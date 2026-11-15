// Shadows computed once into textures instead of sampled from shadow maps on every frame.
//
// The model does not move, so the shadows on its floors never change while the lamps go on and
// off; only the moon / sun moves with the time of day. Every lamp that casts a shadow (and the
// moon) gets one channel of a floor-sized texture, seen from above, holding how much of its
// light each spot of the floor loses. Rendering then reads those textures (a few lookups per
// floor pixel) and no shadow map at all: the shadow maps exist only while baking, then are
// freed. Walls and furniture no longer receive shadows; the lamps stay inside their rooms
// through the room mask (roommask.js).
import * as THREE from 'three';

const TEXELS_PER_METRE = 56;
const MAX_SIZE = 2048;
const PAD = 0.45; // the plinth around the model
const LAYER = 7;  // what the bake camera sees: the floors and the one light being baked

export function createShadowBake(renderer, scene, bounds, receivers, { sun, lamps }) {
  const minX = bounds.minX - PAD;
  const maxX = bounds.maxX + PAD;
  const minZ = bounds.minZ - PAD;
  const maxZ = bounds.maxZ + PAD;
  const W = maxX - minX;
  const D = maxZ - minZ;
  const scale = Math.min(TEXELS_PER_METRE, MAX_SIZE / Math.max(W, D));
  const size = [Math.max(4, Math.round(W * scale)), Math.max(4, Math.round(D * scale))];

  // Texture 0 is the sun's alone (it is baked again as the day goes by); the lamps fill the
  // others, four to a texture.
  const channel = new Map([[sun, 0]]);
  lamps.forEach((l, i) => channel.set(l, 4 + i));
  const count = 1 + Math.ceil(lamps.length / 4);
  const targets = Array.from({ length: count }, () => new THREE.WebGLRenderTarget(size[0], size[1], {
    type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  }));

  // Seen from straight above, x to the right and -z up: u = (x - minX) / W, v = (maxZ - z) / D.
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0.1, 60);
  camera.position.set((minX + maxX) / 2, 30, (minZ + maxZ) / 2);
  camera.up.set(0, 0, -1);
  camera.lookAt((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  camera.updateMatrixWorld();
  // The shadow maps are drawn by an ordinary render, of everything (all layers), into one
  // pixel and with a material that writes nothing: only the shadow pass inside it counts.
  const casterView = camera.clone();
  casterView.layers.enableAll();
  const pixel = new THREE.WebGLRenderTarget(1, 1);
  const nothing = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  camera.layers.set(LAYER);
  for (const m of receivers) m.layers.enable(LAYER);

  // Each light writes how much of it is lost into its own channel, zero in the others, and
  // the texture keeps the largest value per channel (MAX blending): the lights of one texture
  // add up without touching each other, and the plinth under the floors (in the same shadow)
  // changes nothing.
  const shadowMaterials = [0, 1, 2, 3].map((c) => {
    const m = new THREE.ShadowMaterial({
      color: new THREE.Color(c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0),
      opacity: 1,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
    });
    const alpha = c === 3 ? '1.0' : '0.0';
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `float bakeLoss = opacity * ( 1.0 - getShadowMask() );\n\tgl_FragColor = vec4( color * bakeLoss, bakeLoss * ${alpha} );`);
    };
    m.customProgramCacheKey = () => `bake${c}`;
    return m;
  });

  const uniforms = {
    bakeMaps: { value: targets.map((t) => t.texture) },
    bakeRect: { value: new THREE.Vector4(minX, maxZ, 1 / W, -1 / D) },
  };

  const all = [sun, ...lamps];

  /** Bakes the sun's shadows, or every light's with `everything`. */
  function bake({ everything = true } = {}) {
    const lights = everything ? all : [sun];
    const prev = {
      target: renderer.getRenderTarget(), autoClear: renderer.autoClear, background: scene.background,
      override: scene.overrideMaterial, enabled: renderer.shadowMap.enabled,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    };
    scene.updateMatrixWorld(true);
    renderer.shadowMap.enabled = true;
    for (const l of all) l.castShadow = lights.includes(l);
    scene.background = null;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(pixel);
    scene.overrideMaterial = nothing;
    renderer.render(scene, casterView);

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    for (let t = 0; t < count; t++) {
      const group = all.filter((l) => lights.includes(l) && Math.floor(channel.get(l) / 4) === t);
      if (!group.length) continue;
      renderer.setRenderTarget(targets[t]);
      renderer.clear(true, true, false);
      for (const l of all) l.castShadow = false;
      for (const l of group) {
        l.castShadow = true;
        l.layers.enable(LAYER);
        scene.overrideMaterial = shadowMaterials[channel.get(l) % 4];
        renderer.render(scene, camera);
        l.layers.disable(LAYER);
        l.castShadow = false;
      }
    }

    // Back to drawing without any shadow map: free them.
    for (const l of lights) {
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    for (const l of all) l.castShadow = false;
    renderer.shadowMap.enabled = prev.enabled;
    renderer.shadowMap.needsUpdate = false;
    scene.overrideMaterial = prev.override;
    scene.background = prev.background;
    renderer.autoClear = prev.autoClear;
    renderer.setClearColor(prev.clear, prev.alpha);
    renderer.setRenderTarget(prev.target);
  }

  return {
    uniforms,
    count,
    /** The channel a light's shadow is in, or -1. */
    channelOf: (light) => channel.get(light) ?? -1,
    bake,
    dispose() {
      for (const t of targets) t.dispose();
      for (const m of shadowMaterials) m.dispose();
      pixel.dispose();
      nothing.dispose();
    },
  };
}
