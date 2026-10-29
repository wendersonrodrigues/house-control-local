// A TV whose screen lights up while it is on, and a sliding gate that moves along its wall
// opening, so the model shows at a glance whether the house is open.
import * as THREE from 'three';
import { box, mat, at } from './kit.js';
import { buildPiece } from './furniture.js';

const SCREEN_OFF = new THREE.Color('#27407a');
const SCREEN_ON = new THREE.Color('#a8c8ff');

export class TVUnit {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = buildPiece({ type: 'tv', pos: cfg.pos, rot: cfg.rot, width: cfg.width });
    this.screen = this.group.getObjectByName('screen');
    this.screen.material = this.screen.material.clone();
    // The room in front of the screen takes on its glow.
    this.glow = new THREE.PointLight('#7fb0ff', 0, 4.5, 1.6);
    this.glow.position.set(0, 0.8, 0.5);
    this.group.add(this.glow);

    const sw = cfg.width * 0.84;
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(cfg.width, sw * 0.5625 + 0.5, 0.6), new THREE.MeshBasicMaterial());
    this.hit.position.set(0, 0.6, 0);
    this.hit.visible = false;
    this.hit.userData = { kind: 'tv', id: cfg.id };
    this.group.add(this.hit);

    this.power = 0;
    this.goal = 0;
    this.playing = false;
    this.clock = 0;
    this.hover = 0;
    this.hoverGoal = 0;
  }

  anchor(out) {
    return out.set(0, 1.15, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false } = {}) {
    this.goal = state?.on ? 1 : 0;
    this.playing = state?.state === 'playing';
    if (instant) this.power = this.goal;
  }

  update(dt) {
    this.power += (this.goal - this.power) * (1 - Math.exp(-dt * 4));
    if (Math.abs(this.goal - this.power) < 0.002) this.power = this.goal;
    this.hover += (this.hoverGoal - this.hover) * (1 - Math.exp(-dt * 14));
    this.clock += dt;
    // A playing picture never holds still: a slow shimmer in the light it throws.
    const shimmer = this.playing ? 0.85 + Math.sin(this.clock * 2.3) * 0.08 + Math.sin(this.clock * 5.1) * 0.05 : 1;
    const p = this.power;
    const m = this.screen.material;
    m.emissive.copy(SCREEN_OFF).lerp(SCREEN_ON, p);
    m.emissiveIntensity = 0.2 + p * 1.5 * shimmer + this.hover * 0.25;
    this.glow.intensity = p * 2.2 * shimmer;
    return this.goal !== this.power || this.playing && p > 0 || Math.abs(this.hoverGoal - this.hover) > 0.004;
  }
}

const SLAT = 0.16;

export class GateUnit {
  /** `rooms` tells which side of the wall is outside: the gate runs on that face. */
  constructor(cfg, rooms) {
    this.cfg = cfg;
    const [ax, az] = cfg.from;
    const [bx, bz] = cfg.to;
    this.length = Math.hypot(bx - ax, bz - az);
    const along = new THREE.Vector3(bx - ax, 0, bz - az).normalize();
    this.slide = cfg.slide === 'from' ? along.clone().negate() : along;
    const mid = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2);
    const normal = new THREE.Vector3(-along.z, 0, along.x);
    const inside = (p) => rooms.some((r) => p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d);
    if (inside(mid.clone().addScaledVector(normal, 0.3))) normal.negate();
    this.outward = normal.clone(); // towards the street
    this.home = mid.addScaledVector(normal, 0.15);

    const h = cfg.height;
    this.group = new THREE.Group();
    this.group.position.copy(this.home);
    this.group.rotation.y = Math.atan2(-along.z, along.x);
    // Black horizontal slats, the way the real one is built.
    const leaf = new THREE.Group();
    const body = mat('#8d939f', { rough: 0.5, metal: 0.2 }); // grey: the real black one would vanish in the night scene
    const line = mat('#5d6472', { rough: 0.45, metal: 0.2 });
    leaf.add(at(box(this.length, h, 0.05, body, { r: 0.01 }), 0, h / 2, 0));
    for (let y = SLAT; y < h - 0.05; y += SLAT) {
      leaf.add(at(box(this.length - 0.04, 0.012, 0.056, line, { r: 0 }), 0, y, 0));
    }
    this.leaf = leaf;
    this.group.add(leaf);

    // A warning lamp on the wall beside the gate: amber and blinking while it moves.
    this.beaconMat = new THREE.MeshStandardMaterial({ color: '#3a2a10', emissive: '#ffae2e', emissiveIntensity: 0, roughness: 0.3 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), this.beaconMat);
    const end = this.slide.dot(along) > 0 ? -this.length / 2 : this.length / 2;
    beacon.position.set(end - Math.sign(end) * 0.12, h + 0.12, 0);
    this.group.add(beacon);
    this.beaconLight = new THREE.PointLight('#ffae2e', 0, 3, 2);
    this.beaconLight.position.copy(beacon.position);
    this.group.add(this.beaconLight);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(this.length, h, 0.4), new THREE.MeshBasicMaterial());
    this.hit.position.set(0, h / 2, 0);
    this.hit.visible = false;
    this.hit.userData = { kind: 'gate', id: cfg.id };
    leaf.add(this.hit);

    this.open = 0;     // 0 closed … 1 fully open
    this.goal = 0;
    this.moving = false;
    this.clock = 0;
    this.hover = 0;
    this.hoverGoal = 0;
    this.slideLocal = this.slide.dot(along) > 0 ? 1 : -1;
  }

  anchor(out) {
    return out.set(this.leaf.position.x, this.cfg.height + 0.2, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false } = {}) {
    const s = state?.state || 'closed';
    this.goal = typeof state?.position === 'number' ? state.position : s === 'open' || s === 'opening' ? 1 : 0;
    this.moving = s === 'opening' || s === 'closing';
    if (instant && !this.moving) this.open = this.goal;
  }

  update(dt) {
    this.clock += dt;
    this.hover += (this.hoverGoal - this.hover) * (1 - Math.exp(-dt * 14));
    // Travels at the real gate's pace, however its state arrives (a cover that jumps from
    // closed to open still slides across).
    const step = dt / Math.max(1, this.cfg.travel);
    const diff = this.goal - this.open;
    this.open = Math.abs(diff) <= step ? this.goal : this.open + Math.sign(diff) * step;
    this.leaf.position.x = this.slideLocal * this.open * this.length;
    const travelling = this.open !== this.goal || this.moving;
    const blink = travelling ? (Math.sin(this.clock * 7) > 0 ? 1 : 0.15) : 0;
    this.beaconMat.emissiveIntensity = blink * 2.4 + this.hover * 0.6;
    this.beaconLight.intensity = blink * 1.6;
    return travelling || Math.abs(this.hoverGoal - this.hover) > 0.004;
  }
}
