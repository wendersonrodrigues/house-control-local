// Walls that stop light. Only a few lamps can afford shadow maps (world.js), so the rest
// would shine through walls into the next room. Instead every lit material learns the
// rooms: a point or spot light standing in a room lights only that room. A light in an
// outdoor room also lights whatever lies outside the indoor rooms (the street, the
// garden); one standing in no room at all lights everything, as before.
//
// Which room each light stands in is worked out here, once; before every render the
// lights are listed in the order three.js hands them to the shader, so the shader only
// compares two numbers per light.
import * as THREE from 'three';

// How far past its walls a room still counts as itself: enough for rounding, less than
// half a wall, so the far face of a wall stays dark.
const PAD = 0.03;
// How far past its walls a covered room keeps out the sun: both faces of an inner wall, the
// inner face of an outer one (0.1 thick each side), not its outer face.
const ROOF_PAD = 0.07;

// `bake` (bake.js), when given: the floors (its receivers) read their shadows from its
// textures, light by light. Everything else under a roof (walls, furniture) reads the sun's
// from the floor below it, so the covered rooms stay out of the daylight as they did with
// shadow maps; it gets no lamp shadows.
export function applyRoomMask(scene, rooms, camera, bake = null, receivers = new Set()) {
  if (!rooms.length) return;
  const n = rooms.length;
  const rects = rooms.map((r) => new THREE.Vector4(r.x, r.z, r.x + r.w, r.z + r.d));
  const inRect = (x, z, b) => x > b.x && x < b.z && z > b.y && z < b.w;
  // The roofed part of open areas (a garage's slab) keeps the sun off too.
  const covers = rooms.filter((r) => r.roof).map((r) => new THREE.Vector4(r.roof.x, r.roof.z, r.roof.x + r.roof.w, r.roof.z + r.roof.d));
  const nc = Math.max(1, covers.length);
  if (!covers.length) covers.push(new THREE.Vector4(0, 0, 0, 0));

  const lights = [];
  const p = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isDirectionalLight) { lights.push(o); return; }
    if (!o.isPointLight && !o.isSpotLight) return;
    o.getWorldPosition(p);
    o.userData.room = rects.findIndex((b) => inRect(p.x, p.z, b));
    lights.push(o);
  });
  const points = Math.max(1, lights.filter((l) => l.isPointLight).length);
  const spots = Math.max(1, lights.filter((l) => l.isSpotLight).length);
  const dirs = Math.max(1, lights.filter((l) => l.isDirectionalLight).length);
  const bakeCount = bake ? bake.count : 0;

  const uniforms = {
    roomRects: { value: rects },
    roomOutdoor: { value: rooms.map((r) => (r.outdoor ? 1 : 0)) },
    coverRects: { value: covers },
    pointRoom: { value: new Float32Array(points).fill(-1) },
    spotRoom: { value: new Float32Array(spots).fill(-1) },
    spotBake: { value: new Float32Array(spots).fill(-1) },
    dirBake: { value: new Float32Array(dirs).fill(-1) },
    ...(bake ? bake.uniforms : {}),
  };

  // The order three.js packs lights in (WebGLLights): visible ones, as the scene is walked,
  // those casting shadows first, then those with a projected texture.
  const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const rank = (l) => (l.castShadow ? 2 : 0) + (l.map ? 1 : 0);
  const before = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    before.apply(this, args);
    const cam = args[2] || camera;
    const live = lights.filter((l) => visible(l) && l.layers.test(cam.layers)).sort((a, b) => rank(b) - rank(a));
    let pi = 0;
    let si = 0;
    let di = 0;
    for (const l of live) {
      if (l.isPointLight && pi < points) uniforms.pointRoom.value[pi++] = l.userData.room;
      else if (l.isSpotLight && si < spots) {
        uniforms.spotBake.value[si] = bake ? bake.channelOf(l) : -1;
        uniforms.spotRoom.value[si++] = l.userData.room;
      } else if (l.isDirectionalLight && di < dirs) uniforms.dirBake.value[di++] = bake ? bake.channelOf(l) : -1;
    }
  };

  const vertexHead = 'varying vec3 vRoomPos;\n';
  const vertexBody = `#include <worldpos_vertex>
  vec4 roomWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    roomWorld = batchingMatrix * roomWorld;
  #endif
  #ifdef USE_INSTANCING
    roomWorld = instanceMatrix * roomWorld;
  #endif
  vRoomPos = ( modelMatrix * roomWorld ).xyz;`;

  const pad = PAD.toFixed(3);
  const fragmentHead = `varying vec3 vRoomPos;
uniform vec4 roomRects[ ${n} ];
uniform float roomOutdoor[ ${n} ];
uniform vec4 coverRects[ ${nc} ];
uniform float pointRoom[ ${points} ];
uniform float spotRoom[ ${spots} ];
uniform float spotBake[ ${spots} ];
uniform float dirBake[ ${dirs} ];
#if defined( ROOM_BAKED_SHADOWS ) || defined( ROOM_BAKED_SUN )
uniform sampler2D bakeMaps[ ${Math.max(1, bakeCount)} ];
uniform vec4 bakeRect;
#endif
bool inRoomRect( vec2 q, vec4 b, float pad ) {
  return q.x > b.x - pad && q.x < b.z + pad && q.y > b.y - pad && q.y < b.w + pad;
}
`;
  // Once per fragment: is it inside some indoor room?
  const fragmentSetup = `
  bool roomFragIndoor = false;
  for ( int r = 0; r < ${n}; r ++ ) {
    if ( roomOutdoor[ r ] < 0.5 && inRoomRect( vRoomPos.xz, roomRects[ r ], - ${pad} ) ) roomFragIndoor = true;
  }
  #ifdef ROOM_BAKED_SHADOWS
  vec2 bakeUV = vec2( ( vRoomPos.x - bakeRect.x ) * bakeRect.z, ( vRoomPos.z - bakeRect.y ) * bakeRect.w );
  float bakeLoss[ ${Math.max(1, bakeCount) * 4} ];
  ${Array.from({ length: Math.max(1, bakeCount) }, (_, t) => `{ vec4 b = texture2D( bakeMaps[ ${t} ], bakeUV ); bakeLoss[ ${t * 4} ] = b.r; bakeLoss[ ${t * 4 + 1} ] = b.g; bakeLoss[ ${t * 4 + 2} ] = b.b; bakeLoss[ ${t * 4 + 3} ] = b.a; }`).join('\n  ')}
  #define BAKE_LIT( ch ) ( ( ch ) < - 0.5 ? 1.0 : 1.0 - bakeLoss[ int( ch ) ] )
  #elif defined( ROOM_BAKED_SUN )
  bool roomUnderRoof = false;
  for ( int r = 0; r < ${n}; r ++ ) {
    if ( roomOutdoor[ r ] < 0.5 && inRoomRect( vRoomPos.xz, roomRects[ r ], ${ROOF_PAD.toFixed(3)} ) ) roomUnderRoof = true;
  }
  for ( int c = 0; c < ${nc}; c ++ ) {
    if ( inRoomRect( vRoomPos.xz, coverRects[ c ], 0.0 ) ) roomUnderRoof = true;
  }
  float bakeSunLoss = roomUnderRoof
    ? texture2D( bakeMaps[ 0 ], vec2( ( vRoomPos.x - bakeRect.x ) * bakeRect.z, ( vRoomPos.z - bakeRect.y ) * bakeRect.w ) ).r : 0.0;
  #define BAKE_LIT( ch ) ( abs( ch ) < 0.5 ? 1.0 - bakeSunLoss : 1.0 )
  #else
  #define BAKE_LIT( ch ) 1.0
  #endif
  #define ROOM_MASK( lr ) ( ( lr ) < - 0.5 ? 1.0 : inRoomRect( vRoomPos.xz, roomRects[ int( lr ) ], ${pad} ) ? 1.0 : ( roomOutdoor[ int( lr ) ] > 0.5 && ! roomFragIndoor ) ? 1.0 : 0.0 )
`;

  const lightsChunk = fragmentSetup + THREE.ShaderChunk.lights_fragment_begin
    .replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
      'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color *= ROOM_MASK( pointRoom[ i ] );')
    .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );',
      'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tdirectLight.color *= ROOM_MASK( spotRoom[ i ] ) * BAKE_LIT( spotBake[ i ] );')
    .replace('getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= BAKE_LIT( dirBake[ i ] );');

  function compiler(baked) {
    return function onBeforeCompile(shader) {
      if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return;
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <worldpos_vertex>', vertexBody);
      const define = !bake ? '' : baked ? '#define ROOM_BAKED_SHADOWS\n' : '#define ROOM_BAKED_SUN\n';
      shader.fragmentShader = define + fragmentHead
        + shader.fragmentShader.replace('#include <lights_fragment_begin>', lightsChunk);
    };
  }

  const done = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || m.isShaderMaterial || m.isMeshBasicMaterial) continue;
      done.add(m);
      const baked = Boolean(bake) && receivers.has(m);
      m.onBeforeCompile = compiler(baked);
      m.customProgramCacheKey = () => `roommask${n}.${nc}.${points}.${spots}.${dirs}.${!bake ? '' : baked ? `bake${bakeCount}` : 'sun'}`;
      m.needsUpdate = true;
    }
  });
}
