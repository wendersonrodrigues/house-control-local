// The cameras' page (the "Câmeras" tab at the end of the menu): pick a camera, and below its
// live picture (camera/view.js, with the PTZ pad on the ones that move) come
//   - its latest detections from Frigate (a tap plays the clip in the camera box),
//   - its own settings, the same Home Assistant helpers as the HA dashboards: Detecção
//     (switch.<cam>_detect), Notificar, Só na zona, Contraste noturno, Confiança mínima and
//     Intervalo mínimo (input_boolean / input_number / input_select ..._<cam>),
//   - and, always at the end, the general controls of the plan's `cameraControls`.
// Read over the cameras' line (camera/access.js) only while the page is on screen.

import { h, createSlider } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { haptic } from '../bridge.js';
import { ago } from '../lastseen.js';
import { watchEntities, whileVisible } from '../ha/live.js';

const LABEL = { person: ['Pessoa', 'person'], car: ['Carro', 'car'], dog: ['Cachorro', 'dog'], cat: ['Gato', 'cat'], truck: ['Caminhão', 'truck'], motorcycle: ['Moto', 'car'], bicycle: ['Bicicleta', 'car'] };
const FRIGATE = 'frigate'; // the integration's instance id
const POLL_MS = 15000;

/** The Home Assistant helpers of camera `cam` (a plan entry): by its Frigate name. */
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

