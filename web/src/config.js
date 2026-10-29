// Loads and normalises a floor plan ("home.json"). Everything the 3D scene and the UI
// know about the apartment comes from this one document, so swapping the file swaps the home.

const LIGHT_TYPES = ['ceiling', 'pendant', 'spots', 'floor', 'table', 'strip', 'flood'];
const WALLS = ['north', 'south', 'east', 'west'];

export class ConfigError extends Error {}

export const LIGHT_KINDS = LIGHT_TYPES;

// A lamp or an AC is real when it is linked to a device of a connected platform:
// `link: { service, id }` (Home Assistant, Philips Hue, Apple Home) or, for Smart Life,
// `tuya: { deviceId }`. An AC's `sensor: { service, id }` is a thermometer for its room.
export const LINK_FIELDS = ['tuya', 'link', 'sensor'];

export function linkOf(d) {
  if (d?.link?.service && d.link.id) return { service: d.link.service, id: d.link.id };
  if (d?.tuya?.deviceId) return { service: 'smartlife', id: d.tuya.deviceId };
  return null;
}

export const isLinked = (d) => Boolean(linkOf(d));

/** The platforms House Control can link to, in the order the editor lists them. */
export const SERVICES = {
  smartlife: { name: 'Smart Life', short: 'Smart Life' },
  homeassistant: { name: 'Home Assistant', short: 'Home Assistant' },
  hue: { name: 'Philips Hue', short: 'Hue' },
  homekit: { name: 'Apple Home', short: 'Apple Home' },
};
export const FLOOR_KINDS = ['oak', 'walnut', 'tile', 'stone'];

// HomeOs Bar shows Home Assistant only; the rest of House Control stays in the code
// (see core/Sources/HouseCore/Edition.swift, which the Mac passes in the boot payload).
export const EDITION = {
  name: 'HomeOs Bar', platforms: ['homeassistant'], aiAccess: false, phones: false,
  ...(typeof window !== 'undefined' ? window.__HOUSE_BOOT__?.edition : null),
};

