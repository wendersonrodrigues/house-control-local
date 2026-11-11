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

export function applyRoomMask(scene, rooms, camera) {
  if (!rooms.length) return;
  const n = rooms.length;
  const rects = rooms.map((r) => new THREE.Vector4(r.x, r.z, r.x + r.w, r.z + r.d));
  const inRect = (x, z, b) => x > b.x && x < b.z && z > b.y && z < b.w;

  const lights = [];
  const p = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isPointLight && !o.isSpotLight) return;
    o.getWorldPosition(p);
    o.userData.room = rects.findIndex((b) => inRect(p.x, p.z, b));
    lights.push(o);
  });
  const points = Math.max(1, lights.filter((l) => l.isPointLight).length);
  const spots = Math.max(1, lights.filter((l) => l.isSpotLight).length);

  const uniforms = {
    roomRects: { value: rects },
    roomOutdoor: { value: rooms.map((r) => (r.outdoor ? 1 : 0)) },
    pointRoom: { value: new Float32Array(points).fill(-1) },
    spotRoom: { value: new Float32Array(spots).fill(-1) },
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
    for (const l of live) {
      if (l.isPointLight && pi < points) uniforms.pointRoom.value[pi++] = l.userData.room;
      else if (l.isSpotLight && si < spots) uniforms.spotRoom.value[si++] = l.userData.room;
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
uniform float pointRoom[ ${points} ];
uniform float spotRoom[ ${spots} ];
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
  #define ROOM_MASK( lr ) ( ( lr ) < - 0.5 ? 1.0 : inRoomRect( vRoomPos.xz, roomRects[ int( lr ) ], ${pad} ) ? 1.0 : ( roomOutdoor[ int( lr ) ] > 0.5 && ! roomFragIndoor ) ? 1.0 : 0.0 )
`;

  const lightsChunk = fragmentSetup + THREE.ShaderChunk.lights_fragment_begin
    .replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
      'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color *= ROOM_MASK( pointRoom[ i ] );')
    .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );',
      'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tdirectLight.color *= ROOM_MASK( spotRoom[ i ] );');

  function onBeforeCompile(shader) {
    if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <worldpos_vertex>', vertexBody);
    shader.fragmentShader = fragmentHead + shader.fragmentShader.replace('#include <lights_fragment_begin>', lightsChunk);
  }

  const done = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || m.isShaderMaterial || m.isMeshBasicMaterial) continue;
      done.add(m);
      m.onBeforeCompile = onBeforeCompile;
      m.customProgramCacheKey = () => `roommask${n}.${points}.${spots}`;
      m.needsUpdate = true;
    }
  });
}
