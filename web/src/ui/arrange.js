// How the panel is arranged on this Mac: the order of the shortcuts, the room chips, the
// gates, the automation switches and each room's devices, and which of them are hidden.
// Kept apart from the plan, so rearranging never touches the home itself. The island reads
// the same arrangement.

const KEY = 'homeos:arrangement:v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

/** The arrangement of the home called `home`: { order: { [group]: ids }, hidden: ids }. */
export function loadArrangement(home) {
  const a = readAll()[home] || {};
  return { order: a.order || {}, hidden: new Set(a.hidden || []) };
}

export function saveArrangement(home, a) {
  const all = readAll();
  all[home] = { order: a.order, hidden: [...a.hidden] };
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