// The plan exactly as written on disk (the editor works on this form).
export async function loadRawConfig() {
  const boot = window.__HOUSE_BOOT__;
  if (boot?.config) return boot.config;
  const plan = (boot?.plan !== 'custom' && boot?.plan) || new URLSearchParams(location.search).get('plan') || 'homeos';
  const res = await fetch(`./plans/${plan}.json`);
  if (!res.ok) throw new ConfigError(`Planta "${plan}" não encontrada (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (e) {
    throw new ConfigError(`A planta "${plan}" não é um JSON válido: ${e.message}`);
  }
}

export async function loadConfig() {
  return normalize(await loadRawConfig());
}

function need(cond, msg) {
  if (!cond) throw new ConfigError(msg);
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function normalize(raw) {
  need(raw && typeof raw === 'object', 'A planta precisa ser um objeto JSON');
  need(Array.isArray(raw.rooms) && raw.rooms.length > 0, 'A planta precisa de pelo menos um cômodo em "rooms"');

  const ids = new Set();
  const unique = (id, what) => {
    need(typeof id === 'string' && id, `${what} está sem "id"`);
    need(!ids.has(id), `id repetido "${id}"`);
    ids.add(id);
  };

  const rooms = raw.rooms.map((r) => {
    unique(r.id, 'Um cômodo');
    need(Array.isArray(r.rect) && r.rect.length === 4 && r.rect.every(Number.isFinite),
      `O cômodo "${r.id}" precisa de "rect": [x, z, largura, profundidade]`);
    const [x, z, w, d] = r.rect;
    need(w > 0 && d > 0, `O cômodo "${r.id}" tem "rect" vazio`);
    return { id: r.id, name: r.name || r.id, x, z, w, d, floor: r.floor || 'oak', outdoor: Boolean(r.outdoor), icon: r.icon };
  });
  const roomIds = new Set(rooms.map((r) => r.id));

  const openings = (raw.openings || []).map((o, i) => {
    need(isPoint(o.from) && isPoint(o.to), `A abertura nº ${i + 1} precisa dos pontos "from" e "to"`);
    need(o.from[0] === o.to[0] || o.from[1] === o.to[1], `A abertura nº ${i + 1} precisa ficar alinhada a um eixo`);
    return { type: o.type || 'door', from: o.from, to: o.to, sill: o.sill ?? 0.85, head: o.head ?? 2.1 };
  });

  const lights = (raw.lights || []).map((l) => {
    unique(l.id, 'Uma luz');
    need(roomIds.has(l.room), `A luz "${l.id}" aponta para o cômodo desconhecido "${l.room}"`);
    need(LIGHT_TYPES.includes(l.type), `A luz "${l.id}" tem o tipo desconhecido "${l.type}" (use ${LIGHT_TYPES.join(', ')})`);
    need(isPoint(l.pos), `A luz "${l.id}" precisa de "pos": [x, z]`);
    return {
      ...l,
      name: l.name || l.id,
      rot: l.rot || 0,
      capabilities: l.capabilities || [], // plain smart plugs: on/off only
    };
  });

  // A light drawn in more than one place (spots that turn a corner): the extra pieces say
  // `with: <id>` and are only drawn, switched with that light. The panel lists the one light.
  const mainIds = new Set(lights.filter((l) => !l.with).map((l) => l.id));
  const lightParts = lights.filter((l) => l.with && mainIds.has(l.with) && l.with !== l.id);
  const mainLights = lights.filter((l) => !lightParts.includes(l));

  const acs = (raw.acs || []).map((a) => {
    unique(a.id, 'Um ar-condicionado');
    need(roomIds.has(a.room), `O ar "${a.id}" aponta para o cômodo desconhecido "${a.room}"`);
    need(isPoint(a.pos), `O ar "${a.id}" precisa de "pos": [x, z]`);
    need(WALLS.includes(a.wall), `O ar "${a.id}" precisa de "wall": um de ${WALLS.join(', ')}`);
    return { ...a, name: a.name || a.id, y: a.y ?? 2.2, min: a.min ?? 16, max: a.max ?? 30 };
  });

  const scenes = (raw.scenes || []).map((s) => {
    need(typeof s.id === 'string' && s.id, 'Uma cena está sem "id"');
    return { id: s.id, name: s.name || s.id, icon: s.icon || 'sun', lights: s.lights || {}, acs: s.acs || {} };
  });

  // Not on the plan: the gate, the shortcuts (scripts) and the switches of automations,
  // each linked to its Home Assistant entity.
  const extra = (key, what, fill) => (raw[key] || []).map((x) => {
    unique(x.id, what);
    return { ...x, name: x.name || x.id, ...fill(x) };
  });
  const gates = extra('gates', 'Um portão', () => ({}));
  const shortcuts = extra('shortcuts', 'Um atalho', (x) => ({ icon: x.icon || 'sparkles' }));
  const toggles = extra('toggles', 'Uma chave', (x) => ({ icon: x.icon || 'sparkles' }));
  // The gate slides along its wall opening (`from` → `to`) towards `slide` ("to" or "from").
  for (const g of gates) {
    if (!g.from && !g.to) continue;
    need(isPoint(g.from) && isPoint(g.to), `O portão "${g.id}" precisa de "from" e "to"`);
    need(g.from[0] === g.to[0] || g.from[1] === g.to[1], `O portão "${g.id}" precisa ficar alinhado a uma parede`);
    g.slide = g.slide === 'from' ? 'from' : 'to';
    g.height = g.height ?? 2.2;
    g.travel = g.travel ?? 14;
    g.travelMode = g.travelMode === 'manual' ? 'manual' : 'auto';
    // The room it belongs to (the garage): the one just inside its opening, unless the plan says.
    if (!g.room) {
      const [mx, mz] = [(g.from[0] + g.to[0]) / 2, (g.from[1] + g.to[1]) / 2];
      const along = g.from[1] === g.to[1];
      const probe = (d) => rooms.find((r) => {
        const [px, pz] = along ? [mx, mz + d] : [mx + d, mz];
        return px > r.x && px < r.x + r.w && pz > r.z && pz < r.z + r.d && !r.outdoor;
      });
      g.room = (probe(0.3) || probe(-0.3))?.id;
    }
  }
  // A gate not placed on a wall, and not given a room, belongs to the garage if there is one.
  for (const g of gates) {
    if (g.room && !roomIds.has(g.room)) g.room = undefined;
    if (!g.room) g.room = rooms.find((r) => /garag/i.test(`${r.id} ${r.name}`))?.id;
  }
  // TVs stand in a room like a lamp, as the furniture piece "tv" with a screen that lights up.
  const tvs = (raw.tvs || []).map((t) => {
    unique(t.id, 'Uma TV');
    need(roomIds.has(t.room), `A TV "${t.id}" aponta para o cômodo desconhecido "${t.room}"`);
    need(isPoint(t.pos), `A TV "${t.id}" precisa de "pos": [x, z]`);
    return { ...t, name: t.name || t.id, rot: t.rot || 0, width: t.width ?? 1.6 };
  });

  const minX = Math.min(...rooms.map((r) => r.x));
  const minZ = Math.min(...rooms.map((r) => r.z));
  const maxX = Math.max(...rooms.map((r) => r.x + r.w));
  const maxZ = Math.max(...rooms.map((r) => r.z + r.d));

  return {
    name: raw.name || 'Home',
    wallHeight: raw.wallHeight ?? 2.6,
    interiorWallHeight: raw.interiorWallHeight ?? 1.25,
    // zoom: the distance, 1 framing the whole home (smaller is closer); pan: [x, z] the view
    // is slid by from the home's centre.
    camera: {
      azimuth: raw.camera?.azimuth ?? 34, elevation: raw.camera?.elevation ?? 47,
      zoom: raw.camera?.zoom ?? 1, pan: Array.isArray(raw.camera?.pan) ? raw.camera.pan : [0, 0],
    },
    outdoorTemp: raw.outdoorTemp ?? 27,
    rooms,
    openings,
    furniture: raw.furniture || [],
    lights: mainLights,
    lightParts,
    acs,
    scenes,
    gates,
    shortcuts,
    toggles,
    tvs,
    bounds: { minX, minZ, maxX, maxZ },
  };
}
