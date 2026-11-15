// Home Assistant for the tablet edition: what the Mac app's HomeAssistantService and
// DeviceHub do in Swift (core/Sources/HouseCore), done in the page. Entity states become the
// panel's `applyRemote` updates, and the panel's commands become service calls. Kept in step
// with the Swift mapping on purpose, so the Mac and the tablet behave the same.

import { linkOf } from '../config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
const offline = (value) => value === 'unavailable' || value === 'unknown';

// ---- fan speeds, modes, swing (FanNames, modeTable, panelSwing) ----

function fanPanel(name) {
  const n = name.toLowerCase();
  if (['turbo', 'max', 'strong', 'highest', 'powerful', 'boost', 'very high', 'full'].some((w) => n.includes(w))) return 'turbo';
  if (n.includes('high')) return 'high';
  if (n.includes('med') || n.includes('mid')) return 'medium';
  if (n.includes('silent') || n.includes('quiet')) return 'silent';
  if (n.includes('low')) return 'low';
  if (n.includes('auto')) return 'auto';
  return null;
}
function fanTable(names = []) {
  const out = {};
  for (const name of names) {
    if (name.toLowerCase() === 'off') continue;
    const p = fanPanel(name);
    if (p && !out[p]) out[p] = name;
  }
  return out;
}
const FAN_ORDER = ['auto', 'silent', 'low', 'medium', 'high', 'turbo'];
function modeTable(hvac = []) {
  const out = {};
  for (const [panel, names] of [['cool', ['cool']], ['heat', ['heat']], ['dry', ['dry']], ['fan', ['fan_only']], ['auto', ['auto', 'heat_cool']]]) {
    const name = names.find((n) => hvac.includes(n));
    if (name) out[panel] = name;
  }
  return out;
}
const panelSwing = (name) => (['off', 'horizontal', 'vertical'].includes(name) ? name : 'swing');

const MEDIA_FEATURES = [['power', 128 | 256], ['volume', 4], ['mute', 8], ['step', 1024], ['source', 2048], ['play', 1 | 16384], ['next', 32], ['previous', 16]];
const mediaControls = (supported) => MEDIA_FEATURES.filter(([, bits]) => supported == null || (supported & bits) !== 0).map(([n]) => n);

