// The cameras' page (the "Câmeras" tab at the end of the menu), Frigate brought into HomeOs:
//
//   [ Garagem · Frente · Sala · Cozinha · Corredor · Quintal ]   the camera (opens the first)
//   [ live picture, PTZ over it ]  [ timeline beside it, on a wide screen ]
//   [ Ao vivo | Galeria | Linha do tempo ]   [ filters · info · full screen ]
//   the latest detections (live) / the gallery / the timeline, filtered
//   ▸ Ajustes da câmera   (this camera only: detection, notify, zone, confidence, interval…)
//   ▸ Controles gerais    (what is not one camera's)
//
// The clips come from Frigate's Home Assistant integration: review items (frigate/reviews/get,
// "marcar como visto" with frigate/reviews/viewed) or, for a camera without reviews, its
// detections (frigate/events/get, "favorito" with frigate/event/retain). A tap plays the clip in
// the camera box: HLS on WebKit (the Mac, iPhone, iPad: Frigate's MP4 is HEVC tagged hev1,
// which WebKit refuses), the MP4 elsewhere. Read over the cameras' line (camera/access.js) only
// while the page is on screen.

import { h, createSlider } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { haptic } from '../bridge.js';
import { ago } from '../lastseen.js';
import { watchEntities, whileVisible } from '../ha/live.js';

const LABEL = { person: ['Pessoa', 'person'], car: ['Carro', 'car'], dog: ['Cachorro', 'dog'], cat: ['Gato', 'cat'], truck: ['Caminhão', 'truck'],
  motorcycle: ['Moto', 'car'], bicycle: ['Bicicleta', 'car'], bird: ['Pássaro', 'eye'], 'person-verified': ['Pessoa reconhecida', 'face'], face: ['Rosto', 'face'], license_plate: ['Placa', 'car'] };
const labelOf = (l) => LABEL[l]?.[0] || l || 'Detecção';
const FRIGATE = 'frigate'; // the integration's instance id
const POLL_MS = 15000;
const DAY = 86400000;
const hls = (() => { try { return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== ''; } catch { return false; } })();

/** The Home Assistant helpers of camera `cam` (a plan entry), by its Frigate name. */
export function camEntities(cam) {
  const n = (cam.link?.id || '').replace(/^camera\./, '');
  return {
    name: n,
    detect: `switch.${n}_detect`,
    notify: `input_boolean.notificar_${n}`,
    zone: `input_boolean.exigir_zona_${n}`,
    contrast: `switch.${n}_improve_contrast`,
    confidence: `input_number.confianca_${n}`,
    interval: `input_select.intervalo_${n}`,
  };
}

