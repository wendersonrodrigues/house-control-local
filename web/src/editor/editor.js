// Home editor (a window on the Mac, full screen on the iPhone): a top-down plan you can drag
// things around on, an inspector for the selected item, a live 3D preview and the links to
// real devices. On a phone the same pieces are laid out for a finger: the plan fills the
// screen, the inspector is a sheet from the bottom, pinch zooms and drag pans.
import './editor.css';
import { normalize, loadRawConfig, LIGHT_KINDS, FLOOR_KINDS, isLinked } from '../config.js';
import { createWorld } from '../three/world.js';
import { FURNITURE_TYPES, footprint } from '../three/furniture.js';
import { h, clamp } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { isNative, isPhone, call, post, haptic, incoming } from '../bridge.js';
import { createConnections } from './connections.js';

const SVG = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids.filter((k) => k != null));
  return el;
};

const KEYS = { room: 'rooms', light: 'lights', ac: 'acs', furniture: 'furniture', opening: 'openings', scene: 'scenes',
  tv: 'tvs', gate: 'gates', shortcut: 'shortcuts', toggle: 'toggles' };
const TITLES = { room: 'Cômodos', light: 'Luzes', ac: 'Ares-condicionados', furniture: 'Móveis', opening: 'Portas e janelas', scene: 'Cenas',
  tv: 'TVs', gate: 'Portões', shortcut: 'Atalhos', toggle: 'Chaves de automação' };
// Not on the plan: linked to a Home Assistant entity and shown in the panel only.
const EXTRAS = ['gate', 'shortcut', 'toggle'];
const EXTRA_ICONS = ['sparkles', 'lightsOff', 'bulb', 'outside', 'sun', 'moon', 'home', 'gate', 'presence', 'eye', 'automation', 'toggle', 'shield'];
const FLOOR_FILL = { oak: '#4a3d2e', walnut: '#3c2f28', tile: '#39424b', stone: '#30353c' };
const WALLS = ['north', 'east', 'south', 'west'];
const SCENE_ICONS = ['sun', 'sofa', 'film', 'moon', 'door', 'table', 'bed', 'tv', 'sparkles'];
// What the pickers show for the plan's own words (the file keeps the English ones).
const NAMES = {
  oak: 'Carvalho', walnut: 'Nogueira', tile: 'Cerâmica', stone: 'Pedra',
  ceiling: 'Teto', pendant: 'Pendente', spots: 'Spots', floor: 'Coluna', table: 'Abajur', strip: 'Fita de LED', flood: 'Holofote',
  north: 'Norte', south: 'Sul', east: 'Leste', west: 'Oeste',
  rug: 'Tapete', sofa: 'Sofá', armchair: 'Poltrona', coffeeTable: 'Mesa de centro', tv: 'TV', sideboard: 'Aparador',
  diningSet: 'Mesa de jantar', island: 'Ilha de cozinha', kitchen: 'Cozinha', fridge: 'Geladeira', bed: 'Cama',
  nightstand: 'Criado-mudo', dresser: 'Cômoda', plant: 'Planta', vanity: 'Pia de banheiro', bathtub: 'Banheira',
  toilet: 'Vaso sanitário', desk: 'Escrivaninha', wardrobe: 'Guarda-roupa', bookshelf: 'Estante',
  door: 'Porta', open: 'Passagem aberta', window: 'Janela',
  // Icons of shortcuts and switches.
  sparkles: 'Brilho', lightsOff: 'Luzes apagadas', bulb: 'Lâmpada', outside: 'Área externa', sun: 'Sol', moon: 'Lua',
  home: 'Casa', gate: 'Portão', presence: 'Presença', eye: 'Vigilância', automation: 'Automação', toggle: 'Chave', shield: 'Segurança',
};
const named = (values) => values.map((v) => [v, NAMES[v] || v]);
const REGIONS = [
  ['eu', 'Central Europe'], ['eu-w', 'Western Europe'], ['us', 'Western America'], ['us-e', 'Eastern America'],
  ['cn', 'China'], ['in', 'India'], ['sg', 'Singapore'],
];

const round = (v, step = 0.05) => Math.round(v / step) * step;
const fix = (v) => Math.round(v * 1000) / 1000;
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

