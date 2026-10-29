// The control panel that lives in the menu bar popover: header, scenes, rooms,
// device tiles and the detail sheets for a light or an AC.
import * as THREE from 'three';
import { h, clamp, createSlider, createColorPad, openMenu } from './dom.js';
import { icon, lampIcon } from './icons.js';
import { lightColor } from '../three/lights.js';
import { MODE_COLORS } from '../three/ac.js';
import { AC_SWINGS } from '../store.js';
import { haptic, isPhone } from '../bridge.js';

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

export function createPanel(root, config, store, { onFocus, onMenu }) {
  const { state } = store;
  const ui = { room: 'all', sheet: null };
  let world = null;
  const roomName = new Map(config.rooms.map((r) => [r.id, r.name]));

  /* ---------- skeleton ---------- */

  const canvas = h('canvas', { tabindex: -1 });
  const tooltip = h('div.tooltip');
  const homeSub = h('div.home-sub');
  const power = h('button.round.power', { title: 'Ligar / desligar tudo', 'aria-label': 'Ligar ou desligar tudo', onclick: toggleEverything }, icon('power', 21, 2.2));
  const gear = h('button.round', { title: 'Ajustes e plantas', 'aria-label': 'Ajustes e plantas', onclick: () => onMenu(gear) }, icon('settings', 17));
  // Shown while an AI assistant has a link to this home (AI Access on the Mac).
  const aiBadge = h('button.ai-badge', { hidden: true, title: 'Um assistente de IA tem acesso — clique para gerenciar', 'aria-label': 'Acesso por IA',
    onclick: () => onMenu(aiBadge, 'agent') }, icon('sparkles', 13, 2.2), h('span', 'AI'));

  const scenes = h('div.scenes');
  const rooms = h('div.rooms');
  const listTitle = h('span.title');
  const grid = h('div.grid');
  const panel = h('section.panel',
    scenes, rooms,
    h('div.list-head', listTitle,
      h('button.pill', { onclick: () => bulk(true) }, 'Acender todas'),
      h('button.pill', { onclick: () => bulk(false) }, 'Apagar todas')),
    h('div.devices', grid));
  const sheet = h('section.sheet.hidden');
  sheet.inert = true;
  const toastEl = h('div.panel-toast');

  const clip = h('div.card-clip',
    h('div.stage', canvas),
    h('div.tint'),
    h('header.top',
      h('div.home', h('div.home-badge', icon('home', 17)),
        h('div', h('div.home-name', config.name), homeSub)),
      aiBadge, gear, power),
    tooltip, panel, sheet, toastEl);
  const card = h('div.card.booting', h('div.notch'), clip);
  root.replaceChildren(card);

  /* ---------- scenes ---------- */

  const sceneButtons = new Map();
  for (const s of config.scenes) {
    const b = h('button.scene', { onclick: () => { haptic('medium'); store.applyScene(s.id); } }, icon(s.icon, 19), s.name);
    sceneButtons.set(s.id, b);
    scenes.append(b);
  }
  // Shortcuts (Home Assistant scripts) sit with the scenes: one press runs them.
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
    } }, icon(sc.icon, 19), sc.name);
    scenes.append(b);
  }
  if (!config.scenes.length && !config.shortcuts.length) scenes.style.display = 'none';

  /* ---------- rooms ---------- */

  const roomButtons = new Map();
  // Rooms without a device stay in the model but not in the chips (a bathroom, a passage).
  const withDevices = config.rooms.filter((r) => [...config.lights, ...config.acs, ...config.tvs].some((d) => d.room === r.id));
  for (const r of [{ id: 'all', name: 'Todos' }, ...withDevices]) {
    const count = h('span.count.zero', '0');
    const b = h('button.room', { onclick: () => { haptic('tick'); selectRoom(r.id); } }, r.name, count);
    roomButtons.set(r.id, { b, count });
    rooms.append(b);
  }

  function selectRoom(id) {
    if (ui.room === id) id = 'all';
    ui.room = id;
    layoutTiles();
    update();
    roomButtons.get(id)?.b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    onFocus(id === 'all' ? null : { kind: 'room', id });
  }

  function inScope(cfg) {
    return ui.room === 'all' || cfg.room === ui.room;
  }

  function bulk(on) {
    haptic('medium');
    if (ui.room === 'all') { store.setAllLights(on); return; }
    for (const l of config.lights) if (l.room === ui.room) store.setLight(l.id, { on });
  }

  function toggleEverything() {
    haptic('heavy');
    const anyOn = Object.values(state.lights).some((l) => l.on) || Object.values(state.acs).some((a) => a.on);
    if (anyOn) {
      store.setAllLights(false);
      for (const id of Object.keys(state.acs)) store.setAC(id, { on: false });
    } else {
      store.setAllLights(true);
    }
  }

  /* ---------- tiles ---------- */

  const tiles = new Map();

  function lightTile(cfg) {
    const dimmable = cfg.capabilities.includes('brightness');
    const hasSheet = cfg.capabilities.length > 0;
    const sub = h('div.tile-sub');
    // A phone has no room for the button: touching and holding the tile opens the sheet there.
    const more = hasSheet && !isPhone
      ? h('button.tile-more', { 'aria-label': `Ajustes de ${cfg.name}`, onclick: (e) => { e.stopPropagation(); openSheet({ kind: 'light', id: cfg.id }); } }, icon('sliders', 15))
      : null;
    const el = h(`div.tile${dimmable ? '.dimmable' : ''}`, { role: 'button', tabindex: 0, 'aria-label': cfg.name },
      h('div.bubble', icon(lampIcon(cfg), 19)),
      h('div.tile-text', h('div.tile-name', cfg.name), sub),
      more,
      h('div.tile-level'));

    // Tap toggles; dragging sideways dims (HomeKit-style).
    let gesture = null;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.tile-more') || ev.button !== 0) return;
      el.setPointerCapture(ev.pointerId);
      const s = state.lights[cfg.id];
      gesture = { x: ev.clientX, y: ev.clientY, start: s.on ? s.brightness : 0, moved: false, step: null };
      el.classList.add('pressed');
      if (isPhone && hasSheet) {
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
        sub.textContent = ui.room === 'all' && !isPhone ? `${lightStatus(cfg, s)} · ${roomName.get(cfg.room)}` : lightStatus(cfg, s);
      },
    };
  }

  function acTile(cfg) {
    const sub = h('div.tile-sub');
    const value = h('div.value');
    const bubble = h('div.bubble');
    const step = (d) => (e) => {
      e.stopPropagation();
      haptic('tick');
      const s = state.acs[cfg.id];
      store.setAC(cfg.id, { on: true, target: s.target + d });
    };
    const el = h('div.tile.ac', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: () => openSheet({ kind: 'ac', id: cfg.id }) },
      bubble,
      h('div.tile-text', h('div.tile-name', cfg.name), sub),
      h('div.stepper',
        h('button', { 'aria-label': 'Mais frio', onclick: step(-1) }, icon('minus', 15, 2.2)),
        value,
        h('button', { 'aria-label': 'Mais quente', onclick: step(1) }, icon('plus', 15, 2.2))),
      h('button.mini-power', { 'aria-label': `Ligar ou desligar ${cfg.name}`, onclick: (e) => { e.stopPropagation(); haptic('medium'); store.setAC(cfg.id, { on: !state.acs[cfg.id].on }); } }, icon('power', 16, 2.2)));
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openSheet({ kind: 'ac', id: cfg.id }); });
    let shownMode = null;
    return {
      el, cfg, kind: 'ac',
      update() {
        const s = state.acs[cfg.id];
        el.classList.toggle('on', s.on);
        el.classList.toggle('idle', s.on && s.idle);
        el.style.setProperty('--c', MODE_COLORS[s.mode]);
        if (shownMode !== s.mode) { bubble.replaceChildren(icon(s.mode, 19)); shownMode = s.mode; }
        value.textContent = `${s.target}°`;
        sub.textContent = `${!s.on ? 'Desligado' : s.idle ? 'Em espera' : MODE_LABEL[s.mode]} · Ambiente ${s.roomTemp.toFixed(isPhone ? 0 : 1)}°`;
      },
    };
  }

  const GATE_TEXT = { open: 'Aberto', closed: 'Fechado', opening: 'Abrindo…', closing: 'Fechando…' };
  const GATE_COLOR = { open: '#ffb340', opening: '#ffd84a', closing: '#ffd84a' };

  // The gate opens and closes on a second press within a few seconds, never on the first:
  // a stray click in the menu bar must not open the house.
  function gateTile(cfg) {
    const sub = h('div.tile-sub');
    const label = h('span');
    let armed = 0;
    const disarm = () => { clearTimeout(armed); armed = 0; action.classList.remove('armed'); update(); };
    const action = h('button.gate-action', { onclick: (e) => {
      e.stopPropagation();
      const g = state.gates[cfg.id];
      const verb = g.state === 'open' || g.state === 'opening' ? 'close' : 'open';
      if (!armed) {
        haptic('light');
        action.classList.add('armed');
        label.textContent = verb === 'open' ? 'Toque de novo para abrir' : 'Toque de novo para fechar';
        armed = setTimeout(disarm, 3500);
        return;
      }
      disarm();
      haptic('heavy');
      store.gateAction(cfg.id, verb);
    } }, label);
    const el = h('div.tile.gate', { 'aria-label': cfg.name }, h('div.bubble', icon('gate', 19)),
      h('div.tile-text', h('div.tile-name', cfg.name), sub), action);
    function update() {
      const g = state.gates[cfg.id];
      el.classList.toggle('on', g.state !== 'closed');
      el.classList.toggle('offline', g.online === false);
      el.style.setProperty('--c', GATE_COLOR[g.state] || '#8b93a7');
      sub.textContent = g.online === false ? 'Indisponível' : GATE_TEXT[g.state] || g.state;
      if (!armed) label.textContent = g.state === 'open' || g.state === 'opening' ? 'Fechar' : 'Abrir';
    }
    return { el, cfg, kind: 'gate', update };
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

  const TV_BLUE = '#6fa8ff';
  const tvStatus = (t) => (t.online === false ? 'Indisponível' : !t.on ? 'Desligada'
    : t.title || t.source || (t.state === 'playing' ? 'Reproduzindo' : t.state === 'paused' ? 'Pausada' : 'Ligada'));

  function tvTile(cfg) {
    const sub = h('div.tile-sub');
    const power = h('button.mini-power', { 'aria-label': `Ligar ou desligar ${cfg.name}`, onclick: (e) => {
      e.stopPropagation(); haptic('medium'); store.setTV(cfg.id, { on: !state.tvs[cfg.id].on });
    } }, icon('power', 16, 2.2));
    const el = h('div.tile.tv', { role: 'button', tabindex: 0, 'aria-label': cfg.name, onclick: () => openSheet({ kind: 'tv', id: cfg.id }) },
      h('div.bubble', icon('tv', 19)), h('div.tile-text', h('div.tile-name', cfg.name), sub), power);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openSheet({ kind: 'tv', id: cfg.id }); });
    return {
      el, cfg, kind: 'tv',
      update() {
        const t = state.tvs[cfg.id];
        el.classList.toggle('on', t.on);
        el.classList.toggle('offline', t.online === false);
        el.style.setProperty('--c', TV_BLUE);
        sub.textContent = ui.room === 'all' && !isPhone ? `${tvStatus(t)} · ${roomName.get(cfg.room)}` : tvStatus(t);
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
    const volumeRow = h('div.slider-row',
      h('button.round', { 'aria-label': 'Menos volume', onclick: () => { haptic('tick'); store.tvAction(id, 'volume_down'); set({ volume: Math.max(0, t().volume - 0.01) }); } }, icon('minus', 18, 2.2)),
      slider.el,
      h('button.round', { 'aria-label': 'Mais volume', onclick: () => { haptic('tick'); store.tvAction(id, 'volume_up'); set({ volume: Math.min(1, t().volume + 0.01) }); } }, icon('plus', 18, 2.2)));
    return {
      nodes: [
        sheetHead(cfg.name, sub, powerBtn),
        readout,
        volumeRow,
        options,
      ],
      update() {
        const tv = t();
        powerBtn.classList.toggle('on', tv.on);
        sub.replaceChildren(roomName.get(cfg.room), ' · ', h('b', tvStatus(tv)));
        big.set(Math.round(tv.volume * 100), !tv.on || tv.muted);
        slider.set(Math.round(tv.volume * 100));
        mute.classList.toggle('on', Boolean(tv.muted));
        sourceValue.textContent = tv.source || '—';
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
  // Not in a room: shown above (the gate) and below (automations) the rooms, on "All" only.
  const gateTiles = config.gates.map(gateTile);
  const toggleTiles = config.toggles.map(toggleTile);

  function toggleLight(id) {
    haptic('light');
    world?.lights.get(id)?.bump();
    store.toggleLight(id);
  }

  function layoutTiles() {
    const nodes = [];
    let i = 0;
    const add = (t) => { t.el.style.setProperty('--i', i++); nodes.push(t.el); };
    if (ui.room === 'all' && gateTiles.length) {
      nodes.push(h('div.group-label', gateTiles.length > 1 ? 'Portões' : 'Portão'));
      gateTiles.forEach(add);
    }
    for (const room of config.rooms) {
      if (ui.room !== 'all' && room.id !== ui.room) continue;
      const devices = [...tiles.values()].filter((t) => t.cfg.room === room.id);
      if (!devices.length) continue;
      if (ui.room === 'all') nodes.push(h('div.group-label', room.name));
      devices.filter((t) => t.kind === 'ac').forEach(add);
      devices.filter((t) => t.kind === 'tv').forEach(add);
      devices.filter((t) => t.kind === 'light').forEach(add);
    }
    if (ui.room === 'all' && toggleTiles.length) {
      nodes.push(h('div.group-label', 'Automações'));
      toggleTiles.forEach(add);
    }
    if (!nodes.length) nodes.push(h('div.group-label', 'Nenhum dispositivo neste cômodo ainda'));
    else if (isPhone && config.lights.some((l) => l.capabilities.length && inScope(l))) {
      nodes.push(h('div.grid-hint', 'Toque e segure uma luz para brilho e cor'));
    }
    grid.replaceChildren(...nodes);
    grid.parentElement.scrollTop = 0;
  }

  /* ---------- sheets ---------- */

  let sheetView = null;

  function openSheet(target) {
    ui.sheet = target;
    sheetView = target.kind === 'ac' ? acSheet(target.id) : target.kind === 'tv' ? tvSheet(target.id) : lightSheet(target.id);
    sheet.replaceChildren(...sheetView.nodes);
    panel.classList.add('hidden');
    sheet.classList.remove('hidden');
    panel.inert = true;
    sheet.inert = false;
    card.classList.add('detail');
    hideTooltip();
    const room = target.kind === 'tv' ? store.tvCfg.get(target.id).room : target.kind === 'light' ? store.lightCfg.get(target.id).room : null;
    onFocus(target.kind === 'ac' ? target : { kind: 'room', id: room });
    update();
  }

  function closeSheet() {
    if (!ui.sheet) return false;
    ui.sheet = null;
    sheetView = null;
    sheet.classList.add('hidden');
    panel.classList.remove('hidden');
    panel.inert = false;
    sheet.inert = true;
    card.classList.remove('detail');
    onFocus(ui.room === 'all' ? null : { kind: 'room', id: ui.room });
    update();
    return true;
  }

  function sheetHead(name, sub, powerBtn) {
    return h('div.sheet-head',
      h('button.round', { 'aria-label': 'Voltar', onclick: closeSheet }, icon('back', 19, 2.2)),
      h('div.sheet-title', h('div.sheet-name', name), sub),
      powerBtn);
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
    const big = bigNumber('%');
    const nodes = [sheetHead(cfg.name, sub, powerBtn), h('div.readout', big.el)];
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
        `${roomName.get(cfg.room)} · arraste sobre o botão da luz para ajustar o brilho, ou ${isPhone ? 'toque' : 'clique'} na lâmpada da maquete 3D para acender ou apagar.`));
    }

    return {
      nodes,
      update() {
        const l = s();
        powerBtn.classList.toggle('on', l.on);
        sub.replaceChildren(roomName.get(cfg.room), ' · ', h('b', l.on ? 'Acesa' : 'Apagada'));
        big.set(caps.includes('brightness') ? Math.round(l.brightness * 100) : l.on ? 100 : 0, !l.on);
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

  function showTooltip(hit) {
    if (!hit) { hideTooltip(); return; }
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
      name = cfg.name; status = tvStatus(t); on = t.on; color = TV_BLUE;
    } else if (hit.kind === 'gate') {
      const cfg = store.gateCfg.get(hit.id);
      const g = state.gates[hit.id];
      name = cfg.name; status = GATE_TEXT[g.state] || g.state; on = g.state !== 'closed'; color = GATE_COLOR[g.state] || '#8b93a7';
    } else {
      const cfg = store.acCfg.get(hit.id);
      const s = state.acs[hit.id];
      name = cfg.name; status = s.on ? `${s.idle ? 'Em espera' : MODE_LABEL[s.mode]} ${s.target}°` : 'Desligado'; on = s.on && !s.idle; color = MODE_COLORS[s.mode];
    }
    tooltip.replaceChildren(h('i.dot'), name, h('span', status));
    tooltip.classList.toggle('on', on);
    tooltip.style.setProperty('--dot', color);
    tooltip.style.left = `${clamp(hit.x, 70, card.clientWidth - 70)}px`;
    tooltip.style.top = `${Math.max(64, hit.y)}px`;
    tooltip.classList.add('show');
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
    sum.multiplyScalar(0.42 / weight);
    return NAVY.clone().lerp(sum, clamp(weight / 3.5, 0.25, 0.8));
  }

  function update() {
    const lights = Object.values(state.lights);
    const onCount = lights.filter((l) => l.on).length;
    const acsOn = Object.values(state.acs).filter((a) => a.on);
    const anyOn = onCount > 0 || acsOn.length > 0;

    homeSub.replaceChildren(
      h('span.live', { style: anyOn ? {} : { background: 'rgba(255,255,255,.25)', boxShadow: 'none' } }),
      h('b', onCount ? `${onCount} de ${lights.length}` : 'Nenhuma'), onCount === 1 ? ' luz acesa' : ' luzes acesas',
      acsOn.length ? ` · Ar ${acsOn[0].target}°` : '');
    power.classList.toggle('on', anyOn);

    for (const [id, b] of sceneButtons) b.classList.toggle('active', state.scene === id);

    for (const [id, { b, count }] of roomButtons) {
      b.classList.toggle('active', ui.room === id);
      const n = config.lights.filter((l) => (id === 'all' || l.room === id) && state.lights[l.id].on).length;
      count.textContent = n;
      count.classList.toggle('zero', n === 0 || id === 'all');
    }

    const scoped = config.lights.filter(inScope);
    const scopedOn = scoped.filter((l) => state.lights[l.id].on).length;
    listTitle.replaceChildren(h('b', ui.room === 'all' ? 'Casa toda' : roomName.get(ui.room)), ` · ${scopedOn} de ${scoped.length} acesas`);

    for (const t of tiles.values()) t.update();
    for (const t of [...gateTiles, ...toggleTiles]) t.update();
    sheetView?.update();
    const m = css(mood());
    card.style.setProperty('--mood', m);
  }

  store.on(() => update());
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !closeSheet()) onMenu(null, 'escape');
  });

  layoutTiles();
  update();

  return {
    canvas,
    card,
    attach(w) { world = w; card.classList.remove('booting'); },
    showTooltip,
    openSheet,
    closeSheet,
    selectRoom,
    toggleLight,
    get room() { return ui.room; },
    setNotch(x) { card.style.setProperty('--notch-x', `${x}px`); },
    setAgentLive(live) { aiBadge.hidden = !live; },
    /** The stage and the controls moved (a Duo folded or opened): the controls settle in place. */
    relayout() {
      card.classList.remove('relayout');
      void card.offsetWidth; // restarts the animation
      card.classList.add('relayout');
      clearTimeout(card.relayoutTimer);
      card.relayoutTimer = setTimeout(() => card.classList.remove('relayout'), 600);
    },
    /** `ai`: something an AI assistant did (who, what), instead of an error. */
    toast(text, ai = null) {
      toastEl.replaceChildren(...(ai ? [h('span.toast-ai', icon('sparkles', 13, 2.2), ai), h('span', text)] : [text]));
      toastEl.classList.toggle('ai', Boolean(ai));
      toastEl.classList.add('show');
      clearTimeout(toastEl.timer);
      toastEl.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
    },
    anchorMenu: clip,
  };
}
