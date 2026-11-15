// Informação: when each device last changed, and the period before that. Not a log: one
// record per device, { phase, raw, since, prev: { phase, since, until } }, kept on this device
// (localStorage). The start of the current state comes from the platform (Home Assistant's
// last_changed, store.changedAt) when it reports one, so it is right even if the change
// happened with the app closed; the period before is the one this app saw end.

const KEY = 'homeos:ultimo:v1';
const KINDS = [['lights', 'light'], ['acs', 'ac'], ['gates', 'gate'], ['tvs', 'tv'], ['toggles', 'toggle']];

// What counts as a change: on / off, and for a gate open (or moving) / closed.
function phaseOf(kind, s) {
  if (!s || s.online === false) return null;
  if (kind === 'gate') return s.state === 'closed' ? 'closed' : 'open';
  return s.on ? 'on' : 'off';
}
const rawOf = (kind, s) => (kind === 'gate' ? s.state : s.on ? 'on' : 'off');

export function createLastSeen(store, config) {
  let records = {};
  try { records = JSON.parse(localStorage.getItem(KEY) || '{}')?.[config.name] || {}; } catch { records = {}; }
  // A linked device is only recorded once its platform has spoken: before that, the state on
  // screen is the one restored from last time, not the real one.
  const linked = new Set(KINDS.flatMap(([key]) => (config[key] || []).filter((d) => d.link?.id || d.tuya?.deviceId).map((d) => d.id)));

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const all = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
        all[config.name] = records;
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch { /* kept for this session only */ }
    }, 400);
  }

  function scan() {
    const now = Date.now();
    let dirty = false;
    for (const [key, kind] of KINDS) {
      for (const [id, s] of Object.entries(store.state[key] || {})) {
        const phase = phaseOf(kind, s);
        if (!phase) continue;
        const reported = store.changedAt[id];
        if (linked.has(id) && reported == null) continue;
        const raw = rawOf(kind, s);
        const rec = records[id];
        if (!rec) {
          records[id] = { phase, raw, since: reported ?? now };
          dirty = true;
        } else if (rec.phase !== phase) {
          const since = reported && reported > rec.since ? reported : now;
          records[id] = { phase, raw, since, prev: { phase: rec.phase, since: rec.since, until: since } };
          dirty = true;
        } else if (reported && reported > rec.since && rec.raw === raw) {
          // the same state, begun later than we thought (switched back and forth while away)
          rec.since = reported;
          dirty = true;
        } else if (rec.raw !== raw) {
          rec.raw = raw; // opening → open: still the same opening
          dirty = true;
        }
      }
    }
    if (dirty) save();
  }

  store.on(scan);
  scan();
  return { get: (id) => records[id] || null };
}

/** "agora", "há 5 min", "há 2 h 10 min", "há 3 dias". */
export function ago(t, now = Date.now()) {
  return `há ${span(now - t)}`.replace('há agora', 'agora mesmo');
}

/** A duration: "agora", "40 s", "5 min", "2 h 10 min", "3 dias". */
export function span(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 30) return 'agora';
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

/** 14:02, or "ontem 14:02", or "10/11 14:02". */
export function when(t, now = Date.now()) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x).toDateString();
  if (day(t) === day(now)) return time;
  if (day(t) === day(now - 86400000)) return `ontem ${time}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}