export async function bootEditor(root) {
  let doc = structuredClone(await loadRawConfig());
  for (const key of Object.values(KEYS)) doc[key] ||= [];

  // "connections", "service:smartlife|homeassistant|hue|homekit": where the editor opens
  // (HOUSE_OPEN_EDITOR, or the Mac's Settings window through incoming.openSection).
  const sectionSel = (at) => (at === 'connections' ? { kind: 'connections' }
    : at.startsWith('service:') ? { kind: 'service', service: at.slice(8) }
      : at === 'tuya' ? { kind: 'service', service: 'smartlife' } : { kind: 'home' });
  let sel = sectionSel(window.__HOUSE_BOOT__?.section || new URLSearchParams(location.search).get('section') || '');
  let dirty = false;
  let world = null;
  let phone = null; // the iPhone's layout and gestures, set up by buildPhoneLayout()
  let previewLights = true;
  const undo = [];
  const redo = [];
  const tuya = {
    info: window.__HOUSE_BOOT__?.tuya || { configured: false, accessId: '', region: 'eu' },
    account: window.__HOUSE_BOOT__?.smartLife || { connected: false, userCode: '', account: '' },
    devices: null, busy: false, error: null, qr: null,
    get linked() { return this.account.connected || this.info.configured; },
  };
  const links = createConnections({
    rerender: () => {
      renderSidebar();
      if (['connections', 'service', 'light', 'ac', 'tv', ...EXTRAS].includes(sel.kind)) renderInspector();
    },
    toast,
    usedBy: () => links.usedMap(doc),
    // On the iPhone the connection screens are native ones, shown over the editor.
    onOpen: (service) => (isPhone && service ? post('openConnection', { service })
      : select(service ? { kind: 'service', service } : { kind: 'connections' })),
  });
  // Smart Life signed in or out on its own screen: the overview and the pickers follow.
  const smartLifeChanged = () => links.refreshInfo().then(() => links.load({ quiet: true }));

  /* ---------- layout ---------- */

  const nameInput = h('input.title-input', { value: doc.name || 'Home', spellcheck: 'false', 'aria-label': 'Nome da casa' });
  nameInput.addEventListener('input', () => { snapshot('name'); doc.name = nameInput.value; touch({ inspector: sel.kind === 'home' }); });
  const status = h('div.status');
  const saveBtn = h('button.btn.primary', { onclick: save }, icon('check', 15, 2.4), 'Salvar e aplicar');
  const hint = h('div.hint', isPhone ? 'Toque para escolher · arraste o que está escolhido · pince para ampliar'
    : 'Arraste cômodos, luzes e móveis · arraste o canto de um cômodo para redimensionar · tudo encaixa a cada 5 cm');
  const toastEl = h('div.toast');

  const sidebar = h('aside.side');
  const plan = sv('svg', { class: 'plan', tabindex: 0 });
  const inspector = h('div.inspector');
  const previewHost = h('div.preview');
  // Day or night in the preview: as outside now (the clock), or forced either way.
  let previewDay = null;
  const dayToggle = h('button.chip.day-chip', { onclick: () => {
    previewDay = previewDay === null ? 1 : previewDay === 1 ? 0 : null;
    schedulePreview(0);
  } });
  const previewToggle = h('button.chip', { onclick: () => { previewLights = !previewLights; tests.clear(); schedulePreview(0); if (sel.index != null) renderInspector(); } });

  // The right column's width and the preview's height follow two grips, and are remembered.
  const sizes = (() => { try { return JSON.parse(localStorage.getItem('homeos:editor-sizes') || '{}'); } catch { return {}; } })();
  const applySizes = () => {
    root.style.setProperty('--right-w', `${sizes.right || 340}px`);
    root.style.setProperty('--preview-h', `${sizes.preview || 250}px`);
  };
  const grip = (cls, onMove) => {
    const el = h(`div.${cls}`, { role: 'separator' });
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      const start = { x: ev.clientX, y: ev.clientY, right: sizes.right || 340, preview: sizes.preview || 250 };
      const move = (e) => { onMove(start, e); applySizes(); };
      const up = () => {
        el.removeEventListener('pointermove', move);
        try { localStorage.setItem('homeos:editor-sizes', JSON.stringify(sizes)); } catch { /* not kept */ }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
    });
    return el;
  };
  const colGrip = grip('col-grip', (st, e) => { sizes.right = clamp(st.right - (e.clientX - st.x), 300, Math.round(window.innerWidth * 0.7)); });
  const rowGrip = grip('row-grip', (st, e) => { sizes.preview = clamp(st.preview + (e.clientY - st.y), 160, Math.round(window.innerHeight * 0.8)); });
  applySizes();

  if (isPhone) buildPhoneLayout();
  else root.replaceChildren(h('div.editor',
    h('header.bar',
      h('div.bar-title', icon('home', 17), nameInput),
      h('div.bar-actions',
        h('button.btn', { title: 'Desfazer (⌘Z)', onclick: () => stepHistory(undo, redo) }, 'Desfazer'),
        h('button.btn', { title: 'Refazer (⇧⌘Z)', onclick: () => stepHistory(redo, undo) }, 'Refazer'),
        h('button.btn', { onclick: importPlan }, 'Importar…'),
        h('button.btn', { onclick: exportPlan }, 'Exportar…'),
        saveBtn)),
    sidebar,
    h('main.canvas', plan, hint),
    h('aside.right', colGrip, h('div.preview-wrap', previewHost, previewToggle, dayToggle), rowGrip, inspector),
    h('footer.foot', status),
    toastEl));

  /* ---------- history ---------- */

  let lastSnapshotKey = null;
  function snapshot(key = null) {
    if (key && key === lastSnapshotKey) return; // coalesce a drag or a burst of typing into one step
    lastSnapshotKey = key;
    undo.push(JSON.stringify(doc));
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(doc));
    doc = JSON.parse(from.pop());
    lastSnapshotKey = null;
    if (sel.index != null && !doc[KEYS[sel.kind]]?.[sel.index]) sel = { kind: 'home' };
    nameInput.value = doc.name || '';
    touch();
  }

  function touch({ inspector: redrawInspector = true } = {}) {
    dirty = true;
    renderSidebar();
    renderPlan();
    if (redrawInspector) renderInspector();
    validate();
    schedulePreview();
  }

  function select(next) {
    sel = next;
    lastSnapshotKey = null;
    renderSidebar();
    renderPlan();
    renderInspector();
    if (isPhone) phone.selected(next);
  }

  function toast(text, bad = false) {
    toastEl.textContent = text;
    toastEl.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
  }

  /* ---------- validation + preview ---------- */

  let valid = null;
  function validate() {
    try {
      valid = normalize(structuredClone(doc));
      const linked = [...doc.lights, ...doc.acs, ...doc.tvs, ...doc.gates, ...doc.shortcuts, ...doc.toggles].filter(isLinked).length;
      status.className = 'status';
      status.replaceChildren(h('span.ok', '●'), ` ${doc.rooms.length} cômodos · ${doc.lights.length} luzes · ${doc.acs.length} ares · `,
        `${linked} vinculados a dispositivos reais`, dirty ? h('span.dirty', ' · alterações não salvas') : '');
    } catch (e) {
      valid = null;
      status.className = 'status bad';
      status.textContent = `⚠ ${e.message}`;
    }
    saveBtn.disabled = !valid;
    if (isPhone) phone.refresh();
  }

  // What the "Testar na prévia" buttons switched, by item id, over the lights-on/off default.
  const tests = new Map();
  let preview = null;
  function previewStore(cfg) {
    const state = { lights: {}, acs: {}, tvs: {}, gates: {}, daylight: previewDay };
    const t = (id, base) => ({ ...base, ...(tests.get(id) || {}) });
    for (const l of cfg.lights) state.lights[l.id] = t(l.id, { on: previewLights, brightness: 0.85, temp: 3200, color: l.color || null });
    for (const a of cfg.acs) state.acs[a.id] = t(a.id, { on: previewLights, mode: 'cool', fan: 'auto', swing: 'swing', sleep: false, target: 23 });
    for (const v of cfg.tvs) state.tvs[v.id] = t(v.id, { on: false, state: 'off' });
    for (const g of cfg.gates) state.gates[g.id] = t(g.id, { state: 'closed' });
    const listeners = new Set();
    preview = { state, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, emit: (c) => listeners.forEach((fn) => fn(c)) };
    return preview;
  }

  // How long the gate takes from end to end: learned by the app from full runs (Home
  // Assistant's "open" / "closed" mark the ends), or typed in.
  function gateTravelSection(item) {
    let measured = null;
    try {
      const saved = JSON.parse(localStorage.getItem('house-control:state:v1') || 'null');
      const g = saved?.gates?.[item.id];
      if (g?.samples?.length) measured = { avg: g.samples.reduce((a, b) => a + b, 0) / g.samples.length, n: g.samples.length };
    } catch { /* nothing measured here */ }
    const auto = item.travelMode !== 'manual';
    return section('Tempo de abertura',
      bind('Como saber', choice([['auto', 'Detectar automaticamente'], ['manual', 'Manual']]), {
        get: () => (auto ? 'auto' : 'manual'),
        set: (v) => { if (v === 'manual') item.travelMode = 'manual'; else delete item.travelMode; },
        event: 'change',
      }),
      bind(auto ? 'Até medir, usar (s)' : 'Segundos para abrir por completo', number(1), { ...prop(item, 'travel', 14), parse: parseNum }),
      h('p.note', auto
        ? (measured
          ? `Medido: ${Math.round(measured.avg)} s, média de ${measured.n} ${measured.n === 1 ? 'abertura ou fechamento completo' : 'aberturas e fechamentos completos'}. A média segue as últimas ${6} medições.`
          : 'Ainda sem medição. Abra ou feche o portão por completo pelo app: quando o Home Assistant disser “aberto” ou “fechado”, o app mede quanto levou. Até lá vale o valor acima.')
        : 'O app usa esse tempo para mostrar onde o portão está e onde parou. Não precisa ser exato.'));
  }

  /** Switches one item in the preview only: nothing is sent to the real device. */
  function testItem(kind, id, patch) {
    tests.set(id, { ...(tests.get(id) || {}), ...patch });
    const section = { light: 'lights', ac: 'acs', tv: 'tvs', gate: 'gates' }[kind];
    if (preview?.state[section]?.[id]) {
      Object.assign(preview.state[section][id], patch);
      preview.emit({ type: kind, id });
    }
    renderInspector();
  }

  function testSection(kind, item) {
    const cur = { light: 'lights', ac: 'acs', tv: 'tvs', gate: 'gates' }[kind];
    const s = preview?.state[cur]?.[item.id] || {};
    const on = kind === 'gate' ? s.state === 'open' : Boolean(s.on);
    const label = kind === 'gate' ? (on ? 'Fechar o portão' : 'Abrir o portão')
      : kind === 'light' ? (on ? 'Apagar' : 'Acender') : on ? 'Desligar' : 'Ligar';
    const press = () => testItem(kind, item.id, kind === 'gate' ? { state: on ? 'closed' : 'open' } : { on: !on, state: on ? 'off' : 'on' });
    return section('Testar na prévia',
      h('button.btn.wide', { onclick: press }, icon(kind === 'gate' ? (on ? 'gate' : 'gateOpen') : 'power', 14), label),
      h('p.note', 'Só na prévia 3D ao lado, para conferir posição e efeito. Nada é enviado ao aparelho real.'));
  }

  let previewTimer = 0;
  function schedulePreview(delay = 350) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(buildPreview, delay);
  }

  function buildPreview() {
    previewToggle.replaceChildren(icon(previewLights ? 'bright' : 'moon', 14), previewLights ? 'Luzes acesas' : 'Luzes apagadas');
    dayToggle.replaceChildren(icon(previewDay === 0 ? 'moon' : 'sun', 14), previewDay === null ? 'Dia/noite: agora' : previewDay ? 'Dia' : 'Noite');
    if (!valid) return;
    if (isPhone && !phone.show3D) { world?.dispose(); world = null; previewHost.replaceChildren(); return; }
    world?.dispose();
    world = null;
    const canvas = h('canvas');
    previewHost.replaceChildren(canvas);
    try {
      world = createWorld(canvas, valid, previewStore(valid), {
        onHover() {},
        onPick(t) {
          if (!t) return;
          const index = doc[KEYS[t.kind]].findIndex((x) => x.id === t.id);
          if (index >= 0) select({ kind: t.kind, index });
        },
      });
      world.setInsets(isPhone ? 20 : 6, isPhone ? 20 : 6);
      world.setRunning(true);
      const w = world;
      new ResizeObserver(() => { if (world === w) w.resize(); }).observe(canvas);
    } catch (e) {
      previewHost.replaceChildren(h('div.preview-error', String(e.message || e)));
    }
  }

  /* ---------- sidebar ---------- */

  function rowLabel(kind, item) {
    if (kind === 'room') return [item.name || item.id, `${fix(item.rect[2])} × ${fix(item.rect[3])} m`];
    if (kind === 'light') return [item.name || item.id, `${roomName(item.room)} · ${NAMES[item.type] || item.type}`];
    if (kind === 'ac') return [item.name || item.id, `${roomName(item.room)} · parede ${(NAMES[item.wall] || item.wall).toLowerCase()}`];
    if (kind === 'tv') return [item.name || item.id, `${roomName(item.room)} · ${item.link?.id || 'não vinculada'}`];
    if (kind === 'furniture') return [NAMES[item.type] || item.type, roomName(roomAt(item.pos)?.id) || '—'];
    if (kind === 'opening') return [NAMES[item.type || 'door'], `${fix(Math.hypot(item.to[0] - item.from[0], item.to[1] - item.from[1]))} m`];
    if (EXTRAS.includes(kind)) return [item.name || item.id, item.link?.id || 'Não vinculado'];
    return [item.name || item.id, `${Object.keys(item.lights || {}).length} regras`];
  }

  const roomName = (id) => doc.rooms.find((r) => r.id === id)?.name || id || '';
  const roomAt = ([x, z]) => doc.rooms.find((r) => x >= r.rect[0] && x <= r.rect[0] + r.rect[2] && z >= r.rect[1] && z <= r.rect[1] + r.rect[3]);

  function renderSidebar() {
    const nodes = [h(`button.row.home-row${sel.kind === 'home' ? '.active' : ''}`, { onclick: () => select({ kind: 'home' }) },
      icon('home', 15), h('span.row-name', 'Ajustes da casa')),
    links.sidebarRow(sel.kind === 'connections' || sel.kind === 'service', () => select({ kind: 'connections' }))];
    for (const kind of Object.keys(KEYS)) {
      const items = doc[KEYS[kind]];
      nodes.push(h('div.group',
        h('span', `${TITLES[kind]}`), h('span.n', items.length),
        h('button.add', { title: `Adicionar em ${TITLES[kind].toLowerCase()}`, 'aria-label': `Adicionar em ${TITLES[kind].toLowerCase()}`, onclick: () => add(kind) }, icon('plus', 14, 2.4))));
      items.forEach((item, index) => {
        const [name, sub] = rowLabel(kind, item);
        const active = sel.kind === kind && sel.index === index;
        nodes.push(h(`div.row${active ? '.active' : ''}`, { role: 'button', tabindex: 0, onclick: () => select({ kind, index }) },
          h('span.row-name', name),
          isLinked(item) ? h('span.linked', { title: 'Vinculado a um dispositivo real' }, icon('link', 12, 2.2)) : null,
          h('span.row-sub', sub),
          h('button.del', { title: 'Remover', 'aria-label': `Remover ${name}`, onclick: (e) => { e.stopPropagation(); remove(kind, index); } }, icon('close', 13, 2.4))));
      });
    }
    const top = sidebar.scrollTop;
    sidebar.replaceChildren(...nodes);
    sidebar.scrollTop = top;
  }

  function uniqueId(base) {
    const ids = new Set([...doc.rooms, ...doc.lights, ...doc.acs, ...doc.scenes, ...doc.tvs, ...doc.gates, ...doc.shortcuts, ...doc.toggles].map((x) => x.id));
    if (!ids.has(base)) return base;
    for (let i = 2; ; i++) if (!ids.has(`${base}${i}`)) return `${base}${i}`;
  }

  function add(kind) {
    snapshot();
    const room = (sel.kind === 'room' && doc.rooms[sel.index]) || doc.rooms.find((r) => r.id === doc[KEYS[sel.kind]]?.[sel.index]?.room) || doc.rooms[0];
    const center = room ? [fix(room.rect[0] + room.rect[2] / 2), fix(room.rect[1] + room.rect[3] / 2)] : [1, 1];
    const list = doc[KEYS[kind]];
    if (kind === 'room') {
      const maxX = Math.max(0, ...doc.rooms.map((r) => r.rect[0] + r.rect[2]));
      const minZ = Math.min(...doc.rooms.map((r) => r.rect[1]), 0);
      list.push({ id: uniqueId('room'), name: 'Novo cômodo', rect: [fix(maxX), fix(doc.rooms.length ? minZ : 0), 3, 3], floor: 'oak' });
    } else if (kind === 'light') {
      if (!room) return toast('Adicione um cômodo primeiro', true);
      list.push({ id: uniqueId(`${room.id}.light`), name: 'Nova luz', room: room.id, type: 'ceiling', pos: freeSpot(room, center), capabilities: [] });
    } else if (kind === 'ac') {
      if (!room) return toast('Adicione um cômodo primeiro', true);
      list.push({ id: uniqueId(`${room.id}.ac`), name: `Ar ${room.name}`, room: room.id, wall: 'north', pos: [center[0], room.rect[1]], y: 2.2 });
    } else if (kind === 'furniture') {
      list.push({ type: 'sofa', pos: center, rot: 0 });
    } else if (kind === 'opening') {
      if (!room) return toast('Adicione um cômodo primeiro', true);
      const z = room.rect[1] + room.rect[3];
      list.push({ type: 'door', from: [fix(center[0] - 0.45), fix(z)], to: [fix(center[0] + 0.45), fix(z)] });
    } else if (kind === 'scene') {
      list.push({ id: uniqueId('scene'), name: 'Nova cena', icon: 'sparkles', lights: { '*': { on: false } } });
    } else if (kind === 'tv') {
      if (!room) return toast('Adicione um cômodo primeiro', true);
      list.push({ id: uniqueId(`${room.id}.tv`), name: 'TV', room: room.id, pos: center, rot: 0, width: 1.6 });
    } else if (kind === 'gate') {
      list.push({ id: uniqueId('portao'), name: 'Portão' });
    } else if (kind === 'shortcut') {
      list.push({ id: uniqueId('atalho'), name: 'Novo atalho', icon: 'sparkles' });
    } else if (kind === 'toggle') {
      list.push({ id: uniqueId('chave'), name: 'Nova chave', icon: 'automation' });
    }
    sel = { kind, index: list.length - 1 };
    touch();
  }

  // The middle of the room, or the nearest place around it no other lamp stands on.
  function freeSpot(room, center) {
    const [x, z, w, d] = room.rect;
    const taken = (p) => doc.lights.some((l) => Math.hypot(l.pos[0] - p[0], l.pos[1] - p[1]) < 0.45);
    for (let ring = 0; ring < 4; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
        const p = [fix(round(center[0] + Math.cos(a) * ring * 0.6)), fix(round(center[1] + Math.sin(a) * ring * 0.6))];
        if (p[0] > x + 0.2 && p[0] < x + w - 0.2 && p[1] > z + 0.2 && p[1] < z + d - 0.2 && !taken(p)) return p;
      }
    }
    return center;
  }

  function remove(kind, index) {
    snapshot();
    const [gone] = doc[KEYS[kind]].splice(index, 1);
    if (kind === 'room') {
      // Devices cannot outlive their room.
      doc.lights = doc.lights.filter((l) => l.room !== gone.id);
      doc.acs = doc.acs.filter((a) => a.room !== gone.id);
    }
    if (kind === 'light' || kind === 'ac' || kind === 'room') {
      const ids = new Set([...doc.lights, ...doc.acs].map((d) => d.id));
      for (const sc of doc.scenes) {
        for (const map of [sc.lights, sc.acs]) for (const id of Object.keys(map || {})) if (id !== '*' && !ids.has(id)) delete map[id];
      }
    }
    sel = { kind: 'home' };
    touch();
  }

  /* ---------- plan (SVG) ---------- */

  function bounds() {
    const rs = doc.rooms.length ? doc.rooms : [{ rect: [0, 0, 6, 4] }];
    const minX = Math.min(...rs.map((r) => r.rect[0]));
    const minZ = Math.min(...rs.map((r) => r.rect[1]));
    const maxX = Math.max(...rs.map((r) => r.rect[0] + r.rect[2]));
    const maxZ = Math.max(...rs.map((r) => r.rect[1] + r.rect[3]));
    return { minX, minZ, maxX, maxZ };
  }

  const isSel = (kind, index) => sel.kind === kind && sel.index === index;

  function renderPlan() {
    const b = bounds();
    const m = 1.4;
    if (isPhone) phone.applyView();
    else if (deskView) plan.setAttribute('viewBox', `${deskView.x} ${deskView.y} ${deskView.w} ${deskView.h}`);
    else plan.setAttribute('viewBox', `${b.minX - m} ${b.minZ - m} ${b.maxX - b.minX + m * 2} ${b.maxZ - b.minZ + m * 2}`);
    // Fingers are bigger than a mouse pointer: on a phone small things get a wider target.
    const big = isPhone;
    const kids = [
      sv('defs', {}, sv('pattern', { id: 'grid', width: 1, height: 1, patternUnits: 'userSpaceOnUse' },
        sv('path', { d: 'M1 0H0V1', fill: 'none', stroke: 'rgba(255,255,255,0.07)', 'stroke-width': 0.015 }),
        sv('path', { d: 'M0.5 0V1M0 0.5H1', fill: 'none', stroke: 'rgba(255,255,255,0.03)', 'stroke-width': 0.01 }))),
      sv('rect', { x: b.minX - 20, y: b.minZ - 20, width: 60, height: 60, fill: 'url(#grid)', 'data-kind': 'none' }),
    ];

    doc.rooms.forEach((r, i) => {
      const [x, z, w, d] = r.rect;
      const g = sv('g', { class: `p-room${isSel('room', i) ? ' sel' : ''}`, 'data-kind': 'room', 'data-index': i },
        sv('rect', { x, y: z, width: w, height: d, fill: FLOOR_FILL[r.floor] || FLOOR_FILL.oak }),
        sv('text', { x: x + w / 2, y: z + d / 2 - 0.02, class: 'p-label' }, document.createTextNode(r.name || r.id)),
        sv('text', { x: x + w / 2, y: z + d / 2 + 0.3, class: 'p-dim' }, document.createTextNode(`${fix(w)} × ${fix(d)}`)));
      kids.push(g);
    });

    doc.furniture.forEach((f, i) => {
      if (!Array.isArray(f.pos)) return;
      const [w, d] = footprint(f);
      kids.push(sv('g', {
        class: `p-furn${isSel('furniture', i) ? ' sel' : ''}`, 'data-kind': 'furniture', 'data-index': i,
        transform: `translate(${f.pos[0]} ${f.pos[1]}) rotate(${-(f.rot || 0)})`,
      },
        sv('rect', { x: -w / 2, y: -d / 2, width: w, height: d, rx: 0.06 }),
        // a tick marks the front of the piece
        sv('path', { d: `M${-w / 4} ${d / 2}H${w / 4}`, class: 'front' })));
    });

    doc.openings.forEach((o, i) => {
      if (big) kids.push(sv('line', { class: 'p-hit', 'data-kind': 'opening', 'data-index': i, x1: o.from[0], y1: o.from[1], x2: o.to[0], y2: o.to[1] }));
      kids.push(sv('line', {
        class: `p-open ${o.type || 'door'}${isSel('opening', i) ? ' sel' : ''}`, 'data-kind': 'opening', 'data-index': i,
        x1: o.from[0], y1: o.from[1], x2: o.to[0], y2: o.to[1],
      }));
    });

    doc.acs.forEach((a, i) => {
      const rot = { north: 0, east: 90, south: 180, west: 270 }[a.wall] || 0;
      kids.push(sv('g', {
        class: `p-ac${isSel('ac', i) ? ' sel' : ''}`, 'data-kind': 'ac', 'data-index': i,
        transform: `translate(${a.pos[0]} ${a.pos[1]}) rotate(${rot})`,
      }, big ? sv('rect', { x: -0.62, y: -0.12, width: 1.24, height: 0.74, class: 'hit' }) : null,
        sv('rect', { x: -0.47, y: 0.08, width: 0.94, height: 0.24, rx: 0.07 }),
        sv('path', { d: 'M-0.3 0.42v0.22M0 0.42v0.3M0.3 0.42v0.22', class: 'flow' })));
    });

    doc.tvs.forEach((t, i) => {
      kids.push(sv('g', {
        class: `p-furn p-tv${isSel('tv', i) ? ' sel' : ''}`, 'data-kind': 'tv', 'data-index': i,
        transform: `translate(${t.pos[0]} ${t.pos[1]}) rotate(${-(t.rot || 0)})`,
      },
        sv('rect', { x: -(t.width || 1.6) / 2, y: -0.2, width: t.width || 1.6, height: 0.4, rx: 0.06 }),
        sv('path', { d: `M${-(t.width || 1.6) / 4} 0.2H${(t.width || 1.6) / 4}`, class: 'front' })));
    });
    // Gates on their wall: drawn, not dragged (their ends are edited in the inspector).
    doc.gates.filter((g) => g.from && g.to).forEach((g) => {
      kids.push(sv('line', { class: 'p-gate', x1: g.from[0], y1: g.from[1], x2: g.to[0], y2: g.to[1] }));
    });

    doc.lights.forEach((l, i) => {
      const g = sv('g', {
        class: `p-light ${l.type}${isSel('light', i) ? ' sel' : ''}${isLinked(l) ? ' linked' : ''}`, 'data-kind': 'light', 'data-index': i,
        transform: `translate(${l.pos[0]} ${l.pos[1]}) rotate(${-(l.rot || 0)})`,
      });
      if (big) g.append(sv('circle', { r: 0.58, class: 'hit' }));
      if (l.type === 'strip') {
        const len = l.length || 1;
        g.append(sv('rect', { x: -len / 2, y: -0.07, width: len, height: 0.14, rx: 0.07 }));
        if (l.corner > 0) {
          const side = l.turn === 'left' ? -1 : 1;
          g.append(sv('rect', { x: len / 2 - 0.07, y: side > 0 ? -0.07 : -l.corner - 0.07, width: 0.14, height: l.corner + 0.14, rx: 0.07 }));
        }
      } else if (l.type === 'spots' && ((l.count ?? 3) === 1 || (l.spacing ?? 0.32) > 0.45)) {
        const n = l.count ?? 3;
        const gap = l.spacing ?? 0.32;
        for (let k = 0; k < n; k++) g.append(sv('circle', { cx: (k - (n - 1) / 2) * gap, r: 0.13 }));
        if (n > 1) g.append(sv('path', { d: `M${-(n - 1) / 2 * gap} 0H${(n - 1) / 2 * gap}`, class: 'link-line' }));
      } else if (l.type === 'flood') {
        g.append(sv('circle', { r: 0.3, class: 'halo' }), sv('rect', { x: -0.16, y: -0.08, width: 0.32, height: 0.16, rx: 0.04 }),
          sv('path', { d: 'M0 0.12V0.9M-0.18 0.68L0 0.9L0.18 0.68', class: 'aim' }));
      } else if (l.type === 'ceiling' && l.shape === 'square') {
        g.append(sv('circle', { r: 0.34, class: 'halo' }), sv('rect', { x: -0.17, y: -0.17, width: 0.34, height: 0.34, rx: 0.03 }));
      } else {
        g.append(sv('circle', { r: 0.34, class: 'halo' }), sv('circle', { r: l.type === 'table' ? 0.13 : 0.19 }));
      }
      kids.push(g);
    });

    if (sel.kind === 'room' && doc.rooms[sel.index]) {
      const [x, z, w, d] = doc.rooms[sel.index].rect;
      if (big) kids.push(sv('circle', { cx: x + w, cy: z + d, r: 0.55, class: 'hit', 'data-kind': 'resize', 'data-index': sel.index }));
      kids.push(sv('circle', { cx: x + w, cy: z + d, r: big ? 0.24 : 0.16, class: 'p-handle', 'data-kind': 'resize', 'data-index': sel.index }));
    }
    plan.replaceChildren(...kids);
  }

  // On the Mac: the wheel or a pinch zooms where the pointer is, the right / middle button or
  // Shift / Option + drag slides the plan, a double click on the floor shows it all again.
  let deskView = null;
  const currentView = () => {
    const [x, y, w, hh] = plan.getAttribute('viewBox').split(' ').map(Number);
    return { x, y, w, h: hh };
  };
  if (!isPhone) {
    plan.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const v = currentView();
      const [px, pz] = planPoint(ev);
      const f = clamp(Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), 0.5, 2);
      const b = bounds();
      const maxW = (b.maxX - b.minX + 2.8) * 1.5;
      const w = clamp(v.w * f, 1.5, maxW);
      const k = w / v.w;
      deskView = { x: px - (px - v.x) * k, y: pz - (pz - v.y) * k, w, h: v.h * k };
      renderPlan();
    }, { passive: false });
    plan.addEventListener('pointerdown', (ev) => {
      if (!(ev.button === 1 || ev.button === 2 || ev.shiftKey || ev.altKey)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      plan.setPointerCapture(ev.pointerId);
      const start = { x: ev.clientX, y: ev.clientY, v: currentView() };
      const r = plan.getBoundingClientRect();
      const scale = Math.max(start.v.w / r.width, start.v.h / r.height);
      const move = (e) => {
        deskView = { ...start.v, x: start.v.x - (e.clientX - start.x) * scale, y: start.v.y - (e.clientY - start.y) * scale };
        renderPlan();
      };
      plan.addEventListener('pointermove', move);
      plan.addEventListener('pointerup', () => plan.removeEventListener('pointermove', move), { once: true });
    }, true);
    plan.addEventListener('contextmenu', (ev) => ev.preventDefault());
    plan.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('[data-kind]')?.dataset.kind && !['none', 'room'].includes(ev.target.closest('[data-kind]').dataset.kind)) return;
      deskView = null;
      renderPlan();
    });
  }

  function planPoint(ev) {
    const pt = plan.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(plan.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  // Puts an AC on the nearest wall of the room under (or nearest to) the pointer.
  function snapAC(ac, [x, z]) {
    const room = roomAt([x, z]) || doc.rooms.find((r) => r.id === ac.room);
    if (!room) return;
    const [rx, rz, rw, rd] = room.rect;
    const options = [
      ['north', Math.abs(z - rz)], ['south', Math.abs(z - (rz + rd))],
      ['west', Math.abs(x - rx)], ['east', Math.abs(x - (rx + rw))],
    ].sort((p, q) => p[1] - q[1]);
    const wall = options[0][0];
    ac.room = room.id;
    ac.wall = wall;
    const cx = fix(clamp(round(x), rx + 0.6, rx + rw - 0.6));
    const cz = fix(clamp(round(z), rz + 0.6, rz + rd - 0.6));
    ac.pos = wall === 'north' ? [cx, rz] : wall === 'south' ? [cx, fix(rz + rd)] : wall === 'west' ? [rx, cz] : [fix(rx + rw), cz];
  }

  let drag = null;
  plan.addEventListener('pointerdown', (ev) => {
    if (isPhone) return;
    const el = ev.target.closest('[data-kind]');
    const kind = el?.dataset.kind;
    if (!kind || kind === 'none') { select({ kind: 'home' }); return; }
    plan.setPointerCapture(ev.pointerId);
    startDrag(kind, Number(el.dataset.index), ev);
  });

  // Picks up an item (or a room's resize handle) under the pointer.
  function startDrag(kind, index, ev) {
    const start = planPoint(ev);
    if (kind === 'resize') {
      drag = { kind, index, start, rect: [...doc.rooms[index].rect] };
      return;
    }
    if (!isSel(kind, index)) select({ kind, index });
    const item = doc[KEYS[kind]][index];
    drag = { kind, index, start, moved: false };
    if (kind === 'room') {
      const [x, z, w, d] = item.rect;
      const inside = ([px, pz]) => px >= x - 1e-6 && px <= x + w + 1e-6 && pz >= z - 1e-6 && pz <= z + d + 1e-6;
      drag.rect = [...item.rect];
      // Everything standing in the room travels with it.
      drag.riders = [
        ...doc.lights.filter((l) => l.room === item.id).map((o) => ({ o, pos: [...o.pos] })),
        ...doc.acs.filter((a) => a.room === item.id).map((o) => ({ o, pos: [...o.pos] })),
        ...doc.furniture.filter((f) => Array.isArray(f.pos) && inside(f.pos)).map((o) => ({ o, pos: [...o.pos] })),
      ];
      drag.openings = doc.openings.filter((o) => inside(o.from) && inside(o.to)).map((o) => ({ o, from: [...o.from], to: [...o.to] }));
    } else if (kind === 'opening') {
      drag.from = [...item.from];
      drag.to = [...item.to];
    } else {
      drag.pos = [...item.pos];
    }
  }

  plan.addEventListener('pointermove', (ev) => { if (!isPhone) moveDrag(ev); });

  function moveDrag(ev) {
    if (!drag) return;
    const [px, pz] = planPoint(ev);
    const dx = round(px - drag.start[0]);
    const dz = round(pz - drag.start[1]);
    if (!drag.moved && !dx && !dz) return;
    if (!drag.moved) { drag.moved = true; snapshot(); haptic('tick'); }
    const item = drag.kind === 'resize' ? doc.rooms[drag.index] : doc[KEYS[drag.kind]][drag.index];

    if (drag.kind === 'resize') {
      item.rect[2] = fix(Math.max(1, round(drag.rect[2] + px - drag.start[0], 0.1)));
      item.rect[3] = fix(Math.max(1, round(drag.rect[3] + pz - drag.start[1], 0.1)));
    } else if (drag.kind === 'room') {
      const mx = round(px - drag.start[0], 0.1);
      const mz = round(pz - drag.start[1], 0.1);
      item.rect[0] = fix(drag.rect[0] + mx);
      item.rect[1] = fix(drag.rect[1] + mz);
      for (const r of drag.riders) r.o.pos = [fix(r.pos[0] + mx), fix(r.pos[1] + mz)];
      for (const r of drag.openings) {
        r.o.from = [fix(r.from[0] + mx), fix(r.from[1] + mz)];
        r.o.to = [fix(r.to[0] + mx), fix(r.to[1] + mz)];
      }
    } else if (drag.kind === 'opening') {
      item.from = [fix(drag.from[0] + dx), fix(drag.from[1] + dz)];
      item.to = [fix(drag.to[0] + dx), fix(drag.to[1] + dz)];
    } else if (drag.kind === 'ac') {
      snapAC(item, [px, pz]);
    } else {
      item.pos = [fix(drag.pos[0] + dx), fix(drag.pos[1] + dz)];
      if (drag.kind === 'light') {
        const room = roomAt(item.pos);
        if (room) item.room = room.id;
      }
    }
    touch();
  }

  const endDrag = () => { drag = null; lastSnapshotKey = null; };
  plan.addEventListener('pointerup', () => { if (!isPhone) endDrag(); });
  plan.addEventListener('pointercancel', () => { if (!isPhone) endDrag(); });

  /* ---------- inspector ---------- */

  // A labelled input bound to a getter/setter; edits redraw everything except the form itself.
  function bind(label, input, { get, set, parse = (v) => v, event = 'input' }) {
    const v = get();
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = v ?? '';
    input.addEventListener(event, () => {
      const raw = input.type === 'checkbox' ? input.checked : input.value;
      const next = parse(raw);
      if (next === undefined) return;
      snapshot(label + sel.kind + sel.index);
      set(next);
      // Pickers and checkboxes can change which fields exist; typing must keep its focus.
      touch({ inspector: event === 'change' });
    });
    return h('label.field', h('span', label), input);
  }

  const number = (step = 0.05) => h('input', { type: 'number', step, inputmode: 'decimal' });
  const parseNum = (v) => (v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
  const text = () => h('input', { type: 'text', spellcheck: 'false' });
  const choice = (options) => h('select', options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));

  const prop = (obj, key, fallback) => ({ get: () => obj[key] ?? fallback, set: (v) => { obj[key] = v; } });
  const at = (obj, key, i) => ({ get: () => obj[key][i], set: (v) => { obj[key][i] = v; } });
  const optional = (obj, key) => ({
    get: () => obj[key] ?? '',
    set: (v) => { if (v === '' || v == null) delete obj[key]; else obj[key] = v; },
  });
  const optNum = (v) => (v === '' ? '' : Number.isNaN(Number(v)) ? undefined : Number(v));

  const row = (...fields) => h('div.fields', fields);
  const section = (title, ...nodes) => h('section.block', h('h3', title), nodes);

  // Linking to a real device: links.deviceSection / links.sensorSection (connections.js).
  const linkHooks = { snapshot: () => snapshot(), changed: (note) => { touch(); if (note) toast(note); } };

  function renderInspector() {
    const kind = sel.kind;
    const item = sel.index != null ? doc[KEYS[kind]]?.[sel.index] : null;
    const nodes = [];
    const head = (title, sub) => nodes.push(isPhone
      ? h('div.insp-head', h('div.insp-titles', h('h2', title), sub ? h('span', sub) : null), phone.headActions())
      : h('div.insp-head', h('h2', title), sub ? h('span', sub) : null));

    if (kind === 'home') {
      head('Casa', 'Ajustes gerais desta planta');
      doc.camera ||= { azimuth: 34, elevation: 47 };
      if (isPhone) nodes.push(section('Dispositivos reais', links.sidebarRow(false, () => select({ kind: 'connections' }))));
      nodes.push(section('Construção',
        row(bind('Altura das paredes, m', number(0.1), { ...prop(doc, 'wallHeight', 2.6), parse: parseNum }),
          bind('Altura visível das paredes internas, m', number(0.05), { ...prop(doc, 'interiorWallHeight', 1.25), parse: parseNum })),
        bind('Temperatura externa, °C', number(1), { ...prop(doc, 'outdoorTemp', 27), parse: parseNum })),
      section('Câmera inicial',
        row(bind('Azimute, °', number(1), { ...prop(doc.camera, 'azimuth', 34), parse: parseNum }),
          bind('Elevação, °', number(1), { ...prop(doc.camera, 'elevation', 47), parse: parseNum })),
        bind('Distância, % (100 = a casa inteira; menos, mais perto)', number(5), {
          get: () => Math.round((doc.camera.zoom ?? 1) * 100),
          set: (v) => { if (v === 100) delete doc.camera.zoom; else doc.camera.zoom = v / 100; },
          parse: (v) => { const n = Math.round(Number(v)); return n >= 18 && n <= 120 ? n : undefined; },
        }),
        h('button.btn.wide', { onclick: () => {
          if (!world) return;
          snapshot();
          const v = world.view();
          Object.assign(doc.camera, { azimuth: v.azimuth, elevation: v.elevation });
          if (v.zoom === 1) delete doc.camera.zoom; else doc.camera.zoom = v.zoom;
          if (!v.pan[0] && !v.pan[1]) delete doc.camera.pan; else doc.camera.pan = v.pan;
          touch();
          toast('Câmera inicial = a vista da prévia');
        } }, icon('fit', 14), 'Usar a vista da prévia'),
        h('p.note', 'As paredes viradas para a câmera ficam cortadas, então o azimute decide qual lado da casa aparece aberto.')),
      section('Como funciona',
        h('p.note', isPhone
          ? 'Toque em qualquer item da planta, ou procure em Itens, para editar. “Salvar” guarda a planta neste iPhone e envia ao computador pareado. As coordenadas são em metros: x cresce para a direita (leste), z cresce para baixo (sul).'
          : 'Escolha qualquer item na planta ou na lista para editar. “Salvar e aplicar” grava a planta e recarrega o painel da barra de menu. Portão, atalhos e chaves não aparecem na planta: ficam no painel. As coordenadas são em metros: x cresce para a direita (leste), z cresce para baixo (sul).')));
    } else if (kind === 'connections') {
      head('Conexões', 'Onde ficam seus dispositivos reais');
      if (isPhone) nodes.push(h('button.back-link', { onclick: () => select({ kind: 'home' }) }, icon('back', 14, 2.2), 'Casa'));
      nodes.push(...links.overview());
    } else if (kind === 'service') {
      nodes.push(h('button.back-link', { onclick: () => { links.stopPairing(); select({ kind: 'connections' }); } }, icon('back', 14, 2.2), 'Conexões'));
      nodes.push(h('div.insp-head.svc-head', links.tile(sel.service, 40),
        h('div', h('h2', links.title(sel.service)), h('span', links.blurb(sel.service)))));
      nodes.push(...[links.detail(sel.service, tuyaPanel)].flat());
    } else if (!item) {
      head('Nada escolhido');
      if (isPhone) nodes.push(h('p.note', 'Toque num cômodo, numa luz ou em qualquer item da planta.'));
    } else if (kind === 'room') {
      head(item.name || item.id, `id: ${item.id}`);
      nodes.push(section('Cômodo',
        bind('Nome', text(), prop(item, 'name', '')),
        bind('Piso', choice(named(FLOOR_KINDS)), { ...prop(item, 'floor', 'oak'), event: 'change' }),
        h('div.checks', bind('Área externa (quintal, corredor aberto)', h('input', { type: 'checkbox' }), {
          get: () => Boolean(item.outdoor), set: (on) => { if (on) item.outdoor = true; else delete item.outdoor; }, event: 'change' }))),
      section('Posição e tamanho, m',
        row(bind('X', number(0.1), { ...at(item, 'rect', 0), parse: parseNum }), bind('Z', number(0.1), { ...at(item, 'rect', 1), parse: parseNum })),
        row(bind('Largura', number(0.1), { ...at(item, 'rect', 2), parse: parseNum }), bind('Profundidade', number(0.1), { ...at(item, 'rect', 3), parse: parseNum })),
        h('p.note', 'Cômodos que dividem um lado ganham uma parede interna ali. Adicione uma porta ou uma passagem aberta para ligá-los.')));
    } else if (kind === 'light') {
      head(item.name || item.id, `id: ${item.id}`);
      item.capabilities ||= [];
      const cap = (name) => ({
        get: () => item.capabilities.includes(name),
        set: (on) => { item.capabilities = item.capabilities.filter((c) => c !== name); if (on) item.capabilities.push(name); },
      });
      nodes.push(section('Luz',
        bind('Nome', text(), prop(item, 'name', '')),
        row(bind('Cômodo', choice(doc.rooms.map((r) => [r.id, r.name || r.id])), { ...prop(item, 'room'), event: 'change' }),
          bind('Luminária', choice(named(LIGHT_KINDS)), { ...prop(item, 'type'), event: 'change' }))),
      section('Posição, m',
        row(bind('X', number(), { ...at(item, 'pos', 0), parse: parseNum }), bind('Z', number(), { ...at(item, 'pos', 1), parse: parseNum })),
        row(bind('Altura (automática se vazia)', number(), { ...optional(item, 'y'), parse: optNum }),
          bind('Rotação, °', number(15), { ...prop(item, 'rot', 0), parse: parseNum })),
        item.type === 'strip' ? [
          row(bind('Comprimento da fita, m', number(0.1), { ...prop(item, 'length', 1), parse: parseNum }),
            bind('Segundo lado do L, m', number(0.1), { ...optional(item, 'corner'), parse: optNum })),
          item.corner ? bind('O L vira para', choice([['right', 'A direita'], ['left', 'A esquerda']]), { ...prop(item, 'turn', 'right'), event: 'change' }) : null,
          h('p.note', 'Para uma fita em L, preencha o segundo lado: ela vira 90° na ponta leste (com rotação 0°). Deixe vazio para uma fita reta.'),
        ] : null),
      section('Aparência na maquete',
        bind('Intensidade na maquete, %', number(10), {
          get: () => Math.round((item.power ?? 1) * 100),
          set: (v) => { if (v === 100) delete item.power; else item.power = v / 100; },
          parse: (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 10 && n <= 400 ? n : undefined; },
        }),
        item.type === 'ceiling' ? bind('Formato', choice([['round', 'Redonda'], ['square', 'Quadrada']]), {
          get: () => item.shape || 'round', set: (v) => { if (v === 'square') item.shape = 'square'; else delete item.shape; }, event: 'change' }) : null,
        item.type === 'spots' ? row(
          bind('Quantidade', choice([['1', '1 spot'], ['2', '2 spots'], ['3', '3 spots'], ['4', '4 spots']]), {
            get: () => String(item.count ?? 3), set: (v) => { if (v === '3') delete item.count; else item.count = Number(v); }, event: 'change' }),
          bind('Distância entre eles, m', number(0.05), { ...prop(item, 'spacing', 0.32), parse: parseNum })) : null,
        item.type === 'flood' ? [
          row(bind('Abertura do feixe, °', number(5), { ...prop(item, 'beam', 170), parse: (v) => { const n = Number(v); return n >= 20 && n <= 175 ? n : undefined; } }),
            bind('Inclinação para baixo, °', number(5), { ...prop(item, 'tilt', 35), parse: (v) => { const n = Number(v); return n >= 0 && n <= 80 ? n : undefined; } })),
          h('p.note', 'Holofote de LED: ilumina um quadrado largo (até 175°). Ele aponta para a frente: com rotação 0° ilumina para o sul (para baixo na planta), 90° para o leste. A seta na planta mostra a direção.'),
        ] : null,
        h('p.note', 'Só muda como a luz aparece na maquete 3D: a lâmpada de verdade não é afetada.')),
      section('O que ela faz',
        h('div.checks',
          bind('Brilho ajustável', h('input', { type: 'checkbox' }), { ...cap('brightness'), event: 'change' }),
          bind('Temperatura de branco', h('input', { type: 'checkbox' }), { ...cap('temp'), event: 'change' }),
          bind('Cor', h('input', { type: 'checkbox' }), { ...cap('color'), event: 'change' })),
        h('p.note', 'Deixe as três desmarcadas para um interruptor simples: ela só liga e desliga (é o caso das luzes Tuya da casa).')),
      testSection('light', item),
      links.deviceSection(item, 'light', linkHooks));
    } else if (kind === 'ac') {
      head(item.name || item.id, `id: ${item.id}`);
      nodes.push(section('Ar-condicionado',
        bind('Nome', text(), prop(item, 'name', '')),
        row(bind('Cômodo', choice(doc.rooms.map((r) => [r.id, r.name || r.id])), { ...prop(item, 'room'), event: 'change' }),
          bind('Parede', choice(named(WALLS)), { ...prop(item, 'wall', 'north'), event: 'change' }))),
      section('Posição, m',
        row(bind('X', number(), { ...at(item, 'pos', 0), parse: parseNum }), bind('Z', number(), { ...at(item, 'pos', 1), parse: parseNum })),
        row(bind('Altura', number(), { ...prop(item, 'y', 2.2), parse: parseNum }),
          bind('Mín. / máx. °C', text(), {
            get: () => `${item.min ?? 16}-${item.max ?? 30}`,
            set: ([a, b]) => { item.min = a; item.max = b; },
            parse: (v) => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(v.trim()); return m && +m[1] < +m[2] ? [+m[1], +m[2]] : undefined; },
          })),
        h('p.note', 'Arrastar o aparelho na planta o encaixa na parede mais próxima do cômodo.')),
      testSection('ac', item),
      links.deviceSection(item, 'ac', linkHooks),
      links.sensorSection(item, linkHooks));
    } else if (kind === 'furniture') {
      head(NAMES[item.type] || item.type, 'Só decoração');
      nodes.push(section('Móvel',
        bind('Tipo', choice(named(FURNITURE_TYPES)), { ...prop(item, 'type'), event: 'change' }),
        row(bind('X', number(), { ...at(item, 'pos', 0), parse: parseNum }), bind('Z', number(), { ...at(item, 'pos', 1), parse: parseNum })),
        row(bind('Rotação, °', number(15), { ...prop(item, 'rot', 0), parse: parseNum }),
          bind('Largura, m', number(0.1), { ...optional(item, 'width'), parse: optNum })),
        bind('Cor (hex, opcional)', text(), optional(item, 'color')),
        h('p.note', 'O tracinho na planta marca a frente. Rotação 0° fica virada para o sul (para baixo na planta).')));
    } else if (kind === 'opening') {
      head(NAMES[item.type || 'door'], 'Uma passagem ou janela na parede');
      nodes.push(section('Abertura',
        bind('Tipo', choice(named(['door', 'open', 'window'])), { ...prop(item, 'type', 'door'), event: 'change' }),
        row(bind('De X', number(), { ...at(item, 'from', 0), parse: parseNum }), bind('De Z', number(), { ...at(item, 'from', 1), parse: parseNum })),
        row(bind('Até X', number(), { ...at(item, 'to', 0), parse: parseNum }), bind('Até Z', number(), { ...at(item, 'to', 1), parse: parseNum })),
        item.type === 'window' ? row(bind('Peitoril, m', number(), { ...prop(item, 'sill', 0.85), parse: parseNum }),
          bind('Topo, m', number(), { ...prop(item, 'head', 2.1), parse: parseNum })) : null,
        h('p.note', 'Os dois pontos precisam estar na mesma linha de parede (mesmo X ou mesmo Z). Janelas só aparecem nas paredes do fundo; as viradas para a câmera ficam cortadas.')));
    } else if (kind === 'scene') {
      head(item.name || item.id, `id: ${item.id}`);
      item.lights ||= {};
      const rule = (id) => ({
        get: () => (item.lights[id]?.on === true ? 'on' : item.lights[id]?.on === false ? 'off' : ''),
        set: (v) => {
          if (v === '') delete item.lights[id];
          else item.lights[id] = { ...(item.lights[id] || {}), on: v === 'on' };
        },
      });
      const tri = () => choice([['', 'Não mexer'], ['on', 'Acender'], ['off', 'Apagar']]);
      nodes.push(section('Cena',
        row(bind('Nome', text(), prop(item, 'name', '')), bind('Ícone', choice(SCENE_ICONS), { ...prop(item, 'icon', 'sun'), event: 'change' }))),
      section('Luzes',
        bind('Todas as luzes (padrão)', tri(), { ...rule('*'), event: 'change' }),
        doc.lights.map((l) => bind(`${l.name} · ${roomName(l.room)}`, tri(), { ...rule(l.id), event: 'change' })),
        h('p.note', 'Brilho, temperatura e cor de cada luz vêm do arquivo da planta; edite lá para ajustes finos.')),
      section('Ares-condicionados',
        bind('Todos os ares', choice([['', 'Não mexer'], ['off', 'Desligar'], ['on', 'Ligar']]), {
          get: () => (item.acs?.['*']?.on === true ? 'on' : item.acs?.['*']?.on === false ? 'off' : ''),
          set: (v) => { item.acs ||= {}; if (v === '') delete item.acs['*']; else item.acs['*'] = { on: v === 'on' }; },
          event: 'change',
        })));
    } else if (kind === 'tv') {
      head(item.name || item.id, `id: ${item.id}`);
      nodes.push(section('TV',
        bind('Nome', text(), prop(item, 'name', '')),
        bind('Cômodo', choice(doc.rooms.map((r) => [r.id, r.name || r.id])), { ...prop(item, 'room'), event: 'change' })),
      section('Posição, m',
        row(bind('X', number(), { ...at(item, 'pos', 0), parse: parseNum }), bind('Z', number(), { ...at(item, 'pos', 1), parse: parseNum })),
        row(bind('Rotação, °', number(15), { ...prop(item, 'rot', 0), parse: parseNum }),
          bind('Largura, m', number(0.1), { ...prop(item, 'width', 1.6), parse: parseNum })),
        h('p.note', 'A TV aparece na maquete com o móvel e a tela acende quando ela está ligada. Rotação 0° fica virada para o sul.')),
      testSection('tv', item),
      links.deviceSection(item, 'tv', linkHooks));
    } else if (EXTRAS.includes(kind)) {
      const what = { gate: ['Portão', 'Abre e fecha com dois toques no painel e na ilha'],
        shortcut: ['Atalho', 'Roda um script ou uma cena do Home Assistant'],
        toggle: ['Chave de automação', 'Liga e desliga um input_boolean ou uma automação'] }[kind];
      head(item.name || item.id, what[1]);
      nodes.push(section(what[0],
        bind('Nome', text(), prop(item, 'name', '')),
        kind === 'gate' ? null : bind('Ícone', choice(named(EXTRA_ICONS)), { ...prop(item, 'icon', kind === 'toggle' ? 'automation' : 'sparkles'), event: 'change' })),
      kind === 'gate' ? section('Na maquete',
        h('div.checks', bind('Mostrar o portão na maquete', h('input', { type: 'checkbox' }), {
          get: () => Boolean(item.from && item.to),
          set: (on) => {
            if (!on) { delete item.from; delete item.to; return; }
            const o = doc.openings.find((x) => x.type === 'door' && x.from[0] === x.to[0] && x.from[0] === Math.min(...doc.rooms.map((r) => r.rect[0])));
            item.from = o ? [...o.from] : [0, 0];
            item.to = o ? [...o.to] : [0, 2.5];
          },
          event: 'change',
        })),
        item.from && item.to ? [
          row(bind('De X', number(), { ...at(item, 'from', 0), parse: parseNum }), bind('De Z', number(), { ...at(item, 'from', 1), parse: parseNum })),
          row(bind('Até X', number(), { ...at(item, 'to', 0), parse: parseNum }), bind('Até Z', number(), { ...at(item, 'to', 1), parse: parseNum })),
          bind('Desliza para', choice([['to', 'O lado do “Até”'], ['from', 'O lado do “De”']]), { ...prop(item, 'slide', 'to'), event: 'change' }),
          h('p.note', 'Os dois pontos ficam na parede, nas pontas da abertura do portão. Na maquete ele desliza pelo lado de fora, com uma luz âmbar piscando enquanto se move.'),
        ] : null) : null,
      kind === 'gate' ? gateTravelSection(item) : null,
      kind === 'gate' && item.from && item.to ? testSection('gate', item) : null,
      links.deviceSection(item, kind, linkHooks));
    }
    const key = `${sel.kind}:${sel.index ?? sel.service ?? ''}`;
    const same = key === inspector.dataset.key;
    const top = same ? inspector.scrollTop : 0;
    // A refresh of the same screen (devices arriving) keeps the field being typed in.
    const fields = () => [...inspector.querySelectorAll('input, select, textarea')];
    const focused = same ? fields().indexOf(document.activeElement) : -1;
    const caret = focused >= 0 ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    inspector.dataset.key = key;
    inspector.replaceChildren(...nodes.flat(2).filter(Boolean));
    inspector.scrollTop = top;
    if (focused >= 0) {
      const el = fields()[focused];
      el?.focus();
      try { if (caret?.[0] != null) el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
    }
  }

  /* ---------- Smart Life ---------- */

  let loginTimer = 0;
  function stopLoginPolling() { clearInterval(loginTimer); loginTimer = 0; }

  async function fetchDevices() {
    tuya.busy = true; tuya.error = null;
    if (sel.kind === 'service') renderInspector();
    try {
      tuya.devices = (await call('tuya.devices')).devices;
    } catch (e) {
      tuya.error = e.message;
      tuya.devices = null;
    }
    tuya.busy = false;
    renderSidebar();
    if (sel.kind === 'service') renderInspector();
  }

  function deviceList() {
    if (tuya.busy) return h('p.note', 'Talking to Smart Life…');
    if (tuya.error) return h('p.note.bad', tuya.error);
    if (!tuya.devices) return null;
    if (!tuya.devices.length) return h('p.note.bad', 'Connected, but this account has no devices yet.');
    const used = new Map([...doc.lights, ...doc.acs].filter((d) => d.tuya?.deviceId).map((d) => [d.tuya.deviceId, d.name]));
    return h('div.devices-list', h('h3', `${tuya.devices.length} devices in your account`), tuya.devices.map((d) => h('div.device',
      h(`span.dot${d.online ? '.on' : ''}`),
      h('div', h('b', d.name), h('span', `${d.product || d.category || 'device'} · ${d.codes.join(', ') || 'no functions reported'}`)),
      used.has(d.id) ? h('span.pill.on', used.get(d.id)) : null)));
  }

  function tuyaPanel() {
    const nodes = [];
    if (!isNative) nodes.push(h('p.note.bad', 'Connecting works inside the House Control app (this is the browser preview).'));

    if (tuya.account.connected) {
      nodes.push(section('Smart Life account',
        h('div.device', h('span.dot.on'), h('div', h('b', tuya.account.account || 'Signed in'), h('span', `User Code ${tuya.account.userCode}`))),
        h('div.fields',
          h('button.btn', { onclick: fetchDevices }, 'Refresh devices'),
          h('button.btn', { onclick: async () => {
            stopLoginPolling();
            tuya.account = await call('smartlife.signOut');
            tuya.devices = null; tuya.qr = null;
            renderSidebar(); renderInspector();
            smartLifeChanged();
          } }, 'Sign out')),
        h('p.note', 'Pick a lamp or an AC on the plan, choose its device under “Smart Life device”, then press “Save & apply”.')),
      deviceList());
      if (!tuya.devices && !tuya.busy && !tuya.error && isNative) setTimeout(fetchDevices, 0);
    } else {
      const codeInput = text();
      codeInput.value = tuya.account.userCode || '';
      codeInput.placeholder = 'e.g. aB12cD3';
      const message = h('p.note');
      const qrBox = h('div.qr');
      const start = async () => {
        stopLoginPolling();
        message.className = 'note';
        message.textContent = 'Requesting a login code…';
        qrBox.replaceChildren();
        try {
          const userCode = codeInput.value.trim();
          const { token, qr } = await call('smartlife.begin', { userCode });
          qrBox.replaceChildren(h('img', { src: qr, alt: 'Smart Life login QR code', width: 220, height: 220 }));
          message.textContent = 'Scan this code with the Smart Life app (the scan icon on the Home tab) and confirm the login. Waiting…';
          let tries = 0;
          loginTimer = setInterval(async () => {
            if (++tries > 90) { stopLoginPolling(); message.className = 'note bad'; message.textContent = 'The code expired. Press “Show QR code” again.'; return; }
            const r = await call('smartlife.poll', { token, userCode }).catch(() => null);
            if (!r?.connected) return;
            stopLoginPolling();
            tuya.account = r.info;
            renderSidebar();
            renderInspector();
            smartLifeChanged();
          }, 2000);
        } catch (e) {
          message.className = 'note bad';
          message.textContent = e.message;
        }
      };
      nodes.push(section('Sign in with the Smart Life app',
        h('ol.steps',
          h('li', 'In the Smart Life app open Me → ⚙ Settings → Account and Security and copy the User Code at the bottom.'),
          h('li', 'Type it here and press “Show QR code”.'),
          h('li', 'Scan the code with the Smart Life app and confirm.')),
        h('label.field', h('span', 'User Code'), codeInput),
        h('button.btn.primary.wide', { onclick: start, disabled: !isNative }, 'Show QR code'),
        qrBox, message,
        h('p.note', 'Free and needs no Tuya developer account: this is the same sign-in the Home Assistant integration uses. The session is stored only on this Mac.')));
    }

    // The developer-project route stays available for those who already have one.
    const idInput = text();
    idInput.value = tuya.info.accessId || '';
    idInput.placeholder = 'Access ID / Client ID';
    const secretInput = h('input', { type: 'password', autocomplete: 'off' });
    secretInput.placeholder = tuya.info.hasSecret ? '•••••••• (saved — leave empty to keep)' : 'Access Secret / Client Secret';
    const region = choice(REGIONS.map(([id, label]) => [id, `${label} (${id})`]));
    region.value = tuya.info.region || 'eu';
    const saveCloud = async () => {
      try {
        tuya.info = await call('tuya.save', { accessId: idInput.value, accessSecret: secretInput.value, region: region.value });
        renderSidebar();
        smartLifeChanged();
        if (tuya.info.configured) await fetchDevices(); else renderInspector();
      } catch (e) { toast(e.message, true); }
    };
    nodes.push(h('details.advanced', h('summary', 'Advanced: Tuya Cloud project instead'),
      h('p.note', 'Only if you already have a project on platform.tuya.com with your app account linked. The QR sign-in above takes priority when both are set.'),
      h('label.field', h('span', 'Access ID'), idInput),
      h('label.field', h('span', 'Access Secret'), secretInput),
      h('label.field', h('span', 'Data center'), region),
      h('button.btn.wide', { onclick: saveCloud, disabled: !isNative }, 'Save & fetch devices'),
      tuya.account.connected ? null : deviceList()));
    return nodes;
  }

  /* ---------- file actions ---------- */

  async function save() {
    if (!valid) return;
    if (!isNative) {
      download();
      toast('Prévia no navegador: a planta foi baixada em vez de aplicada');
      return;
    }
    try {
      await call('savePlan', { config: doc });
      dirty = false;
      validate();
      haptic('success');
      toast(isPhone ? 'Salvo' : 'Salvo — o painel da barra de menu já mostra esta casa');
    } catch (e) {
      toast(e.message, true);
    }
  }

  function download() {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })), download: `${slug(doc.name)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function exportPlan() {
    if (!isNative) { download(); return; }
    try {
      const r = await call('exportPlan', { config: doc });
      if (r.ok) toast('Planta exportada');
    } catch (e) { toast(e.message, true); }
  }

  async function importPlan() {
    const load = (json) => {
      try {
        normalize(structuredClone(json));
      } catch (e) {
        toast(`Planta inválida: ${e.message}`, true);
        return;
      }
      snapshot();
      doc = json;
      for (const key of Object.values(KEYS)) doc[key] ||= [];
      nameInput.value = doc.name || 'Home';
      sel = { kind: 'home' };
      touch();
      toast('Planta importada — revise e clique em “Salvar e aplicar”');
    };
    if (isNative) {
      try {
        const r = await call('importPlan');
        if (r.config) load(r.config);
      } catch (e) { toast(e.message, true); }
      return;
    }
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      try { load(JSON.parse(await input.files[0].text())); } catch (e) { toast(`Não foi possível ler o arquivo: ${e.message}`, true); }
    });
    input.click();
  }

  /* ---------- keyboard ---------- */

  window.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z' && !typing) {
      ev.preventDefault();
      if (ev.shiftKey) stepHistory(redo, undo); else stepHistory(undo, redo);
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      save();
    } else if ((ev.key === 'Backspace' || ev.key === 'Delete') && !typing && sel.index != null) {
      ev.preventDefault();
      remove(sel.kind, sel.index);
    } else if (ev.key.startsWith('Arrow') && !typing && sel.index != null) {
      const item = doc[KEYS[sel.kind]][sel.index];
      const target = item.pos || item.rect;
      if (!target) return;
      ev.preventDefault();
      const stepSize = ev.shiftKey ? 0.5 : 0.05;
      snapshot(`nudge${sel.kind}${sel.index}`);
      if (ev.key === 'ArrowLeft') target[0] = fix(target[0] - stepSize);
      if (ev.key === 'ArrowRight') target[0] = fix(target[0] + stepSize);
      if (ev.key === 'ArrowUp') target[1] = fix(target[1] - stepSize);
      if (ev.key === 'ArrowDown') target[1] = fix(target[1] + stepSize);
      touch();
    }
  });

  /* ---------- iPhone ---------- */

  // The plan fills the screen; a bar on top (close, name, undo, save), tools at the bottom
  // (add, items, 3D, home) and the inspector as a sheet that rises when something is picked.
  function buildPhoneLayout() {
    const canvas = h('main.canvas');
    const sheet = h('section.p-sheet', { 'aria-label': 'Details' });
    const grip = h('div.p-grip', { role: 'button', 'aria-label': 'Resize details' }, h('span'));
    const scrim = h('div.p-scrim');
    const listSheet = h('section.p-modal', { 'aria-label': 'Items' });
    const addSheet = h('section.p-modal.p-add', { 'aria-label': 'Add' });
    const confirmSheet = h('section.p-modal.p-confirm', { 'aria-label': 'Unsaved changes' });
    const undoBtn = h('button.p-icon', { 'aria-label': 'Undo', onclick: () => { stepHistory(undo, redo); haptic('light'); } }, icon('undo', 19, 2.1));
    const redoBtn = h('button.p-icon', { 'aria-label': 'Redo', onclick: () => { stepHistory(redo, undo); haptic('light'); } }, icon('redo', 19, 2.1));
    const doneBtn = h('button.p-save', { onclick: () => (dirty ? save() : close()) });
    const issue = h('div.p-issue');
    const fitBtn = h('button.p-float', { 'aria-label': 'Show the whole plan', onclick: () => { ui.view = null; ui.applyView(); haptic('light'); } }, icon('fit', 18, 2));
    const tool = (name, label, onclick) => h('button.p-tool', { onclick }, icon(name, 22, 1.9), h('span', label));
    const view3d = tool('box', '3D', () => setShow3D(!ui.show3D));
    const tools = h('nav.p-tools',
      tool('plus', 'Add', () => openModal(addSheet)),
      tool('list', 'Items', () => openModal(listSheet)),
      view3d,
      tool('home', 'Home', () => { select({ kind: 'home' }); setSheet('full'); }));

    nameInput.setAttribute('enterkeyhint', 'done');
    nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') nameInput.blur(); });
    sidebar.classList.add('p-list');
    listSheet.append(h('div.p-modal-head', h('b', 'Items'), h('button.p-text', { onclick: closeModals }, 'Done')), sidebar);
    const addables = [
      ['room', 'home', 'Room'], ['light', 'bulb', 'Lamp'], ['ac', 'ac', 'Air conditioner'],
      ['opening', 'opening', 'Door or window'], ['furniture', 'furniture', 'Furniture'], ['scene', 'sparkles', 'Scene'],
    ];
    addSheet.append(h('div.p-modal-head', h('b', 'Add to the plan'), h('button.p-text', { onclick: closeModals }, 'Cancel')),
      h('div.p-add-grid', addables.map(([kind, name, label]) => h('button.p-add-item', {
        onclick: () => { closeModals(); add(kind); haptic('light'); ui.reveal(); },
      }, icon(name, 24, 1.8), h('span', label)))));
    confirmSheet.append(h('div.p-modal-head', h('b', 'Unsaved changes')),
      h('p.note', 'Save them before closing? Saved plans reach your paired computer too.'),
      h('div.p-confirm-actions',
        h('button.btn.primary.wide', { onclick: async () => { closeModals(); await save(); if (!dirty) close(); } }, 'Save and close'),
        h('button.btn.wide.danger', { onclick: () => { closeModals(); dirty = false; close(); } }, 'Discard changes'),
        h('button.btn.wide', { onclick: closeModals }, 'Keep editing')));

    sheet.append(grip, inspector);
    canvas.append(plan, h('div.p-preview', previewHost, previewToggle), issue, fitBtn, hint);
    const shell = h('div.editor.phone',
      h('header.p-bar', h('button.p-icon', { 'aria-label': 'Close', onclick: requestClose }, icon('close', 20, 2.2)),
        nameInput, undoBtn, redoBtn, doneBtn),
      canvas, tools, scrim, sheet, listSheet, addSheet, confirmSheet, toastEl);
    root.replaceChildren(shell);

    /* sheet: closed, peek (the bottom part of the screen) or full */
    function setSheet(next) {
      ui.sheet = next;
      sheet.dataset.state = next;
      shell.dataset.sheet = next;
      sheet.style.height = '';
      document.activeElement?.blur?.();
    }
    let gripDrag = null;
    // Docked beside the plan on a wide screen (editor.css), the details have no height to drag.
    const docked = matchMedia('(min-width: 720px) and (min-aspect-ratio: 23/20)');
    const startGrip = (ev) => {
      if (docked.matches || ev.target.closest('button, input, select, textarea, a')) return;
      gripDrag = { y: ev.clientY, h: sheet.getBoundingClientRect().height, id: ev.pointerId, moved: false };
    };
    grip.addEventListener('pointerdown', startGrip);
    inspector.addEventListener('pointerdown', (ev) => { if (ev.target.closest('.insp-head')) startGrip(ev); });
    window.addEventListener('pointermove', (ev) => {
      if (!gripDrag || ev.pointerId !== gripDrag.id) return;
      const dy = ev.clientY - gripDrag.y;
      if (!gripDrag.moved && Math.abs(dy) < 6) return;
      gripDrag.moved = true;
      sheet.classList.add('dragging');
      sheet.style.height = `${Math.max(80, gripDrag.h - dy)}px`;
    });
    const endGrip = (ev) => {
      if (!gripDrag || ev.pointerId !== gripDrag.id) return;
      const { moved, h: from } = gripDrag;
      gripDrag = null;
      sheet.classList.remove('dragging');
      if (!moved) { if (ev.target.closest('.p-grip')) setSheet(ui.sheet === 'full' ? 'peek' : 'full'); return; }
      const now = sheet.getBoundingClientRect().height;
      const screen = window.innerHeight;
      if (now < Math.min(from, screen * 0.42) * 0.7) closeSheet();
      else setSheet(now > screen * 0.62 ? 'full' : 'peek');
    };
    window.addEventListener('pointerup', endGrip);
    window.addEventListener('pointercancel', endGrip);

    function closeSheet() {
      setSheet('closed');
      if (sel.kind !== 'home') { sel = { kind: 'home' }; renderSidebar(); renderPlan(); renderInspector(); }
    }

    function openModal(el) {
      closeModals();
      if (el === listSheet) renderSidebar();
      el.classList.add('open');
      scrim.classList.add('open');
      haptic('light');
    }
    function closeModals() {
      for (const el of [listSheet, addSheet, confirmSheet]) el.classList.remove('open');
      scrim.classList.remove('open');
    }
    scrim.addEventListener('click', closeModals);

    function requestClose() {
      if (dirty) openModal(confirmSheet); else close();
    }
    function close() { post('close'); }

    function setShow3D(on) {
      ui.show3D = on;
      canvas.classList.toggle('show-3d', on);
      view3d.replaceChildren(icon(on ? 'map' : 'box', 22, 1.9), h('span', on ? 'Plan' : '3D'));
      schedulePreview(0);
      haptic('light');
    }

    /* the plan's view: a box in plan metres with the element's aspect, or null to fit */
    function fitBox() {
      const b = bounds();
      const rect = plan.getBoundingClientRect();
      const W = rect.width || 390;
      const H = rect.height || 600;
      // Clear of the fit button on top, a little air on the other sides.
      const pad = { top: 64, side: 18, bottom: 18 };
      const scale = Math.min((W - pad.side * 2) / (b.maxX - b.minX), (H - pad.top - pad.bottom) / (b.maxZ - b.minZ));
      const w = W / scale;
      const hh = H / scale;
      const midY = pad.top + (H - pad.top - pad.bottom) / 2;
      return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minZ + b.maxZ) / 2 - midY / scale, w, h: hh };
    }
    new ResizeObserver(() => ui.applyView()).observe(plan);

    // One finger on what is selected drags it; anywhere else it pans, and a tap picks.
    // Two fingers pinch to zoom.
    const fingers = new Map();
    let gesture = null;
    const box = () => ui.view || fitBox();
    const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const middle = () => { const [a, b] = [...fingers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

    plan.addEventListener('pointerdown', (ev) => {
      plan.setPointerCapture(ev.pointerId);
      fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (fingers.size === 2) {
        if (drag) endDrag();
        const rect = plan.getBoundingClientRect();
        const v = box();
        const mid = middle();
        gesture = { type: 'pinch', d0: spread(), v0: v, at: { x: v.x + (mid.x - rect.left) * v.w / rect.width, y: v.y + (mid.y - rect.top) * v.h / rect.height } };
        return;
      }
      if (fingers.size > 2) return;
      const el = ev.target.closest('[data-kind]');
      const kind = el?.dataset.kind;
      const index = Number(el?.dataset.index);
      // A selected room is grabbed anywhere inside it, even over its furniture and lamps.
      const room = sel.kind === 'room' && doc.rooms[sel.index];
      const [px, pz] = planPoint(ev);
      const inRoom = room && px >= room.rect[0] && px <= room.rect[0] + room.rect[2] && pz >= room.rect[1] && pz <= room.rect[1] + room.rect[3];
      if (kind === 'resize' || (kind && kind !== 'none' && isSel(kind, index)) || (inRoom && kind !== 'light' && kind !== 'ac')) {
        const what = kind === 'resize' || isSel(kind, index) ? [kind, index] : ['room', sel.index];
        // The view holds still while something is dragged past the plan's edge.
        if (!ui.view) ui.view = fitBox();
        startDrag(what[0], what[1], ev);
        gesture = { type: 'drag' };
        return;
      }
      gesture = { type: 'pan', x: ev.clientX, y: ev.clientY, v0: box(), moved: false, kind, index };
    });

    plan.addEventListener('pointermove', (ev) => {
      if (!fingers.has(ev.pointerId)) return;
      fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!gesture) return;
      if (gesture.type === 'drag') { moveDrag(ev); return; }
      const rect = plan.getBoundingClientRect();
      if (gesture.type === 'pinch' && fingers.size === 2) {
        const fit = fitBox();
        const w = clamp(gesture.v0.w * gesture.d0 / Math.max(1, spread()), 1.6, Math.max(fit.w * 2.5, 24));
        const hh = w * rect.height / rect.width;
        const mid = middle();
        ui.view = { x: gesture.at.x - (mid.x - rect.left) * w / rect.width, y: gesture.at.y - (mid.y - rect.top) * hh / rect.height, w, h: hh };
        ui.applyView();
      } else if (gesture.type === 'pan') {
        const dx = ev.clientX - gesture.x;
        const dy = ev.clientY - gesture.y;
        if (!gesture.moved && Math.hypot(dx, dy) < 8) return;
        gesture.moved = true;
        const v = gesture.v0;
        ui.view = { ...v, x: v.x - dx * v.w / rect.width, y: v.y - dy * v.h / rect.height };
        ui.applyView();
      }
    });

    const lift = (ev) => {
      if (!fingers.delete(ev.pointerId)) return;
      if (!gesture) return;
      if (gesture.type === 'drag') {
        // A tap on what is already selected (just added, say) brings up its details.
        const tapped = ev.type === 'pointerup' && drag && !drag.moved && drag.kind !== 'resize';
        endDrag();
        gesture = null;
        if (tapped && ui.sheet === 'closed') { haptic('light'); setSheet('peek'); }
        return;
      }
      if (gesture.type === 'pinch') {
        // One finger stays down: it carries on panning from here.
        const [rest] = [...fingers.values()];
        gesture = rest ? { type: 'pan', x: rest.x, y: rest.y, v0: box(), moved: true } : null;
        return;
      }
      if (gesture.type === 'pan' && !gesture.moved && ev.type === 'pointerup') {
        const { kind, index } = gesture;
        if (kind && kind !== 'none' && kind !== 'resize') { haptic('light'); select({ kind, index }); }
        else if (ui.sheet !== 'closed') closeSheet();
      }
      gesture = null;
    };
    plan.addEventListener('pointerup', lift);
    plan.addEventListener('pointercancel', lift);

    const ui = {
      view: null,
      sheet: 'closed',
      show3D: false,
      applyView() {
        if (ui.view) {
          // The plan's box changed shape (the sheet came up): keep the middle and the zoom.
          const rect = plan.getBoundingClientRect();
          const hh = rect.width ? ui.view.w * rect.height / rect.width : ui.view.h;
          ui.view = { ...ui.view, y: ui.view.y + (ui.view.h - hh) / 2, h: hh };
        }
        const v = ui.view || fitBox();
        plan.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
      },
      // Something was picked (on the plan, in the list, in 3D): its details come up.
      selected(next) {
        closeModals();
        if (next.kind === 'connections' || next.kind === 'service') setSheet('full');
        else if (next.kind !== 'home' && ui.sheet === 'closed') setSheet('peek');
      },
      // The item just added may lie outside what is shown: show everything again.
      reveal() { ui.view = null; ui.applyView(); },
      headActions() {
        const nodes = [];
        if (sel.index != null) {
          nodes.push(h('button.p-icon.danger', {
            'aria-label': 'Remove', onclick: () => { haptic('medium'); remove(sel.kind, sel.index); setSheet('closed'); },
          }, icon('trash', 18, 2)));
        }
        nodes.push(h('button.p-icon', { 'aria-label': 'Close details', onclick: closeSheet }, icon('down', 20, 2.2)));
        return h('div.p-head-actions', nodes);
      },
      refresh() {
        doneBtn.textContent = dirty ? 'Save' : 'Done';
        doneBtn.classList.toggle('primary', dirty);
        doneBtn.disabled = dirty && !valid;
        undoBtn.disabled = !undo.length;
        redoBtn.disabled = !redo.length;
        issue.textContent = valid ? '' : status.textContent;
        issue.classList.toggle('show', !valid);
      },
    };
    setSheet(sel.kind === 'connections' || sel.kind === 'service' ? 'full' : 'closed');
    phone = ui;
  }

  renderSidebar();
  renderPlan();
  renderInspector();
  validate();
  dirty = false;
  validate();
  schedulePreview(0);
  incoming.openSection = (at) => select(sectionSel(at));
  // A plan saved on the other device (the Mac, or the paired iPhone) while this editor is open.
  incoming.planArrived = (config, from) => {
    if (dirty) {
      toast(`${from || 'Seu outro dispositivo'} salvou uma planta mais nova. Salvar aqui substitui a dela.`, true);
      return;
    }
    doc = structuredClone(config);
    for (const key of Object.values(KEYS)) doc[key] ||= [];
    nameInput.value = doc.name || 'Home';
    if (sel.index != null && !doc[KEYS[sel.kind]]?.[sel.index]) sel = { kind: 'home' };
    touch();
    dirty = false;
    validate();
    toast(`Atualizado por ${from || 'seu outro dispositivo'}`);
  };

  window.__editor = { get doc() { return doc; }, select, tuya, links, phone };
  post('ready');
}
