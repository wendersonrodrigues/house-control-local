// Entities the panel reads straight from Home Assistant, outside the store: the weather and
// the Alexa's extras (its routines, "Não perturbe", the last voice command). They come over
// the cameras' line (camera/access.js): the page's own connection on the HA edition, a socket
// of its own with Swift's token in the Mac app. Only while something on screen needs them.

/**
 * Watches the entities `pick(states)` chooses among all of Home Assistant's, under the name
 * `who`: `onStates(map)` gets { entity_id: state } at once and again on each change.
 * Returns stop(), which lets the line go.
 */
export function watchEntities(access, who, pick, onStates, { onError } = {}) {
  let stopped = false;
  let unsub = null;
  const now = new Map();
  let ids = new Set();
  let ha = null;
  (async () => {
    try {
      ha = await access.use(who);
      if (stopped) return;
      const all = await ha.call({ type: 'get_states' });
      if (stopped) return;
      ids = new Set(pick(all));
      for (const s of all) if (ids.has(s.entity_id)) now.set(s.entity_id, s);
      onStates(now, ha);
      if (!ids.size) return;
      const off = await ha.subscribe({ type: 'subscribe_events', event_type: 'state_changed' }, (ev) => {
        const s = ev?.data?.new_state;
        if (!s || !ids.has(s.entity_id)) return;
        now.set(s.entity_id, s);
        onStates(now, ha);
      });
      if (stopped) off(); else unsub = off;
    } catch (e) {
      if (!stopped) onError?.(e);
    }
  })();
  return function stop() {
    if (stopped) return;
    stopped = true;
    unsub?.();
    access.release(who);
  };
}

/** Runs `start()` (which returns its stop) while `el` is on screen and the page is visible. */
export function whileVisible(el, start) {
  let stop = null;
  let seen = false;
  const sync = () => {
    const want = seen && !document.hidden;
    if (want && !stop) stop = start();
    else if (!want && stop) { stop(); stop = null; }
  };
  new IntersectionObserver((entries) => {
    for (const e of entries) seen = e.isIntersecting;
    sync();
  }).observe(el);
  document.addEventListener('visibilitychange', sync);
}