const hex = (r, g, b) => `#${[r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
function rgbOf(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---- one entity's state in the panel's terms (reading(from:)) ----

function lightReading(value, a) {
  const light = { on: value === 'on' };
  const b = num(a.brightness);
  if (value === 'on' && b != null) light.brightness = clamp(b / 255, 0.05, 1);
  const mode = a.color_mode;
  if (mode === 'color_temp') {
    const k = num(a.color_temp_kelvin);
    if (k != null) { light.temp = clamp(k, 2200, 6500); light.color = null; }
  } else if (['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(mode) && Array.isArray(a.rgb_color) && a.rgb_color.length === 3) {
    light.color = hex(...a.rgb_color);
  }
  return light;
}

function acReading(value, a) {
  const modes = modeTable(a.hvac_modes);
  const ac = { on: value !== 'off' };
  ac.idle = value !== 'off' && (a.hvac_action === 'idle' || a.hvac_action === 'off');
  const mode = Object.keys(modes).find((k) => modes[k] === value);
  if (mode) ac.mode = mode;
  const t = num(a.temperature);
  const lo = num(a.target_temp_low);
  const hi = num(a.target_temp_high);
  if (t != null) ac.target = t;
  else if (lo != null && hi != null) ac.target = Math.round((lo + hi) / 2);
  const room = num(a.current_temperature);
  if (room != null) ac.roomTemp = room;
  const fans = fanTable(a.fan_modes);
  const fan = a.fan_mode && fanPanel(a.fan_mode);
  if (fan && fans[fan]) ac.fan = fan;
  const swings = a.swing_modes || [];
  if (a.swing_mode && swings.length) ac.swing = panelSwing(a.swing_mode);
  const presets = a.preset_modes || [];
  if (presets.includes('sleep')) ac.sleep = a.preset_mode === 'sleep';
  if (presets.includes('eco')) ac.eco = a.preset_mode === 'eco';
  const features = {
    modes: ['cool', 'heat', 'dry', 'fan', 'auto'].filter((m) => modes[m]),
    fans: FAN_ORDER.filter((f) => fans[f]),
    swing: swings.includes('off') && swings.length > 1,
    swings: ['swing', 'horizontal', 'vertical', 'off'].filter((p) => (p === 'swing'
      ? swings.some((s) => !['off', 'horizontal', 'vertical'].includes(s)) : swings.includes(p))),
    sleep: presets.includes('sleep'),
    eco: presets.includes('eco'),
  };
  return { ac, features };
}

function mediaReading(value, a) {
  const text = (k) => (typeof a[k] === 'string' && a[k] ? a[k] : null);
  const media = { on: !['off', 'standby'].includes(value), state: value };
  const v = num(a.volume_level);
  if (v != null) media.volume = clamp(v, 0, 1);
  if (typeof a.is_volume_muted === 'boolean') media.muted = a.is_volume_muted;
  media.source = a.source ?? null;
  media.sources = a.source_list || [];
  media.title = text('media_title');
  media.artist = text('media_artist');
  media.series = text('media_series_title');
  media.app = text('app_name');
  media.picture = text('entity_picture'); // a path on this same server: fine as it is
  media.controls = mediaControls(num(a.supported_features));
  return media;
}

// ---- service calls for a panel command (calls(for:)) ----

function callsFor(id, patch, state, info) {
  const domain = id.split('.')[0];
  const call = (service, data = {}, d = domain) => ({ domain: d, service, data: { entity_id: id, ...data } });

  if (['switch', 'input_boolean', 'automation'].includes(domain)) {
    return typeof patch.on === 'boolean' ? [call(patch.on ? 'turn_on' : 'turn_off')] : [];
  }
  if (domain === 'cover') {
    const s = { open: 'open_cover', close: 'close_cover', stop: 'stop_cover', toggle: 'toggle' }[patch.action];
    return s ? [call(s)] : [];
  }
  if (domain === 'media_player') {
    const out = [];
    if (typeof patch.on === 'boolean') out.push(call(patch.on ? 'turn_on' : 'turn_off'));
    if (typeof patch.volume === 'number') out.push(call('volume_set', { volume_level: Math.round(clamp(patch.volume, 0, 1) * 100) / 100 }));
    if (typeof patch.muted === 'boolean') out.push(call('volume_mute', { is_volume_muted: patch.muted }));
    if (typeof patch.source === 'string') out.push(call('select_source', { source: patch.source }));
    const actions = { play_pause: 'media_play_pause', next: 'media_next_track', previous: 'media_previous_track', volume_up: 'volume_up', volume_down: 'volume_down' };
    if (actions[patch.action]) out.push(call(actions[patch.action]));
    // only what this player accepts: Home Assistant refuses the whole request otherwise
    const can = new Set(mediaControls(info.media));
    const needs = { volume_set: 'volume', volume_mute: 'mute', select_source: 'source', volume_up: 'step', volume_down: 'step',
      media_play_pause: 'play', media_next_track: 'next', media_previous_track: 'previous' };
    return out.filter((c) => !needs[c.service] || can.has(needs[c.service]));
  }
  if (domain === 'script' || domain === 'scene') return patch.run === true ? [call('turn_on')] : [];
  if (domain === 'light') {
    if (patch.on === false) return [call('turn_off')];
    const data = {};
    if (typeof patch.brightness === 'number') data.brightness_pct = Math.round(patch.brightness * 100);
    if (typeof patch.temp === 'number') data.color_temp_kelvin = Math.round(patch.temp);
    const rgb = typeof patch.color === 'string' && rgbOf(patch.color);
    if (rgb) data.rgb_color = rgb;
    return Object.keys(data).length || patch.on === true ? [call('turn_on', data)] : [];
  }
  if (domain !== 'climate') return [];
  if (patch.on === false) return [call('set_hvac_mode', { hvac_mode: 'off' })];
  const out = [];
  const modes = info.modes || {};
  if (patch.on === true || patch.mode != null) {
    const mode = patch.mode || state.mode || 'cool';
    const name = modes[mode] || Object.values(modes)[0];
    if (name) out.push(call('set_hvac_mode', { hvac_mode: name }));
  }
  if (typeof patch.target === 'number') out.push(call('set_temperature', { temperature: patch.target }));
  if (typeof patch.fan === 'string' && info.fans?.[patch.fan]) out.push(call('set_fan_mode', { fan_mode: info.fans[patch.fan] }));
  if (typeof patch.swing === 'string') {
    const sw = info.swings || [];
    const name = patch.swing !== 'swing' ? patch.swing
      : sw.find((s) => s === 'on') || sw.find((s) => s === 'both') || sw.find((s) => s !== 'off') || 'on';
    out.push(call('set_swing_mode', { swing_mode: name }));
  }
  for (const preset of ['sleep', 'eco']) {
    if (typeof patch[preset] === 'boolean') out.push(call('set_preset_mode', { preset_mode: patch[preset] ? preset : 'none' }));
  }
  return out;
}

// ---- the provider ----

const SECTIONS = [['light', 'lights'], ['ac', 'acs'], ['gate', 'gates'], ['shortcut', 'shortcuts'], ['toggle', 'toggles'], ['tv', 'tvs']];

/**
 * Feeds `store` from Home Assistant through `ha` (ha/connection.js) and returns the
 * transport for bridge.setTransport: the panel's `call('command', …)` lands here.
 */
export function attachHomeAssistant(ha, config, store, { onStatus } = {}) {
  // Which panel devices each entity stands for: the device itself, or an AC's thermometer.
  const byEntity = new Map();
  const entityOf = new Map();
  const add = (entity, ref) => {
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    byEntity.get(entity).push(ref);
  };
  for (const [kind, key] of SECTIONS) {
    for (const d of config[key] || []) {
      const link = linkOf(d);
      if (link?.service === 'homeassistant') { add(link.id, { kind, id: d.id }); entityOf.set(d.id, link.id); }
      if (kind === 'ac' && d.sensor?.service === 'homeassistant' && d.sensor.id) add(d.sensor.id, { kind: 'sensor', id: d.id });
    }
  }
  add('sun.sun', { kind: 'sun' });
  // Each entity's own names, from its last state, for the commands (fanNames, modeNames…).
  const info = new Map();

  function updateFor(state, out) {
    const entity = state.entity_id;
    const refs = byEntity.get(entity);
    if (!refs) return;
    const value = state.state;
    const a = state.attributes || {};
    const online = !offline(value);
    if (entity.startsWith('climate.')) info.set(entity, { fans: fanTable(a.fan_modes), modes: modeTable(a.hvac_modes), swings: a.swing_modes || [] });
    if (entity.startsWith('media_player.')) info.set(entity, { media: num(a.supported_features) });
    // When this state began (Home Assistant's last_changed), for Informação (lastseen.js).
    const since = Date.parse(state.last_changed);
    for (const ref of refs) {
      if (online && Number.isFinite(since) && ['light', 'ac', 'gate', 'tv', 'toggle'].includes(ref.kind)) out.changed[ref.id] = since;
      switch (ref.kind) {
        case 'light':
          if (online) out.lights[ref.id] = lightReading(value, a);
          break;
        case 'ac': {
          if (!online) break;
          const { ac, features } = acReading(value, a);
          out.acs[ref.id] = { ...(out.acs[ref.id] || {}), ...ac };
          out.features[ref.id] = features;
          break;
        }
        case 'sensor': {
          let t = num(value);
          if (t == null) break;
          if (a.unit_of_measurement === '°F') t = (t - 32) * 5 / 9;
          out.acs[ref.id] = { ...(out.acs[ref.id] || {}), roomTemp: t };
          break;
        }
        case 'gate': {
          if (!online) { out.gates[ref.id] = { online: false }; break; }
          const g = { state: ['open', 'closed', 'opening', 'closing'].includes(value) ? value : 'closed', online: true };
          const p = num(a.current_position);
          if (p != null) g.position = clamp(p / 100, 0, 1);
          out.gates[ref.id] = g;
          break;
        }
        case 'tv':
          out.tvs[ref.id] = online ? { ...mediaReading(value, a), online: true } : { online: false, on: false };
          break;
        case 'toggle':
          out.toggles[ref.id] = online ? { on: value === 'on', online: true } : { online: false };
          break;
        case 'sun': {
          const e = num(a.elevation);
          if (e != null) out.sun = { elevation: e };
          break;
        }
        default:
      }
    }
  }

  const empty = () => ({ lights: {}, acs: {}, features: {}, gates: {}, toggles: {}, tvs: {}, changed: {} });
  function apply(states) {
    const out = empty();
    for (const s of states) updateFor(s, out);
    store.applyRemote(out);
  }

  // A burst of changes (a script switching ten lamps) is applied as one update.
  let queued = new Map();
  let flush = 0;
  function changed(event) {
    const s = event?.data?.new_state;
    if (!s || !byEntity.has(s.entity_id)) return;
    queued.set(s.entity_id, s);
    if (!flush) flush = setTimeout(() => { flush = 0; const batch = [...queued.values()]; queued = new Map(); apply(batch); }, 120);
  }

  async function readAll() {
    const states = await ha.call({ type: 'get_states' });
    apply(states.filter((s) => byEntity.has(s.entity_id)));
    onStatus?.('online');
  }

  (async () => {
    try {
      await ha.subscribe({ type: 'subscribe_events', event_type: 'state_changed' }, changed);
      await readAll();
    } catch (e) {
      onStatus?.('error', e);
    }
  })();
  ha.onReconnect?.(() => readAll().catch((e) => onStatus?.('error', e)));
  // Back on screen after a while (a tablet that slept): read everything again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) readAll().catch(() => {}); });

  /** bridge transport: `call('command', { kind, id, patch, state })`. */
  return async function transport(type, payload) {
    if (type !== 'command') throw new Error('Indisponível no Home Assistant');
    const entity = entityOf.get(payload.id);
    if (!entity) return { ok: true }; // a lamp only drawn on the plan: simulated
    const calls = callsFor(entity, payload.patch || {}, payload.state || {}, info.get(entity) || {});
    for (const c of calls) {
      try {
        await ha.call({ type: 'call_service', domain: c.domain, service: c.service, service_data: c.data });
      } catch (e) {
        throw new Error(e?.message || 'O Home Assistant recusou o comando');
      }
    }
    return { ok: true };
  };
}

export const _test = { callsFor, acReading, lightReading, mediaReading, fanTable, modeTable };
