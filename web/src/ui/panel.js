// The control panel that lives in the menu bar popover: header, scenes, rooms,
// device tiles and the detail sheets for a light or an AC.
import * as THREE from 'three';
import { h, clamp, createSlider, createColorPad, openMenu } from './dom.js';
import { icon, roomIcon } from './icons.js';
import { brandOf, brandLogo, TV_MARK } from './brands.js';
import { lightColor } from '../three/lights.js';
import { MODE_COLORS } from '../three/ac.js';
import { AC_SWINGS } from '../store.js';
import { haptic, isPhone, isTouch, isTablet, isNative, post } from '../bridge.js';
import { loadArrangement, saveArrangement, ordered, visible, move } from './arrange.js';
import { createLastSeen, ago, span, when } from '../lastseen.js';
import { createCameraBox } from '../camera/view.js';

const MODE_LABEL = { cool: 'Gelar', heat: 'Aquecer', dry: 'Desumidificar', fan: 'Ventilar', auto: 'Automático' };
const FAN_LABEL = { auto: 'Automático', silent: 'Silencioso', low: 'Baixo', medium: 'Médio', high: 'Alto', turbo: 'Máximo' };
const SWING_LABEL = { swing: 'Oscilar', horizontal: 'Horizontal', vertical: 'Vertical', l1: 'L1', l2: 'L2', l3: 'L3', l4: 'L4', l5: 'L5', off: 'Parado' };
const SWATCHES = ['#ff5a4f', '#ff9a3c', '#ffd84a', '#5fe08a', '#42d6e8', '#4f8dff', '#8b5cff', '#ff5fc4'];

const TEMP_GRADIENT = 'linear-gradient(90deg, #2f7df6 0%, #58b4f5 34%, #f3e2c0 62%, #f6a54a 82%, #f0762c 100%)';
const DIM_GRADIENT = 'linear-gradient(90deg, #4a4f5e 0%, #b9a98c 45%, #ffe2b0 100%)';
const KELVIN_GRADIENT = 'linear-gradient(90deg, #ff9438 0%, #ffbd7a 30%, #ffe2c2 62%, #dfe9ff 100%)';

const NAVY = new THREE.Color('#17274f');
const tmp = new THREE.Color();
const css = (c) => `#${c.getHexString()}`;

function lightStatus(cfg, s) {
  if (!s.on) return 'Apagada';
  return cfg.capabilities.includes('brightness') ? `${Math.round(s.brightness * 100)}%` : 'Acesa';
}

function acTemperatureColor(target, cfg) {
  const t = clamp((target - cfg.min) / (cfg.max - cfg.min), 0, 1);
  return tmp.set('#1c4fc0').lerp(new THREE.Color('#8a3d12'), t).clone();
}

