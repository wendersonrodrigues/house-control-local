// How the panel is arranged on this Mac: the order of the shortcuts, the room chips, the
// gates, the automation switches and each room's devices, and which of them are hidden.
// Kept apart from the plan, so rearranging never touches the home itself. The island reads
// the same arrangement.

import { isTablet } from '../bridge.js';

const KEY = 'homeos:arrangement:v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

/** The arrangement of the home called `home`: { order: { [group]: ids }, hidden: ids, … }. */
export function loadArrangement(home) {
  const a = readAll()[home] || {};
  // chips: how the room chips read: "name", "icon" or "both".
  // roomsAt: where they sit: "top" (above the list) or "bottom" (a phone app's tab bar);
  // on a tablet (iPad, the HA edition) the tab bar at the foot unless chosen otherwise.
  // sizes: a card's size, by id ("small", "wide", "big", "full"); flip: cards with the
  // switch on the other side; labels: the small tag over a lamp's name ("LED", "Cortina");
  // showLabels: whether those tags show; mapHidden: the start page without the model.
  return {
    order: a.order || {}, hidden: new Set(a.hidden || []), chips: a.chips || 'name',
    roomsAt: (a.roomsAt || (isTablet ? 'bottom' : 'top')) === 'bottom' ? 'bottom' : 'top',
    sizes: a.sizes || {}, flip: new Set(a.flip || []), labels: a.labels || {},
    showLabels: a.showLabels !== false, mapHidden: Boolean(a.mapHidden),
    // hidden only from the start page (Todos): cards, and whole rooms
    hiddenHome: new Set(a.hiddenHome || []), hiddenHomeRooms: new Set(a.hiddenHomeRooms || []),
    // the power button at the top: "room" (the room in view; the whole home on the start
    // page) or "home" (always the whole home); powerConfirm: asks before switching
    powerScope: a.powerScope === 'home' ? 'home' : 'room', powerConfirm: a.powerConfirm !== false,
    // homeOwn: the start page keeps its own card order ("home:" groups in `order`), sizes and
    // sides, apart from the rooms'; homeSeeded: those were copied from the rooms once
    homeOwn: Boolean(a.homeOwn), homeSeeded: Boolean(a.homeSeeded),
    homeSizes: a.homeSizes || {}, homeFlip: new Set(a.homeFlip || []),
    // secCols: the start page sideways (tablet lying down, no map): each section's width in
    // columns of cards, by group ("room:sala"…); unset: 6, or 8 for a section with many cards
    secCols: a.secCols || {},
    // secBelow: sections put below the one before (two rooms in the height), by group
    secBelow: a.secBelow || {},
    // the start page sideways keeps its own order ("side:" groups), sizes and sides;
    // sideSeeded: copied from the start page the first time
    sideSeeded: Boolean(a.sideSeeded), sideSizes: a.sideSizes || {}, sideFlip: new Set(a.sideFlip || []),
  };
}

export function saveArrangement(home, a) {
  const all = readAll();
  all[home] = {
    order: a.order, hidden: [...a.hidden], chips: a.chips, roomsAt: a.roomsAt,
    sizes: a.sizes, flip: [...a.flip], labels: a.labels, showLabels: a.showLabels, mapHidden: a.mapHidden,
    hiddenHome: [...a.hiddenHome], hiddenHomeRooms: [...a.hiddenHomeRooms],
    powerScope: a.powerScope, powerConfirm: a.powerConfirm,
    homeOwn: a.homeOwn, homeSeeded: a.homeSeeded, homeSizes: a.homeSizes, homeFlip: [...a.homeFlip],
    secCols: a.secCols, secBelow: a.secBelow,
    sideSeeded: a.sideSeeded, sideSizes: a.sideSizes, sideFlip: [...a.sideFlip],
  };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* kept for this session only */ }
}

/** `items` in the saved order of `group` (new ones keep their place at the end). */
export function ordered(items, a, group) {
  const order = a.order[group] || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => (rank.get(x.item.id) ?? 1e6 + x.i) - (rank.get(y.item.id) ?? 1e6 + y.i))
    .map(({ item }) => item);
}

/** The ordered items of `group` that are not hidden. */
export const visible = (items, a, group) => ordered(items, a, group).filter((x) => !a.hidden.has(x.id));

/** Moves `id` one place up (-1) or down (+1) within `group`. */
export function move(a, group, items, id, step) {
  const ids = ordered(items, a, group).map((x) => x.id);
  const i = ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  a.order[group] = ids;
}

/** The saved arrangement of `home` as written, for sending to Home Assistant (null if none). */
export function rawArrangement(home) {
  return readAll()[home] || null;
}

// What the Mac sends is how the cards are laid out (order, sizes, sides, tags, what is
// hidden); where the room chips sit, the map, the power button stay this device's own.
const OWN = ['chips', 'roomsAt', 'mapHidden', 'powerScope', 'powerConfirm'];
/** Takes the cards' arrangement sent from the Mac, keeping this device's own choices. */
export function adoptArrangement(home, sent) {
  if (!sent || typeof sent !== 'object') return;
  const all = readAll();
  const mine = all[home] || {};
  const next = { ...sent };
  for (const k of OWN) { if (k in mine) next[k] = mine[k]; else delete next[k]; }
  all[home] = next;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* kept for this session only */ }
}