export function createCamConsole({ access, config, camBox, onPick, isCurrent }) {
  const cams = config.cameras || [];
  const ctl = config.cameraControls || {};
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

  /* ---------- the picker: a row of chips, one per camera ---------- */
  const chips = new Map();
  const picker = h('div.cam-picker', { role: 'tablist', 'aria-label': 'Câmeras' },
    ...cams.map((c) => {
      const dot = h('span.cam-chip-dot');
      const b = h('button.cam-pick', { role: 'tab', onclick: () => onPick(c.id) }, icon('cctvFilled', 15), h('span', c.name), dot);
      chips.set(c.id, { b, dot });
      return b;
    }));

  /* ---------- a switch card ---------- */
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

  /** Options of an input_select as a row of chips (short), or stacked rows (long ones). */
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
        const key = opts.join('|');
        if (key !== shown) {
          shown = key;
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

  /** An input_number as a slider (Confiança mínima). */
  function numberCard(entity, name, glyph) {
    const value = h('span.cc-value');
    let slider = null;
    let range = '';
    let timer = 0;
    const holder = h('div.cc-slider');
    const el = h('div.cc-card', h('div.cc-card-head', icon(glyph, 17), h('span', name), value), holder);
    return {
      el,
      update() {
        const s = states.get(entity);
        el.hidden = !s;
        if (!s) return;
        const a = s.attributes || {};
        const min = a.min ?? 0;
        const max = a.max ?? 100;
        const step = a.step ?? 1;
        const v = Number(s.state);
        if (`${min}:${max}:${step}` !== range) {
          range = `${min}:${max}:${step}`;
          slider = createSlider({ min, max, step, value: v, detent: step, gradient: 'linear-gradient(90deg, #1d3557 0%, #5aa2ff 100%)', onInput: (n) => {
            value.textContent = `${n}${a.unit_of_measurement || ''}`;
            clearTimeout(timer);
            timer = setTimeout(() => {
              states.set(entity, { ...states.get(entity), state: String(n) });
              service('input_number', 'set_value', { entity_id: entity, value: n }).catch(() => {});
            }, 450);
          } });
          holder.replaceChildren(slider.el);
        }
        if (Number.isFinite(v)) { slider.set(v); value.textContent = `${Math.round(v)}${a.unit_of_measurement || ''}`; }
      },
    };
  }

  /* ---------- the camera's part: detections and settings ---------- */
  const camTitle = h('span');
  const detList = h('div.cc-detections');
  const detNote = h('div.cc-note');
  const detSection = h('section.cc-section', h('div.cc-head', icon('eye', 15), h('span', 'Últimas detecções')), detList, detNote);
  const settingsGrid = h('div.cc-grid');
  const settingsSection = h('section.cc-section', h('div.cc-head', icon('sliders', 15), h('span', 'Ajustes da câmera '), camTitle), settingsGrid);
  const hint = h('div.cc-hint', icon('cctv', 22), h('div', h('b', 'Escolha uma câmera'), h('span', 'O vídeo abre com as últimas detecções e os ajustes dela.')));
  let camParts = [];

  function buildCam(cam) {
    const e = camEntities(cam);
    camTitle.textContent = cam.name;
    camParts = [
      switchCard(e.detect, 'Detecção', 'presence', (on) => (on ? 'Ligada' : 'Desligada')),
      switchCard(e.notify, 'Notificar', 'bell', (on) => (on ? 'Ligado' : 'Desligado')),
      switchCard(e.zone, 'Só na zona', 'fit', (on) => (on ? 'Só dentro da zona' : 'Em toda a imagem')),
      switchCard(e.contrast, 'Contraste noturno', 'contrast'),
      numberCard(e.confidence, 'Confiança mínima', 'userCheck'),
      choiceCard(e.interval, 'Intervalo mínimo', 'hourglass'),
    ];
    settingsGrid.replaceChildren(...camParts.map((p) => p.el));
    events = [];
    detList.replaceChildren();
    loadEvents();
  }

  /* ---------- the general controls ---------- */
  const actions = (ctl.actions || []).map((a) => h('button.scene.cc-action', { onclick: async (ev) => {
    haptic('medium');
    const b = ev.currentTarget;
    b.classList.add('running');
    try { await service(a.entity.split('.')[0], a.entity.startsWith('button.') ? 'press' : 'turn_on', { entity_id: a.entity }); } catch { /* shown by its state */ }
    setTimeout(() => b.classList.remove('running'), 900);
  } }, h('span.glyph-ring', icon(a.icon || 'cctv', 17)), h('span', a.name)));
  const general = [
    ...(ctl.switches || []).map((s) => switchCard(s.entity, s.name, s.icon || 'toggle')),
    ...(ctl.selects || []).map((s) => choiceCard(s.entity, s.name, s.icon || 'list', { stacked: true })),
  ];
  const generalSection = h('section.cc-section', h('div.cc-head', icon('sliders', 15), h('span', 'Controles gerais')),
    actions.length ? h('div.cc-actions', ...actions) : null, h('div.cc-grid', ...general.map((p) => p.el)));

  const el = h('div.cam-console', hint, detSection, settingsSection, generalSection);

  /* ---------- the latest detections (Frigate's events) ---------- */
  let events = [];
  let pollTimer = 0;
  async function signed(path) {
    const base = (ha.base || location.origin).replace(/\/$/, '');
    try {
      const r = await ha.call({ type: 'auth/sign_path', path, expires: 3600 });
      return base + r.path;
    } catch { return base + path; }
  }
  async function loadEvents() {
    clearTimeout(pollTimer);
    const cam = current;
    if (!cam || !ha) return;
    const { name } = camEntities(cam);
    try {
      let list = await ha.call({ type: 'frigate/events/get', instance_id: FRIGATE, cameras: [name], limit: 12 });
      if (typeof list === 'string') list = JSON.parse(list);
      if (cam !== current) return;
      const fresh = list.map((e) => e.id).join();
      if (fresh !== events.map((e) => e.id).join()) {
        events = list;
        const items = await Promise.all(list.map(async (ev) => {
          const thumb = await signed(`/api/frigate/notifications/${ev.id}/thumbnail.jpg`);
          const [word, glyph] = LABEL[ev.label] || [ev.label, 'eye'];
          const who = Array.isArray(ev.sub_label) ? ev.sub_label[0] : ev.sub_label;
          const score = ev.data?.top_score ?? ev.top_score;
          const when = h('span.cc-det-when');
          const item = h('button.cc-det', { title: `${who || word}${score ? ` · ${Math.round(score * 100)}%` : ''}`, onclick: async () => {
            if (!ev.has_clip) return;
            haptic('light');
            camBox.playClip(await signed(`/api/frigate/notifications/${ev.id}/${name}/clip.mp4`), `${who || word} · ${cam.name}`);
          } },
          h('img', { src: thumb, alt: '', loading: 'lazy' }),
          h('span.cc-det-tag', icon(glyph, 11, 2.2), who || word),
          ev.has_clip ? h('span.cc-det-play', icon('play', 12, 2.4)) : null,
          when);
          item.dataset.start = String(ev.start_time * 1000);
          return item;
        }));
        if (cam !== current) return;
        detList.replaceChildren(...items);
      }
      for (const item of detList.children) item.querySelector('.cc-det-when').textContent = ago(Number(item.dataset.start));
      render();
    } catch (e) {
      detNote.textContent = 'Não foi possível ler as detecções do Frigate';
      detNote.hidden = false;
    }
    if (cam === current) pollTimer = setTimeout(loadEvents, POLL_MS);
  }

  /* ---------- reading Home Assistant while the page is on screen ---------- */
  const wanted = () => {
    const ids = [];
    for (const c of cams) ids.push(...Object.values(camEntities(c)).filter((v) => v.includes('.')));
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
      ha = conn;
      states = new Map(now);
      render();
      if (current && !events.length) loadEvents();
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
    settingsSection.hidden = !current;
    detSection.hidden = !current;
    if (current) {
      const det = states.get(camEntities(current).detect);
      const none = !detList.children.length;
      detNote.hidden = !none && onOff(det);
      detNote.textContent = none ? (onOff(det) ? 'Nenhuma detecção recente.' : 'Nenhuma detecção recente. A detecção desta câmera está desligada.')
        : 'A detecção está desligada: estas são as últimas antes de desligar.';
    }
    for (const p of [...camParts, ...general]) p.update();
  }

  return {
    el,
    picker,
    /** The camera picked on this page (its live picture is open), or null. */
    show(id) {
      const cam = cams.find((c) => c.id === id) || null;
      if (cam === current) { render(); return; }
      current = cam;
      if (cam) buildCam(cam);
      else { camParts = []; settingsGrid.replaceChildren(); clearTimeout(pollTimer); }
      render();
      if (cam && live && ha) loadEvents();
    },
    refresh: render,
  };
}
