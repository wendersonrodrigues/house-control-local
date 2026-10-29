// The editor's "Connections": the smart home platforms House Control can link the plan's
// lamps and ACs to (Smart Life, Home Assistant, Philips Hue, Apple Home), the screens that
// connect each one, and the pickers that link a lamp or an AC to one of their devices.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { isNative, call } from '../bridge.js';
import { SERVICES, EDITION, linkOf } from '../config.js';

const ORDER = ['smartlife', 'homeassistant', 'hue', 'homekit'].filter((id) => !EDITION.platforms || EDITION.platforms.includes(id));
const LOOK = {
  smartlife: { icon: 'plug', tint: '#ff7a3d', blurb: 'Tuya, Smart Life and the many brands built on them' },
  homeassistant: { icon: 'homeassistant', tint: '#18bcf2', blurb: 'Tudo o que ele controla: Tuya Local, Midea, Zigbee, Matter…' },
  hue: { icon: 'bulb', tint: '#c38bff', blurb: 'A Hue Bridge on this network. No account needed' },
  homekit: { icon: 'home', tint: '#ffb340', blurb: 'HomeKit and Matter accessories, through your iPhone' },
};
const KIND_TITLES = { light: 'Luzes e tomadas', ac: 'Ares-condicionados', sensor: 'Sensores de temperatura',
  tv: 'TVs e mídia', gate: 'Portões', shortcut: 'Scripts e cenas', toggle: 'Chaves e automações' };
// Placeholder names the editor gives a new gate, shortcut or switch: replaced by the device's own.
const PLACEHOLDERS = ['Portão', 'Novo atalho', 'Nova chave', 'TV'];

