// The Alexa's extras, beside what the store already has of its media player (playing, volume):
// the last thing said to it and its answer, "Não perturbe", the routines it can run ("Alexa, bom
// dia"), and a message to announce. From Home Assistant's Alexa Devices integration, read over
// the cameras' line while the card or its page is on screen (ha/live.js).
//
// The entities are found by name, so the plan only links the media player: the device's own
// ones begin with its name ("Echo Show Familia Do not disturb", "… Voice event", "… Announce"),
// and the account's routines are buttons named "<account> Alexa, <routine>". The plan may
// name them instead: `alexa: { dnd, voice, announce, routines: [[entity, label]] }`.

import { watchEntities } from '../ha/live.js';

const ROUTINE = /\bAlexa,\s*(.+)$/i;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function createAlexaLive(access) {
  const live = new Map();      // tv id → { voice, reply, when, dnd, routines, ids, ha }
  const watchers = new Map();  // tv id → { fns: Set, stop }

  function find(cfg, all) {
    const own = typeof cfg.alexa === 'object' ? cfg.alexa : {};
    const media = all.find((s) => s.entity_id === cfg.link?.id);
    const name = (media?.attributes?.friendly_name || '').toLowerCase();
    const mine = (domain, test) => all.find((s) => s.entity_id.startsWith(`${domain}.`) && name
      && (s.attributes?.friendly_name || '').toLowerCase().startsWith(name) && test(s.entity_id, (s.attributes.friendly_name || '').toLowerCase()));
    const ids = {
      dnd: own.dnd || mine('switch', (id) => /do_not_disturb|nao_perturbe/.test(id))?.entity_id,
      voice: own.voice || mine('event', (id) => /voice/.test(id))?.entity_id,
      announce: own.announce || mine('notify', (id, n) => /announce|anunciar/.test(n))?.entity_id,
      speak: own.speak || mine('notify', (id, n) => /speak|falar/.test(n))?.entity_id,
    };
    const routines = own.routines?.length ? own.routines.map(([entity, label]) => ({ entity, label }))
      : all.filter((s) => s.entity_id.startsWith('button.') && ROUTINE.test(s.attributes?.friendly_name || ''))
        .map((s) => ({ entity: s.entity_id, label: cap(ROUTINE.exec(s.attributes.friendly_name)[1].trim()) }));
    return { ids, routines };
  }

  function read(id, states, found) {
    const v = states.get(found.ids.voice);
    const d = states.get(found.ids.dnd);
    const a = v?.attributes || {};
    live.set(id, {
      ...live.get(id),
      voice: a.voice_command || null,
      reply: a.voice_reply || null,
      who: a.person_first_name || null,
      when: v && !['unknown', 'unavailable'].includes(v.state) ? Date.parse(v.state) : null,
      dnd: d ? (d.state === 'unavailable' ? null : d.state === 'on') : null,
      routines: found.routines,
      ids: found.ids,
    });
  }

  /** Calls `fn(extras)` now and on each change while watched; returns the stop. */
  function watch(cfg, fn) {
    let w = watchers.get(cfg.id);
    if (!w) {
      let found = null;
      w = { fns: new Set(), stop: null };
      watchers.set(cfg.id, w);
      w.stop = watchEntities(access, `alexa:${cfg.id}`,
        (all) => {
          found = find(cfg, all);
          return [found.ids.voice, found.ids.dnd].filter(Boolean);
        },
        (states, ha) => {
          read(cfg.id, states, found);
          live.get(cfg.id).ha = ha;
          for (const f of w.fns) f(live.get(cfg.id));
        });
    }
    w.fns.add(fn);
    if (live.has(cfg.id)) fn(live.get(cfg.id));
    return () => {
      w.fns.delete(fn);
      if (w.fns.size) return;
      w.stop();
      watchers.delete(cfg.id);
    };
  }

  async function service(id, domain, srv, data) {
    const x = live.get(id);
    if (!x?.ha) throw new Error('Sem conexão com o Home Assistant');
    await x.ha.call({ type: 'call_service', domain, service: srv, service_data: data });
  }

  return {
    watch,
    get: (id) => live.get(id) || null,
    runRoutine: (id, entity) => service(id, 'button', 'press', { entity_id: entity }),
    setDnd(id, on) {
      const x = live.get(id);
      if (!x?.ids?.dnd) return Promise.reject(new Error('Não perturbe indisponível'));
      x.dnd = on;
      return service(id, 'switch', on ? 'turn_on' : 'turn_off', { entity_id: x.ids.dnd });
    },
    /** Says `message` on the Echo: as an announcement (with its chime), else spoken. */
    announce(id, message) {
      const x = live.get(id);
      const target = x?.ids?.announce || x?.ids?.speak;
      if (!target) return Promise.reject(new Error('Anúncio indisponível'));
      return service(id, 'notify', 'send_message', { entity_id: target, message });
    },
  };
}