const onOff = (s) => s?.state === 'on';
const usable = (s) => s && !['unavailable', 'unknown'].includes(s.state);
const two = (n) => String(n).padStart(2, '0');
const clock = (t) => { const d = new Date(t); return [two(d.getHours()), two(d.getMinutes()), two(d.getSeconds())]; };
const dayWord = (t) => {
  const d = new Date(t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return 'Hoje';
  if (d >= today - DAY) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const span = (s) => { if (s == null) return ''; s = Math.max(0, Math.round(s)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${two(s % 60)}s`; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(`homeos.cams.${k}`)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(`homeos.cams.${k}`, JSON.stringify(v)); } catch { /* private window */ } } };

export function createCamConsole({ access, config, camBox, onPick, isCurrent }) {
  const cams = config.cameras || [];
  const ctl = config.cameraControls || {};
  const forCam = (g, cam) => !g.cameras || g.cameras.includes(cam.id);
  const shared = (g) => !g.cameras;
  let states = new Map();
  let ha = null;
  let current = null; // the camera picked (plan entry)

  async function service(domain, srv, data) {
    if (!ha) throw new Error('Sem conexão com o Home Assistant');
    await ha.call({ type: 'call_service', domain, service: srv, service_data: data });
  }
  function flip(entity) {
    const s = states.get(entity);
    if (!usable(s)) return;
    const on = !onOff(s);
    haptic('light');
    states.set(entity, { ...s, state: on ? 'on' : 'off' }); // shown at once, Home Assistant confirms
    render();
    service(entity.split('.')[0], on ? 'turn_on' : 'turn_off', { entity_id: entity }).catch(() => {});
  }

  /* ================= the picker ================= */
  const chips = new Map();
  const picker = h('div.cam-picker', { role: 'tablist', 'aria-label': 'Câmeras' },
    ...cams.map((c) => {
      const dot = h('span.cam-chip-dot');
      const count = h('span.cam-chip-count', { hidden: true });
      const b = h('button.cam-pick', { role: 'tab', onclick: () => { if (!isCurrent(c.id)) onPick(c.id); } }, icon('cctvFilled', 15), h('span', c.name), count, dot);
      chips.set(c.id, { b, dot, count });
      return b;
    }));

  /* ================= small controls ================= */
  function switchCard(entity, name, glyph, sub) {
    const subEl = h('div.tile-sub');
    const el = h('div.tile.toggle.cc-switch', { role: 'button', tabindex: 0, onclick: () => flip(entity) },
      h('div.bubble', icon(glyph, 18)), h('div.tile-text', h('div.tile-name', name), subEl), h('span.switch'));
    el.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); flip(entity); } });
    return {
      el,
      update() {
        const s = states.get(entity);
        el.hidden = !s;
        el.classList.toggle('on', onOff(s));
        el.classList.toggle('offline', !usable(s));
        el.style.setProperty('--c', '#5aa2ff');
        subEl.textContent = !usable(s) ? 'Indisponível' : sub ? sub(onOff(s)) : onOff(s) ? 'Ligado' : 'Desligado';
      },
    };
  }
  function choiceCard(entity, name, glyph, { stacked = false } = {}) {
    const list = h(`div.cc-choices${stacked ? '.stacked' : ''}`);
    const value = h('span.cc-value');
    const el = h('div.cc-card', h('div.cc-card-head', icon(glyph, 17), h('span', name), value), list);
    let shown = '';
    return {
      el,
      update() {
        const s = states.get(entity);
        el.hidden = !s;
        if (!s) return;
        const opts = s.attributes?.options || [];
        if (opts.join('|') !== shown) {
          shown = opts.join('|');
          list.replaceChildren(...opts.map((o) => h('button.cc-choice', { 'data-v': o, onclick: () => {
            haptic('tick');
            states.set(entity, { ...states.get(entity), state: o });
            render();
            service('input_select', 'select_option', { entity_id: entity, option: o }).catch(() => {});
          } }, stacked ? [h('span.cc-radio'), o] : o)));
        }
        for (const b of list.children) b.classList.toggle('on', b.dataset.v === s.state);
        value.textContent = stacked ? '' : s.state;
      },
    };
  }
  function numberCard(entity, name, glyph) {
    const value = h('span.cc-value');
    const holder = h('div.cc-slider');
    const el = h('div.cc-card', h('div.cc-card-head', icon(glyph, 17), h('span', name), value), holder);
    let slider = null;
    let range = '';
    let timer = 0;
    return {
      el,
      update() {
        const s = states.get(entity);
        el.hidden = !s;
        if (!s) return;
        const a = s.attributes || {};
        const unit = a.unit_of_measurement || '';
        if (`${a.min}:${a.max}:${a.step}` !== range) {
          range = `${a.min}:${a.max}:${a.step}`;
          const step = a.step ?? 1;
          slider = createSlider({ min: a.min ?? 0, max: a.max ?? 100, step, detent: step, value: Number(s.state),
            gradient: 'linear-gradient(90deg, #1d3557 0%, #5aa2ff 100%)', onInput: (n) => {
              value.textContent = `${n}${unit}`;
              clearTimeout(timer);
              timer = setTimeout(() => {
                states.set(entity, { ...states.get(entity), state: String(n) });
                service('input_number', 'set_value', { entity_id: entity, value: n }).catch(() => {});
              }, 450);
            } });
          holder.replaceChildren(slider.el);
        }
        const v = Number(s.state);
        if (Number.isFinite(v)) { slider.set(v); value.textContent = `${Math.round(v)}${unit}`; }
      },
    };
  }
  /** The zone: "Só na zona" and the zones Frigate has drawn on this camera (`zones` in the plan),
   *  lit while something is in them; without zones, the switch would silence the camera. */
  function zoneCard(cam) {
    const e = camEntities(cam);
    const zones = (cam.zones || []).map((z) => (Array.isArray(z) ? { id: z[0], name: z[1] } : typeof z === 'string' ? { id: z, name: z } : z));
    const toggle = h('button.cc-inline-switch', { onclick: () => flip(e.zone) }, h('span', 'Avisar só dentro da zona'), h('span.switch'));
    const chipsEl = h('div.cc-zones', ...zones.map((z) => h('span.cc-zone', { 'data-z': z.id }, icon('fit', 13, 2), z.name)));
    const note = h('div.cc-zone-note');
    const el = h('div.cc-card', h('div.cc-card-head', icon('fit', 17), h('span', 'Zona')), toggle, chipsEl, note);
    return {
      el,
      update() {
        const s = states.get(e.zone);
        el.hidden = !s;
        if (!s) return;
        toggle.classList.toggle('on', onOff(s));
        for (const c of chipsEl.children) c.classList.toggle('busy', onOff(states.get(`binary_sensor.${c.dataset.z}_all_occupancy`)));
        chipsEl.hidden = !zones.length;
        note.classList.toggle('warn', !zones.length && onOff(s));
        note.textContent = zones.length
          ? (onOff(s) ? 'Só avisa quando a pessoa entra numa dessas zonas.' : 'Avisa em qualquer parte da imagem; as zonas ficam só para registro.')
          : onOff(s) ? 'Esta câmera não tem zona desenhada no Frigate: com esta opção ligada ela não avisa.'
            : 'Esta câmera não tem zona desenhada no Frigate: avisa em qualquer parte da imagem.';
      },
    };
  }

  /* ================= the clips ================= */
  let source = 'reviews';           // 'reviews' | 'events' (a camera without reviews: its detections)
  let autoSource = true;
  let items = [];                   // normalized, newest first
  let playing = null;               // the item on screen
  const filters = store.get('filters', { when: 'all', reviewed: 'all', severity: 'all', labels: [], people: [], favorites: false });
  let mode = store.get('mode', 'live'); // 'live' | 'gallery' | 'timeline'

  async function signed(path) {
    const base = (ha?.base || location.origin).replace(/\/$/, '');
    if (path.includes('/notifications/')) return base + path; // served without a login (Frigate's notifications)
    try { return base + (await ha.call({ type: 'auth/sign_path', path, expires: 3600 })).path; } catch { return base + path; }
  }
  const asList = (r) => (typeof r === 'string' ? JSON.parse(r) : r) || [];
  function normalize(list, kind, cam) {
    const n = camEntities(cam).name;
    return list.map((x) => {
      if (kind === 'reviews') {
        const d = x.data || {};
        return { id: x.id, kind, start: x.start_time * 1000, end: x.end_time ? x.end_time * 1000 : null,
          label: d.objects?.[0], labels: d.objects || [], people: d.sub_labels || [], zones: d.zones || [],
          severity: x.severity, reviewed: x.has_been_reviewed, clip: d.detections?.[0] || null,
          thumb: `/api/frigate/notifications/${x.id}/${n}/review_thumbnail.webp` };
      }
      const who = Array.isArray(x.sub_label) ? x.sub_label[0] : x.sub_label;
      return { id: x.id, kind, start: x.start_time * 1000, end: x.end_time ? x.end_time * 1000 : null,
        label: x.label, labels: [x.label], people: who ? [who] : [], zones: x.zones || [],
        score: x.data?.top_score ?? x.top_score, favorite: Boolean(x.retain_indefinitely),
        clip: x.has_clip ? x.id : null, thumb: `/api/frigate/notifications/${x.id}/thumbnail.jpg` };
    });
  }
  let pollTimer = 0;
  let loadSerial = 0;
  async function load() {
    clearTimeout(pollTimer);
    const cam = current;
    if (!cam || !ha) return;
    const mine = ++loadSerial;
    const name = camEntities(cam).name;
    const after = filters.when === 'today' ? new Date().setHours(0, 0, 0, 0) / 1000
      : filters.when === 'yesterday' ? (new Date().setHours(0, 0, 0, 0) - DAY) / 1000
        : filters.when === 'week' ? (Date.now() - 7 * DAY) / 1000 : undefined;
    const before = filters.when === 'yesterday' ? new Date().setHours(0, 0, 0, 0) / 1000 : undefined;
    const range = { ...(after && { after: Math.floor(after) }), ...(before && { before: Math.floor(before) }) };
    try {
      let kind = source;
      let list;
      if (kind === 'reviews') {
        list = asList(await ha.call({ type: 'frigate/reviews/get', instance_id: FRIGATE, cameras: [name], limit: 120, ...range }));
        // a camera whose detections never became reviews (no alerts configured): its detections
        if (!list.length && autoSource) {
          kind = 'events';
          list = asList(await ha.call({ type: 'frigate/events/get', instance_id: FRIGATE, cameras: [name], limit: 120, ...range }));
        }
      } else {
        list = asList(await ha.call({ type: 'frigate/events/get', instance_id: FRIGATE, cameras: [name], limit: 120, ...range }));
      }
      if (mine !== loadSerial || cam !== current) return;
      shownSource = kind;
      items = normalize(list, kind, cam);
      for (const it of items) it.url = await signed(it.thumb);
      if (mine !== loadSerial) return;
      failed = false;
    } catch {
      if (mine === loadSerial) failed = true;
    }
    renderClips();
    if (cam === current) pollTimer = setTimeout(load, POLL_MS);
  }
  let shownSource = 'reviews';
  let failed = false;

  function filtered() {
    return items.filter((it) => {
      if (shownSource === 'reviews' && filters.reviewed === 'unreviewed' && it.reviewed) return false;
      if (shownSource === 'reviews' && filters.reviewed === 'reviewed' && !it.reviewed) return false;
      if (shownSource === 'reviews' && filters.severity !== 'all' && it.severity !== filters.severity) return false;
      if (shownSource === 'events' && filters.favorites && !it.favorite) return false;
      if (filters.labels.length && !it.labels.some((l) => filters.labels.includes(l))) return false;
      if (filters.people.length && !it.people.some((p) => filters.people.includes(p))) return false;
      return true;
    });
  }

  async function play(it) {
    if (!it.clip) return;
    haptic('light');
    playing = it;
    const path = hls ? `/api/frigate/notifications/${it.clip}/master.m3u8` : `/api/frigate/notifications/${it.clip}/${camEntities(current).name}/clip.mp4`;
    const [hh, mm] = clock(it.start);
    camBox.playClip(await signed(path), `${labelOf(it.label)}${it.people[0] ? ` · ${it.people[0]}` : ''} · ${hh}:${mm}`, () => { playing = null; renderClips(); });
    renderClips();
    viewer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function markViewed(it, viewed = true) {
    haptic('tick');
    it.reviewed = viewed;
    renderClips();
    try { await ha.call({ type: 'frigate/reviews/viewed', instance_id: FRIGATE, ids: [it.id], viewed }); } catch { it.reviewed = !viewed; renderClips(); }
  }
  async function markAllViewed() {
    const ids = filtered().filter((it) => !it.reviewed).map((it) => it.id);
    if (!ids.length) return;
    haptic('medium');
    for (const it of items) if (ids.includes(it.id)) it.reviewed = true;
    renderClips();
    try { await ha.call({ type: 'frigate/reviews/viewed', instance_id: FRIGATE, ids, viewed: true }); } catch { load(); }
  }
  async function toggleFavorite(it) {
    haptic('tick');
    it.favorite = !it.favorite;
    renderClips();
    try { await ha.call({ type: 'frigate/event/retain', instance_id: FRIGATE, event_id: it.id, retain: it.favorite }); } catch { it.favorite = !it.favorite; renderClips(); }
  }

  /** One clip as a picture (the strip, the gallery). */
  function tile(it) {
    const [hh, mm] = clock(it.start);
    const glyph = LABEL[it.label]?.[1] || 'eye';
    const mark = it.kind === 'reviews'
      ? h(`button.cc-det-mark${it.reviewed ? '.done' : ''}`, { title: it.reviewed ? 'Marcar como não visto' : 'Marcar como visto', 'aria-label': it.reviewed ? 'Marcar como não visto' : 'Marcar como visto',
        onclick: (e) => { e.stopPropagation(); markViewed(it, !it.reviewed); } }, icon('check', 13, 2.6))
      : h(`button.cc-det-mark.fav${it.favorite ? '.done' : ''}`, { title: it.favorite ? 'Tirar dos favoritos' : 'Guardar nos favoritos',
        onclick: (e) => { e.stopPropagation(); toggleFavorite(it); } }, icon('pin', 12, 2.4));
    return h(`button.cc-det${it.kind === 'reviews' && !it.reviewed ? '.new' : ''}${playing?.id === it.id ? '.playing' : ''}${it.severity === 'alert' ? '.alert' : ''}`,
      { title: `${labelOf(it.label)}${it.people.length ? ` · ${it.people.join(', ')}` : ''}`, onclick: () => play(it) },
      h('img', { src: it.url, alt: '', loading: 'lazy' }),
      mark,
      !it.end ? h('span.cc-rec', h('i'), 'REC') : null,
      h('span.cc-det-tag', icon(glyph, 11, 2.2), it.people[0] || labelOf(it.label)),
      h('span.cc-det-when', `${hh}:${mm}`));
  }
  /** One clip as a row of the timeline (as Frigate's side panel). */
  function row(it) {
    const [hh, mm, ss] = clock(it.start);
    const dur = it.end ? span((it.end - it.start) / 1000) : null;
    return h(`button.cc-row${it.kind === 'reviews' && !it.reviewed ? '.new' : ''}${playing?.id === it.id ? '.playing' : ''}`, { onclick: () => play(it) },
      h('span.cc-row-pic', h('img', { src: it.url, alt: '', loading: 'lazy' }),
        it.kind === 'reviews' && it.reviewed ? h('span.cc-row-seen', icon('check', 12, 2.6)) : null),
      h('span.cc-row-text',
        !it.end ? h('span.cc-rec.inline', h('i'), 'REC') : null,
        h('span.cc-row-top', h('b', it.people[0] || labelOf(it.label)), h('span.cc-row-time', `${hh}:${mm}`, h('small', `:${ss}`))),
        h('span.cc-row-sub', [dayWord(it.start), dur].filter(Boolean).join(' · ')),
        h('span.cc-row-sub', [current?.name, ...(it.zones || [])].filter(Boolean).join(' · '))));
  }

  /* ================= the layout ================= */
  const videoSlot = h('div.cc-video');                 // the camera box is put here (panel.js)
  const side = h('div.cc-side');                       // the timeline beside the picture (wide)
  const viewer = h('div.cc-viewer', videoSlot, side);
  const modeBtns = [['live', 'Ao vivo', 'cctv'], ['gallery', 'Galeria', 'layout'], ['timeline', 'Linha do tempo', 'list']].map(([m, label, g]) => {
    const badge = h('span.cc-badge', { hidden: true });
    const b = h('button.cc-mode', { 'data-m': m, onclick: () => { haptic('tick'); mode = m; store.set('mode', m); renderClips(); } }, icon(g, 15, 2), h('span', label), badge);
    b.badge = badge;
    return b;
  });
  const filterBtn = h('button.cc-tool', { title: 'Filtros', 'aria-label': 'Filtros', onclick: () => { filtersOpen = !filtersOpen; infoOpen = false; renderClips(); } }, icon('sliders', 16, 2), h('span.cc-tool-dot', { hidden: true }));
  const infoBtn = h('button.cc-tool', { title: 'Informações', 'aria-label': 'Informações', onclick: () => { infoOpen = !infoOpen; filtersOpen = false; renderClips(); } }, icon('info', 16, 2));
  const fullBtn = h('button.cc-tool', { title: 'Tela cheia', 'aria-label': 'Tela cheia', onclick: () => camBox.fullscreen() }, icon('fit', 16, 2));
  const toolbar = h('div.cc-toolbar', h('div.cc-modes', ...modeBtns), h('div.cc-tools', filterBtn, infoBtn, fullBtn));
  let filtersOpen = false;
  let infoOpen = false;
  const filterPanel = h('div.cc-filters', { hidden: true });
  const infoPanel = h('div.cc-info', { hidden: true });
  const listHead = h('div.cc-list-head');
  const strip = h('div.cc-detections');
  const gallery = h('div.cc-gallery');
  const timeline = h('div.cc-timeline');
  const empty = h('div.cc-note');
  const clipsSection = h('section.cc-section.cc-clips', toolbar, filterPanel, infoPanel, listHead, strip, gallery, timeline, empty);

  // the two folded sections: shown on a tap, remembered per device
  function fold(key, title, glyph, body) {
    const open = store.get(`open.${key}`, false);
    const head = h('button.cc-fold-head', { 'aria-expanded': String(open), onclick: () => {
      const now = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(now));
      section.classList.toggle('open', now);
      store.set(`open.${key}`, now);
      haptic('tick');
    } }, icon(glyph, 16, 2), h('span', title), h('span.cc-fold-sub'), icon('down', 16, 2.2));
    const section = h(`section.cc-fold${open ? '.open' : ''}`, head, h('div.cc-fold-body', body));
    section.sub = head.querySelector('.cc-fold-sub');
    return section;
  }
  const settingsGrid = h('div.cc-grid');
  const settingsFold = fold('settings', 'Ajustes da câmera', 'sliders', settingsGrid);
  const hint = h('div.cc-hint', icon('cctv', 22), h('div', h('b', 'Escolha uma câmera'), h('span', 'O vídeo abre com as detecções e os ajustes dela.')));

  // general controls: only what is not one camera's
  const actions = (ctl.actions || []).map((a) => h('button.scene.cc-action', { onclick: async (ev) => {
    haptic('medium');
    const b = ev.currentTarget;
    b.classList.add('running');
    try { await service(a.entity.split('.')[0], a.entity.startsWith('button.') ? 'press' : 'turn_on', { entity_id: a.entity }); } catch { /* its state shows it */ }
    setTimeout(() => b.classList.remove('running'), 900);
  } }, h('span.glyph-ring', icon(a.icon || 'cctv', 17)), h('span', a.name)));
  const general = [
    ...(ctl.switches || []).filter(shared).map((s) => switchCard(s.entity, s.name, s.icon || 'toggle')),
    ...(ctl.selects || []).filter(shared).map((s) => choiceCard(s.entity, s.name, s.icon || 'list', { stacked: true })),
  ];
  const generalFold = fold('general', 'Controles gerais', 'shield',
    h('div.cc-general', actions.length ? h('div.cc-actions', ...actions) : null, h('div.cc-grid', ...general.map((p) => p.el))));

  const el = h('div.cam-console', hint, viewer, clipsSection, settingsFold, generalFold);
  let camParts = [];

  function buildCam(cam) {
    const e = camEntities(cam);
    camParts = [
      switchCard(e.detect, 'Detecção', 'presence', (on) => (on ? 'Ligada' : 'Desligada')),
      switchCard(e.notify, 'Notificar', 'bell', (on) => (on ? 'Ligado' : 'Desligado')),
      switchCard(e.contrast, 'Contraste noturno', 'contrast'),
      // this camera's part of the plan's controls (Vigilância for the Sala and the Cozinha…)
      ...(ctl.switches || []).filter((g) => g.cameras && forCam(g, cam)).map((s) => switchCard(s.entity, s.name, s.icon || 'toggle')),
      zoneCard(cam),
      numberCard(e.confidence, 'Confiança mínima', 'userCheck'),
      choiceCard(e.interval, 'Intervalo mínimo', 'hourglass'),
    ];
    settingsGrid.replaceChildren(...camParts.map((p) => p.el));
    items = [];
    playing = null;
    autoSource = true;
    source = 'reviews';
    renderClips();
    load();
  }

  /* ================= rendering ================= */
  function chipRow(title, options, isOn, toggle) {
    return h('div.cc-filter', h('div.cc-filter-title', title),
      h('div.cc-filter-chips', ...options.map(([v, label]) => h(`button.cc-fchip${isOn(v) ? '.on' : ''}`, { onclick: () => { haptic('tick'); toggle(v); store.set('filters', filters); load(); renderClips(); } }, label))));
  }
  function renderFilters() {
    const labels = [...new Set(items.flatMap((it) => it.labels))].filter(Boolean);
    const people = [...new Set(items.flatMap((it) => it.people))].filter(Boolean);
    const set = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
    filterPanel.replaceChildren(...[
      chipRow('Tipo de mídia', [['reviews', 'Revisões'], ['events', 'Detecções']], (v) => v === shownSource, (v) => { source = v; autoSource = false; }),
      chipRow('Quando', [['all', 'Tudo'], ['today', 'Hoje'], ['yesterday', 'Ontem'], ['week', '7 dias']], (v) => filters.when === v, (v) => { filters.when = v; }),
      labels.length ? chipRow('O que', labels.map((l) => [l, labelOf(l)]), (v) => filters.labels.includes(v), (v) => set(filters.labels, v)) : null,
      chipRow('Pessoa', people.length ? people.map((p) => [p, p]) : [['', 'Ninguém reconhecido ainda']], (v) => filters.people.includes(v), (v) => { if (v) set(filters.people, v); }),
      shownSource === 'reviews' ? chipRow('Visto', [['all', 'Todos'], ['unreviewed', 'Não vistos'], ['reviewed', 'Vistos']], (v) => filters.reviewed === v, (v) => { filters.reviewed = v; }) : null,
      shownSource === 'reviews' ? chipRow('Gravidade', [['all', 'Todas'], ['alert', 'Alertas'], ['detection', 'Detecções']], (v) => filters.severity === v, (v) => { filters.severity = v; }) : null,
      shownSource === 'events' ? chipRow('Favoritos', [[false, 'Todos'], [true, 'Só favoritos']], (v) => filters.favorites === v, (v) => { filters.favorites = v; }) : null,
      h('button.cc-filter-clear', { onclick: () => { Object.assign(filters, { when: 'all', reviewed: 'all', severity: 'all', labels: [], people: [], favorites: false }); store.set('filters', filters); load(); renderClips(); } }, 'Limpar filtros')].filter(Boolean));
  }
  function renderInfo() {
    const it = playing;
    const e = current && camEntities(current);
    const line = (k, v) => (v ? h('div.cc-info-row', h('span', k), h('b', v)) : null);
    if (it) {
      const [hh, mm, ss] = clock(it.start);
      infoPanel.replaceChildren(...[h('div.cc-info-title', icon('video', 15, 2), 'Este clipe'),
        line('O que', it.labels.map(labelOf).join(', ')),
        line('Pessoa', it.people.join(', ')),
        line('Quando', `${dayWord(it.start)}, ${hh}:${mm}:${ss}`),
        line('Duração', it.end ? span((it.end - it.start) / 1000) : 'gravando'),
        line('Zonas', it.zones.join(', ')),
        line('Confiança', it.score ? `${Math.round(it.score * 100)}%` : ''),
        line('Gravidade', it.severity === 'alert' ? 'Alerta' : it.severity === 'detection' ? 'Detecção' : ''),
        it.kind === 'reviews' ? line('Visto', it.reviewed ? 'Sim' : 'Não') : null].filter(Boolean));
    } else {
      const unseen = items.filter((x) => x.kind === 'reviews' && !x.reviewed).length;
      infoPanel.replaceChildren(...[h('div.cc-info-title', icon('cctv', 15, 2), current?.name || 'Câmera'),
        line('Detecção', e && (onOff(states.get(e.detect)) ? 'Ligada' : 'Desligada')),
        line('Notificar', e && (onOff(states.get(e.notify)) ? 'Ligado' : 'Desligado')),
        line('Última detecção', items[0] ? `${dayWord(items[0].start)}, ${clock(items[0].start).slice(0, 2).join(':')} (${ago(items[0].start)})` : 'nenhuma'),
        line('Não vistas', shownSource === 'reviews' ? String(unseen) : ''),
        line('PTZ', current?.ptz ? 'Sim (setas sobre o vídeo)' : ''),
        line('Fonte', shownSource === 'reviews' ? 'Revisões do Frigate' : 'Detecções do Frigate')].filter(Boolean));
    }
  }
  function renderClips() {
    for (const b of modeBtns) b.classList.toggle('on', b.dataset.m === mode);
    const unseen = items.filter((x) => x.kind === 'reviews' && !x.reviewed).length;
    modeBtns[1].badge.hidden = !unseen;
    modeBtns[1].badge.textContent = unseen > 99 ? '99+' : String(unseen);
    const active = filters.when !== 'all' || filters.reviewed !== 'all' || filters.severity !== 'all' || filters.labels.length || filters.people.length || filters.favorites;
    filterBtn.querySelector('.cc-tool-dot').hidden = !active;
    filterBtn.classList.toggle('on', filtersOpen);
    infoBtn.classList.toggle('on', infoOpen);
    filterPanel.hidden = !filtersOpen;
    infoPanel.hidden = !infoOpen;
    if (filtersOpen) renderFilters();
    if (infoOpen) renderInfo();

    const list = filtered();
    const det = current && states.get(camEntities(current).detect);
    const word = shownSource === 'reviews' ? 'revisões' : 'detecções';
    listHead.replaceChildren(...[
      h('span', mode === 'live' ? 'Últimas detecções' : mode === 'gallery' ? 'Galeria' : 'Linha do tempo'),
      h('small', list.length ? `${list.length} ${word}` : ''),
      shownSource === 'reviews' && list.some((it) => !it.reviewed)
        ? h('button.cc-mark-all', { onclick: markAllViewed }, icon('check', 13, 2.4), 'Marcar tudo como visto') : null].filter(Boolean));
    strip.replaceChildren(...(mode === 'live' ? list.slice(0, 16).map(tile) : []));
    gallery.replaceChildren(...(mode === 'gallery' ? list.map(tile) : []));
    timeline.replaceChildren(...(mode === 'timeline' ? list.map(row) : []));
    // beside the picture on a wide screen: the timeline while live
    side.replaceChildren(...(mode === 'live' ? list.slice(0, 30).map(row) : []));
    viewer.classList.toggle('with-side', mode === 'live' && list.length > 0);
    empty.hidden = list.length > 0;
    empty.textContent = failed ? 'Não foi possível ler as detecções do Frigate.'
      : items.length ? 'Nada com esses filtros.'
        : onOff(det) ? 'Nenhuma detecção ainda nesta câmera.' : 'Nenhuma detecção. A detecção desta câmera está desligada (em Ajustes da câmera).';
  }

  /* ================= reading Home Assistant while on screen ================= */
  const wanted = () => {
    const ids = [];
    for (const c of cams) {
      ids.push(...Object.values(camEntities(c)).filter((v) => v.includes('.')));
      for (const z of c.zones || []) ids.push(`binary_sensor.${Array.isArray(z) ? z[0] : z.id || z}_all_occupancy`);
    }
    for (const g of [...(ctl.switches || []), ...(ctl.selects || []), ...(ctl.actions || [])]) ids.push(g.entity);
    return ids;
  };
  let live = false;
  whileVisible(el, () => {
    live = true;
    const stop = watchEntities(access, 'camconsole', (all) => {
      const want = new Set(wanted());
      return all.map((s) => s.entity_id).filter((id) => want.has(id));
    }, (now, conn) => {
      const first = !ha;
      ha = conn;
      states = new Map(now);
      render();
      if (current && (first || !items.length)) load();
    });
    return () => { live = false; clearTimeout(pollTimer); stop(); };
  });

  function render() {
    for (const c of cams) {
      const chip = chips.get(c.id);
      const det = states.get(camEntities(c).detect);
      chip.b.classList.toggle('on', isCurrent(c.id));
      chip.b.setAttribute('aria-selected', String(isCurrent(c.id)));
      chip.dot.classList.toggle('armed', onOff(det));
      chip.dot.title = onOff(det) ? 'Detecção ligada' : 'Detecção desligada';
    }
    hint.hidden = Boolean(current);
    viewer.hidden = !current;
    clipsSection.hidden = !current;
    settingsFold.hidden = !current;
    if (current) {
      const e = camEntities(current);
      settingsFold.sub.textContent = `${current.name} · detecção ${onOff(states.get(e.detect)) ? 'ligada' : 'desligada'}`;
    }
    generalFold.sub.textContent = '';
    for (const p of [...camParts, ...general]) p.update();
  }

  return {
    el,
    picker,
    /** Where the camera box goes on this page (panel.js moves it here and back). */
    videoSlot,
    /** The camera picked on this page (its live picture is open), or null. */
    show(id) {
      const cam = cams.find((c) => c.id === id) || null;
      if (cam === current) { render(); return; }
      current = cam;
      if (cam) { store.set('last', cam.id); buildCam(cam); } else { camParts = []; settingsGrid.replaceChildren(); clearTimeout(pollTimer); items = []; }
      render();
      if (cam && live && ha) load();
    },
    /** The camera this page opens with: the last one seen here, else the first. */
    firstCamera() { const last = store.get('last', null); return (cams.find((c) => c.id === last) || cams[0])?.id || null; },
    refresh: render,
  };
}