export function createConnections({ rerender, toast, usedBy, onOpen }) {
  const boot = window.__HOUSE_BOOT__ || {};
  const state = {
    info: boot.services || {},
    devices: null,
    errors: {},
    loading: false,
    found: {},       // service -> discovered servers / bridges
    scanning: {},
    pairing: null,   // { host, until } while waiting for the Hue button
  };

  // The platforms this app offers: the native side lists them (the iPhone's App Store
  // edition has no Smart Life). A plain browser shows them all.
  const offered = () => (isNative && boot.services ? ORDER.filter((id) => id in state.info) : ORDER);
  const connected = (id) => Boolean(state.info[id]?.connected);
  const anyConnected = () => offered().some(connected);
  const devicesOf = (id) => (state.devices || []).filter((d) => d.service === id);

  async function refreshInfo() {
    if (!isNative) return;
    try { state.info = await call('services.info'); } catch { /* keep what we had */ }
  }

  async function load({ quiet = false } = {}) {
    if (!isNative || !anyConnected()) { state.devices = null; rerender(); return; }
    state.loading = true;
    if (!quiet) rerender();
    try {
      const r = await call('devices.all');
      state.devices = r.devices;
      state.errors = r.errors || {};
    } catch (e) {
      state.errors = { all: e.message };
    }
    state.loading = false;
    rerender();
  }

  // The Mac pushes this when the paired iPhone sent its Apple Home devices.
  window.house = window.house || {};
  window.house.servicesChanged = (info) => { state.info = info; load({ quiet: true }); };

  /* ---------- sidebar ---------- */

  function sidebarRow(active, select) {
    const n = offered().filter(connected).length;
    return h(`button.row.tuya-row${active ? '.active' : ''}`, { onclick: select },
      icon('link', 15), h('span.row-name', 'Conexões'),
      h(`span.pill${n ? '.on' : ''}`, n ? `${n} conectada${n > 1 ? 's' : ''}` : 'Modo demonstração'));
  }

  /* ---------- overview ---------- */

  function tile(id, size = 34) {
    return h('span.svc-tile', { vars: { '--tint': LOOK[id].tint, '--size': `${size}px` } }, icon(LOOK[id].icon, Math.round(size * 0.52), 2));
  }

  function statusText(id) {
    const info = state.info[id] || {};
    if (id === 'homekit' && info.remote) {
      return info.connected ? `${info.count} devices from ${info.from || 'your iPhone'}` : 'Set up on your iPhone';
    }
    if (!info.connected) return 'Não conectado';
    const count = devicesOf(id).length;
    const name = id === 'homeassistant' ? info.name : id === 'hue' ? info.name : id === 'smartlife' ? info.account : '';
    return [name, state.devices ? `${count} dispositivo${count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'Conectado';
  }

  function overview() {
    if (anyConnected() && !state.devices && !state.loading) setTimeout(() => load(), 0);
    return [
      h('div.svc-cards', offered().map((id) => h('button.svc-card', { onclick: () => onOpen(id) },
        tile(id),
        h('div.svc-text', h('b', SERVICES[id].name), h('span', LOOK[id].blurb)),
        h(`span.svc-status${connected(id) ? '.on' : ''}`, connected(id) ? icon('ok', 13, 2.4) : null, statusText(id)),
        icon('next', 16)))),
      h('p.note', 'Luzes, ares, portão, atalhos e chaves ficam simulados até serem vinculados: escolha um item no editor e selecione a entidade em “Dispositivo real”.'),
      isNative ? null : h('p.note.bad', 'A conexão só funciona dentro do app (esta é a prévia no navegador).'),
    ];
  }

  /* ---------- shared pieces ---------- */

  const section = (title, ...nodes) => h('section.block', h('h3', title), nodes);

  function deviceList(id) {
    if (state.loading) return h('p.note.busy', icon('spinner', 13), 'Buscando os dispositivos…');
    if (state.errors[id]) return h('p.note.bad', state.errors[id]);
    const list = devicesOf(id);
    if (!state.devices) return null;
    if (!list.length) return h('p.note', 'Conectado, mas nenhum dispositivo compatível foi encontrado.');
    const used = usedBy();
    const groups = ['light', 'ac', 'tv', 'sensor', 'gate', 'shortcut', 'toggle'].map((kind) => [kind, list.filter((d) => d.kind === kind)]).filter(([, l]) => l.length);
    return h('div.devices-list', groups.map(([kind, items]) => [
      h('h3', `${KIND_TITLES[kind]} · ${items.length}`),
      items.map((d) => h('div.device',
        h(`span.dot${d.online ? '.on' : ''}`, { title: d.online ? 'Disponível' : 'Indisponível' }),
        h('div', h('b', d.name), h('span', [d.room, d.detail].filter(Boolean).join(' · ') || d.id)),
        used.get(`${d.service}|${d.id}`) ? h('span.pill.on', used.get(`${d.service}|${d.id}`)) : null)),
    ]));
  }

  function connectedHeader(id, title, name, line) {
    return section(title,
      h('div.device', h('span.dot.on'), h('div', h('b', name), h('span', line))),
      h('div.fields',
        h('button.btn', { onclick: () => load() }, 'Atualizar dispositivos'),
        h('button.btn', { onclick: () => disconnect(id) }, 'Desconectar')));
  }

  async function disconnect(id) {
    try {
      state.info = await call('service.disconnect', { service: id });
      state.devices = state.devices?.filter((d) => d.service !== id) ?? null;
      toast(`${SERVICES[id].name} desconectado`);
    } catch (e) { toast(e.message, true); }
    rerender();
  }

  async function scan(id) {
    if (!isNative || state.scanning[id]) return;
    state.scanning[id] = true;
    rerender();
    try {
      state.found[id] = (await call('services.discover', { service: id })).found;
    } catch { state.found[id] = []; }
    state.scanning[id] = false;
    rerender();
  }

  /* ---------- Home Assistant ---------- */

  // The local address first; the external one (Nabu Casa, a tunnel) takes over away from home.
  const ha = { url: '', external: '', token: '', error: null, busy: false };

  function homeAssistant() {
    const info = state.info.homeassistant || {};
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      const where = info.external
        ? `${info.away ? 'Fora de casa: pelo endereço externo' : 'Em casa: pelo endereço local'} (${info.active})`
        : info.url;
      return [connectedHeader('homeassistant', 'Servidor', info.name,
        [where, info.version && `versão ${info.version}`].filter(Boolean).join(' · ')),
      deviceList('homeassistant')];
    }
    if (!state.found.homeassistant && !state.scanning.homeassistant) setTimeout(() => scan('homeassistant'), 0);
    const url = h('input', { type: 'url', spellcheck: 'false', placeholder: 'http://192.168.0.11:8123', value: ha.url });
    const external = h('input', { type: 'url', spellcheck: 'false', placeholder: 'https://homeassistant.exemplo.com (opcional)', value: ha.external });
    const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Token de acesso de longa duração', value: ha.token });
    const ready = () => isNative && !ha.busy && ha.url.trim() && ha.token.trim();
    url.addEventListener('input', () => { ha.url = url.value; button.disabled = !ready(); });
    external.addEventListener('input', () => { ha.external = external.value; });
    token.addEventListener('input', () => { ha.token = token.value; button.disabled = !ready(); });
    const connect = async () => {
      ha.busy = true; ha.error = null; rerender();
      try {
        state.info = await call('homeassistant.connect', { url: ha.url, external: ha.external, token: ha.token });
        ha.token = '';
        toast(`Conectado a ${state.info.homeassistant?.name || 'Home Assistant'}`);
        await load();
      } catch (e) { ha.error = e.message; }
      ha.busy = false;
      rerender();
    };
    const button = h('button.btn.primary.wide', { onclick: connect, disabled: !ready() }, ha.busy ? 'Conectando…' : 'Conectar');
    const found = state.found.homeassistant || [];
    return [
      section('Na sua rede',
        state.scanning.homeassistant ? h('p.note.busy', icon('spinner', 13), 'Procurando o Home Assistant…')
          : found.length ? found.map((s) => h('div.device',
            h('span.dot.on'), h('div', h('b', s.name), h('span', [s.url, s.version && `versão ${s.version}`].filter(Boolean).join(' · '))),
            h('button.btn', { onclick: () => { ha.url = s.url; rerender(); } }, ha.url === s.url ? 'Escolhido' : 'Usar')))
            : h('p.note', 'Nenhum encontrado automaticamente. Digite o endereço abaixo.'),
        state.scanning.homeassistant ? null : h('button.btn.link', { onclick: () => scan('homeassistant') }, icon('radar', 13), 'Procurar de novo')),
      section('Conectar',
        h('label.field', h('span', 'Endereço local'), url),
        h('label.field', h('span', 'Endereço externo'), external),
        h('label.field', h('span', 'Token de acesso'), token),
        h('ol.steps',
          h('li', 'No Home Assistant, abra seu perfil (seu nome no canto inferior esquerdo) → Segurança.'),
          h('li', 'Em “Tokens de acesso de longa duração”, clique em Criar token, dê o nome “HomeOs Bar” e cole aqui.')),
        button,
        ha.error ? h('p.note.bad', ha.error) : null,
        h('p.note', 'O endereço local é usado em casa. Quando ele não responde, o app passa sozinho para o externo, e volta para o local assim que ele responder de novo. O token fica só neste Mac.'),
        h('p.note', 'Aparecem aqui luzes, interruptores, ares-condicionados, sensores de temperatura, portões (cover), scripts, cenas, input_boolean e automações.')),
    ];
  }

  /* ---------- Philips Hue ---------- */

  let pairTimer = 0;
  function stopPairing() { clearInterval(pairTimer); pairTimer = 0; state.pairing = null; }

  function pairHue(bridge) {
    stopPairing();
    state.pairing = { ...bridge, until: Date.now() + 60_000, error: null };
    const attempt = async () => {
      if (!state.pairing) return;
      if (Date.now() > state.pairing.until) {
        state.pairing.error = 'Nobody pressed the button in time. Try again.';
        clearInterval(pairTimer);
        rerender();
        return;
      }
      try {
        const r = await call('hue.pair', { host: bridge.host, bridgeId: bridge.bridgeId, name: bridge.name });
        if (r.waiting) { rerender(); return; }
        stopPairing();
        state.info = r;
        toast(`Paired with ${state.info.hue?.name || 'the Hue Bridge'}`);
        await load();
      } catch (e) {
        if (state.pairing) state.pairing.error = e.message;
        clearInterval(pairTimer);
      }
      rerender();
    };
    attempt();
    pairTimer = setInterval(attempt, 2000);
    rerender();
  }

  const hueManual = { host: '' };

  function hue() {
    const info = state.info.hue || {};
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      return [connectedHeader('hue', 'Bridge', info.name, [info.host, info.bridgeId].filter(Boolean).join(' · ')),
        deviceList('hue')];
    }
    if (state.pairing) {
      const left = Math.max(0, Math.ceil((state.pairing.until - Date.now()) / 1000));
      return [section('Pairing',
        h('div.press',
          h('div.press-button', h('span')),
          h('div', h('b', 'Press the round button on the bridge'), h('span', state.pairing.error || `${state.pairing.name || state.pairing.host} · waiting ${left} s`))),
        h('div.fields',
          state.pairing.error ? h('button.btn', { onclick: () => pairHue(state.pairing) }, 'Try again') : null,
          h('button.btn', { onclick: () => { stopPairing(); rerender(); } }, 'Cancel')),
        h('p.note', 'The big button on top of the Hue Bridge lets one app in for 30 seconds. House Control keeps the key it gets, on this Mac.'))];
    }
    if (!state.found.hue && !state.scanning.hue) setTimeout(() => scan('hue'), 0);
    const found = state.found.hue || [];
    const host = h('input', { type: 'text', spellcheck: 'false', placeholder: 'e.g. 192.168.1.20', value: hueManual.host });
    const pairButton = h('button.btn.wide', { onclick: () => pairHue({ host: hueManual.host.trim(), name: 'Hue Bridge' }), disabled: !isNative || !hueManual.host.trim() }, 'Pair');
    host.addEventListener('input', () => { hueManual.host = host.value; pairButton.disabled = !isNative || !host.value.trim(); });
    return [
      section('On your network',
        state.scanning.hue ? h('p.note.busy', icon('spinner', 13), 'Looking for Hue Bridges…')
          : found.length ? found.map((b) => h('div.device',
            h('span.dot.on'), h('div', h('b', b.name), h('span', [b.host, b.bridgeId].filter(Boolean).join(' · '))),
            h('button.btn.primary', { onclick: () => pairHue(b), disabled: !isNative }, 'Pair')))
            : h('p.note', 'No bridge found by itself. Type its address below (the Hue app shows it under Settings → My Hue system).'),
        state.scanning.hue ? null : h('button.btn.link', { onclick: () => scan('hue') }, icon('radar', 13), 'Look again')),
      section('Or by address',
        h('label.field', h('span', 'Bridge address'), host),
        pairButton),
    ];
  }

  /* ---------- Apple Home ---------- */

  function homeKit() {
    const info = state.info.homekit || {};
    const nodes = [];
    if (info.connected) {
      if (!state.devices && !state.loading) setTimeout(() => load(), 0);
      const when = info.updated ? new Date(info.updated * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
      nodes.push(section('From your iPhone',
        h('div.device', h('span.dot.on'), h('div', h('b', info.from || 'iPhone'), h('span', `${info.count} devices · sent ${when}`))),
        h('div.fields', h('button.btn', { onclick: () => disconnect('homekit') }, 'Forget this list'))),
      deviceList('homekit'));
    }
    nodes.push(section(info.connected ? 'How it works' : 'Set it up on your iPhone',
      h('ol.steps',
        h('li', 'Pair your iPhone with this Mac: right-click the menu bar icon → Pair Phone….'),
        h('li', 'On the iPhone: House Control → Settings → Apple Home → Connect, and allow access to your Home data.'),
        h('li', 'Its lamps, air conditioners and thermometers appear here. Link them like any other device.')),
      h('p.note', 'Apple lets only iPhone, iPad and App Store apps use HomeKit, so the iPhone app switches these devices. On the Mac they show what you set, but stay simulated.')));
    return nodes;
  }

  /* ---------- detail screen ---------- */

  function detail(id, smartLifePanel) {
    if (id === 'smartlife') return smartLifePanel();
    if (id === 'homeassistant') return homeAssistant();
    if (id === 'hue') return hue();
    return homeKit();
  }

  /* ---------- linking a lamp or an AC ---------- */

  function optionLabel(d) {
    return `${d.name}${d.room ? ` — ${d.room}` : ''}${d.online ? '' : ' (offline)'}`;
  }

  function picker(kind, current, include = () => true) {
    const select = h('select');
    select.append(h('option', { value: '' }, kind === 'sensor' ? 'Nenhum — estimado' : 'Não vinculado — simulado'));
    let found = false;
    for (const id of offered()) {
      const list = devicesOf(id).filter((d) => d.kind === kind && include(d));
      if (!list.length) continue;
      select.append(h('optgroup', { label: SERVICES[id].name }, list.map((d) => {
        const value = `${d.service}|${d.id}`;
        if (value === current) found = true;
        return h('option', { value }, optionLabel(d));
      })));
    }
    if (current && !found) {
      const [service, id] = current.split('|');
      select.append(h('option', { value: current }, `${SERVICES[service]?.short || service}: ${id} (não encontrado agora)`));
    }
    select.value = current;
    return select;
  }

  const find = (value) => (state.devices || []).find((d) => `${d.service}|${d.id}` === value);

  /** The "Real device" section of a lamp or an AC. `onLinked(device)` adapts the item. */
  function deviceSection(item, kind, { snapshot, changed }) {
    const link = linkOf(item);
    const current = link ? `${link.service}|${link.id}` : '';
    if (!anyConnected()) {
      return section('Dispositivo real',
        h('p.note', 'Simulado. Conecte o Home Assistant para controlar o dispositivo de verdade.'),
        h('button.btn.wide', { onclick: () => onOpen(null) }, icon('link', 14), 'Abrir Conexões'));
    }
    if (!state.devices && !state.loading) setTimeout(() => load({ quiet: true }), 0);
    const select = picker(kind, current);
    select.addEventListener('change', () => {
      snapshot();
      const value = select.value;
      delete item.link;
      if (item.tuya) { delete item.tuya.deviceId; if (!Object.keys(item.tuya).length) delete item.tuya; }
      const device = find(value);
      if (value) {
        const [service, id] = value.split('|');
        if (service === 'smartlife') item.tuya = { ...(item.tuya || {}), deviceId: id };
        else item.link = { service, id };
        // Smart Life sensors only work beside a Smart Life AC.
        if (service !== 'smartlife' && item.tuya) delete item.tuya;
      }
      let note = null;
      if (device && kind === 'light' && device.capabilities) {
        item.capabilities = [...device.capabilities];
        note = device.capabilities.length ? `Ajustado ao que ela faz: ${device.capabilities.join(', ').replace('brightness', 'brilho').replace('temp', 'temperatura de branco').replace('color', 'cor')}` : 'Ajustado: só liga e desliga';
      }
      if (device && kind === 'ac' && device.min != null) { item.min = Math.round(device.min); item.max = Math.round(device.max); }
      if (device && ['tv', 'gate', 'shortcut', 'toggle'].includes(kind) && (!item.name || PLACEHOLDERS.includes(item.name))) item.name = device.name;
      changed(note);
    });
    const device = find(current);
    const info = device ? [SERVICES[device.service].name, device.detail, device.room].filter(Boolean).join(' · ')
      : current && state.devices ? 'Este dispositivo não foi encontrado agora.'
        : state.loading ? 'Carregando seus dispositivos…' : '';
    const offline = device && !device.online;
    return section('Dispositivo real',
      h('label.field', h('span', 'Entidade'), select),
      info ? h(`p.note${offline ? '.bad' : ''}`, offline ? `${info} · indisponível` : info) : null,
      device?.service === 'homekit' && state.info.homekit?.remote ? h('p.note', 'Acionado pelo iPhone; simulado neste Mac.') : null,
      Object.keys(state.errors).length ? h('p.note.bad', Object.entries(state.errors).map(([s, e]) => `${SERVICES[s]?.name || s}: ${e}`).join(' · ')) : null);
  }

  /** An AC's thermometer: any platform's sensor (a Smart Life one only beside a Smart Life AC). */
  function sensorSection(item, { snapshot, changed }) {
    const link = linkOf(item);
    const current = item.sensor?.id ? `${item.sensor.service}|${item.sensor.id}`
      : item.tuya?.sensorId ? `smartlife|${item.tuya.sensorId}` : '';
    const select = picker('sensor', current, (d) => d.service !== 'smartlife' || link?.service === 'smartlife');
    select.addEventListener('change', () => {
      snapshot();
      delete item.sensor;
      if (item.tuya) delete item.tuya.sensorId;
      const [service, id] = select.value ? select.value.split('|') : [];
      if (service === 'smartlife') item.tuya = { ...(item.tuya || {}), sensorId: id };
      else if (service) item.sensor = { service, id };
      changed();
    });
    return section('Temperatura do ambiente',
      h('label.field', h('span', 'Termômetro'), select),
      h('p.note', 'Um sensor de temperatura no mesmo cômodo. Sem ele, vale a leitura do próprio ar, ou a temperatura é estimada.'));
  }

  /** "id → plan item name" for every device the plan links, to mark them in the lists. */
  function usedMap(doc) {
    const out = new Map();
    for (const d of [...doc.lights, ...doc.acs, ...(doc.tvs || []), ...(doc.gates || []), ...(doc.shortcuts || []), ...(doc.toggles || [])]) {
      const l = linkOf(d);
      if (l) out.set(`${l.service}|${l.id}`, d.name || d.id);
      if (d.sensor?.id) out.set(`${d.sensor.service}|${d.sensor.id}`, `${d.name || d.id} · room`);
      if (d.tuya?.sensorId) out.set(`smartlife|${d.tuya.sensorId}`, `${d.name || d.id} · room`);
    }
    return out;
  }

  return {
    state, load, refreshInfo, sidebarRow, overview, detail, tile, deviceSection, sensorSection, usedMap,
    connected, stopPairing,
    title: (id) => SERVICES[id]?.name,
    blurb: (id) => LOOK[id]?.blurb,
  };
}