export function createPanel(root, config, store, { onFocus, onMenu, cameraAccess = null }) {
  const { state } = store;
  const ui = { room: 'all', sheet: null, pinned: null, editing: false, editSel: null };
  // Informação: each device's last change (lastseen.js).
  const seen = createLastSeen(store, config);

  // Editando os cartões, eles são só cartões: nada aciona os aparelhos. Um toque sem querer
  // numa luz, num atalho, no botão de energia ou na maquete só avisa (uma vez a cada tanto).
  let nudgedAt = 0;
  function nudge() {
    if (Date.now() - nudgedAt < 2500) return;
    nudgedAt = Date.now();
    haptic('error');
    showToast('Editando os cartões: os aparelhos não são acionados. Toque em Concluir para usar.', null, 'info');
  }
  for (const name of ['setLight', 'toggleLight', 'setAllLights', 'setAC', 'setTV', 'tvAction', 'gatePress', 'runShortcut', 'setToggle', 'applyScene']) {
    const real = store[name];
    if (typeof real !== 'function') continue;
    store[name] = (...args) => {
      if (!ui.editing) return real.apply(store, args);
      nudge();
      return name === 'runShortcut' ? Promise.resolve(false) : undefined;
    };
  }
  let world = null;
  const roomName = new Map(config.rooms.map((r) => [r.id, r.name]));
  // Rooms merged into another (`mergeWith` on the plan) share its chip: a tab is the room
  // that gets merged into, listing its own devices and then the others', each under its name.
  const tabOf = (id) => config.rooms.find((r) => r.id === id)?.tab ?? id;
  const membersOf = (tab) => config.rooms.filter((r) => r.tab === tab).sort((a, b) => (b.id === tab) - (a.id === tab));
  const tabName = new Map(config.rooms.filter((r) => r.tab === r.id)
    .map((r) => [r.id, membersOf(r.id).map((m) => m.name).join(' · ')]));

  /* ---------- skeleton ---------- */

  const canvas = h('canvas', { tabindex: -1 });
  const tooltip = h('div.tooltip');
  const homeName = h('div.home-name', config.name);
  // The icon of the room in view (the house on the whole home); hovered, the house: a click
  // always goes back to the start.
  // The app's own mark (the house of the app icon) stands for the whole home.
  const logo = () => h('img.app-logo', { src: './img/logo.png', alt: '', draggable: false });
  const badgeRoom = h('span.badge-room', logo());
  const homeBadge = h('button.home-badge', { title: 'Início', 'aria-label': 'Voltar ao início', onclick: goHome },
    badgeRoom, h('span.badge-home', logo()));
  let badgeShown = 'all';
  const homeSub = h('div.home-sub');
  // Ligar / desligar tudo: no cômodo em vista (ou a casa toda no início), com confirmação;
  // os dois em Organizar o painel.
  const power = h('button.round.power', { title: 'Ligar / desligar tudo', 'aria-label': 'Ligar ou desligar tudo', onclick: toggleEverything }, icon('power', 21, 2.2));
  // On the start page the model can be put away: the list moves up, and comes back in a room.
  const mapBtn = h('button.round.map-btn', { title: 'Mostrar ou ocultar o mapa', 'aria-label': 'Mostrar ou ocultar o mapa', onclick: () => toggleMap() }, icon('map', 17));
  // A room with a security camera: its live picture over the model, only while asked for
  // (camera/view.js). Red while off, like a lamp; blue while the camera is on screen.
  // "Câmeras": a tab of its own at the end of the room tabs with every camera's button (one
  // plays at a time, as in a room). Not a room of the plan: nothing else is listed there.
  const CAM_TAB = 'cameras';
  const camsHere = Boolean(cameraAccess?.available && config.cameras?.length);
  const camerasOf = (tab) => (tab === 'all' ? [] : (config.cameras || []).filter((c) => tab === CAM_TAB || tabOf(c.room) === tab));
  const camBox = createCameraBox({
    access: cameraAccess || { use: () => Promise.reject(new Error('indisponível')), release() {}, warm() {} },
    // the cards below the box start where it ends (style.css: --cam-h)
    onSize: (px) => card.style.setProperty('--cam-h', `${px}px`),
  });
  /** A camera card's switch: `id` on (another one in view switches to it), or off when it is
   *  the one on screen. Without `id`: closes whatever is on. From the start page, the card
   *  first goes to its room (the box belongs to the room in view). */
  function toggleCamera(id = null) {
    if (ui.editing) { nudge(); return; }
    const cam = id && (config.cameras || []).find((c) => c.id === id);
    gateCamOn = false; // a camera chosen by hand stays as any other
    if (!cam || camBox.currentId === id) {
      if (!camBox.isOpen) return;
      haptic('light');
      camBox.close();
      update();
      return;
    }
    haptic('light');
    if (ui.room !== CAM_TAB && tabOf(cam.room) !== ui.room) selectRoom(cam.room);
    camBox.open([cam]);
    update();
  }
  const gear = h('button.round', { title: 'Ajustes e plantas', 'aria-label': 'Ajustes e plantas', onclick: () => onMenu(gear) }, icon('settings', 17));
  // The Mac: let the panel go from the menu bar (a floating window that stays open), or put it back.
  let detached = Boolean(window.__HOUSE_BOOT__?.detached);
  const detachBtn = isNative && !isPhone
    ? h('button.round.detach-btn', { onclick: () => { post('setDetached', { on: !detached }); } })
    : null;
  function showDetached(on) {
    detached = Boolean(on);
    card.classList.toggle('detached', detached);
    if (!detachBtn) return;
    const label = detached ? 'Prender de volta na barra de menu' : 'Soltar da barra de menu (fica aberto)';
    detachBtn.title = label;
    detachBtn.setAttribute('aria-label', label);
    detachBtn.replaceChildren(icon(detached ? 'pinOff' : 'pin', 16, 2));
  }
  // Shown while an AI assistant has a link to this home (AI Access on the Mac).
  const aiBadge = h('button.ai-badge', { hidden: true, title: 'Um assistente de IA tem acesso — clique para gerenciar', 'aria-label': 'Acesso por IA',
    onclick: () => onMenu(aiBadge, 'agent') }, icon('sparkles', 13, 2.2), h('span', 'AI'));

  const scenes = h('div.scenes');
  const rooms = h('div.rooms');
  const grid = h('div.grid');
  // The count of lit lamps is in the header, and a room's lights switch with the power button
  // at the top: this row stays empty (kept as the anchor of the room chips above the list).
  const listHead = h('div.list-head', { hidden: true });
  // The cameras of the room in view: thin cards that stay at the top of the panel, above the
  // cards that scroll (camera/view.js plays the one that is on).
  const camStrip = h('div.cam-strip', { hidden: true });
  const editBar = h('div.edit-bar', { hidden: true });
  const panel = h('section.panel',
    scenes, rooms,
    listHead, editBar, camStrip,
    h('div.devices', grid));
  const sheet = h('section.sheet.hidden');
  sheet.inert = true;
  // The stage above grows into whatever the open sheet leaves free.
  new ResizeObserver(() => { if (ui.sheet) card.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`); }).observe(sheet);
  const toastEl = h('div.panel-toast');

  const clip = h('div.card-clip',
    h('div.stage', canvas),
    h('div.tint'),
    camBox.el,
    h('header.top',
      h('div.home', homeBadge,
        h('div', homeName, homeSub)),
      aiBadge, mapBtn, detachBtn, gear, power),
    tooltip, panel, sheet, toastEl);
  const card = h('div.card.booting', h('div.notch'), clip);
  root.replaceChildren(card);
  showDetached(detached);
  // Solto, the window is dragged by its header (not by its buttons).
  {
    const head = clip.querySelector('header.top');
    let drag = null;
    let pending = null;
    head.addEventListener('pointerdown', (ev) => {
      if (!detached || ev.button !== 0 || ev.target.closest('button')) return;
      drag = { x: ev.screenX, y: ev.screenY };
      head.setPointerCapture(ev.pointerId);
      head.classList.add('dragging');
    });
    head.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.screenX - drag.x;
      const dy = ev.screenY - drag.y;
      if (!dx && !dy) return;
      drag = { x: ev.screenX, y: ev.screenY };
      // one message a frame, with what moved since the last one
      if (pending) { pending.dx += dx; pending.dy += dy; return; }
      pending = { dx, dy };
      requestAnimationFrame(() => { post('moveWindow', pending); pending = null; });
    });
    const end = () => { drag = null; head.classList.remove('dragging'); };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  /** `ai`: something an AI assistant did (who, what), instead of an error; `tone` 'info': a
   *  neutral notice (not an error). */
  function showToast(text, ai = null, tone = null) {
    toastEl.replaceChildren(...(ai ? [h('span.toast-ai', icon('sparkles', 13, 2.2), ai), h('span', text)] : [text]));
    toastEl.classList.toggle('ai', Boolean(ai));
    toastEl.classList.toggle('info', tone === 'info');
    toastEl.classList.add('show');
    clearTimeout(toastEl.timer);
    toastEl.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  /* ---------- scenes ---------- */

  // Like a lamp's ring: blue for what switches on, red for what switches off.
  const OFF_WORDS = /\b(apagar|desligar|off)\b/i;
  function glyphRing(name, label) {
    const off = OFF_WORDS.test(label) || name === 'lightsOff';
    return h(`span.glyph-ring${off ? '.off' : ''}`, icon(name, 16, 2));
  }
  const sceneButtons = new Map();
  for (const s of config.scenes) {
    const b = h('button.scene', { onclick: () => { haptic('medium'); store.applyScene(s.id); } }, glyphRing(s.icon, s.name), s.name);
    sceneButtons.set(s.id, b);
    scenes.append(b);
  }
  // How this Mac arranges the panel (Organizar): order and hidden items, never the plan.
  let arr = loadArrangement(config.name);

  // Shortcuts (Home Assistant scripts) sit with the scenes: one press runs them.
  const shortcutButtons = new Map();
  for (const sc of config.shortcuts) {
    const b = h('button.scene.shortcut', { title: sc.name, onclick: async () => {
      if (b.classList.contains('running')) return;
      haptic('medium');
      b.classList.add('running');
      const ok = await store.runShortcut(sc.id);
      b.classList.remove('running');
      if (!ok) return;
      b.classList.add('active');
      setTimeout(() => b.classList.remove('active'), 1200);
    } }, glyphRing(sc.icon, sc.name), sc.name);
    shortcutButtons.set(sc.id, b);
  }
  function renderScenes() {
    const shown = visible(config.shortcuts, arr, 'shortcuts').map((sc) => shortcutButtons.get(sc.id));
    scenes.replaceChildren(...sceneButtons.values(), ...shown);
    scenes.style.display = config.scenes.length || shown.length ? '' : 'none';
  }
  renderScenes();

  /* ---------- rooms ---------- */

  const roomButtons = new Map();
  // Rooms without a device stay in the model but not in the chips (a bathroom, a passage).
  const devicesIn = (id) => [...config.lights, ...config.acs, ...config.tvs, ...config.gates].some((d) => d.room === id);
  // Every room with something in it (its own devices' group in Organizar o painel)…
  const roomsWithDevices = config.rooms.filter((r) => devicesIn(r.id));
  // …and the chips: one per tab, under the merged name.
  const withDevices = config.rooms.filter((r) => r.tab === r.id && membersOf(r.id).some((m) => devicesIn(m.id)))
    .map((r) => ({ ...r, name: tabName.get(r.id) }));
  for (const r of [{ id: 'all', name: 'Todos' }, ...withDevices]) {
    const count = h('span.count.zero', '0');
    const b = h('button.room', { title: r.name, 'aria-label': r.name, onclick: () => { haptic('tick'); selectRoom(r.id); } },
      h('span.room-icon', icon(r.id === 'all' ? 'home' : roomIcon(r), 16, 2)), h('span.room-name', r.name), count);
    roomButtons.set(r.id, { b, count });
  }
  if (camsHere) {
    const b = h('button.room.cam-tab', { title: 'Câmeras', 'aria-label': 'Câmeras', onclick: () => { haptic('tick'); selectRoom(CAM_TAB); } },
      h('span.room-icon', icon('cctv', 16, 2)), h('span.room-name', 'Câmeras'), h('span.count.zero', '0'));
    roomButtons.set(CAM_TAB, { b, count: b.lastElementChild });
    tabName.set(CAM_TAB, 'Câmeras');
  }
  /** The tabs in their order: Todos, the rooms (as arranged), then Câmeras. */
  const tabOrder = () => ['all', ...visible(withDevices, arr, 'rooms').map((r) => r.id), ...(camsHere ? [CAM_TAB] : [])];
  function renderRooms() {
    rooms.dataset.style = arr.chips;
    // Above the list, or at the foot of the panel like a phone app's tab bar (Organizar).
    const bottom = arr.roomsAt === 'bottom';
    panel.classList.toggle('rooms-bottom', bottom);
    if (bottom && panel.lastElementChild !== rooms) panel.append(rooms);
    if (!bottom && rooms.nextElementSibling !== listHead) panel.insertBefore(rooms, listHead);
    rooms.replaceChildren(...tabOrder().map((id) => roomButtons.get(id).b));
  }
  renderRooms();

  // Swiping the cards sideways moves to the next room tab (left) or the one before (right),
  // in the order of the tabs. Not on what already drags sideways (a dimmable lamp, a slider,
  // the colour pad), nor while editing the cards or with a sheet open.
  const devicesEl = grid.parentElement;
  let swipe = null;
  devicesEl.addEventListener('touchstart', (ev) => {
    swipe = null;
    if (ev.touches.length !== 1 || ui.editing || ui.sheet || sideways()) return;
    if (ev.target.closest('.dimmable, .slider, .slider-track, .pad, input, textarea, select, .no-swipe')) return;
    const t = ev.touches[0];
    swipe = { x: t.clientX, y: t.clientY, side: false, done: false };
  }, { passive: true });
  // Decided while the finger moves (WebKit may take the touch for scrolling before it lifts):
  // once the drag is clearly sideways the page stops scrolling, and past 70 px the room changes.
  devicesEl.addEventListener('touchmove', (ev) => {
    const s = swipe;
    if (!s || s.done) return;
    const t = ev.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.side) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // a scroll
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) s.side = true;
    }
    if (!s.side) return;
    if (ev.cancelable) ev.preventDefault();
    if (Math.abs(dx) < 70 || ui.editing || ui.sheet) return;
    s.done = true;
    const order = tabOrder();
    const at = order.indexOf(ui.room);
    const next = order[at + (dx < 0 ? 1 : -1)];
    if (at < 0 || !next) return; // the first or last tab: nothing past it
    haptic('tick');
    selectRoom(next);
    grid.classList.remove('swipe-left', 'swipe-right');
    void grid.offsetWidth; // restart the slide
    grid.classList.add(dx < 0 ? 'swipe-left' : 'swipe-right');
    devicesEl.scrollTo({ top: 0 });
  }, { passive: false });
  devicesEl.addEventListener('touchend', () => { swipe = null; }, { passive: true });
  devicesEl.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
  grid.addEventListener('animationend', () => grid.classList.remove('swipe-left', 'swipe-right'));

  /** The room's tab centred in the row of tabs. Only that row scrolls: scrollIntoView would
   *  also scroll the panel (the tabs at the foot sit outside it, so it slid the shortcuts up). */
  function showTab(id, behavior = 'smooth') {
    const b = roomButtons.get(id)?.b;
    if (!b || b.parentElement !== rooms) return;
    const r = rooms.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const left = rooms.scrollLeft + (br.left - r.left) - (r.width - br.width) / 2;
    rooms.scrollTo({ left: Math.max(0, left), behavior });
  }

  /** The house icon: back to the start, whatever is open. */
  /** The model zoomed to a room from the start page, without leaving it (the room's name). */
  function peekRoom(id) {
    ui.peek = ui.peek === id ? null : id;
    haptic('light');
    onFocus(ui.peek ? { kind: 'room', id: ui.peek } : null);
    for (const l of grid.querySelectorAll('.group-label.peek')) l.classList.toggle('on', l.dataset.room === ui.peek);
  }

  function goHome() {
    haptic('light');
    camBox.close();
    ui.peek = null;
    for (const l of grid.querySelectorAll('.group-label.peek.on')) l.classList.remove('on');
    closeSheet();
    unpin();
    if (ui.room !== 'all') selectRoom('all');
    else onFocus(null);
    grid.parentElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectRoom(id) {
    id = tabOf(id);
    ui.peek = null;
    if (ui.room === id) id = 'all';
    // Leaving the room ends its camera: nothing streams in the background.
    camBox.close();
    if (camerasOf(id).length) cameraAccess?.warm();
    ui.room = id;
    renderCamStrip();
    if (ui.pinned) { ui.pinned = null; world?.pin(null); }
    ui.room = id;
    layoutTiles();
    update();
    showTab(id);
    onFocus(id === 'all' || id === CAM_TAB ? null : { kind: 'room', id });
    if (ui.editing) renderEditBar(); // the room's own options (its camera)
    // A room set to open with a camera (Editar): that camera comes on by itself.
    const auto = !ui.editing && arr.autoCam[id] && camerasOf(id).find((c) => c.id === arr.autoCam[id]);
    if (auto && camsHere) { camBox.open([auto]); update(); }
  }

  function inScope(cfg) {
    return ui.room === 'all' || tabOf(cfg.room) === ui.room;
  }

  /** What the power button at the top switches: the room in view (unless set to the whole
   *  home in Organizar), or the whole home on the start page. */
  function powerScope() {
    const tab = arr.powerScope !== 'home' && ui.room !== 'all' && ui.room !== CAM_TAB ? ui.room : null;
    const mine = (d) => !tab || tabOf(d.room) === tab;
    return { tab, lights: config.lights.filter(mine), acs: config.acs.filter(mine) };
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function toggleEverything() {
    if (ui.editing) { nudge(); return; }
    const { tab, lights, acs } = powerScope();
    if (!lights.length && !acs.length) return;
    const lit = lights.filter((l) => state.lights[l.id].on);
    const acsOn = acs.filter((a) => state.acs[a.id].on);
    const off = lit.length > 0 || acsOn.length > 0;
    const where = tab ? tabName.get(tab) : null;
    const run = () => {
      haptic('heavy');
      if (off) {
        if (tab) for (const l of lit) store.setLight(l.id, { on: false });
        else store.setAllLights(false);
        for (const a of acsOn) store.setAC(a.id, { on: false });
      } else if (tab) {
        for (const l of lights) store.setLight(l.id, { on: true });
      } else {
        store.setAllLights(true);
      }
    };
    if (arr.powerConfirm === false) { run(); return; }
    haptic('medium');
    const parts = off
      ? [lit.length ? `apaga ${plural(lit.length, 'luz', 'luzes')}` : null, acsOn.length ? `desliga ${plural(acsOn.length, 'ar-condicionado', 'ares-condicionados')}` : null].filter(Boolean)
      : [`acende ${lights.length === 1 ? 'a luz' : `as ${lights.length} luzes`}`];
    const what = parts.join(' e ');
    askConfirm({
      title: off ? (where ? `Desligar tudo em ${where}?` : 'Desligar a casa toda?') : (where ? `Acender ${where}?` : 'Acender a casa toda?'),
      text: `${what.charAt(0).toUpperCase()}${what.slice(1)}${where ? '' : ' da casa toda'}.`,
      ok: off ? 'Desligar' : 'Acender',
      danger: off,
    }, run);
  }

  // A small confirmation over the panel (the power button): two buttons, Esc or a tap outside cancels.
  let confirmView = null;
  function askConfirm({ title, text, ok, danger }, onOk) {
    closeConfirm();
    const close = () => closeConfirm();
    const yes = h(`button.confirm-ok${danger ? '.danger' : ''}`, { onclick: () => { close(); onOk(); } }, ok);
    const box = h('div.confirm-box', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.confirm-title', title), text ? h('div.confirm-text', text) : null,
      h('div.confirm-actions', h('button.confirm-cancel', { onclick: close }, 'Cancelar'), yes));
    confirmView = h('div.confirm', { onclick: (e) => { if (e.target === confirmView) close(); } }, box);
    clip.append(confirmView);
    requestAnimationFrame(() => { confirmView?.classList.add('show'); yes.focus({ preventScroll: true }); });
  }
  function closeConfirm() {
    if (!confirmView) return false;
    const el = confirmView;
    confirmView = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
    return true;
  }

  /* ---------- tiles ---------- */

  const tiles = new Map();

  function lightTile(cfg) {
    const dimmable = cfg.capabilities.includes('brightness');
    // the optional tag over the name ("LED", "Cortina"), set in Editar
    const tag = h('div.tile-label');
    const hasSheet = cfg.capabilities.length > 0;
    const sub = h('div.tile-sub');
    // A phone has no room for the button: touching and holding the tile opens the sheet there.
    const more = hasSheet && !isTouch
      ? h('button.tile-more', { 'aria-label': `Ajustes de ${cfg.name}`, onclick: (e) => { e.stopPropagation(); openSheet({ kind: 'light', id: cfg.id }); } }, icon('sliders', 15))
      : null;
    const el = h(`div.tile.lamp${dimmable ? '.dimmable' : ''}`, { role: 'button', tabindex: 0, 'aria-label': cfg.name },
      h('div.tile-text', tag, h('div.tile-name', cfg.name), sub),
      more,
      // a glowing ring at the right, like the switch on the wall: red when off, blue when lit
      h('span.tile-dot', { 'aria-hidden': 'true' }),
      h('div.tile-level'));

    // Tap toggles; dragging sideways dims (HomeKit-style).
    let gesture = null;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.tile-more') || ev.button !== 0) return;
      el.setPointerCapture(ev.pointerId);
      const s = state.lights[cfg.id];
      gesture = { x: ev.clientX, y: ev.clientY, start: s.on ? s.brightness : 0, moved: false, step: null };
      el.classList.add('pressed');
      if (isTouch && hasSheet) {
        gesture.hold = setTimeout(() => {
          if (!gesture || gesture.moved) return;
          gesture = null;
          el.classList.remove('pressed');
          haptic('medium');
          openSheet({ kind: 'light', id: cfg.id });
        }, 420);
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!gesture) return;
      const dx = ev.clientX - gesture.x;
      if (Math.hypot(dx, ev.clientY - gesture.y) > 8) clearTimeout(gesture.hold);
      // A mostly vertical move is the list being scrolled, not a dim.
      if (!gesture.moved && dimmable && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(ev.clientY - gesture.y)) {
        gesture.moved = true;
        el.classList.add('dragging');
      }
      if (gesture.moved) {
        const b = clamp(gesture.start + dx / el.clientWidth, 0, 1);
        const step = Math.round(b * 20);
        if (step !== gesture.step) { if (gesture.step !== null) haptic('tick'); gesture.step = step; }
        store.setLight(cfg.id, b < 0.04 ? { on: false } : { on: true, brightness: b });
      }
    });
    const finish = (ev) => {
      if (!gesture) return;
      const tapped = !gesture.moved && ev.type === 'pointerup';
      clearTimeout(gesture.hold);
      gesture = null;
      el.classList.remove('pressed', 'dragging');
      if (tapped) toggleLight(cfg.id);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleLight(cfg.id); }
    });

    return {
      el, cfg, kind: 'light',
      update() {
        const s = state.lights[cfg.id];
        el.classList.toggle('on', s.on);
        el.style.setProperty('--c', css(lightColor(s, tmp)));
        el.style.setProperty('--level', s.on ? String(s.brightness) : '0');
        // On a phone the group heading above the tile already names the room.
        // The room is the group's heading already.
        // The switch itself shows on or off; only a dimmable lamp's level is written out.
        sub.textContent = dimmable && s.on ? lightStatus(cfg, s) : '';
        const label = arr.showLabels ? arr.labels[cfg.id] || '' : '';
        tag.textContent = label;
        tag.hidden = !label;
        el.setAttribute('aria-pressed', String(s.on));
      },
    };
  }

  // The square cards (air, TV, gate) show the device itself, off and on, as two pictures
  // made for the panel; the lit one fades in over the other.
  const scene = (kind, offSrc, onSrc, ...over) => h(`div.card-scene.${kind}`,
    h('img.card-art', { alt: '', src: offSrc, draggable: false }),
    h('img.card-art.lit', { alt: '', src: onSrc, draggable: false }),
    ...over);

  function acTile(cfg) {
    const sub = h('div.tile-sub');
    const value = h('div.ac-display');
    const room = h('div.card-note');
    const step = (d) => (e) => {
      e.stopPropagation();
      haptic('tick');
      const s = state.acs[cfg.id];
      store.setAC(cfg.id, { on: true, target: s.target + d });
    };
    const el = h('div.tile.ac.card', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: () => openSheet({ kind: 'ac', id: cfg.id }) },
      // the set temperature is on the unit's own display, as on the real one
      scene('ac', './img/ac-off.jpg', './img/ac-on.jpg', value),
      h('div.card-head',
        h('div.tile-text', h('div.tile-name', cfg.name), sub),
        h('button.mini-power', { 'aria-label': `Ligar ou desligar ${cfg.name}`, onclick: (e) => { e.stopPropagation(); haptic('medium'); store.setAC(cfg.id, { on: !state.acs[cfg.id].on }); } }, icon('power', 16, 2.2))),
      h('div.card-foot',
        room,
        h('div.stepper',
          h('button', { 'aria-label': 'Mais frio', onclick: step(-1) }, icon('minus', 15, 2.2)),
          h('button', { 'aria-label': 'Mais quente', onclick: step(1) }, icon('plus', 15, 2.2)))));
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openSheet({ kind: 'ac', id: cfg.id }); });
    return {
      el, cfg, kind: 'ac',
      update() {
        const s = state.acs[cfg.id];
        el.classList.toggle('on', s.on);
        el.classList.toggle('idle', s.on && s.idle);
        el.style.setProperty('--c', MODE_COLORS[s.mode]);
        value.textContent = String(s.target);
        sub.textContent = !s.on ? 'Desligado' : s.idle ? 'Em espera' : MODE_LABEL[s.mode];
        room.textContent = `Ambiente ${s.roomTemp.toFixed(isPhone ? 0 : 1)}°`;
        el.setAttribute('aria-label', `${cfg.name}, ${sub.textContent}${s.on ? `, ${s.target} graus` : ''}`);
      },
    };
  }

  const GATE_TEXT = { open: 'Aberto', closed: 'Fechado', opening: 'Abrindo…', closing: 'Fechando…', stopped: 'Parado' };
  const GATE_COLOR = { open: '#ffb340', opening: '#ffd84a', closing: '#ffd84a', stopped: '#ff8f5a' };
  const GATE_VERB = { open: 'Abrir', close: 'Fechar', stop: 'Parar' };
  const pct = (p) => `${Math.round(p * 100)}%`;
  /** "Aberto", "Abrindo… 40%", "Parado · 40% aberto". */
  const gateText = (id) => {
    const g = state.gates[id];
    if (g.online === false) return 'Indisponível';
    const p = store.gatePosition(id);
    if (g.motion) return `${GATE_TEXT[g.state]} ${pct(p)}`;
    return g.state === 'stopped' ? `Parado · ${pct(p)} aberto` : GATE_TEXT[g.state] || g.state;
  };
  // One press, like the gate's own button. Starting it takes a second press within a few
  // seconds (a stray click must not open the house); stopping it never waits.
  function gateButton(id, render) {
    let armed = 0;
    const disarm = () => { clearTimeout(armed); armed = 0; render(); };
    return {
      get armed() { return Boolean(armed); },
      /** `el`: the button pressed. The camera opening above pushes the cards down: the button
       *  comes back into view, and the time for the second press starts again once it is there. */
      press(el) {
        // Safety: from the first touch (the one that arms the button) the gate's camera is on
        // screen, and stays until the page changes.
        const moved = showGateCamera(id);
        const next = store.gateNext(id);
        if (next !== 'stop' && !armed) {
          haptic('light');
          armed = setTimeout(disarm, 3500);
          render();
          if (moved && el) {
            // after the panel's slide down (style.css: .panel top 460ms)
            setTimeout(() => {
              if (!armed) return;
              bringIntoView(el);
              clearTimeout(armed);
              armed = setTimeout(disarm, 3500);
            }, 480);
          }
          return;
        }
        clearTimeout(armed); armed = 0;
        haptic(next === 'stop' ? 'medium' : 'heavy');
        store.gatePress(id);
        render();
      },
      label(short) {
        const next = store.gateNext(id);
        // The tile is half a row wide: there the second press asks in one word ("Abrir?").
        if (armed) return short ? `${GATE_VERB[next]}?` : next === 'open' ? 'Toque de novo para abrir' : 'Toque de novo para fechar';
        return short ? GATE_VERB[next] : `${GATE_VERB[next]} o portão`;
      },
    };
  }
  /** Scrolls `el` into the part of its list left visible: below the camera box, above the
   *  room tabs at the foot (a phone, an iPad), which lie over the list. */
  function bringIntoView(el) {
    let list = el.parentElement;
    while (list && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) list = list.parentElement;
    if (!list) return;
    const box = list.getBoundingClientRect();
    const tabs = card.querySelector('.panel.rooms-bottom:not(.hidden) .rooms');
    const bottom = Math.min(box.bottom, tabs ? tabs.getBoundingClientRect().top : Infinity) - 8;
    const top = box.top + 8;
    const r = el.getBoundingClientRect();
    const dy = r.bottom > bottom ? r.bottom - bottom : r.top < top ? r.top - top : 0;
    if (dy) list.scrollBy({ top: dy, behavior: 'smooth' });
  }
  /** The camera of the gate's room (the garage) on screen, unless a camera already is. It goes
   *  away with the page: another room, the start page, or leaving the gate's sheet. */
  let gateCamOn = false;
  function showGateCamera(gateId) {
    if (ui.editing || !camsHere) return false;
    const gate = config.gates.find((g) => g.id === gateId);
    const cams = gate?.room ? camerasOf(tabOf(gate.room)) : [];
    // The plan's gate view (`gateView` on cameras: which half of each to show; `gateSlot`: its
    // place from the top), else the camera of the gate's room whole.
    const order = { top: 0, full: 1, bottom: 2 };
    const slot = (c) => c.gateSlot ?? order[c.gateView];
    const view = (config.cameras || []).filter((c) => order[c.gateView] != null)
      .sort((a, b) => slot(a) - slot(b)).map((c) => ({ camera: c, part: c.gateView }));
    const cam = cams.find((c) => c.room === gate.room) || cams[0];
    // Already open: the gate's view replaces one of its own cameras shown alone; it is left as
    // it is when it already shows the gate's view, or another camera chosen on purpose.
    if (camBox.isOpen) {
      const own = view.length ? view.map((p) => p.camera.id) : cam ? [cam.id] : [];
      if (!camBox.currentId || !own.includes(camBox.currentId) || !view.length) return false;
    }
    if (view.length) camBox.openView(view);
    else if (cam) camBox.open([cam]);
    else return false;
    gateCamOn = true;
    update();
    return true;
  }

  // While a gate moves, its percentage and the bar follow it.
  setInterval(() => { if (Object.values(state.gates).some((g) => g.motion)) { for (const t of gateTiles) t.update(); sheetView?.update(); } }, 250);

  // The gate opens and closes on a second press within a few seconds, never on the first:
  // a stray click in the menu bar must not open the house.
  function gateTile(cfg) {
    const sub = h('div.tile-sub');
    const label = h('span');
    const button = gateButton(cfg.id, () => update());
    const action = h('button.gate-action', { onclick: (e) => { e.stopPropagation(); button.press(action); } }, label);
    // since when (the medium and long cards have room for it)
    const since = h('div.card-since');
    const el = h('div.tile.gate.card', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: () => openSheet({ kind: 'gate', id: cfg.id }) },
      scene('gate', './img/gate-closed.jpg', './img/gate-open.jpg'),
      h('div.card-head', h('div.tile-text', h('div.tile-name', cfg.name), sub, since)),
      h('div.card-foot', action));
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === el) openSheet({ kind: 'gate', id: cfg.id }); });
    function update() {
      const g = state.gates[cfg.id];
      el.classList.toggle('on', g.state !== 'closed');
      el.classList.toggle('offline', g.online === false);
      el.style.setProperty('--c', GATE_COLOR[g.state] || '#8b93a7');
      // how far open, 0…1: the open picture fades in with the gate as it moves
      const open = g.online === false ? 0 : g.motion ? store.gatePosition(cfg.id) : g.state === 'closed' ? 0 : g.state === 'open' ? 1 : store.gatePosition(cfg.id);
      el.style.setProperty('--open', String(Math.round(open * 100) / 100));
      sub.textContent = gateText(cfg.id);
      const r = seen.get(cfg.id);
      since.textContent = r && !g.motion && g.online !== false ? ago(r.since) : '';
      action.classList.toggle('armed', button.armed);
      action.classList.toggle('stop', store.gateNext(cfg.id) === 'stop');
      label.textContent = button.label(true);
    }
    return { el, cfg, kind: 'gate', update };
  }

  // Organizar: the order of each group, and what is shown. One step up or down at a time,
  // an eye to hide or show; nothing is removed from the home.
  function organizeSheet() {
    const body = h('div.organize');
    const changed = () => {
      saveArrangement(config.name, arr);
      renderScenes();
      renderRooms();
      layoutTiles();
      const top = sheet.scrollTop;
      draw();
      sheet.scrollTop = top;
    };
    const rowFor = (group, items, item, label, sub) => {
      const hidden = arr.hidden.has(item.id);
      const list = ordered(items, arr, group);
      const i = list.findIndex((x) => x.id === item.id);
      return h(`div.org-row${hidden ? '.hidden-item' : ''}`,
        h('button.org-eye', { 'aria-label': hidden ? `Mostrar ${label}` : `Esconder ${label}`, title: hidden ? 'Mostrar' : 'Esconder',
          onclick: () => { if (hidden) arr.hidden.delete(item.id); else arr.hidden.add(item.id); haptic('light'); changed(); } },
        icon(hidden ? 'eyeOff' : 'eye', 15)),
        h('div.org-text', h('div.org-name', label), sub ? h('div.org-sub', sub) : null),
        h('button.org-move', { 'aria-label': `Subir ${label}`, disabled: i === 0, onclick: () => { move(arr, group, items, item.id, -1); haptic('tick'); changed(); } }, icon('up', 14, 2.2)),
        h('button.org-move', { 'aria-label': `Descer ${label}`, disabled: i === list.length - 1, onclick: () => { move(arr, group, items, item.id, 1); haptic('tick'); changed(); } }, icon('downArrow', 14, 2.2)));
    };
    const group = (title, key, items, label = (x) => x.name, sub = () => null) => (items.length
      ? [h('div.org-title', title), ...ordered(items, arr, key).map((x) => rowFor(key, items, x, label(x), sub(x)))] : []);
    const KIND_NAME = { ac: 'Ar-condicionado', tv: 'TV', light: 'Luz', camera: 'Câmera' };
    // How the room chips read: names, icons, or both.
    const chipStyle = h('div.org-seg', [['name', 'Nome'], ['icon', 'Ícone'], ['both', 'Ícone e nome']].map(([v, label]) =>
      h(`button${arr.chips === v ? '.on' : ''}`, { onclick: () => { arr.chips = v; haptic('light'); changed(); } }, label)));
    // Where the room chips sit: above the list, or as a menu at the foot of the panel.
    const roomsAt = h('div.org-seg', [['top', 'Acima da lista'], ['bottom', 'Menu inferior']].map(([v, label]) =>
      h(`button${arr.roomsAt === v ? '.on' : ''}`, { onclick: () => { arr.roomsAt = v; haptic('light'); changed(); } }, label)));
    // The power button at the top: the room in view or always the whole home; and whether it asks first.
    const powerScopeSeg = h('div.org-seg', [['room', 'Cômodo em vista'], ['home', 'Sempre a casa toda']].map(([v, label]) =>
      h('button', { onclick: () => { arr.powerScope = v; haptic('light'); changed(); update(); } }, label)));
    const homeOwnSeg = h('div.org-seg', [[false, 'Iguais aos cômodos'], [true, 'Organização própria']].map(([v, label]) =>
      h('button', { onclick: () => { setHomeOwn(v); changed(); } }, label)));
    const powerConfirmSeg = h('div.org-seg', [[true, 'Pedir confirmação'], [false, 'Sem confirmação']].map(([v, label]) =>
      h('button', { onclick: () => { arr.powerConfirm = v; haptic('light'); changed(); } }, label)));
    function draw() {
      chipStyle.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['name', 'icon', 'both'][i] === arr.chips));
      roomsAt.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['top', 'bottom'][i] === arr.roomsAt));
      powerScopeSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['room', 'home'][i] === arr.powerScope));
      powerConfirmSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', [true, false][i] === arr.powerConfirm));
      homeOwnSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', [false, true][i] === arr.homeOwn));
      body.replaceChildren(
        h('div.org-title', 'Fileira de cômodos'), chipStyle,
        h('div.org-title', 'Posição dos cômodos'), roomsAt,
        h('div.org-title', 'Botão de energia (no topo)'), powerScopeSeg, powerConfirmSeg,
        h('div.org-title', 'Cartões da tela inicial'), homeOwnSeg,
        ...group('Atalhos', 'shortcuts', config.shortcuts),
        ...group('Cômodos', 'rooms', withDevices),
        ...group(config.gates.length > 1 ? 'Portões' : 'Portão', 'gates', config.gates),
        ...visible(withDevices, arr, 'rooms').flatMap((tab) => {
          const list = tabDevices(tab.id).filter((t) => t.kind !== 'gate');
          const kindOf = new Map(list.map((t) => [t.cfg.id, t.kind]));
          return group(`Dispositivos · ${tab.name}`, `room:${tab.id}`, list.map((t) => t.cfg), (x) => x.name, (x) => KIND_NAME[kindOf.get(x.id)]);
        }),
        ...group('Automações', 'toggles', config.toggles));
    }
    draw();
    return {
      nodes: [
        sheetHead('Organizar o painel', h('div.sheet-sub', `Ordem e o que aparece, só neste ${isTablet ? 'aparelho' : 'Mac'}`), null),
        body,
        h('div.org-foot',
          h('button.pill.org-btn', { onclick: () => { arr = loadArrangement('\u0000padrão'); changed(); } }, icon('rotate', 13), 'Restaurar o padrão'),
          h('button.pill.org-btn.org-done', { onclick: closeSheet }, icon('check', 13, 2.4), 'Pronto')),
      ],
      update() {},
    };
  }

  const clock = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Informação: for each device of a room, its state and since when, and the time before
  // (how long a lamp stayed on, when the gate was last open). Only the last change of each.
  const STATE_WORD = {
    light: { on: 'Acesa', off: 'Apagada' }, ac: { on: 'Ligado', off: 'Desligado' }, tv: { on: 'Ligada', off: 'Desligada' },
    gate: { open: 'Aberto', closed: 'Fechado', opening: 'Abrindo', closing: 'Fechando' }, toggle: { on: 'Ligada', off: 'Desligada' },
  };
  const ACTIVE = { on: true, open: true };
  const KIND_TITLE = { light: 'Luz', ac: 'Ar-condicionado', tv: 'TV', gate: 'Portão' };
  function infoSheet(tabId) {
    const list = h('div.info-list');
    function row(t) {
      const words = t.kind === 'tv' && masculine(t.cfg) ? { on: 'Ligado', off: 'Desligado' } : STATE_WORD[t.kind];
      const r = seen.get(t.cfg.id);
      const now = Date.now();
      let main = 'Sem informação ainda';
      let sub = null;
      if (r) {
        main = `${words[r.raw] || words[r.phase]} ${ago(r.since, now)}`;
        sub = `desde ${when(r.since, now)}`;
        const p = r.prev;
        if (p) {
          const lower = (words[p.phase] || '').toLowerCase();
          const range = `${when(p.since, now)} – ${when(p.until, now)}`;
          sub += ACTIVE[p.phase]
            ? ` · última vez ${lower}: por ${span(p.until - p.since)} (${range})`
            : ` · antes ${lower} por ${span(p.until - p.since)}`;
        }
      }
      const active = r && ACTIVE[r.phase];
      return h(`div.info-row${active ? '.active' : ''}`,
        h('div.info-name', h('span.info-kind', KIND_TITLE[t.kind] || ''), t.cfg.name),
        h('div.info-main', main), sub ? h('div.info-sub', sub) : null);
    }
    const draw = () => {
      const items = tabDevices(tabId).filter((t) => !arr.hidden.has(t.cfg.id));
      list.replaceChildren(...(items.length ? items.map(row) : [h('div.info-sub', 'Nenhum aparelho neste cômodo.')]));
    };
    draw();
    const timer = setInterval(draw, 30000); // "há 5 min" keeps counting
    return {
      nodes: [
        sheetHead('Informação', h('div.sheet-sub', tabName.get(tabId) || ''), null),
        list,
        h('p.sheet-note', icon('clock', 18), 'Só a última mudança de cada aparelho, guardada neste aparelho. A hora do estado atual vem do Home Assistant.'),
      ],
      update: draw,
      close: () => clearInterval(timer),
    };
  }

  // The gate up close: what it is doing, since when, and the same two-press button, bigger.
  function gateSheet(id) {
    const cfg = store.gateCfg.get(id);
    const g = () => state.gates[id];
    const sub = h('div.sheet-sub');
    const badge = h('div.gate-badge');
    const status = h('div.gate-status');
    const since = h('div.gate-since');
    const bar = h('div.gate-bar', h('i'));
    const label = h('span');
    const button = gateButton(id, () => update());
    const main = h('button.gate-main', { onclick: () => button.press(main) }, label);
    const travelNote = () => {
      const t = store.gateTravel(id);
      return `${g().state === 'open' ? 'fecha' : 'abre'} em ~${Math.round(t.seconds)} s${t.measured ? ' (medido)' : t.mode === 'auto' ? ' (ainda sem medição)' : ''}`;
    };
    let shownIcon = null;
    function update() {
      const s = g();
      const want = s.state === 'closed' ? 'gate' : 'gateOpen';
      if (want !== shownIcon) { badge.replaceChildren(icon(want, 34, 1.7)); shownIcon = want; }
      badge.style.setProperty('--c', GATE_COLOR[s.state] || '#8b93a7');
      badge.classList.toggle('on', s.state !== 'closed');
      status.textContent = s.online === false ? 'Indisponível' : GATE_TEXT[s.state] || s.state;
      const pos = store.gatePosition(id);
      const next = store.gateNext(id);
      since.textContent = s.online === false ? 'O Home Assistant não está recebendo o estado do portão.'
        : s.motion ? 'Em movimento · um toque para parar'
          : s.state === 'stopped' ? `Parou no meio do caminho · o próximo toque ${next === 'open' ? 'abre' : 'fecha'}`
            : [s.since ? `${GATE_TEXT[s.state]} desde ${clock(s.since)}` : null, travelNote()].filter(Boolean).join(' · ');
      bar.firstChild.style.width = pct(pos);
      bar.dataset.label = `${pct(pos)} aberto`;
      main.classList.toggle('armed', button.armed);
      main.classList.toggle('stop', next === 'stop');
      label.textContent = button.label(false);
      sub.replaceChildren('Portão de correr · ', h('b', gateText(id)));
    }
    return {
      nodes: [
        sheetHead(cfg.name, sub, null),
        h('div.gate-card', badge, h('div', status, since)),
        bar,
        h('div.gate-actions', main),
        h('p.sheet-note', icon('shield', 18), 'Um botão, como o do controle: em movimento, um toque para; parado no meio, o próximo toque vai no sentido contrário. Para pôr o portão em movimento são dois toques: o primeiro arma o botão e o segundo, em até 3,5 segundos, confirma.'),
      ],
      update,
    };
  }

  function toggleTile(cfg) {
    const sub = h('div.tile-sub');
    const flip = () => { haptic('light'); store.setToggle(cfg.id, !state.toggles[cfg.id].on); };
    const el = h('div.tile.toggle', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: flip },
      h('div.bubble', icon(cfg.icon, 19)), h('div.tile-text', h('div.tile-name', cfg.name), sub), h('span.switch'));
    el.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); flip(); } });
    return {
      el, cfg, kind: 'toggle',
      update() {
        const t = state.toggles[cfg.id];
        el.classList.toggle('on', t.on);
        el.classList.toggle('offline', t.online === false);
        el.style.setProperty('--c', '#5fe08a');
        sub.textContent = t.online === false ? 'Indisponível' : t.on ? 'Ligada' : 'Desligada';
      },
    };
  }

  // A security camera: a thin card (half a lamp card's height) in the strip at the top of its
  // room, the camera in a filled badge (grey off, blue while its picture is on screen).
  function cameraTile(cfg) {
    const tag = h('div.tile-label');
    const sub = h('div.tile-sub');
    const go = () => toggleCamera(cfg.id);
    const el = h('div.tile.lamp.cam.thin', { role: 'button', tabindex: 0, 'aria-label': `Câmera ${cfg.name}`, onclick: go },
      h('div.tile-text', tag, h('div.tile-name', cfg.name), sub),
      // the camera in a filled round badge, like the air's and the TV's switch: grey off, blue on
      h('span.tile-dot.cam-icon', { 'aria-hidden': 'true' }, icon('cctvFilled', 20)),
      h('div.tile-level'));
    el.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); go(); } });
    return {
      el, cfg, kind: 'camera',
      update() {
        const on = camBox.shows(cfg.id);
        el.classList.toggle('on', on);
        sub.textContent = on ? 'Ao vivo' : '';
        // "Câmera" over the name unless given a tag of its own (a lamp may share the name)
        const label = (arr.showLabels && arr.labels[cfg.id]) || 'Câmera';
        tag.textContent = label;
        tag.hidden = false;
        el.setAttribute('aria-pressed', String(on));
      },
    };
  }

  const TV_BLUE = '#6fa8ff';
  // A TV is "ligada" / "desligada"; a monitor or a streaming box (Apple TV), "ligado" / "desligado".
  const masculine = (cfg) => Boolean(cfg?.mount);
  const tvStatus = (t, cfg) => (t.online === false ? 'Indisponível' : !t.on ? (masculine(cfg) ? 'Desligado' : 'Desligada')
    : t.title || t.app || t.source || (t.state === 'playing' ? 'Reproduzindo' : t.state === 'paused' ? (masculine(cfg) ? 'Pausado' : 'Pausada') : masculine(cfg) ? 'Ligado' : 'Ligada'));

  function tvTile(cfg) {
    const sub = h('div.tile-sub');
    const power = h('button.mini-power', { 'aria-label': `Ligar ou desligar ${cfg.name}`, onclick: (e) => {
      e.stopPropagation(); haptic('medium'); store.setTV(cfg.id, { on: !state.tvs[cfg.id].on });
    } }, icon('power', 16, 2.2));
    // What is on, as its logo over the screen: a known app or system, else Home Assistant's picture.
    const bubble = h('div.bubble.logo.card-logo', { hidden: true }); // shown once there is something on
    const el = h('div.tile.tv.card', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: () => openSheet({ kind: 'tv', id: cfg.id }) },
      // the TV's own photos, or another device's (img/appletv-off/-on.jpg for the Apple TV)
      scene(cfg.picture === 'tv' ? 'tv' : `tv.${cfg.picture}`, `./img/${cfg.picture}-off.jpg`, `./img/${cfg.picture}-on.jpg`),
      h('div.card-head', h('div.tile-text', h('div.tile-name', cfg.name), sub), power),
      h('div.card-foot', bubble));
    let shown = '';
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openSheet({ kind: 'tv', id: cfg.id }); });
    return {
      el, cfg, kind: 'tv',
      update() {
        const t = state.tvs[cfg.id];
        el.classList.toggle('on', t.on);
        el.classList.toggle('offline', t.online === false);
        el.style.setProperty('--c', TV_BLUE);
        sub.textContent = tvStatus(t, cfg);
        // a known app or system's logo, else Home Assistant's picture, else (a TV channel, an
        // input without a logo) the TV symbol: never an empty corner while it is on
        const brand = brandOf(t);
        const want = brand ? `brand:${brand.id}` : t.on && t.picture ? `pic:${t.picture}` : t.on ? 'tv' : '';
        if (want !== shown) {
          shown = want;
          bubble.hidden = !want;
          if (brand) bubble.replaceChildren(brandLogo(brand));
          else if (want === 'tv') bubble.replaceChildren(brandLogo(TV_MARK));
          else if (want) {
            const img = h('img.bubble-art', { alt: '', src: t.picture });
            img.addEventListener('error', () => { shown = 'tv'; bubble.replaceChildren(brandLogo(TV_MARK)); });
            bubble.replaceChildren(img);
          } else bubble.replaceChildren();
        }
      },
    };
  }

  function tvSheet(id) {
    const cfg = store.tvCfg.get(id);
    const t = () => state.tvs[id];
    const set = (patch) => store.setTV(id, patch);
    const sub = h('div.sheet-sub');
    const powerBtn = h('button.round.power', { 'aria-label': 'Ligar ou desligar', onclick: () => { haptic('medium'); set({ on: !t().on }); } }, icon('power', 21, 2.2));
    const big = bigNumber('%');
    const slider = createSlider({
      min: 0, max: 100, value: Math.round(t().volume * 100), gradient: 'linear-gradient(90deg, #26365e 0%, #6fa8ff 100%)', detent: 5,
      onInput: (v) => set({ volume: v / 100, muted: false }),
    });
    const mute = h('button.toggle-chip', { onclick: () => { haptic('light'); set({ muted: !t().muted }); } }, icon('dim', 17), 'Mudo', h('span.switch'));
    const sourceValue = h('div.option-value');
    const source = h('button.option', { onclick: () => {
      const list = t().sources || [];
      if (!list.length) return;
      source.classList.add('open');
      openMenu(clip, source, list.map((v) => ({
        label: v, selected: t().source === v, icon: t().source === v ? icon('check', 16, 2.4) : null,
        action: () => { haptic('light'); set({ source: v }); },
      })), { onClose: () => source.classList.remove('open') });
    } }, icon('list', 24, 1.6), h('span.corner', icon('down', 15, 2.2)), h('div.option-label', 'Entrada'), sourceValue);
    const control = (name, action, label) => h('button.option', { 'aria-label': label, onclick: () => { haptic('light'); store.tvAction(id, action); } },
      icon(name, 24, 1.6), h('div.option-label', label));
    const playback = { previous: control('back', 'previous', 'Anterior'), play: control('film', 'play_pause', 'Tocar/pausar'), next: control('next', 'next', 'Próxima') };
    const options = h('div.options', source, playback.previous, playback.play, playback.next);
    const readout = h('div.readout', big.el, mute);
    // What is on: the picture Home Assistant has (an app icon or a poster), title, artist, app.
    const art = h('img.np-art', { alt: '' });
    art.addEventListener('error', () => { art.hidden = true; art.dataset.bad = art.dataset.src; });
    const artBrand = h('div.np-art.np-brand');
    artBrand.hidden = true;
    const npTitle = h('div.np-title');
    const npSub = h('div.np-sub');
    const npState = h('span.np-state');
    const nowPlaying = h('div.now-playing', art, artBrand, h('div.np-text', h('div.np-label', 'Reproduzindo agora', npState), npTitle, npSub));
    const volumeRow = h('div.slider-row',
      h('button.round', { 'aria-label': 'Menos volume', onclick: () => { haptic('tick'); store.tvAction(id, 'volume_down'); set({ volume: Math.max(0, t().volume - 0.01) }); } }, icon('minus', 18, 2.2)),
      slider.el,
      h('button.round', { 'aria-label': 'Mais volume', onclick: () => { haptic('tick'); store.tvAction(id, 'volume_up'); set({ volume: Math.min(1, t().volume + 0.01) }); } }, icon('plus', 18, 2.2)));
    return {
      nodes: [
        sheetHead(cfg.name, sub, powerBtn),
        nowPlaying,
        readout,
        volumeRow,
        options,
      ],
      update() {
        const tv = t();
        powerBtn.classList.toggle('on', tv.on);
        sub.replaceChildren(roomName.get(cfg.room), ' · ', h('b', tvStatus(tv, cfg)));
        big.set(Math.round(tv.volume * 100), !tv.on || tv.muted);
        slider.set(Math.round(tv.volume * 100));
        mute.classList.toggle('on', Boolean(tv.muted));
        sourceValue.textContent = tv.source || '—';
        const title = tv.title || tv.app || tv.source;
        nowPlaying.hidden = !tv.on || !title;
        npTitle.textContent = title || '';
        npSub.textContent = [tv.series, tv.artist, tv.title && tv.app, tv.source !== tv.app && tv.source !== title ? tv.source : null]
          .filter(Boolean).join(' · ');
        npSub.hidden = !npSub.textContent;
        npState.textContent = tv.state === 'playing' ? 'tocando' : tv.state === 'paused' ? 'pausado' : '';
        // A known app or system shows its own logo; anything else, Home Assistant's picture.
        // No logo and no picture (a TV channel, an input): the TV symbol.
        const picOk = Boolean(tv.picture) && art.dataset.bad !== tv.picture;
        const brand = brandOf(tv) || (picOk ? null : TV_MARK);
        if (brand && artBrand.dataset.id !== brand.id) { artBrand.dataset.id = brand.id; artBrand.replaceChildren(brandLogo(brand)); }
        artBrand.hidden = !brand;
        if (brand) art.hidden = true;
        else {
          if (art.dataset.src !== tv.picture) { art.dataset.src = tv.picture; art.src = tv.picture; }
          art.hidden = false;
        }
        // A real TV only shows the controls Home Assistant says it has.
        const has = (name) => !tv.controls || tv.controls.includes(name);
        source.hidden = !has('source') || !(tv.sources || []).length;
        for (const [name, el] of Object.entries(playback)) el.hidden = !has(name);
        options.style.gridTemplateColumns = `repeat(${[source, ...Object.values(playback)].filter((el) => !el.hidden).length || 1}, 1fr)`;
        options.hidden = [source, ...Object.values(playback)].every((el) => el.hidden);
        volumeRow.hidden = !has('volume') && !has('step');
        slider.el.style.visibility = has('volume') ? '' : 'hidden';
        big.el.style.visibility = has('volume') ? '' : 'hidden';
        mute.hidden = !has('mute');
        readout.hidden = !has('volume') && !has('mute');
      },
    };
  }

  for (const cfg of config.acs) tiles.set(cfg.id, acTile(cfg));
  for (const cfg of config.tvs) tiles.set(cfg.id, tvTile(cfg));
  for (const cfg of config.lights) tiles.set(cfg.id, lightTile(cfg));
  // cameras only where they can play (the apps and the Home Assistant edition), in the strip
  const camTiles = cameraAccess?.available ? (config.cameras || []).map(cameraTile) : [];
  function renderCamStrip() {
    const ids = new Set(camerasOf(ui.room).map((c) => c.id));
    const list = camTiles.filter((t) => ids.has(t.cfg.id));
    camStrip.replaceChildren(...list.map((t) => t.el));
    camStrip.hidden = !list.length;
  }
  // Not in a room: shown above (the gate) and below (automations) the rooms, on "All" only.
  const gateTiles = config.gates.map(gateTile);
  const toggleTiles = config.toggles.map(toggleTile);

  function toggleLight(id) {
    if (ui.editing) { nudge(); return; }
    haptic('light');
    world?.lights.get(id)?.bump();
    store.toggleLight(id);
  }

  // A room's tiles: ACs, TVs, then lights, unless rearranged.
  const KIND_ORDER = { ac: 0, tv: 1, light: 2, camera: 3 };
  function roomDevices(roomId) {
    const all = [...tiles.values()].filter((t) => t.cfg.room === roomId).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const byId = new Map(all.map((t) => [t.cfg.id, t]));
    return ordered(all.map((t) => t.cfg), arr, `room:${roomId}`).map((c) => byId.get(c.id));
  }
  /** A tab's cards: its gates and devices, then those of the rooms merged into it, in one order. */
  function tabDevices(tabId) {
    const list = membersOf(tabId).flatMap((r) => [...gateTiles.filter((t) => t.cfg.room === r.id), ...roomDevices(r.id)]);
    return inOrder(list, `room:${tabId}`);
  }

  /* ---------- Editar: cards moved, resized, flipped and tagged ---------- */

  // A card's size on a grid of four columns (rows are a third of a column on the Mac, half
  // on a phone, so a small card is square): small (one column), wide (two, a strip), big
  // (two, square), full (the whole row).
  const SIZES = {
    light: ['small', 'wide', 'big', 'full'], camera: ['small', 'wide', 'big', 'full'], ac: ['wide', 'big'], tv: ['wide', 'big'], gate: ['wide', 'medium', 'big', 'full'], toggle: ['wide', 'full'],
  };
  const DEFAULT_SIZE = { light: 'wide', camera: 'wide', ac: 'big', tv: 'big', gate: 'big', toggle: 'full' };
  const SIZE_NAME = { small: 'Pequeno', wide: 'Largo', big: 'Grande', full: 'Faixa' };
  // The gate: a strip without the picture, a medium card (the picture beside the name), the
  // square, and the square stretched sideways (four columns, as tall as the square).
  const GATE_SIZE_NAME = { wide: 'Faixa', medium: 'Médio', big: 'Quadrado', full: 'Comprido' };
  const sizeName = (kind, s) => (kind === 'gate' ? GATE_SIZE_NAME[s] : SIZE_NAME[s]);
  const SIZE_COLS = { small: 1, wide: 2, medium: 2, big: 2, full: 4 };
  const LABEL_IDEAS = ['LED', 'Luz central', 'Spots', 'Cortina', 'Pendente', 'Abajur', 'Externa'];
  const allTiles = () => [...tiles.values(), ...gateTiles, ...toggleTiles];
  const tileById = (id) => allTiles().find((t) => t.cfg.id === id);
  // The start page with its own layout (an option): its own order groups, sizes and sides.
  const homeLayout = () => arr.homeOwn && ui.room === 'all';
  // And the start page sideways (tablet lying down, no map) keeps a layout of its own too:
  // order ("side:" groups), sizes and sides, apart from the start page with the map.
  const sideLayout = () => sideways();
  const gkey = (group) => (sideLayout() ? `side:${group}` : homeLayout() ? `home:${group}` : group);
  const sizesNow = () => (sideLayout() ? arr.sideSizes : homeLayout() ? arr.homeSizes : arr.sizes);
  const flipNow = () => (sideLayout() ? arr.sideFlip : homeLayout() ? arr.homeFlip : arr.flip);
  /** The first time sideways: it starts as the start page was (its own layout, or the rooms'). */
  function seedSide() {
    if (arr.sideSeeded) return;
    const own = arr.homeOwn;
    for (const [k, ids] of Object.entries(arr.order)) {
      if (k.startsWith('side:')) continue;
      if (own ? k.startsWith('home:') : !k.startsWith('home:')) arr.order[`side:${own ? k.slice(5) : k}`] = [...ids];
    }
    arr.sideSizes = { ...(own ? arr.homeSizes : arr.sizes) };
    arr.sideFlip = new Set(own ? arr.homeFlip : arr.flip);
    arr.sideSeeded = true;
    saveArr();
  }
  const sizeOf = (t) => (SIZES[t.kind].includes(sizesNow()[t.cfg.id]) ? sizesNow()[t.cfg.id] : DEFAULT_SIZE[t.kind]);
  /** Turns the start page's own layout on (copied from the rooms the first time) or off. */
  function setHomeOwn(on) {
    arr.homeOwn = on;
    if (on && !arr.homeSeeded) {
      for (const [k, ids] of Object.entries(arr.order)) if (!k.startsWith('home:')) arr.order[`home:${k}`] = [...ids];
      arr.homeSizes = { ...arr.sizes };
      arr.homeFlip = new Set(arr.flip);
      arr.homeSeeded = true;
    }
    haptic('light');
    saveArr();
    layoutTiles(true);
    renderEditBar();
  }
  const inOrder = (list, group) => {
    const byId = new Map(list.map((t) => [t.cfg.id, t]));
    return ordered(list.map((t) => t.cfg), arr, group).map((c) => byId.get(c.id));
  };
  const saveArr = () => saveArrangement(config.name, arr);

  /** Puts a tile in the grid: its group (what it can be moved among), size and side. */
  function dress(t, group) {
    const el = t.el;
    el.dataset.id = t.cfg.id;
    el.dataset.group = group;
    el.dataset.size = sizeOf(t);
    el.classList.toggle('flipped', flipNow().has(t.cfg.id));
    el.classList.toggle('selected', ui.editSel === t.cfg.id);
    if (!el.querySelector(':scope > .edit-handle')) {
      el.append(h('span.edit-handle.edit-ui', { 'aria-hidden': 'true' }),
        h('button.edit-eye.edit-ui', { 'aria-label': `Ocultar ou mostrar ${t.cfg.name}`, onclick: (e) => { e.stopPropagation(); toggleHidden(t); } }));
      if (t.kind === 'light' || t.kind === 'camera') {
        el.append(h('button.edit-flip.edit-ui', { title: 'Trocar de lado', 'aria-label': `Trocar ${t.cfg.name} de lado`,
          onclick: (e) => { e.stopPropagation(); flipTile(t); } }, icon('swap', 12, 2.2)));
      }
    }
  }

  // The eye: in Todos it hides a card from the start page only; in a room, everywhere.
  function toggleHidden(t) {
    const id = t.cfg.id;
    const off = arr.hidden.has(id) || (ui.room === 'all' && arr.hiddenHome.has(id));
    if (off) { arr.hidden.delete(id); arr.hiddenHome.delete(id); } else (ui.room === 'all' ? arr.hiddenHome : arr.hidden).add(id);
    haptic('light');
    saveArr();
    layoutTiles(true);
  }
  function toggleRoomHome(roomId) {
    if (arr.hiddenHomeRooms.has(roomId)) arr.hiddenHomeRooms.delete(roomId); else arr.hiddenHomeRooms.add(roomId);
    haptic('light');
    saveArr();
    layoutTiles(true);
  }

  function setSize(t, size) {
    const sizes = sizesNow();
    if (size === DEFAULT_SIZE[t.kind]) delete sizes[t.cfg.id];
    else sizes[t.cfg.id] = size;
    t.el.dataset.size = size;
    saveArr();
  }

  function flipTile(t) {
    const flip = flipNow();
    if (flip.has(t.cfg.id)) flip.delete(t.cfg.id); else flip.add(t.cfg.id);
    t.el.classList.toggle('flipped', flip.has(t.cfg.id));
    haptic('light');
    saveArr();
    renderEditBar();
  }

  function setEditing(on) {
    ui.editing = on;
    ui.editSel = null;
    panel.classList.toggle('editing', on);
    card.classList.toggle('editing', on);
    for (const t of allTiles()) t.el.classList.remove('selected');
    haptic(on ? 'medium' : 'light');
    renderEditBar();
    layoutTiles(true);
  }

  function select(id) {
    ui.editSel = ui.editSel === id ? null : id;
    for (const t of allTiles()) t.el.classList.toggle('selected', t.cfg.id === ui.editSel);
    renderEditBar();
  }

  // Over the list while editing: how it works, or the chosen card's size, side and tag.
  function renderEditBar() {
    editBar.hidden = !ui.editing;
    if (!ui.editing) { editBar.replaceChildren(); return; }
    const done = h('button.pill.edit-done', { onclick: () => setEditing(false) }, icon('check', 13, 2.4), 'Concluir');
    const t = ui.editSel && tileById(ui.editSel);
    if (!t) {
      const labels = h('input', { type: 'checkbox' });
      labels.checked = arr.showLabels;
      labels.addEventListener('change', () => { arr.showLabels = labels.checked; saveArr(); for (const x of tiles.values()) x.update(); });
      const own = h('input', { type: 'checkbox' });
      own.checked = arr.homeOwn;
      own.addEventListener('change', () => setHomeOwn(own.checked));
      const ownNote = laidSideways
        ? 'Tela deitada sem o mapa: ordem e tamanhos próprios deste modo; a tela com o mapa e os cômodos não mudam.'
        : ui.room === 'all'
        ? (arr.homeOwn ? 'Mexendo na organização da tela inicial; os cômodos não mudam.' : 'Mexendo aqui, os cômodos mudam junto.')
        : (arr.homeOwn ? 'Mexendo neste cômodo; a tela inicial tem a sua.' : 'Mexendo neste cômodo, a tela inicial muda junto.');
      // This room opening with a camera on, and which one (only where there are cameras).
      const cams = ui.room !== 'all' && camsHere ? camerasOf(ui.room) : [];
      const pickCam = (id) => {
        if (id) arr.autoCam[ui.room] = id; else delete arr.autoCam[ui.room];
        haptic('tick');
        saveArr();
        renderEditBar();
      };
      const chosen = cams.some((c) => c.id === arr.autoCam[ui.room]) ? arr.autoCam[ui.room] : null;
      const autoRow = cams.length ? h('div.edit-autocam',
        h('div.edit-check', icon('cctv', 13), h('span', 'Abrir este cômodo com a câmera')),
        h('div.org-seg.edit-sizes', [[null, 'Não'], ...cams.map((c) => [c.id, c.name])].map(([id, label]) =>
          h(`button${id === chosen ? '.on' : ''}`, { onclick: () => pickCam(id) }, label)))) : null;
      editBar.replaceChildren(
        h('div.edit-row', h('div.edit-hint', laidSideways
          ? 'Arraste para mover. Puxe o canto para mudar o tamanho. Tela deitada sem o mapa: embaixo do título de cada cômodo, escolha a largura e se ele fica ao lado ou embaixo do anterior.'
          : 'Arraste para mover. Puxe o canto para mudar o tamanho. Toque para mais opções.'), done),
        h('label.edit-check', labels, 'Mostrar as etiquetas das luzes'),
        laidSideways
          ? h('div.edit-check', icon('layout', 13), h('span.edit-check-note', ownNote))
          : h('label.edit-check', own, 'Tela inicial com organização própria', h('span.edit-check-note', ` · ${ownNote}`)),
        autoRow);
      return;
    }
    const size = sizeOf(t);
    const sizes = h('div.org-seg.edit-sizes', SIZES[t.kind].map((s) => h(`button${s === size ? '.on' : ''}`,
      { onclick: () => { setSize(t, s); haptic('tick'); renderEditBar(); } }, sizeName(t.kind, s))));
    const rows = [h('div.edit-row', h('div.edit-name', t.cfg.name), h('button.pill', { onclick: () => select(t.cfg.id) }, 'Ok'), done), sizes];
    if (t.kind === 'light' || t.kind === 'camera') {
      const input = h('input.edit-input', { type: 'text', maxlength: 18, placeholder: 'Etiqueta (opcional): LED, Cortina…', value: arr.labels[t.cfg.id] || '' });
      const setLabel = (v) => {
        v = v.trim();
        if (v) arr.labels[t.cfg.id] = v; else delete arr.labels[t.cfg.id];
        saveArr();
        t.update();
      };
      input.addEventListener('input', () => setLabel(input.value));
      input.addEventListener('keydown', (e) => e.stopPropagation());
      rows.push(
        h('div.edit-row',
          input,
          h('button.pill.edit-swap', { onclick: () => flipTile(t), title: 'Trocar o anel de lado' }, icon('swap', 13, 2.2), 'Lado')),
        h('div.edit-ideas', LABEL_IDEAS.map((idea) => h('button.pill', { onclick: () => { input.value = idea; setLabel(idea); } }, idea)),
          h('button.pill', { onclick: () => { input.value = ''; setLabel(''); } }, 'Nenhuma')));
    }
    editBar.replaceChildren(...rows);
  }

  // While editing, the tiles stop being switches: a press drags, the corner resizes, a tap picks.
  const gridMetrics = (el) => {
    const cs = getComputedStyle(el?.parentElement || grid);
    const col = parseFloat(cs.gridTemplateColumns);
    const row = parseFloat(cs.gridAutoRows);
    const gap = parseFloat(cs.columnGap) || 8;
    return { col, row, gap };
  };
  grid.addEventListener('click', (ev) => {
    if (!ui.editing) return;
    if (ev.target.closest('.edit-flip, .edit-eye, .sec-tools')) return;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
  grid.addEventListener('pointerdown', (ev) => {
    if (!ui.editing || ev.button !== 0) return;
    const el = ev.target.closest('.tile');
    if (!el || ev.target.closest('.edit-flip, .edit-eye')) return;
    ev.stopPropagation();
    ev.preventDefault();
    const t = tileById(el.dataset.id);
    if (!t) return;
    el.setPointerCapture(ev.pointerId);
    const start = { x: ev.clientX, y: ev.clientY };
    const resizing = Boolean(ev.target.closest('.edit-handle'));
    const rect0 = el.getBoundingClientRect();
    let moved = false;
    let tx = 0;
    let ty = 0;
    const onMove = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      if (resizing) {
        // the size nearest the corner's place, among the ones this kind of card has
        const { col, row, gap } = gridMetrics(el);
        const cols = (e.clientX - rect0.left + gap) / (col + gap);
        const rows = (e.clientY - rect0.top + gap) / (row + gap);
        const rowsOf = (s) => parseFloat(getComputedStyle(grid).getPropertyValue(`--rows-${s}`)) || 2;
        let best = sizeOf(t);
        let bestD = Infinity;
        for (const s of SIZES[t.kind]) {
          const d = (cols - SIZE_COLS[s]) ** 2 + ((rows - rowsOf(s)) / 3) ** 2;
          if (d < bestD) { bestD = d; best = s; }
        }
        if (el.dataset.size !== best) { el.dataset.size = best; haptic('tick'); }
        return;
      }
      el.classList.add('dragging');
      // where the card would sit, in reading order among its group: before the first card that
      // starts below the pointer, or on the pointer's row to its right; past them all, at the end
      // (so it can go under a full row, not only swap with the card beside it)
      const peers = [...grid.querySelectorAll(`.tile[data-group="${CSS.escape(el.dataset.group)}"]`)].filter((x) => x !== el);
      let before = null;
      for (const p of peers) {
        const r = p.getBoundingClientRect();
        const onRow = e.clientY >= r.top && e.clientY <= r.bottom;
        if (e.clientY < r.top || (onRow && e.clientX < r.left + r.width / 2)) { before = p; break; }
      }
      const nextPeer = peers.find((p) => el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
      if (before !== nextPeer) {
        if (before) before.before(el);
        else peers[peers.length - 1]?.after(el);
        haptic('tick');
      }
      // the card follows the pointer from wherever the grid has put it now
      el.style.transform = '';
      const base = el.getBoundingClientRect();
      tx = e.clientX - (start.x - rect0.left) - base.left;
      ty = e.clientY - (start.y - rect0.top) - base.top;
      el.style.transform = `translate(${tx}px, ${ty}px) scale(1.03)`;
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      el.style.transform = '';
      if (!moved) { select(t.cfg.id); return; }
      if (resizing) { setSize(t, el.dataset.size); renderEditBar(); return; }
      const group = el.dataset.group;
      const ids = [...grid.querySelectorAll(`.tile[data-group="${CSS.escape(group)}"]`)].map((x) => x.dataset.id);
      arr.order[group] = [...ids, ...(arr.order[group] || []).filter((id) => !ids.includes(id))];
      saveArr();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }, true);

  function toggleMap() {
    haptic('light');
    arr.mapHidden = !arr.mapHidden;
    saveArr();
    update();
    if (sideways() !== laidSideways) layoutTiles();
  }

  /* ---------- the start page sideways (tablet lying down, without the map) ----------
     The sections sit side by side and the page scrolls to the right: each section a grid of
     its own, as wide as its cards need up to a maximum (6 columns, 8 for a section with many
     cards; chosen per section while editing). */
  const sideways = () => isTablet && arr.mapHidden && ui.room === 'all' && innerWidth > innerHeight && !camBox.isOpen;
  let laidSideways = false;
  const SECTION_WIDTHS = [4, 5, 6, 7, 8, 10];
  const UNITS = { small: 1, wide: 2, medium: 2, big: 2, full: 4 };
  function sectionsOf(nodes) {
    const out = [];
    const rest = [];
    let cur = null;
    for (const n of nodes) {
      if (n.classList?.contains('group-label')) { cur = { label: n, tiles: [] }; out.push(cur); }
      else if (n.classList?.contains('tile') && cur) cur.tiles.push(n);
      else rest.push(n);
    }
    return { sections: out.filter((x) => x.tiles.length), rest };
  }
  function sideSection({ label, tiles }, index) {
    const key = tiles[0].dataset.group.replace(/^(home|side):/, '');
    const units = tiles.reduce((sum, t) => sum + (t.classList.contains('gate') && t.dataset.size === 'full' ? 4 : UNITS[t.dataset.size] || 2), 0);
    const max = arr.secCols?.[key] || (units > 12 ? 8 : 6);
    const cols = Math.max(Math.min(max, units), 2);
    const below = Boolean(arr.secBelow?.[key]) && index > 0;
    const set = (field, value) => (e) => {
      e.stopPropagation();
      arr[field] = { ...(arr[field] || {}), [key]: value };
      if (value === false) delete arr[field][key];
      haptic('tick');
      saveArr();
      layoutTiles(true);
    };
    // editing: under the title, the section's width (columns of cards) and where it goes:
    // beside the one before, or below it (two rooms in the height)
    const tools = ui.editing ? h('div.sec-tools.edit-ui',
      h('span.sec-seg', h('span.sec-seg-name', 'Largura'), ...SECTION_WIDTHS.map((w) =>
        h(`button${w === max ? '.on' : ''}`, { onclick: set('secCols', w) }, String(w)))),
      index > 0 ? h('span.sec-seg', h('span.sec-seg-name', 'Posição'),
        h(`button${!below ? '.on' : ''}`, { onclick: set('secBelow', false) }, 'Ao lado'),
        h(`button${below ? '.on' : ''}`, { onclick: set('secBelow', true) }, 'Embaixo')) : null) : null;
    const el = h('section.hsec', label, tools, h('div.grid.hgrid', ...tiles));
    el.style.setProperty('--sec-cols', String(cols));
    return { el, below };
  }
  /** The sections in columns: one, or two when a section goes below the one before. */
  function sideColumns(sections) {
    const cols = [];
    sections.forEach((sec, i) => {
      const { el, below } = sideSection(sec, i);
      const last = cols[cols.length - 1];
      if (below && last && last.childElementCount === 1) last.append(el);
      else cols.push(h('div.hcol', el));
    });
    return cols;
  }
  // with a mouse: drag the empty space to scroll sideways; the wheel scrolls sideways too
  {
    const devices = grid.parentElement;
    let drag = null;
    devices.addEventListener('pointerdown', (ev) => {
      if (!laidSideways || ev.pointerType !== 'mouse' || ev.button !== 0 || ui.editing) return;
      if (ev.target.closest('.tile, button, input, a')) return;
      drag = { x: ev.clientX, left: devices.scrollLeft };
      devices.setPointerCapture(ev.pointerId);
      devices.classList.add('grabbing');
    });
    devices.addEventListener('pointermove', (ev) => { if (drag) devices.scrollLeft = drag.left - (ev.clientX - drag.x); });
    const end = () => { drag = null; devices.classList.remove('grabbing'); };
    devices.addEventListener('pointerup', end);
    devices.addEventListener('pointercancel', end);
    devices.addEventListener('wheel', (ev) => {
      if (!laidSideways || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
      if (devices.scrollHeight > devices.clientHeight + 4) return; // it scrolls down too: leave the wheel to that
      devices.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }, { passive: false });
    let wasSideways = null;
    window.addEventListener('resize', () => {
      const now = sideways();
      if (now !== wasSideways && wasSideways !== null && now !== laidSideways) layoutTiles(true);
      wasSideways = now;
    });
  }

  function layoutTiles(keepScroll = false) {
    if (sideways()) seedSide();
    const nodes = [];
    let i = 0;
    const home = ui.room === 'all';
    const editing = ui.editing;
    // Hidden: everywhere (Organizar, or the eye in a room) or only on the start page (the eye
    // in Todos). While editing, hidden cards stay in place, faded, so the eye can bring them back.
    const isOff = (t) => arr.hidden.has(t.cfg.id) || (home && arr.hiddenHome.has(t.cfg.id));
    const pick = (list) => (editing ? list : list.filter((t) => !isOff(t)));
    const add = (group, roomOff = false) => (t) => {
      t.el.style.setProperty('--i', i++);
      dress(t, gkey(group));
      const off = roomOff || isOff(t);
      t.el.classList.toggle('is-hidden', editing && off);
      const eye = t.el.querySelector(':scope > .edit-eye');
      eye.replaceChildren(icon(isOff(t) ? 'eyeOff' : 'eye', 13, 2));
      eye.title = isOff(t) ? 'Mostrar' : home ? 'Ocultar no início' : 'Ocultar';
      nodes.push(t.el);
    };
    const label = (text, roomId = null) => {
      const off = Boolean(roomId) && home && arr.hiddenHomeRooms.has(roomId);
      // on the start page, the room's name brings the model to that room (its saved view)
      // and stays on the start page; again, back to the whole home
      const peekable = Boolean(roomId) && home && !editing;
      return h(`div.group-label${off && editing ? '.is-hidden' : ''}${peekable ? '.peek' : ''}${peekable && ui.peek === roomId ? '.on' : ''}`, {
        'data-room': roomId || null,
        role: peekable ? 'button' : null, title: peekable ? `Ver ${text} na maquete` : null,
        onclick: peekable ? () => peekRoom(roomId) : null,
      }, h('span', text),
        roomId && home ? h('button.edit-eye.edit-ui', { title: off ? 'Mostrar no início' : 'Ocultar no início', 'aria-label': `${off ? 'Mostrar' : 'Ocultar'} ${text} no início`,
          onclick: (e) => { e.stopPropagation(); toggleRoomHome(roomId); } }, icon(off ? 'eyeOff' : 'eye', 13, 2)) : null);
    };
    // A gate is part of its room (the garage); one without a room on the plan keeps a group
    // of its own at the top.
    const loose = pick(inOrder(gateTiles.filter((t) => !roomName.has(t.cfg.room)), gkey('gates')));
    if (home && loose.length) {
      nodes.push(label(loose.length > 1 ? 'Portões' : 'Portão'));
      loose.forEach(add('gates'));
    }
    // One group per tab: rooms merged into another (Corredor and Quintal) share a heading,
    // "Corredor · Quintal", and their cards sit together, side by side.
    const tabList = home ? visible(withDevices, arr, 'rooms') : withDevices.filter((r) => r.id === ui.room);
    for (const tab of tabList) {
      const roomOff = home && arr.hiddenHomeRooms.has(tab.id);
      if (roomOff && !editing) continue;
      const devices = pick(inOrder(tabDevices(tab.id), gkey(`room:${tab.id}`)));
      if (!devices.length) continue;
      if (home) nodes.push(label(tab.name, tab.id));
      devices.forEach(add(`room:${tab.id}`, roomOff));
    }
    const shownToggles = pick(inOrder(toggleTiles, gkey('toggles')));
    if (home && shownToggles.length) {
      nodes.push(label('Automações'));
      shownToggles.forEach(add('toggles'));
    }
    // Below a room's cards: when each of its devices last changed.
    if (!home && !editing && nodes.length) {
      nodes.push(h('button.info-link', { onclick: () => openSheet({ kind: 'info', id: ui.room }) }, icon('info', 14), 'Informação'));
    }
    if (home && !isPhone && !editing) {
      nodes.push(h('button.organize-link', { onclick: () => openSheet({ kind: 'organize' }) }, icon('list', 14), 'Organizar o painel'));
    }
    if (!nodes.length && ui.room !== CAM_TAB) nodes.push(h('div.group-label', 'Nenhum dispositivo neste cômodo ainda'));
    else if (isTouch && config.lights.some((l) => l.capabilities.length && inScope(l))) {
      nodes.push(h('div.grid-hint', 'Toque e segure uma luz para brilho e cor'));
    }
    const scroller = grid.parentElement;
    const top = scroller.scrollTop;
    const left = scroller.scrollLeft;
    laidSideways = sideways();
    grid.classList.toggle('hrow', laidSideways);
    card.classList.toggle('sideways', laidSideways);
    if (laidSideways) {
      const { sections, rest } = sectionsOf(nodes);
      grid.replaceChildren(...sideColumns(sections), ...rest.filter((n) => n.classList?.contains('organize-link')));
    } else {
      grid.replaceChildren(...nodes);
    }
    scroller.scrollTop = keepScroll ? top : 0;
    scroller.scrollLeft = keepScroll && laidSideways ? left : 0;
    fitSideways();
  }

  // Sideways, nothing scrolls down: the cards' size comes from the height there is. The card
  // unit starts from the width (as everywhere on the tablet) and shrinks until the tallest
  // column (two rooms one above the other, say) fits.
  function fitSideways() {
    grid.style.removeProperty('--side-col');
    if (!laidSideways) return;
    const dev = grid.parentElement;
    const w = dev.clientWidth;
    const cols = w >= 1080 ? 10 : w >= 840 ? 8 : w >= 620 ? 6 : 4;
    let col = (w - (cols - 1) * 8) / cols;
    // what is really visible: down to the room tabs at the foot when they sit over the list
    const box = dev.getBoundingClientRect();
    const foot = arr.roomsAt === 'bottom' ? rooms.getBoundingClientRect().top : Infinity;
    const room = Math.min(box.bottom, foot) - box.top - 18;
    if (room <= 0) return;
    for (let i = 0; i < 8; i++) {
      grid.style.setProperty('--side-col', `${Math.floor(col)}px`);
      const need = Math.max(0, ...[...grid.querySelectorAll('.hcol')].map((c) => c.offsetHeight));
      if (need <= room) break;
      col = Math.max(56, col * (room / need) * 0.985);
    }
  }
  new ResizeObserver(() => { if (laidSideways) fitSideways(); }).observe(grid.parentElement);

  /* ---------- sheets ---------- */

  let sheetView = null;

  const cfgOf = (target) => ({ light: store.lightCfg, ac: store.acCfg, tv: store.tvCfg, gate: store.gateCfg })[target.kind]?.get(target.id);

  /** A device picked in the model: its room first, then its menu, so a stray click never
   *  switches anything; the menu's own button does. */
  function show(target) {
    const own = cfgOf(target)?.room;
    const room = own && tabOf(own);
    // A lamp needs no menu: its room's list stays below, and over the lamp a label with its
    // switch. Clicked again, the lamp itself switches.
    if (target.kind === 'light') {
      if (!ui.sheet && ui.pinned?.id === target.id) { toggleLight(target.id); return; }
      closeSheet();
      if (room && ui.room !== room) selectRoom(room);
      ui.pinned = target;
      world?.pin(target);
      update();
      return;
    }
    if (room && ui.room !== room) {
      ui.room = room;
      layoutTiles();
      showTab(room);
    }
    openSheet(target);
  }

  function unpin() {
    if (!ui.pinned) return false;
    ui.pinned = null;
    world?.pin(null);
    update();
    return true;
  }

  /** The floor of a room clicked: off a lamp's label first, otherwise into (or out of) the room. */
  function pickRoom(id) {
    if (ui.pinned && ui.room === tabOf(id)) { unpin(); return; }
    selectRoom(id);
  }

  function openSheet(target) {
    sheetView?.close?.();
    ui.pinned = null;
    ui.sheet = target;
    sheetView = target.kind === 'ac' ? acSheet(target.id) : target.kind === 'tv' ? tvSheet(target.id)
      : target.kind === 'gate' ? gateSheet(target.id) : target.kind === 'organize' ? organizeSheet()
        : target.kind === 'info' ? infoSheet(target.id) : lightSheet(target.id);
    sheet.replaceChildren(...sheetView.nodes);
    panel.classList.add('hidden');
    sheet.classList.remove('hidden');
    panel.inert = true;
    sheet.inert = false;
    card.classList.add('detail');
    hideTooltip();
    const room = target.kind === 'tv' ? store.tvCfg.get(target.id).room : target.kind === 'light' ? store.lightCfg.get(target.id).room : null;
    onFocus(['ac', 'tv', 'gate'].includes(target.kind) ? target : target.kind === 'organize' ? null
      : { kind: 'room', id: target.kind === 'info' ? target.id : tabOf(room) });
    update();
    world?.pin(pinnable(target) ? target : null);
  }

  function closeSheet() {
    if (!ui.sheet) return false;
    ui.sheet = null;
    sheetView?.close?.();
    sheetView = null;
    sheet.classList.add('hidden');
    panel.classList.remove('hidden');
    panel.inert = false;
    sheet.inert = true;
    card.classList.remove('detail');
    // the camera the gate brought up belongs to the gate's sheet: it leaves with it
    if (gateCamOn && camBox.isOpen) camBox.close();
    gateCamOn = false;
    onFocus(ui.room === 'all' ? null : { kind: 'room', id: ui.room });
    update();
    world?.pin(null);
    return true;
  }

  /** `beside`: the power button next to the name, for a lamp that only switches on and off. */
  function sheetHead(name, sub, powerBtn, { beside = false } = {}) {
    const title = h('div.sheet-title', h('div.sheet-name', name), sub);
    return h('div.sheet-head',
      h('button.round', { 'aria-label': 'Voltar', onclick: closeSheet }, icon('back', 19, 2.2)),
      ...(beside ? [powerBtn, title] : [title, powerBtn]));
  }

  function bigNumber(unit) {
    const num = h('span.num');
    const el = h('div.big', num, h('small', unit));
    let shown = null;
    return {
      el,
      set(value, off) {
        el.classList.toggle('off', off);
        if (value === shown) return;
        if (shown !== null) {
          num.classList.remove('tick-up', 'tick-down');
          void num.offsetWidth;
          num.classList.add(value > shown ? 'tick-up' : 'tick-down');
        }
        num.textContent = value;
        shown = value;
      },
    };
  }

  function acSheet(id) {
    const cfg = store.acCfg.get(id);
    const s = () => state.acs[id];
    const set = (patch) => store.setAC(id, patch);
    const sub = h('div.sheet-sub');
    const powerBtn = h('button.round.power', { 'aria-label': 'Ligar ou desligar', onclick: () => { haptic('medium'); set({ on: !s().on }); } }, icon('power', 21, 2.2));
    const big = bigNumber('°C');
    const eco = h('button.toggle-chip', { onclick: () => { haptic('light'); set({ eco: !s().eco }); } }, icon('leaf', 17), 'Modo econômico', h('span.switch'));
    const slider = createSlider({
      min: cfg.min, max: cfg.max, value: s().target, gradient: TEMP_GRADIENT,
      labels: [`${cfg.min}°`, `${cfg.max}°`],
      onInput: (v) => set({ on: true, target: v }),
    });

    const features = () => store.acFeatures(id);
    const option = (key, label, labels, values, iconName) => {
      const value = h('div.option-value');
      let holder = h('span');
      const el = h('button.option', { onclick: () => {
        el.classList.add('open');
        openMenu(clip, el, values().map((v) => ({
          label: labels[v], selected: s()[key] === v, icon: s()[key] === v ? icon('check', 16, 2.4) : null,
          action: () => { haptic('light'); set(key === 'mode' ? { on: true, mode: v } : { [key]: v }); },
        })), { onClose: () => el.classList.remove('open') });
      } }, holder, h('span.corner', icon('down', 15, 2.2)), h('div.option-label', label), value);
      let shown = null;
      return {
        el,
        update() {
          value.textContent = labels[s()[key]];
          const ic = iconName || s().mode;
          if (shown !== ic) {
            const next = icon(ic, 24, 1.6);
            holder.replaceWith(next);
            holder = next;
            shown = ic;
          }
        },
      };
    };

    const mode = option('mode', 'Modo', MODE_LABEL, () => features().modes, null);
    const fan = option('fan', 'Ventilação', FAN_LABEL, () => features().fans, 'fan');
    const swing = option('swing', 'Direção do ar', SWING_LABEL, () => features().swings || AC_SWINGS, 'wind');
    const sleepValue = h('div.option-value');
    const sleep = h('button.option', { onclick: () => { haptic('light'); set({ sleep: !s().sleep }); } },
      icon('moon', 24, 1.6), h('span.corner.dot'), h('div.option-label', 'Dormir'), sleepValue);
    const options = h('div.options', mode.el, fan.el, sleep, swing.el);

    return {
      nodes: [
        sheetHead(cfg.name, sub, powerBtn),
        h('div.readout', big.el, eco),
        h('div.slider-row',
          h('button.round', { 'aria-label': 'Mais frio', onclick: () => { haptic('tick'); set({ on: true, target: s().target - 1 }); } }, icon('minus', 18, 2.2)),
          slider.el,
          h('button.round', { 'aria-label': 'Mais quente', onclick: () => { haptic('tick'); set({ on: true, target: s().target + 1 }); } }, icon('plus', 18, 2.2))),
        options,
      ],
      update() {
        const a = s();
        // A real AC only shows the controls it has a function for.
        const f = features();
        const shown = [[mode.el, f.modes.length > 0], [fan.el, f.fans.length > 0], [sleep, f.sleep], [swing.el, f.swing]];
        for (const [el, on] of shown) el.hidden = !on;
        eco.hidden = !f.eco;
        options.style.gridTemplateColumns = `repeat(${shown.filter(([, on]) => on).length || 1}, 1fr)`;
        powerBtn.classList.toggle('on', a.on);
        sub.replaceChildren(icon('thermo', 14), 'Ambiente ', h('b', `${a.roomTemp.toFixed(1)}°C`),
          h('span.live', { style: { background: a.on ? MODE_COLORS[a.mode] : 'rgba(255,255,255,.25)', boxShadow: a.on && !a.idle ? `0 0 8px ${MODE_COLORS[a.mode]}` : 'none' } }));
        big.set(a.target, !a.on);
        slider.set(a.target);
        eco.classList.toggle('on', a.eco);
        mode.update(); fan.update(); swing.update();
        sleep.classList.toggle('active', a.sleep);
        sleepValue.textContent = a.sleep ? 'Ligado' : 'Desligado';
      },
    };
  }

  function lightSheet(id) {
    const cfg = store.lightCfg.get(id);
    const s = () => state.lights[id];
    const set = (patch) => store.setLight(id, patch);
    const caps = cfg.capabilities;
    const sub = h('div.sheet-sub');
    const powerBtn = h('button.round.power', { 'aria-label': 'Ligar ou desligar', onclick: () => toggleLight(id) }, icon('power', 21, 2.2));
    // A percentage only where there is a brightness to show: a lamp that just switches on
    // and off would read as dimmable.
    const dimmable = caps.includes('brightness');
    const big = dimmable ? bigNumber('%') : null;
    const nodes = [sheetHead(cfg.name, sub, powerBtn, { beside: !dimmable }), ...(big ? [h('div.readout', big.el)] : [])];
    const sliders = {};

    if (caps.includes('brightness')) {
      sliders.brightness = createSlider({
        min: 5, max: 100, value: Math.round(s().brightness * 100), gradient: DIM_GRADIENT, detent: 5,
        onInput: (v) => set({ on: true, brightness: v / 100 }),
      });
      nodes.push(h('div.slider-row',
        h('button.round', { 'aria-label': 'Menos brilho', onclick: () => { haptic('tick'); set({ on: true, brightness: s().brightness - 0.1 }); } }, icon('dim', 18)),
        sliders.brightness.el,
        h('button.round', { 'aria-label': 'Mais brilho', onclick: () => { haptic('tick'); set({ on: true, brightness: s().brightness + 0.1 }); } }, icon('bright', 18))));
    }
    let kelvinLabel = null;
    if (caps.includes('temp')) {
      kelvinLabel = h('span');
      sliders.temp = createSlider({
        min: 2200, max: 6500, step: 100, value: s().temp, gradient: KELVIN_GRADIENT, compact: true, detent: 500,
        onInput: (v) => set({ on: true, temp: v }),
      });
      nodes.push(h('div.field-label', h('span', 'Temperatura de cor'), kelvinLabel), h('div.slider-row', sliders.temp.el));
    }
    let swatches = [];
    let pad = null;
    let colorLabel = null;
    if (caps.includes('color')) {
      colorLabel = h('span');
      pad = createColorPad({ value: s().color, onInput: (c) => set({ on: true, color: c }) });
      swatches = SWATCHES.map((c) => h('button.swatch', { 'aria-label': `Cor ${c}`, vars: { '--sw': c }, onclick: () => { haptic('light'); set({ on: true, color: c }); } }));
      nodes.push(h('div.field-label', h('span', 'Cor'), colorLabel), pad.el, h('div.swatches', swatches));
    } else {
      nodes.push(h('div.sheet-note', icon(cfg.type, 20),
        `${roomName.get(cfg.room)} · ${isTouch ? 'toque' : 'clique'} no botão ao lado do nome, ou de novo na lâmpada da maquete, para acender ou apagar.`));
    }

    return {
      nodes,
      update() {
        const l = s();
        powerBtn.classList.toggle('on', l.on);
        sub.replaceChildren(roomName.get(cfg.room), ' · ', h('b', l.on ? 'Acesa' : 'Apagada'));
        big?.set(Math.round(l.brightness * 100), !l.on);
        sliders.brightness?.set(Math.round(l.brightness * 100));
        sliders.temp?.set(l.temp);
        if (kelvinLabel) kelvinLabel.textContent = l.color ? '—' : `${l.temp} K`;
        swatches.forEach((el, i) => el.classList.toggle('selected', l.color?.toLowerCase() === SWATCHES[i]));
        pad?.set(l.color);
        if (colorLabel) colorLabel.textContent = l.color ? l.color.toUpperCase() : 'Branca';
      },
    };
  }

  /* ---------- tooltip ---------- */

  function hideTooltip() { tooltip.classList.remove('show'); }

  /** What a label over a device says: its name and state, and the colour its dot glows. */
  function describe(hit) {
    let name;
    let status;
    let on;
    let color;
    if (hit.kind === 'light') {
      const cfg = store.lightCfg.get(hit.id);
      const s = state.lights[hit.id];
      name = cfg.name; status = lightStatus(cfg, s); on = s.on; color = css(lightColor(s, tmp));
    } else if (hit.kind === 'tv') {
      const cfg = store.tvCfg.get(hit.id);
      const t = state.tvs[hit.id];
      name = cfg.name; status = tvStatus(t, cfg); on = t.on; color = TV_BLUE;
    } else if (hit.kind === 'gate') {
      const cfg = store.gateCfg.get(hit.id);
      const g = state.gates[hit.id];
      name = cfg.name; status = gateText(hit.id); on = g.state !== 'closed'; color = GATE_COLOR[g.state] || '#8b93a7';
    } else {
      const cfg = store.acCfg.get(hit.id);
      const s = state.acs[hit.id];
      name = cfg.name; status = s.on ? `${s.idle ? 'Em espera' : MODE_LABEL[s.mode]} ${s.target}°` : 'Desligado'; on = s.on && !s.idle; color = MODE_COLORS[s.mode];
    }
    return { name, status, on, color };
  }

  function showTooltip(hit) {
    // The open device already has its own label (the pin below).
    const p = pinTarget();
    if (!hit || (p && p.kind === hit.kind && p.id === hit.id)) { hideTooltip(); return; }
    // The dot's glow tells the state; the name is all the words it needs.
    const { name, on, color } = describe(hit);
    tooltip.replaceChildren(h('i.dot'), name);
    tooltip.classList.toggle('on', on);
    tooltip.style.setProperty('--dot', color);
    tooltip.style.left = `${clamp(hit.x, 70, card.clientWidth - 70)}px`;
    tooltip.style.top = `${Math.max(64, hit.y)}px`;
    tooltip.classList.add('show');
  }

  /* ---------- pin: the open device's label, with its switch ---------- */

  // Over the device whose menu is open, in place of the hover label's dot: a round switch
  // that glows in the device's colour while it is on. Gates keep their own two-step button.
  const pinPower = h('button.pin-power', { 'aria-label': 'Ligar ou desligar', onclick: (e) => { e.stopPropagation(); flipPinned(); } }, icon('power', 15, 2.4));
  // Just the name: the switch's glow already says whether it is on, and the menu below says it in words.
  const pinName = h('b');
  const pin = h('div.pin', pinPower, pinName);
  clip.append(pin);

  const pinnable = (t) => t && ['light', 'tv', 'ac'].includes(t.kind);
  // The open menu's device, or a lamp clicked in the model (it has no menu).
  const pinTarget = () => (pinnable(ui.sheet) ? ui.sheet : ui.sheet ? null : ui.pinned);

  function flipPinned() {
    const t = pinTarget();
    if (!pinnable(t)) return;
    if (t.kind === 'light') { toggleLight(t.id); return; }
    haptic('medium');
    if (t.kind === 'tv') store.setTV(t.id, { on: !state.tvs[t.id].on });
    else store.setAC(t.id, { on: !state.acs[t.id].on });
  }

  function placePin(at) {
    const t = pinTarget();
    const show = t && at && Number.isFinite(at.x) && at.kind === t.kind && at.id === t.id;
    pin.classList.toggle('show', !!show);
    if (!show) return;
    pin.style.left = `${clamp(at.x, 90, card.clientWidth - 90)}px`;
    pin.style.top = `${Math.max(70, at.y)}px`;
  }

  function updatePin() {
    const t = pinTarget();
    if (!t) { pin.classList.remove('show'); sheet.classList.remove('tinted'); return; }
    const { name, on, color } = describe(t);
    pinName.textContent = name;
    pin.classList.toggle('on', on);
    pin.style.setProperty('--dot', color);
    // An open menu's own switch glows the same colour.
    sheet.classList.toggle('tinted', !!ui.sheet);
    sheet.style.setProperty('--dot', color);
  }

  /* ---------- derived state ---------- */

  function mood() {
    if (ui.sheet?.kind === 'ac') {
      const a = state.acs[ui.sheet.id];
      if (!a.on) return NAVY.clone().multiplyScalar(0.8);
      if (a.mode === 'cool' || a.mode === 'heat' || a.mode === 'auto') return acTemperatureColor(a.target, store.acCfg.get(ui.sheet.id));
      return new THREE.Color(MODE_COLORS[a.mode]).multiplyScalar(0.38);
    }
    const sum = new THREE.Color(0, 0, 0);
    let weight = 0;
    for (const cfg of config.lights) {
      const s = state.lights[cfg.id];
      if (!s.on) continue;
      const w = cfg.capabilities.includes('brightness') ? s.brightness : 1;
      lightColor(s, tmp);
      sum.r += tmp.r * w; sum.g += tmp.g * w; sum.b += tmp.b * w;
      weight += w;
    }
    if (!weight) return NAVY.clone();
    // A hint of the lamps' colour over the deep blue, never more: with many lamps lit it used
    // to reach 80% and wash the whole backdrop warm.
    sum.multiplyScalar(0.42 / weight);
    return NAVY.clone().lerp(sum, clamp(weight / 8, 0.08, 0.28));
  }

  function update() {
    const lights = Object.values(state.lights);
    const onCount = lights.filter((l) => l.on).length;
    const acsOn = Object.values(state.acs).filter((a) => a.on);
    const anyOn = onCount > 0 || acsOn.length > 0;

    // Every light off: a plain 0 and a green leaf, rather than a "Nenhuma" that reads as missing.
    homeSub.replaceChildren(
      onCount ? h('span.live') : h('span.eco-leaf', { title: 'Todas as luzes apagadas' }, icon('leaf', 13, 2.2)),
      h('b', onCount ? `${onCount} de ${lights.length}` : '0'), onCount === 1 ? ' luz acesa' : ' luzes acesas',
      acsOn.length ? ` · Ar ${acsOn[0].target}°` : '');
    const scope = powerScope();
    power.classList.toggle('on', scope.lights.some((l) => state.lights[l.id].on) || scope.acs.some((a) => state.acs[a.id].on));
    const powerTitle = scope.tab ? `Ligar / desligar tudo em ${tabName.get(scope.tab)}` : 'Ligar / desligar a casa toda';
    if (power.title !== powerTitle) { power.title = powerTitle; power.setAttribute('aria-label', powerTitle); }
    // The room in view, or the home's own name when the whole home is.
    const info = ui.sheet?.kind === 'info';
    const inView = info ? ui.sheet.id : ui.sheet && ui.sheet.kind !== 'organize' ? cfgOf(ui.sheet)?.room : ui.room !== 'all' ? ui.room : null;
    homeName.textContent = (ui.sheet && !info ? roomName.get(inView) : tabName.get(inView)) || config.name;
    const badgeFor = inView ? tabOf(inView) : 'all';
    if (badgeFor !== badgeShown) {
      badgeShown = badgeFor;
      const r = config.rooms.find((x) => x.id === badgeFor);
      const cams = badgeFor === CAM_TAB;
      badgeRoom.replaceChildren(r ? icon(roomIcon(r), 17) : cams ? icon('cctv', 17) : logo());
      homeBadge.classList.toggle('in-room', Boolean(r) || cams);
    }

    for (const [id, b] of sceneButtons) b.classList.toggle('active', state.scene === id);

    for (const [id, { b, count }] of roomButtons) {
      b.classList.toggle('active', ui.room === id);
      const n = config.lights.filter((l) => (id === 'all' || tabOf(l.room) === id) && state.lights[l.id].on).length;
      count.textContent = n;
      count.classList.toggle('zero', n === 0 || id === 'all');
    }

    // The start page without the model, if it was put away (remembered); a room always shows it.
    // (a camera on screen brings the model's side back while it is open: the box sits there)
    const mapOff = arr.mapHidden && ui.room === 'all' && !ui.sheet && !camBox.isOpen;
    card.classList.toggle('map-off', mapOff);
    mapBtn.hidden = ui.room !== 'all' || Boolean(ui.sheet);
    mapBtn.classList.toggle('on', !arr.mapHidden);
    card.classList.toggle('cam-open', camBox.isOpen);
    // the start page laid sideways without the map, and a camera opening or closing over it
    if (sideways() !== laidSideways) layoutTiles(true);

    updatePin();
    for (const t of tiles.values()) t.update();
    for (const t of [...gateTiles, ...toggleTiles, ...camTiles]) t.update();
    sheetView?.update();
    const m = css(mood());
    card.style.setProperty('--mood', m);
  }

  store.on(() => update());
  // Out of sight (the panel closed, the tablet asleep, another app in front): the camera stops.
  document.addEventListener('visibilitychange', () => { if (document.hidden && camBox.isOpen) toggleCamera(); });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && closeConfirm()) return;
    if (ev.key === 'Escape' && camBox.isOpen && !ui.sheet) { toggleCamera(); return; }
    if (ev.key === 'Escape' && ui.editing) { setEditing(false); return; }
    if (ev.key === 'Escape' && !closeSheet() && !unpin()) onMenu(null, 'escape');
  });

  layoutTiles();
  update();

  return {
    canvas,
    card,
    attach(w) { world = w; card.classList.remove('booting'); },
    showTooltip,
    placePin,
    openSheet,
    show,
    pickRoom,
    closeSheet,
    /** Organizar o painel: order and visibility of shortcuts, rooms and devices. */
    organize() { openSheet({ kind: 'organize' }); },
    /** Editar: drag, resize, flip, hide and tag the cards. */
    edit() { closeSheet(); setEditing(true); },
    selectRoom,
    toggleLight,
    /** A camera (its plan id) on, or off if it is the one on screen; no id: off. */
    toggleCamera,
    get cameraOpen() { return camBox.isOpen; },
    get room() { return ui.room; },
    /** Where the room chips sit: "top" (above the list) or "bottom" (a menu at the foot). */
    get roomsAt() { return arr.roomsAt; },
    setRoomsAt(where) {
      arr.roomsAt = where === 'bottom' ? 'bottom' : 'top';
      saveArrangement(config.name, arr);
      renderRooms();
      showTab(ui.room, 'auto');
    },
    setNotch(x) { card.style.setProperty('--notch-x', `${x}px`); },
    setAgentLive(live) { aiBadge.hidden = !live; },
    /** Let go of the menu bar (Mac): no notch, dragged by the header. */
    setDetached: showDetached,
    /** The stage and the controls moved (a Duo folded or opened): the controls settle in place. */
    relayout() {
      card.classList.remove('relayout');
      void card.offsetWidth; // restarts the animation
      card.classList.add('relayout');
      clearTimeout(card.relayoutTimer);
      card.relayoutTimer = setTimeout(() => card.classList.remove('relayout'), 600);
    },
    /** `ai`: something an AI assistant did (who, what), instead of an error. */
    toast: showToast,
    /** A confirmation over the panel: { title, text, ok, danger }, then `onOk`. */
    confirm: (opts, onOk) => askConfirm(opts, onOk),
    anchorMenu: clip,
  };
}
