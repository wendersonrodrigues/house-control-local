import { post, call, isNative } from './bridge.js';
import { linkOf } from './config.js';

const STORAGE_KEY = 'house-control:state:v1';

export const AC_MODES = ['cool', 'heat', 'dry', 'fan', 'auto'];
export const AC_FANS = ['auto', 'silent', 'low', 'medium', 'high', 'turbo'];
export const AC_SWINGS = ['swing', 'l1', 'l2', 'l3', 'l4', 'l5', 'off'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function defaultLight(cfg) {
  return { on: false, brightness: 0.8, temp: 3000, color: cfg.color || null };
}

function defaultAC(cfg, outdoor) {
  return {
    on: false, target: 24, mode: 'cool', fan: 'auto', swing: 'swing',
    sleep: false, eco: false, roomTemp: Math.min(outdoor - 2, 27),
    // On but not running right now (a real thermostat says so); never sent to a device.
    idle: false,
  };
}

export function createStore(config) {
  const listeners = new Set();
  const lightCfg = new Map(config.lights.map((l) => [l.id, l]));
  const acCfg = new Map(config.acs.map((a) => [a.id, a]));

  const state = { lights: {}, acs: {}, gates: {}, toggles: {}, tvs: {}, scene: null };
  for (const l of config.lights) state.lights[l.id] = defaultLight(l);
  for (const a of config.acs) state.acs[a.id] = defaultAC(a, config.outdoorTemp);
  for (const g of config.gates) state.gates[g.id] = { state: 'closed', position: 0, dir: 'close', motion: null, online: true };
  for (const t of config.toggles) state.toggles[t.id] = { on: false, online: true };
  for (const t of config.tvs) {
    state.tvs[t.id] = { on: false, online: true, state: 'off', volume: 0.2, muted: false, source: null, sources: [], title: null };
  }
  const tvCfg = new Map(config.tvs.map((t) => [t.id, t]));
  const gateCfg = new Map(config.gates.map((g) => [g.id, g]));
  const toggleCfg = new Map(config.toggles.map((t) => [t.id, t]));
  // What each real AC can do, as reported by the native side. A simulated AC can do everything.
  const features = {};

  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.home === config.name) {
      for (const [id, s] of Object.entries(saved.lights || {})) if (state.lights[id]) Object.assign(state.lights[id], s);
      for (const [id, s] of Object.entries(saved.acs || {})) if (state.acs[id]) Object.assign(state.acs[id], s);
      for (const [id, f] of Object.entries(saved.features || {})) if (state.acs[id]) features[id] = f;
      for (const [id, g] of Object.entries(saved.gates || {})) {
        if (!state.gates[id]) continue;
        // A gate that was moving when the app closed is shown where it was last seen.
        const { motion, timer, run, ...rest } = g;
        Object.assign(state.gates[id], rest);
        if (motion) Object.assign(state.gates[id], settle(rest.position ?? 0));
      }
      for (const [id, t] of Object.entries(saved.toggles || {})) if (state.toggles[id]) Object.assign(state.toggles[id], t);
      for (const [id, t] of Object.entries(saved.tvs || {})) if (state.tvs[id]) Object.assign(state.tvs[id], t);
      state.scene = saved.scene || null;
      restored = true;
    }
  } catch { /* storage unavailable: start from defaults */ }

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ home: config.name, ...state, features }));
      } catch { /* ignore */ }
    }, 200);
  }

  function emit(change) {
    for (const fn of listeners) fn(change);
    if (change.type !== 'tick') {
      persist();
      post('summary', summary());
      // The native shell passes this on to its other views of the same home (the panel
      // and the island each run their own store), which adopt it without re-sending.
      if (!change.adopted) post('state', { lights: state.lights, acs: state.acs, gates: state.gates, toggles: state.toggles, tvs: state.tvs, sun: state.sun, scene: state.scene, source: change.source ?? store.source ?? null });
    }
  }

  // One command per device is in flight at a time. Whatever changes meanwhile is merged
  // into a single follow-up, so dragging a slider costs a couple of requests (or infrared
  // key presses) instead of dozens. A change the device refuses is rolled back.
  const COOL_DOWN = { light: 300, ac: 900 };
  const outbox = new Map();

  function transmit(kind, id, patch) {
    if (!isNative) return Promise.resolve();
    const current = kind === 'light' ? state.lights[id] : state.acs[id];
    const sent = call('command', { kind, id, patch, state: { ...current } });
    // Never let a lost reply block the device for good.
    return Promise.race([sent, new Promise((resolve) => setTimeout(resolve, 20000))]);
  }

  function dispatch(kind, id, patch, before) {
    const slot = outbox.get(id);
    if (slot) {
      slot.pending = { ...slot.pending, ...patch };
      slot.before = { ...before, ...slot.before }; // the oldest value is the one to return to
      return;
    }
    const entry = { pending: null, before: null };
    outbox.set(id, entry);
    run(kind, id, patch, before, entry);
  }

  function run(kind, id, patch, before, entry) {
    const started = performance.now();
    transmit(kind, id, patch)
      .catch((error) => rollback(kind, id, patch, before, entry, error))
      .then(() => setTimeout(() => {
        if (!entry.pending) { outbox.delete(id); return; }
        const [next, prior] = [entry.pending, entry.before];
        entry.pending = entry.before = null;
        run(kind, id, next, prior, entry);
      }, Math.max(0, COOL_DOWN[kind] - (performance.now() - started))));
  }

  function rollback(kind, id, patch, before, entry, error) {
    const current = kind === 'light' ? state.lights[id] : state.acs[id];
    let any = false;
    for (const key of error.detail?.failed || Object.keys(patch)) {
      if (!(key in patch)) continue;
      // Changed again in the meantime: that follow-up now falls back to the last good value.
      if (entry.pending && key in entry.pending) { entry.before[key] = before[key]; continue; }
      if (current[key] !== patch[key]) continue; // a real device reported something newer
      current[key] = before[key];
      any = true;
    }
    if (any) emit({ type: kind, id, reverted: true });
    store.onDeviceError?.(id, error.message);
  }

  // The gate, the shortcuts and the automation switches: one command each, never merged
  // (two presses on the gate are two commands). Without a real device the result is simulated.
  async function order(kind, id, patch) {
    if (!isNative) return;
    await call('command', { kind, id, patch, state: {} });
  }

  function writeGate(id, patch) {
    const cur = state.gates[id];
    if (!cur) return false;
    const changed = Object.entries(patch).some(([k, v]) => cur[k] !== v);
    // When it last opened or closed, for "aberto desde 14:32".
    if ('state' in patch && patch.state !== cur.state) cur.since = Date.now();
    Object.assign(cur, patch);
    return changed;
  }

  // ---- the gate's one-button model ----
  // The time a full run takes: typed in (travelMode "manual"), or learned from the gate itself
  // ("auto"): how long full openings and closings started here took until Home Assistant
  // said "open" / "closed", averaged over the last few. Until it has one, the typed value.
  const MAX_SAMPLES = 6;
  function travelSeconds(cur, cfg) {
    const typed = cfg?.travel ?? 14;
    if (cfg?.travelMode === 'manual' || !cur?.samples?.length) return typed;
    return cur.samples.reduce((a, b) => a + b, 0) / cur.samples.length;
  }
  const travelOf = (id) => travelSeconds(state.gates[id], gateCfg.get(id));
  const travelMs = (cfg, cur = state.gates[cfg?.id]) => Math.max(1, travelSeconds(cur, cfg)) * 1000;
  function learn(id, seconds) {
    const cur = state.gates[id];
    if (!(seconds >= 3 && seconds <= 180)) return; // a missed report, not a run
    cur.samples = [...(cur.samples || []), Math.round(seconds * 10) / 10].slice(-MAX_SAMPLES);
    cur.travel = travelOf(id);
  }
  function gatePos(cur, cfg) {
    if (!cur) return 0;
    if (!cur.motion) return cur.position ?? 0;
    const t = (Date.now() - cur.motion.start) / travelMs(cfg);
    return clamp(cur.motion.from + (cur.motion.dir === 'open' ? t : -t), 0, 1);
  }
  function gateNext(cur) {
    if (!cur) return 'open';
    if (cur.motion) return 'stop';
    const p = cur.position ?? 0;
    if (p >= 0.99) return 'close';
    if (p <= 0.01) return 'open';
    return cur.dir === 'open' ? 'close' : 'open';
  }
  /** The state shown for a gate standing at `p`. */
  function settle(p) {
    return { position: p, motion: null, state: p >= 0.99 ? 'open' : p <= 0.01 ? 'closed' : 'stopped' };
  }
  function moveGate(id, dir, from, own = false) {
    const cur = state.gates[id];
    const cfg = gateCfg.get(id);
    const p = from ?? gatePos(cur, cfg);
    clearTimeout(cur.timer);
    writeGate(id, { state: dir === 'open' ? 'opening' : 'closing', dir, position: p, travel: travelOf(id),
      motion: { dir, from: p, start: Date.now(), full: p <= 0.01 || p >= 0.99, own: Boolean(own) } });
    // Kept after the run ends here: Home Assistant's "open" / "closed" may come later.
    cur.run = cur.motion;
    emit({ type: 'gate', id });
    const left = (dir === 'open' ? 1 - p : p) * travelMs(cfg);
    cur.timer = setTimeout(() => { writeGate(id, settle(dir === 'open' ? 1 : 0)); emit({ type: 'gate', id }); }, left);
  }
  function stopGate(id) {
    const cur = state.gates[id];
    clearTimeout(cur.timer);
    cur.run = null; // stopped part way: not a full run
    writeGate(id, settle(gatePos(cur, gateCfg.get(id))));
    emit({ type: 'gate', id });
  }

  // What Home Assistant says corrects the estimate. Its "open" and "closed" come from the
  // sensors at each end, so they are the truth, but only when they change: halfway it still
  // shows the last end it reached. Reaching an end after a full run started here is also a
  // measurement of how long the gate takes (see travelSeconds).
  function reconcileGate(id, g) {
    const cur = state.gates[id];
    let any = false;
    if ('online' in g && cur.online !== g.online) { cur.online = g.online; any = true; }
    if (g.online === false || !g.state) return any;
    const before = cur.ha;
    cur.ha = g.state;
    // A position in between is a real reading. 0 or 100 often is not: a template cover
    // derives it from its state, so it says 0 all the way until the gate reaches the end.
    if (typeof g.position === 'number' && g.position > 0.01 && g.position < 0.99) {
      if (g.state === 'opening' || g.state === 'closing') {
        const dir = g.state === 'opening' ? 'open' : 'close';
        if (cur.motion?.dir !== dir) { moveGate(id, dir, g.position); return true; }
        return any;
      }
      if (cur.motion || Math.abs((cur.position ?? 0) - g.position) > 0.01) { clearTimeout(cur.timer); writeGate(id, settle(g.position)); return true; }
      return any;
    }
    if (before === g.state) return any;
    if (before === undefined && cur.motion) return any; // first look while moving: wait for the end
    if (g.state === 'open' || g.state === 'closed') {
      const m = cur.motion || cur.run;
      const end = g.state === 'open' ? 'open' : 'close';
      if (m && m.own && m.full && m.dir === end && Date.now() - m.start < 180000) learn(id, (Date.now() - m.start) / 1000);
      cur.run = null;
      clearTimeout(cur.timer);
      writeGate(id, { ...settle(g.state === 'open' ? 1 : 0), dir: end, travel: travelOf(id) });
      return true;
    }
    if (g.state === 'opening' && cur.motion?.dir !== 'open') { moveGate(id, 'open'); return true; }
    if (g.state === 'closing' && cur.motion?.dir !== 'close') { moveGate(id, 'close'); return true; }
    return any;
  }

  function adoptExtras(update, { fromDevices = false } = {}) {
    let any = false;
    // Where the sun is (Home Assistant's sun.sun): the model's daylight follows it.
    if (update.sun && update.sun.elevation !== state.sun?.elevation) {
      state.sun = { elevation: update.sun.elevation };
      for (const fn of listeners) fn({ type: 'sun' });
    }
    for (const [id, g] of Object.entries(update.gates || {})) {
      if (!state.gates[id]) continue;
      if (fromDevices) { any = reconcileGate(id, g) || any; continue; }
      // Another view of this home (panel ⇄ island): take its model as it is.
      const { timer, pressed, ...clean } = g;
      const cur = state.gates[id];
      if (JSON.stringify(cur.motion) !== JSON.stringify(clean.motion ?? null)) any = true;
      cur.motion = clean.motion ?? null;
      any = writeGate(id, clean) || any;
    }
    for (const [id, t] of Object.entries(update.tvs || {})) {
      const cur = state.tvs[id];
      if (!cur) continue;
      // While a slider is being dragged here, the TV's own (older) volume must not pull it back.
      const fresh = performance.now() - (cur.touched || 0) < 2500;
      for (const [k, v] of Object.entries(t)) {
        if (fresh && k === 'volume') continue;
        if (k === 'timer' || k === 'pending' || k === 'touched') continue; // this view's own bookkeeping
        if (JSON.stringify(cur[k]) !== JSON.stringify(v)) { cur[k] = v; any = true; }
      }
    }
    for (const [id, t] of Object.entries(update.toggles || {})) {
      const cur = state.toggles[id];
      if (!cur) continue;
      for (const k of ['on', 'online']) if (k in t && cur[k] !== t[k]) { cur[k] = t[k]; any = true; }
    }
    return any;
  }

  function sanitizeLight(id, patch) {
    const caps = lightCfg.get(id).capabilities;
    const out = {};
    if ('on' in patch) out.on = Boolean(patch.on);
    if ('brightness' in patch && caps.includes('brightness')) out.brightness = clamp(patch.brightness, 0.05, 1);
    if ('temp' in patch && caps.includes('temp')) { out.temp = clamp(patch.temp, 2200, 6500); out.color = null; }
    if ('color' in patch && caps.includes('color')) out.color = patch.color;
    return out;
  }

  function writeLight(id, patch, { remote = false } = {}) {
    const cur = state.lights[id];
    if (!cur) return false;
    const clean = sanitizeLight(id, patch);
    // Only what actually changed is worth sending to the device.
    const diff = Object.fromEntries(Object.entries(clean).filter(([k, v]) => cur[k] !== v));
    if (!Object.keys(diff).length) return false;
    const before = Object.fromEntries(Object.keys(diff).map((k) => [k, cur[k]]));
    Object.assign(cur, clean);
    if (!remote) dispatch('light', id, diff, before);
    return true;
  }

  function writeAC(id, patch, { remote = false } = {}) {
    const cur = state.acs[id];
    const cfg = acCfg.get(id);
    if (!cur) return false;
    const clean = { ...patch };
    if ('target' in clean) clean.target = clamp(Math.round(clean.target), cfg.min, cfg.max);
    // Switched on here: running until the thermostat says otherwise at the next poll.
    if (!remote && clean.on === true && !cur.on) clean.idle = false;
    const diff = Object.fromEntries(Object.entries(clean).filter(([k, v]) => cur[k] !== v));
    if (!Object.keys(diff).length) return false;
    const before = Object.fromEntries(Object.keys(diff).map((k) => [k, cur[k]]));
    Object.assign(cur, clean);
    const { roomTemp, idle, ...sendable } = diff;
    if (!remote && Object.keys(sendable).length) dispatch('ac', id, sendable, before);
    return true;
  }

  function summary() {
    const lights = Object.values(state.lights);
    const acs = Object.entries(state.acs).filter(([, a]) => a.on);
    return {
      lightsOn: lights.filter((l) => l.on).length,
      lightsTotal: lights.length,
      acOn: acs.length,
      acTarget: acs.length ? acs[0][1].target : null,
      acMode: acs.length ? acs[0][1].mode : null,
    };
  }

  const store = {
    state,
    config,
    restored,
    lightCfg,
    acCfg,
    summary,
    /** Set by the UI: called with (device id, message) when a real device refuses a change. */
    onDeviceError: null,
    /** Who is changing things right now when it is not the person at this screen ("ChatGPT"…). */
    source: null,

    /** What the panel may offer for this AC: modes, fan speeds, and the optional extras. */
    acFeatures(id) {
      return features[id] || { modes: AC_MODES, fans: AC_FANS, sleep: true, eco: true, swing: true };
    },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    gateCfg,
    toggleCfg,
    tvCfg,

    /** Power, volume (0…1), mute or input. Shown at once, sent at most every 250 ms. */
    setTV(id, patch) {
      const cur = state.tvs[id];
      if (!cur) return;
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k]]));
      Object.assign(cur, patch, { touched: performance.now() });
      if ('on' in patch) cur.state = patch.on ? 'on' : 'off';
      emit({ type: 'tv', id });
      clearTimeout(cur.timer);
      cur.pending = { ...(cur.pending || {}), ...patch };
      cur.timer = setTimeout(() => {
        const send = cur.pending;
        cur.pending = null;
        order('tv', id, send).catch((error) => {
          Object.assign(cur, before);
          emit({ type: 'tv', id, reverted: true });
          store.onDeviceError?.(id, error.message);
        });
      }, 'volume' in patch ? 250 : 0);
    },

    /** "play_pause", "next", "previous", "volume_up", "volume_down". */
    tvAction(id, action) {
      order('tv', id, { action }).catch((error) => store.onDeviceError?.(id, error.message));
    },

    /** Where the gate is now, 0 closed … 1 open, counting the travel in progress. */
    gatePosition(id) { return gatePos(state.gates[id], gateCfg.get(id)); },

    /** The full-run time in use, and how it was found: { seconds, measured, samples }. */
    gateTravel(id) {
      const cur = state.gates[id];
      const cfg = gateCfg.get(id);
      const measured = cfg?.travelMode !== 'manual' && Boolean(cur?.samples?.length);
      return { seconds: travelSeconds(cur, cfg), measured, samples: cur?.samples?.length || 0, mode: cfg?.travelMode || 'auto' };
    },

    /** What one press would do now: "open", "close" or "stop". */
    gateNext(id) { return gateNext(state.gates[id]); },

    // The gate has one button, like its remote: moving, a press stops it; stopped part way,
    // the next press goes the other way; fully open it closes, closed it opens. Home
    // Assistant's cover.toggle does the same, so one press here is one press there.
    gatePress(id) {
      const cur = state.gates[id];
      if (!cur) return;
      const next = gateNext(cur);
      const before = { ...cur };
      cur.pressed = Date.now();
      if (next === 'stop') stopGate(id); else moveGate(id, next, undefined, true);
      order('gate', id, { action: 'toggle' }).catch((error) => {
        clearTimeout(cur.timer);
        Object.assign(cur, before, { motion: before.motion });
        emit({ type: 'gate', id, reverted: true });
        store.onDeviceError?.(id, error.message);
      });
    },

    /** Runs a shortcut (a Home Assistant script). Resolves when Home Assistant took it. */
    async runShortcut(id) {
      try {
        await order('shortcut', id, { run: true });
        return true;
      } catch (error) {
        store.onDeviceError?.(id, error.message);
        return false;
      }
    },

    setToggle(id, on) {
      const cur = state.toggles[id];
      if (!cur || cur.on === on) return;
      cur.on = on;
      emit({ type: 'toggle', id });
      order('toggle', id, { on }).catch((error) => {
        cur.on = !on;
        emit({ type: 'toggle', id, reverted: true });
        store.onDeviceError?.(id, error.message);
      });
    },

    setLight(id, patch) {
      if (writeLight(id, patch)) { state.scene = null; emit({ type: 'light', id }); }
    },
    toggleLight(id) { store.setLight(id, { on: !state.lights[id].on }); },

    setAllLights(on) {
      let any = false;
      for (const id of Object.keys(state.lights)) any = writeLight(id, { on }) || any;
      if (any) { state.scene = null; emit({ type: 'bulk' }); }
    },

    setAC(id, patch) {
      if (writeAC(id, patch)) emit({ type: 'ac', id });
    },

    applyScene(sceneId) {
      const scene = config.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      for (const id of Object.keys(state.lights)) {
        const patch = { ...(scene.lights['*'] || {}), ...(scene.lights[id] || {}) };
        // A scene that sets a white temperature should not be overridden by a stale colour.
        if (!('color' in patch) && 'temp' in patch) patch.color = null;
        writeLight(id, patch);
      }
      for (const id of Object.keys(state.acs)) {
        const patch = { ...(scene.acs['*'] || {}), ...(scene.acs[id] || {}) };
        if (Object.keys(patch).length) writeAC(id, patch);
      }
      state.scene = sceneId;
      emit({ type: 'bulk', scene: sceneId });
    },

    /** Reports the state again, for a view that has only just started. */
    share() { post('state', { lights: state.lights, acs: state.acs, gates: state.gates, toggles: state.toggles, tvs: state.tvs, sun: state.sun, scene: state.scene }); },

    // The state of another view of this home (see emit). Nothing goes to the devices:
    // the view where the change was made has already sent it.
    adopt(other) {
      let any = false;
      for (const [id, s] of Object.entries(other.lights || {})) any = writeLight(id, s, { remote: true }) || any;
      for (const [id, s] of Object.entries(other.acs || {})) any = writeAC(id, s, { remote: true }) || any;
      any = adoptExtras(other) || any;
      const scene = other.scene ?? null;
      if (scene !== state.scene) { state.scene = scene; any = true; }
      if (any) emit({ type: 'bulk', remote: true, adopted: true, source: other.source || null });
    },

    // State reported by real devices (native provider). Never echoed back as a command.
    applyRemote(update) {
      let any = false;
      for (const [id, patch] of Object.entries(update.lights || {})) any = writeLight(id, patch, { remote: true }) || any;
      for (const [id, patch] of Object.entries(update.acs || {})) any = writeAC(id, patch, { remote: true }) || any;
      any = adoptExtras(update, { fromDevices: true }) || any;
      for (const [id, f] of Object.entries(update.features || {})) {
        if (!state.acs[id] || JSON.stringify(features[id]) === JSON.stringify(f)) continue;
        features[id] = f;
        any = true;
      }
      if (any) emit({ type: 'bulk', remote: true });
    },
  };

  // Without real sensors the room temperature is simulated: it drifts towards the
  // set-point while an AC runs and back towards the outdoor-ish ambient when it is off.
  setInterval(() => {
    let any = false;
    for (const [id, a] of Object.entries(state.acs)) {
      const cfg = acCfg.get(id);
      if (cfg.tuya?.sensorId || cfg.sensor?.id || cfg.link?.id) continue; // a real sensor or unit reports this room
      const ambient = Math.min(config.outdoorTemp - 2, 27);
      const goal = a.on && a.mode !== 'fan' ? a.target : ambient;
      const step = a.on ? 0.2 : 0.1;
      const next = Math.abs(goal - a.roomTemp) <= step ? goal : a.roomTemp + Math.sign(goal - a.roomTemp) * step;
      if (next !== a.roomTemp) { a.roomTemp = Math.round(next * 10) / 10; any = true; }
    }
    if (any) { for (const fn of listeners) fn({ type: 'tick' }); persist(); }
  }, 3000);

  return store;
}
