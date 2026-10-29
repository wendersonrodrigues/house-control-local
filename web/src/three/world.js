// The 3D stage: renderer, camera rig, picking and the per-frame animation loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildHouse } from './house.js';
import { buildFurniture } from './furniture.js';
import { LightUnit } from './lights.js';
import { ACUnit } from './ac.js';
import { TVUnit, GateUnit } from './devices.js';

export const STAGE_BG = '#0a0e1a';

const rad = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;
const ORBIT_AZ = 40;       // degrees of freedom either side of the plan's default view
const EL_MIN = 26;
const EL_MAX = 70;
const ZOOM_MIN = 0.18;     // closest: a long home needs to get near one room
const ZOOM_MAX = 1.2;

export function createWorld(canvas, config, store, { onHover, onPick, background = STAGE_BG }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // the model is static: shadow maps are rendered once

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 120);

  const { minX, minZ, maxX, maxZ } = config.bounds;
  const H = config.wallHeight;
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const span = Math.max(maxX - minX, maxZ - minZ);

  const baseAz = config.camera.azimuth;
  const camDir = new THREE.Vector3(Math.sin(rad(baseAz)), 0, Math.cos(rad(baseAz)));

  /* ---------- content ---------- */

  const house = buildHouse(config, camDir);
  scene.add(house.group);
  scene.add(buildFurniture(config.furniture));

  const lights = new Map();
  for (const cfg of config.lights) {
    const unit = new LightUnit(cfg, H);
    lights.set(cfg.id, unit);
    scene.add(unit.group);
  }

  // Every shadow-casting lamp costs the shader a texture sampler, and WebGL caps how many
  // one program may use (16 on Apple GPUs — and the moonlight takes one of them too). Past
  // the cap the program no longer links, three.js logs `useProgram: program not valid` on
  // every draw and the whole stage renders black. The bundled demo plans have 11 lamps, so
  // this only shows up on a real floor plan. Give the most important lamps the shadow slots
  // and let the rest light the room without casting.
  const SHADOW_PRIORITY = { ceiling: 0, flood: 0, pendant: 1, floor: 2, spots: 3, table: 4, strip: 9 };
  const canShadow = (unit) => unit.lights.some((l) => l.userData.canShadow);
  const shadowCap = Math.max(1, Math.min(8, renderer.capabilities.maxTextures - 6));
  const ranked = [...lights.values()].sort((a, b) =>
    (SHADOW_PRIORITY[a.cfg.type] ?? 9) - (SHADOW_PRIORITY[b.cfg.type] ?? 9));
  // One lamp per room first, so every room keeps some depth, then fill up to the cap.
  const shadowOrder = [];
  const seenRooms = new Set();
  for (const unit of ranked) {
    if (shadowOrder.length >= shadowCap) break;
    if (canShadow(unit) && !seenRooms.has(unit.cfg.room)) { shadowOrder.push(unit); seenRooms.add(unit.cfg.room); }
  }
  for (const unit of ranked) {
    if (shadowOrder.length >= shadowCap) break;
    if (canShadow(unit) && !shadowOrder.includes(unit)) shadowOrder.push(unit);
  }
  for (const unit of lights.values()) {
    const keep = shadowOrder.includes(unit);
    for (const l of unit.lights) if (l.userData.canShadow) l.castShadow = keep;
  }

  const acs = new Map();
  for (const cfg of config.acs) {
    const unit = new ACUnit(cfg);
    acs.set(cfg.id, unit);
    scene.add(unit.group);
  }
  const tvs = new Map();
  for (const cfg of config.tvs || []) {
    const unit = new TVUnit(cfg);
    tvs.set(cfg.id, unit);
    scene.add(unit.group);
  }
  // Only gates the plan places on a wall (`from` / `to`) are drawn.
  const gates = new Map();
  for (const cfg of (config.gates || []).filter((g) => g.from && g.to)) {
    const unit = new GateUnit(cfg, config.rooms);
    gates.set(cfg.id, unit);
    scene.add(unit.group);
  }
  const hitTargets = [...[...lights.values()].map((u) => u.hit), ...[...acs.values()].map((u) => u.hit),
    ...[...tvs.values()].map((u) => u.hit), ...[...gates.values()].map((u) => u.hit), ...house.floors];

  // Night-time ambience: enough to read the model with every lamp off. By day (setDaylight)
  // the same two lights become sky and sun.
  const sky = new THREE.HemisphereLight(0x8ea6ff, 0x0b0e17, 0.42);
  scene.add(sky);
  const moon = new THREE.DirectionalLight(0xa9c0ff, 0.6);
  // Steep and coming from the viewer's side, so the faces we look at stay readable.
  moon.position.copy(center).add(new THREE.Vector3(camDir.x * 3.2 + 1.5, 10, camDir.z * 3.2 - 1.5));
  moon.target.position.copy(center);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = sc.bottom = -span * 0.85;
  sc.right = sc.top = span * 0.85;
  sc.near = 1;
  sc.far = 30;
  moon.shadow.bias = -0.0008;
  moon.shadow.normalBias = 0.04;
  moon.shadow.radius = 4;
  scene.add(moon, moon.target);

  // 0 at night … 1 in full daylight.
  const NIGHT = { sky: new THREE.Color(0x8ea6ff), ground: new THREE.Color(0x0b0e17), sun: new THREE.Color(0xa9c0ff), bg: new THREE.Color(background) };
  const DAY = { sky: new THREE.Color(0xe4eeff), ground: new THREE.Color(0x8a8070), sun: new THREE.Color(0xfff0d8),
    bg: new THREE.Color(background === STAGE_BG ? '#6f93c4' : background) };
  let daylight = -1;
  function setDaylight(d) {
    d = clamp(d, 0, 1);
    if (Math.abs(d - daylight) < 0.005) return;
    daylight = d;
    // The sky lights everything alike (no shadows), so it stays low: the daylight is the sun,
    // which the roofs over the indoor rooms keep out (house.js).
    sky.color.copy(NIGHT.sky).lerp(DAY.sky, d);
    sky.groundColor.copy(NIGHT.ground).lerp(DAY.ground, d);
    sky.intensity = 0.42 + d * 0.22;
    moon.color.copy(NIGHT.sun).lerp(DAY.sun, d);
    moon.intensity = 0.6 + d * 3.6;
    // Lower by day than the moon, so the sun slants in through the windows.
    moon.position.copy(center).add(v.set(camDir.x * (3.2 + d * 4) + 1.5 + d * 1.5, 10 - d * 2, camDir.z * (3.2 + d * 4) - 1.5 - d * 1.5));
    scene.background.copy(NIGHT.bg).lerp(DAY.bg, d);
    renderer.toneMappingExposure = 1.05 - d * 0.1;
    bloom.strength = 0.34 - d * 0.2; // lamps glow less in the sun
    // The roofs keep out the sun, not the moonlight the model is read by at night.
    for (const roof of house.roofs) roof.castShadow = d > 0.02;
    shadowFrames = Math.max(shadowFrames, 1);
    wake();
  }

  // The sun's elevation from Home Assistant when known; otherwise a rough one from the
  // clock (up at 6, highest at noon, down at 18). Full day from 8° up, night below -6°.
  function daylightNow() {
    const forced = store.state.daylight;
    if (typeof forced === 'number') return forced;
    let e = store.state.sun?.elevation;
    if (typeof e !== 'number') {
      const d = new Date();
      e = 70 * Math.sin(Math.PI * (d.getHours() + d.getMinutes() / 60 - 6) / 12);
    }
    const t = clamp((e + 6) / 14, 0, 1);
    return t * t * (3 - 2 * t);
  }
  const daylightTimer = setInterval(() => setDaylight(daylightNow()), 60_000);

  /* ---------- post-processing ---------- */

  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.34, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- camera rig ---------- */

  const rig = {
    az: baseAz, el: config.camera.elevation, dist: 30, target: center.clone(),
    goal: { az: baseAz, el: config.camera.elevation, dist: 30, target: center.clone() },
    zoom: 1, focus: null,
    // Where the view was dragged to, on the floor, from the framed centre.
    pan: new THREE.Vector3(),
  };
  let width = 1;
  let height = 1;
  let topInset = 0;    // pixels at the top covered by the header
  let bottomInset = 0; // pixels at the bottom covered by the panel

  const v = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function basis(az, el) {
    const a = rad(az);
    const e = rad(el);
    fwd.set(-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e));
    right.set(Math.cos(a), 0, -Math.sin(a));
    up.crossVectors(right, fwd);
  }

  // Smallest distance at which `box` fits the usable part of the viewport.
  function fitDistance(box, az, el, fill) {
    basis(az, el);
    const c = box.getCenter(new THREE.Vector3());
    const usableH = Math.max(0.3, (height - topInset - bottomInset) / height);
    const tanV = Math.tan(rad(camera.fov / 2)) * fill * usableH;
    const tanH = Math.tan(rad(camera.fov / 2)) * camera.aspect * fill;
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const depth = v.dot(fwd);
      dist = Math.max(dist, Math.abs(v.dot(right)) / tanH - depth, Math.abs(v.dot(up)) / tanV - depth);
    }
    return { dist, center: c };
  }

  function frameGoal() {
    const f = rig.focus;
    let box;
    let fill = 0.96;
    if (f?.kind === 'room') {
      const r = config.rooms.find((x) => x.id === f.id);
      box = new THREE.Box3(new THREE.Vector3(r.x, 0, r.z), new THREE.Vector3(r.x + r.w, H * 0.75, r.z + r.d));
      fill = 0.84;
    } else if (f?.kind === 'ac') {
      const unit = acs.get(f.id);
      const p = unit.group.position;
      const out = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.group.quaternion);
      box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(p.x + out.x * 1.3, 1.25, p.z + out.z * 1.3), new THREE.Vector3(3.6, 2.6, 3.6));
      fill = 0.92;
    } else if (f?.kind === 'tv' && tvs.get(f.id)) {
      const unit = tvs.get(f.id);
      const p = unit.group.position;
      const out = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.group.quaternion);
      box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(p.x + out.x * 1.4, 1.0, p.z + out.z * 1.4), new THREE.Vector3(3.4, 2.2, 3.4));
      fill = 0.92;
    } else if (f?.kind === 'gate' && gates.get(f.id)) {
      const unit = gates.get(f.id);
      // The opening and the stretch of wall the leaf slides along.
      const c = unit.home.clone().addScaledVector(unit.slide, unit.length / 2);
      box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(c.x, 1.2, c.z),
        new THREE.Vector3(Math.abs(unit.slide.x) * unit.length * 2 + 3, 2.6, Math.abs(unit.slide.z) * unit.length * 2 + 3));
      fill = 0.9;
    } else {
      box = new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, H * 0.8, maxZ));
    }
    const { dist, center: c } = fitDistance(box, rig.goal.az, rig.goal.el, fill);
    rig.goal.dist = dist * rig.zoom;
    // Never further out than the home itself.
    rig.pan.x = clamp(rig.pan.x, minX - c.x, maxX - c.x);
    rig.pan.z = clamp(rig.pan.z, minZ - c.z, maxZ - c.z);
    rig.goal.target.copy(c).add(rig.pan);
  }

  // The point on the floor under the pointer, or null when it points at the sky.
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function floorAt(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
  }

  // Zooms by `factor` keeping the floor point under the pointer where it is on screen.
  function zoomAt(ev, factor) {
    const next = clamp(rig.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const s = next / rig.zoom;
    const p = ev && floorAt(ev);
    rig.zoom = next;
    if (p) rig.pan.addScaledVector(v.copy(rig.goal.target).sub(p), s - 1);
    if (rig.zoom >= 1) rig.pan.multiplyScalar(0.5); // zoomed back out: drift home
    frameGoal();
    wake();
  }

  // Slides the view with the pointer: one pixel moves what is under it by one pixel.
  const ground = new THREE.Vector3();
  function panBy(dx, dy) {
    basis(rig.az, rig.el);
    const perPixel = (2 * rig.dist * Math.tan(rad(camera.fov / 2))) / Math.max(1, height);
    ground.set(fwd.x, 0, fwd.z).normalize();
    rig.pan.addScaledVector(right, -dx * perPixel);
    rig.pan.addScaledVector(ground, (dy * perPixel) / Math.max(0.3, Math.sin(rad(rig.el))));
    frameGoal();
    wake();
  }

  function updateRig(dt, instant = false) {
    const k = instant ? 1 : 1 - Math.exp(-dt * 5.5);
    const g = rig.goal;
    const delta = Math.abs(g.az - rig.az) + Math.abs(g.el - rig.el) + Math.abs(g.dist - rig.dist) * 2
      + rig.target.distanceTo(g.target) * 4;
    rig.az += (g.az - rig.az) * k;
    rig.el += (g.el - rig.el) * k;
    rig.dist += (g.dist - rig.dist) * k;
    rig.target.lerp(g.target, k);
    basis(rig.az, rig.el);
    camera.position.copy(rig.target).addScaledVector(fwd, -rig.dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(rig.target);
    return delta > 0.002;
  }

  /* ---------- state sync ---------- */

  function syncAll(opts = {}) {
    let i = 0;
    for (const [id, unit] of lights) {
      unit.apply(store.state.lights[id], { ...opts, delay: opts.stagger ? 0.25 + i++ * 0.06 : 0 });
    }
    for (const [id, unit] of acs) unit.apply(store.state.acs[id], opts);
    for (const [id, unit] of tvs) unit.apply(store.state.tvs?.[id], opts);
    for (const [id, unit] of gates) unit.apply(store.state.gates?.[id], opts);
    setDaylight(daylightNow());
    wake();
  }

  const unsubscribe = store.on((change) => {
    if (change.type === 'tick') return;
    if (change.type === 'light') lights.get(change.id).apply(store.state.lights[change.id]);
    else if (change.type === 'ac') acs.get(change.id).apply(store.state.acs[change.id]);
    else if (change.type === 'tv') tvs.get(change.id)?.apply(store.state.tvs[change.id]);
    else if (change.type === 'gate') gates.get(change.id)?.apply(store.state.gates[change.id]);
    else if (change.type === 'sun') setDaylight(daylightNow());
    else syncAll();
    wake();
  });

  /* ---------- picking ---------- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  let drag = null;

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    if (!hits.length) return null;
    // Devices win over the floor they stand on.
    const device = hits.find((h) => h.object.userData.kind !== 'room');
    return (device || hits[0]).object.userData;
  }

  function unitOf(t) {
    const map = { light: lights, ac: acs, tv: tvs, gate: gates }[t?.kind];
    return map?.get(t.id) ?? null;
  }

  function screenAnchor(t) {
    const unit = unitOf(t);
    if (!unit) return null;
    unit.anchor(v).project(camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }

  function setHover(t) {
    const same = hovered?.kind === t?.kind && hovered?.id === t?.id;
    if (same) return;
    const prev = unitOf(hovered);
    if (prev) prev.hoverGoal = 0;
    hovered = t && t.kind !== 'room' ? t : null;
    const next = unitOf(hovered);
    if (next) next.hoverGoal = 1;
    canvas.style.cursor = hovered ? 'pointer' : drag?.moved ? 'grabbing' : 'grab';
    onHover(hovered ? { ...hovered, ...screenAnchor(hovered) } : null);
    wake();
  }

  // Two fingers pinch to zoom, the way the scroll wheel does with a mouse.
  const fingers = new Map();
  let pinch = null;
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  };

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (fingers.size === 2) {
      pinch = { spread: spread(), zoom: rig.zoom };
      drag = null;
      setHover(null);
      return;
    }
    if (fingers.size > 2) return;
    // The right or middle button, or Shift / Option held, slides the view instead of turning it.
    const panning = ev.button === 1 || ev.button === 2 || ev.shiftKey || ev.altKey;
    drag = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, az: rig.goal.az, el: rig.goal.el, moved: false, panning };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (fingers.has(ev.pointerId)) fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) {
      if (fingers.size >= 2) {
        zoomAt(null, (pinch.zoom * pinch.spread / spread()) / rig.zoom);
      }
      return;
    }
    if (drag) {
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; setHover(null); canvas.style.cursor = 'grabbing'; }
      if (drag.moved && drag.panning) {
        panBy(ev.clientX - drag.lx, ev.clientY - drag.ly);
        drag.lx = ev.clientX;
        drag.ly = ev.clientY;
      } else if (drag.moved) {
        rig.goal.az = clamp(drag.az - dx * 0.35, baseAz - ORBIT_AZ, baseAz + ORBIT_AZ);
        rig.goal.el = clamp(drag.el + dy * 0.3, EL_MIN, EL_MAX);
        frameGoal();
        wake();
      }
      return;
    }
    setHover(pick(ev));
  });
  const release = (ev) => {
    fingers.delete(ev.pointerId);
    if (pinch) { if (!fingers.size) pinch = null; return; } // lifting after a pinch picks nothing
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    canvas.style.cursor = 'grab';
    if (wasDrag || ev.button !== 0) return;
    const t = pick(ev);
    if (!t) { onPick(null); return; }
    if (t.kind === 'light') lights.get(t.id).bump();
    onPick(t);
    wake();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (ev) => {
    fingers.delete(ev.pointerId);
    if (!fingers.size) pinch = null;
    drag = null;
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // A trackpad pinch arrives as a wheel with Control held, in smaller steps.
    zoomAt(ev, Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  // Double-click: the whole home again.
  canvas.addEventListener('dblclick', () => {
    rig.zoom = 1;
    rig.pan.set(0, 0, 0);
    frameGoal();
    wake();
  });
  canvas.style.cursor = 'grab';

  /* ---------- loop ---------- */

  let raf = 0;
  let last = 0;
  let awake = 0;       // frames still owed after the last change
  let running = false;
  let shadowFrames = 3;

  function wake(frames = 2) {
    awake = Math.max(awake, frames);
    if (running && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let active = updateRig(dt);
    for (const unit of lights.values()) active = unit.update(dt) || active;
    for (const unit of acs.values()) active = unit.update(dt) || active;
    for (const unit of tvs.values()) active = unit.update(dt) || active;
    for (const unit of gates.values()) active = unit.update(dt) || active;
    if (shadowFrames > 0) { renderer.shadowMap.needsUpdate = true; shadowFrames--; active = true; }
    if (active || awake > 0) {
      composer.render(dt);
      awake = Math.max(0, awake - 1);
      if (hovered && active) onHover({ ...hovered, ...screenAnchor(hovered) });
    }
    if (running && (active || awake > 0)) raf = requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    width = r.width;
    height = r.height;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // Centre the model between header and panel by shifting the projection window.
    camera.setViewOffset(width, height, 0, -(topInset - bottomInset) / 2, width, height);
    camera.updateProjectionMatrix();
    frameGoal();
    wake(3);
  }

  const world = {
    lights,
    acs,

    /** 0 night … 1 day: sky, sun and background follow. */
    setDaylight,

    setInsets(top, bottom) { topInset = top; bottomInset = bottom; resize(); },
    resize,

    focus(next) {
      rig.focus = next;
      rig.zoom = 1;
      rig.pan.set(0, 0, 0);
      // A TV or a gate is looked at from the side it faces, as far as the orbit allows.
      const facing = (dir) => clamp(THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z)), baseAz - ORBIT_AZ, baseAz + ORBIT_AZ);
      if (next?.kind === 'tv' && tvs.get(next.id)) {
        rig.goal.az = facing(new THREE.Vector3(0, 0, 1).applyQuaternion(tvs.get(next.id).group.quaternion));
        rig.goal.el = 30;
      } else if (next?.kind === 'gate' && gates.get(next.id)) {
        rig.goal.az = facing(gates.get(next.id).outward);
        rig.goal.el = 30;
      } else {
        rig.goal.az = baseAz + (next?.kind === 'ac' ? (WALL_SIDE[acs.get(next.id).cfg.wall] ?? 0) : 0);
        rig.goal.el = next?.kind === 'ac' ? 30 : config.camera.elevation;
      }
      frameGoal();
      wake();
    },

    // Camera sweep + staggered light-up, played whenever the panel appears.
    intro() {
      syncAll({ instant: true });
      for (const unit of lights.values()) { unit.level = 0; unit.write(); }
      for (const unit of acs.values()) unit.power = 0;
      syncAll({ stagger: true });
      frameGoal();
      rig.az = rig.goal.az - 16;
      rig.el = rig.goal.el + 9;
      rig.dist = rig.goal.dist * 1.28;
      rig.target.copy(rig.goal.target);
      wake(4);
    },

    setRunning(on) {
      running = on;
      if (on) wake(4);
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },

    dispose() {
      unsubscribe();
      clearInterval(daylightTimer);
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      composer.dispose();
      target.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },

    // Jump every running animation to its end state (used by tests and screenshots).
    settle(seconds = 6) {
      for (let t = 0; t < seconds; t += 0.05) {
        updateRig(0.05);
        for (const unit of lights.values()) unit.update(0.05);
        for (const unit of acs.values()) unit.update(0.05);
      }
      renderer.shadowMap.needsUpdate = true;
      composer.render(0);
    },
  };

  syncAll({ instant: true });
  resize();
  updateRig(0, true);
  return world;
}

// Looking at an AC slightly from the side shows its airflow better.
const WALL_SIDE = { north: -14, west: 14, south: 0, east: 0 };
