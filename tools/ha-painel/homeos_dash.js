// Gera e grava o painel "HomeOs" (url /home-os) no HA. Uso: abrir o HA no navegador já logado,
// colar este arquivo no console (DevTools) e rodar. Requer uix (card_mod) para o visual de vidro.
// Cores: as do app HomeOs (paleta "Deep Ocean", web/src/style.css), as mesmas do tema HomeOs
// (tools/ha-tema/homeos.yaml): fundo #040D17, cards em degradê azul-escuro com borda fina,
// luz acesa em azul (#91CCFF), como os cartões do app.
// WARM: a cor das luzes (era laranja até 15/11/2026; agora o azul aceso do app).
const BASE = '/home-os', WARM = '#91ccff', BLUE = '#5aa2ff';
const BG = 'radial-gradient(120% 55% at 50% 0%, #0b2741 0%, rgba(11, 39, 65, 0) 62%) fixed, #040d17';
const GLASS = `ha-card { background: linear-gradient(165deg, rgba(13,30,47,0.92) 0%, rgba(7,19,31,0.92) 100%) !important; border: 1px solid rgba(145,204,255,0.13) !important; border-radius: 20px !important; box-shadow: none !important; backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); color: #e9edf2; --primary-text-color: #e9edf2; --secondary-text-color: rgba(233,237,242,0.64); }`;
const GLASS_ON = GLASS + ` ha-card.active { background: radial-gradient(120% 90% at 50% 120%, #0a78c8 0%, #00508d 38%, #0b2741 72%, #0d1e2f 100%) !important; border-color: rgba(145,204,255,0.38) !important; box-shadow: 0 16px 30px -20px #0a78c8 !important; }`;
const PLAIN = `ha-card { background: none !important; border: 0 !important; box-shadow: none !important; }`;
const GREET_CSS = PLAIN + ` ha-card { color: #e9edf2; padding: 4px 4px 0 !important; } ha-markdown { padding: 0 !important; } ha-markdown h2 { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; margin: 0 0 2px; color: #e9edf2; } ha-markdown p { color: rgba(233,237,242,0.64); margin: 0; font-size: 14px; }`;
const mod = (css = GLASS) => ({ card_mod: { style: css } });

const tile = (entity, name, icon, color = BLUE, kw = {}) => ({
  type: 'tile', entity, color, vertical: false,
  tap_action: { action: 'toggle' }, icon_tap_action: { action: 'more-info' },
  ...(name && { name }), ...(icon && { icon }), ...kw, ...mod(color === WARM ? GLASS_ON : GLASS),
});
const light = (e, n) => tile(e, n, null, WARM);
const info = (e, n, i, kw = {}) => tile(e, n, i, BLUE, { tap_action: { action: 'more-info' }, ...kw });
const heading = (text, icon, nav) => ({ type: 'heading', heading: text, heading_style: 'subtitle',
  ...(icon && { icon }), ...(nav && { tap_action: { action: 'navigate', navigation_path: nav } }) });
const gate = () => tile('cover.portao_garagem', 'Portão', 'mdi:garage-variant', BLUE, {
  tap_action: { action: 'perform-action', perform_action: 'cover.toggle', target: { entity_id: 'cover.portao_garagem' },
    confirmation: { text: 'Acionar o portão da garagem?' } }, grid_options: { columns: 12 } });
const script = (e, n, i) => tile(e, n, i, BLUE, {
  tap_action: { action: 'perform-action', perform_action: 'script.turn_on', target: { entity_id: e } } });
const ac = (e, n) => tile(e, n, null, BLUE, { tap_action: { action: 'more-info' }, grid_options: { columns: 12 },
  features_position: 'bottom', features: [{ type: 'target-temperature' },
    { type: 'climate-hvac-modes', style: 'icons', hvac_modes: ['off', 'cool', 'dry', 'fan_only', 'auto'] }] });
const media = (e, n, i) => tile(e, n, i, BLUE, { tap_action: { action: 'more-info' }, grid_options: { columns: 12 },
  features_position: 'bottom', features: [{ type: 'media-player-volume-slider' }] });
// ---------- os cards do app: o ar e a TV com a foto do aparelho (web/src/style.css .tile.card) ----------
// Um card quadrado: nome em cima, o ícone (liga/desliga) à direita, a foto do aparelho desligado
// ou ligado (as mesmas do app, servidas pelo HA em /local/homeos/img/), o brilho azul por baixo
// quando ligado e os controles embaixo. Feito com uix (card_mod) sobre o card "tile" do HA.
const IMG = '/local/homeos/img';
const SCENE_FADE = 'linear-gradient(90deg, #000 0, #000 86%, transparent 100%), linear-gradient(180deg, transparent 0, #000 22%, #000 78%, transparent 100%)';
const sceneStyle = (onTest, glow, picture, extra = '') => ({ card_mod: { style: {
  '.': `{% set on = ${onTest} %}
ha-card { aspect-ratio: 1 / 1; height: auto !important; min-height: 0 !important; overflow: hidden; isolation: isolate; container-type: inline-size;
  border-radius: 20px !important; color: #e9edf2; --primary-text-color: #e9edf2; --secondary-text-color: {{ '#cfe8ff' if on else 'rgba(233,237,242,0.64)' }};
  background: {{ 'radial-gradient(130% 70% at 50% 118%, ${glow}d9 0%, #00508d 30%, #0b2741 62%, #050e19 100%)' if on else 'radial-gradient(130% 80% at 50% 115%, #0b2741 0%, #07131f 60%, #050e19 100%)' }} !important;
  border: 1px solid {{ 'rgba(145,204,255,0.34)' if on else 'rgba(145,204,255,0.13)' }} !important;
  box-shadow: {{ '0 18px 34px -22px ${glow}, inset 0 1px 0 rgba(233,237,242,0.1)' if on else 'none' }} !important; }
ha-card::before { content: ''; position: absolute; z-index: 0; pointer-events: none; ${picture.box}
  background: url('${IMG}/${picture.name}-{{ 'on' if on else 'off' }}.jpg') center / cover no-repeat;
  -webkit-mask-image: ${picture.fade || SCENE_FADE}; -webkit-mask-composite: source-in; mask-image: ${picture.fade || SCENE_FADE}; mask-composite: intersect; }
ha-card { position: relative; }
ha-tile-container { position: absolute !important; inset: 0; z-index: 1; }
ha-tile-info { flex: 1 1 auto; min-width: 0; }
${extra}`,
  'ha-tile-container $': `.background { background: none !important; border: 0 !important; } /* transparent, not hidden: it takes the tap (more-info) */
:host { height: 100%; }
.container { height: 100% !important; box-sizing: border-box; display: flex !important; flex-direction: column; justify-content: space-between !important; }
.content { flex-direction: row-reverse !important; width: 100%; }
::slotted(ha-tile-info) { flex: 1 1 auto !important; min-width: 0; }
.row { flex: 0 0 auto !important; align-items: flex-start !important; }`,
  'ha-tile-container ha-tile-info $': `.primary { font-size: 15px; font-weight: 650; text-shadow: 0 1px 8px rgba(4,13,23,0.9); }
.secondary { text-shadow: 0 1px 8px rgba(4,13,23,0.9); }`,
} } });
// O ar: a foto larga saindo pela esquerda e o visor com a temperatura, como no app.
const AC_ON = "not is_state(config.entity, 'off') and not is_state(config.entity, 'unavailable')";
const acCard = (e, n) => ({ type: 'tile', entity: e, name: n, color: BLUE, vertical: false,
  tap_action: { action: 'more-info' }, icon_tap_action: { action: 'perform-action', perform_action: 'climate.toggle', target: { entity_id: e } },
  grid_options: { columns: 12, rows: 'auto' }, features_position: 'bottom', features: [{ type: 'target-temperature' }],
  ...sceneStyle(AC_ON, '#2fa8ff', { name: 'ac', box: 'width: 150%; aspect-ratio: 640 / 478; left: -42%; top: 5%;' },
    `ha-card::after { content: '{{ state_attr(config.entity, "temperature") | int if on else "" }}'; position: absolute; z-index: 0; pointer-events: none;
  left: 47.25%; top: 46%; width: 19.8%; height: 10.1%; display: grid; place-items: center; border-radius: 3px; background: #03121c;
  font: 600 6.6cqw/1 ui-monospace, 'SF Mono', Menlo, monospace; color: #6ff0ff; letter-spacing: 0.04em; text-shadow: 0 0 6px rgba(111,240,255,0.9);
  transform: skewY(-4deg); opacity: {{ 1 if on else 0 }}; }`) });
// A TV: a tela que acende, como no app; embaixo, à esquerda, o selo do que está passando: o logo
// do app ou sistema (web/src/ui/brands.js), senão a imagem do HA, senão o símbolo de TV (um canal,
// uma entrada sem logo). Em cima, o que está passando: o título, senão o app ou a entrada.
const TV_ON = "states(config.entity) not in ['off', 'standby', 'unavailable', 'unknown']";
const svgUrl = (inner) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${inner}</svg>`)}")`;
const TV_BRANDS = [
  ['netflix', '#000', svgUrl("<path fill='#e50914' d='M6 2h3.6l2.4 7.2V2h3.6v20c-1.2-.2-2.4-.3-3.6-.3L9.6 14.4V21.6c-1.2.1-2.4.3-3.6.5z'/>")],
  ['youtube', '#fff', svgUrl("<rect x='2' y='5.5' width='20' height='13' rx='4' fill='#ff0000'/><path fill='#fff' d='M10 9v6l5.2-3z'/>")],
  ['spotify', '#121212', svgUrl("<circle cx='12' cy='12' r='10' fill='#1ed760'/><g fill='none' stroke='#121212' stroke-linecap='round'><path stroke-width='1.9' d='M6.6 9.3c3.6-1 7.8-.7 11 1'/><path stroke-width='1.6' d='M7.2 12.4c3-.8 6.3-.5 9 .9'/><path stroke-width='1.3' d='M7.8 15.3c2.4-.6 4.8-.4 6.9.7'/></g>")],
  ['playstation', '#0b3fa8', svgUrl("<path fill='#fff' d='M9.2 3.6v15.6l3.4 1.1V7.2c0-.7.3-1.1.8-.9.6.2.8.8.8 1.4v5.2c2.2 1 3.9 0 3.9-2.8 0-2.9-1-4.2-4-5.2-1.2-.4-3.4-1-4.9-1.3z'/>")],
];
const TV_MARK = svgUrl("<g fill='none' stroke='#8ccbe9' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect x='2.5' y='7' width='19' height='13' rx='2'/><path d='m16.5 2.5-4.5 4.5-4.5-4.5'/></g>");
const TV_BADGE = `{% set said = [state_attr(config.entity, 'app_name'), state_attr(config.entity, 'source'), state_attr(config.entity, 'media_title')] | select('string') | join(' ') | lower %}
{% set pic = state_attr(config.entity, 'entity_picture') %}
ha-card::after { content: ''; position: absolute; z-index: 0; pointer-events: none; left: 14px; bottom: 62px; width: 40px; height: 40px;
  border-radius: 11px; box-shadow: 0 4px 14px -4px rgba(0,0,0,0.7); display: {{ 'grid' if on else 'none' }}; place-items: center;
  font: 26px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: #000;
  {% if not on %}background: none;
${TV_BRANDS.map(([k, bg, url]) => `  {% elif '${k}' in said %}background: ${bg} ${url} center / 66% no-repeat;`).join('\n')}
  {% elif said is search('(^| )(mac|macos|macbook|imac|apple|airplay)( |$)') %}background: #f2f2f4; content: '\\F8FF';
  {% elif pic %}background: #0b1826 url('{{ pic }}') center / cover no-repeat;
  {% else %}background: #0b1826 ${TV_MARK} center / 62% no-repeat; box-shadow: 0 4px 14px -4px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(145,204,255,0.18);
  {% endif %} }`;
const tvCard = (e, n, i) => ({ type: 'tile', entity: e, name: n, icon: i, color: BLUE, vertical: false,
  tap_action: { action: 'more-info' }, icon_tap_action: { action: 'toggle' },
  state_content: ['media_title', 'source'],
  grid_options: { columns: 12, rows: 'auto' }, features_position: 'bottom', features: [{ type: 'media-player-volume-slider' }],
  ...sceneStyle(TV_ON, '#6fa8ff', { name: 'tv', box: 'width: 118%; aspect-ratio: 1; left: -4%; top: 12%;' }, TV_BADGE) });

const section = (title, cards, icon, span = 1) => ({ type: 'grid', column_span: span, cards: [heading(title, icon), ...cards] });

const CAMS = { frente: 'Frente', garagem: 'Garagem', quintal: 'Quintal', corredor: 'Corredor', sala: 'Sala' };
const camCard = (ids, grid = false) => ({ type: 'custom:advanced-camera-card',
  cameras: ids.map((id) => ({ camera_entity: `camera.${id}`, title: CAMS[id] })), view: { default: 'live' },
  live: { zoomable: true, lazy_unload: ['hidden'],
    ...(grid && { display: { mode: 'grid', grid_selected_width_factor: 1, grid_max_columns: 3 } }),
    controls: { thumbnails: { mode: ids.length > 1 && !grid ? 'below' : 'none' }, ptz: { mode: 'off' },
      ...(grid && { next_previous: { style: 'none' } }) } },
  grid_options: { columns: 'full' }, ...mod(GLASS + ' ha-card { overflow: hidden; }') });
const half = { grid_options: { columns: 6 } };
const camSettings = (id) => section(CAMS[id], [camCard([id]),
  tile(`switch.${id}_detect`, 'Detecção', 'mdi:motion-sensor', BLUE, half),
  tile(`input_boolean.notificar_${id}`, 'Notificar', 'mdi:bell-ring', BLUE, half),
  info(`input_number.confianca_${id}`, 'Confiança mínima', null, { grid_options: { columns: 12 },
    features: [{ type: 'numeric-input', style: 'slider' }], features_position: 'bottom' }),
  info(`input_select.intervalo_${id}`, 'Intervalo mínimo', 'mdi:timer-outline', { grid_options: { columns: 6 },
    features: [{ type: 'select-options' }], features_position: 'bottom' }),
  tile(`input_boolean.exigir_zona_${id}`, 'Só na zona', 'mdi:vector-polygon', BLUE, half)], 'mdi:cctv', 2);
const camRoom = (id) => ['Câmera', [camCard([id])], 2];
const appleTv = () => media('media_player.apple_tv', 'Apple TV', 'mdi:television-box');

// Cômodos com aparelhos, na ordem do app.
const ROOMS = [
  ['garagem', 'garagem', 'Garagem', 'mdi:garage', [
    ['Portão', [gate()]], ['Luzes', [light('light.garagem', 'Luz da Garagem')]], camRoom('garagem')]],
  ['sala', 'sala_de_estar', 'Sala de estar', 'mdi:sofa', [
    ['Luzes', [light('light.sala_principal', 'Principal'), light('light.sala_cortina', 'Cortina'),
      light('light.sala_de_estar_luz_central_1', 'Central 1'), light('light.sala_de_estar_luz_central_2', 'Central 2'),
      light('light.sala_de_estar_spots_da_sala', 'Spots'), light('light.sala_de_estar_luz_do_movel', 'Móvel')]],
    ['Ar-condicionado', [acCard('climate.central_sala', 'Ar da Sala')]],
    ['TV', [tvCard('media_player.tv_lg', 'TV LG', 'mdi:television'),
      tile('switch.sala_de_estar_tv_lg_screen', 'Tela da TV', 'mdi:monitor'), appleTv()]], camRoom('sala')]],
  ['office', 'home_office', 'Home Office', 'mdi:chair-rolling', [
    ['Luzes', [light('light.home_office_centro', 'Centro'), light('light.home_office_spots', 'Spots'),
      light('light.home_office_led', 'LED')]],
    ['Monitor e Alexa', [tvCard('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
      tile('switch.lg_webos_u701sb_screen', 'Tela do monitor', 'mdi:monitor'),
      media('media_player.home_office_echo_show_familia', 'Echo Show', 'mdi:speaker-message')]]]],
  ['cozinha', 'cozinha', 'Cozinha', 'mdi:stove', [
    ['Luzes', [light('light.cozinha_mesa', 'Mesa'), light('light.cozinha_bancada', 'LED da Bancada'),
      light('light.cozinha_spots', 'Spots')]]]],
  ['circulacao', 'circulacao', 'Circulação', 'mdi:shoe-print', [
    ['Luzes', [light('light.circulacao_centro', 'Centro'), light('light.circulacao_led', 'LED')]]]],
  ['suite', 'quarto', 'Suíte', 'mdi:bed-king', [
    ['Luzes', [light('light.suite_centro', 'Centro'), light('light.suite_led', 'LED')]],
    ['Ar-condicionado', [acCard('climate.central_quarto', 'Ar do Quarto')]]]],
  ['corredor', 'corredor', 'Corredor', 'mdi:road-variant', [['Luzes', [light('light.corredor', 'Luz do Corredor')]], camRoom('corredor')]],
  ['quintal', 'quintal', 'Quintal', 'mdi:pine-tree-variant-outline', [['Luzes', [light('light.quintal', 'Luz do Quintal')]], camRoom('quintal')]],
];

const GREETING = `{% set h = now().hour %}{% set luzes = states.light | selectattr('state','eq','on') | rejectattr('entity_id','search','luz_de_fundo') | list | count %}
## {{ 'Bom dia' if 5 <= h < 12 else 'Boa tarde' if 12 <= h < 18 else 'Boa noite' }}
{{ 'Nenhuma luz acesa' if luzes == 0 else (luzes ~ ' luz acesa' if luzes == 1 else luzes ~ ' luzes acesas') }} · Portão {{ 'aberto' if is_state('cover.portao_garagem','open') else 'fechado' if is_state('cover.portao_garagem','closed') else states('cover.portao_garagem') }}`;

const area = (path, a, name, cols) => ({ type: 'area', area: a, display_type: 'compact', name, color: WARM,
  ...(path && { navigation_path: `${BASE}/${path}` }),
  features: [{ type: 'area-controls', controls: ['light'] }], features_position: 'inline',
  grid_options: { columns: cols }, ...mod() });

const view = (title, path, icon, sections, extra = {}) => ({ title, path, icon, type: 'sections', max_columns: 4,
  dense_section_placement: true, background: BG, sections, ...extra });

const home = view('Casa', 'casa', 'mdi:home', [
  { type: 'grid', column_span: 4, cards: [{ type: 'markdown', content: GREETING, text_only: true, card_mod: { style: { '.': 'ha-card { background: none !important; border: 0 !important; box-shadow: none !important; padding: 0 4px !important; }', 'ha-markdown$': 'h2 { font-size: 32px; font-weight: 700; letter-spacing: -0.6px; margin: 0 0 4px; color: #e9edf2; } p { color: rgba(233,237,242,0.64); margin: 0; font-size: 15px; }' } } }] },
  section('Atalhos', [gate(),
    script('script.apagar_todas_as_luzes', 'Apagar todas', 'mdi:lightbulb-group-off-outline'),
    script('script.ligar_todas_as_luzes', 'Ligar todas', 'mdi:lightbulb-group-outline'),
    script('script.ligar_luzes_externas', 'Externas: ligar', 'mdi:outdoor-lamp'),
    script('script.apagar_luzes_externas', 'Externas: apagar', 'mdi:coach-lamp')], 'mdi:lightning-bolt'),
  section('Cômodos', ROOMS.map(([p, a, n]) => area(p, a, n, 6)), 'mdi:floor-plan', 2),
  { type: 'grid', column_span: 2, cards: [heading('Câmeras', 'mdi:cctv', `${BASE}/cameras`), camCard(Object.keys(CAMS))] },
  section('Clima', [acCard('climate.central_sala', 'Ar da Sala'), acCard('climate.central_quarto', 'Ar do Quarto'),
    { type: 'weather-forecast', entity: 'weather.forecast_casa', forecast_type: 'daily', show_forecast: true, name: 'Tempo', ...mod() }],
    'mdi:thermometer'),
  section('Mídia', [tvCard('media_player.tv_lg', 'TV LG', 'mdi:television'), appleTv(),
    tvCard('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
    media('media_player.home_office_echo_show_familia', 'Echo Show', 'mdi:speaker-message')], 'mdi:play-circle-outline'),
  section('Automações', [
    tile('input_boolean.luzes_por_presenca', 'Luzes por presença', 'mdi:motion-sensor'),
    tile('input_boolean.automacoes_do_portao', 'Automações do portão', 'mdi:garage-alert'),
    tile('input_boolean.vigilancia_da_sala', 'Vigilância da sala', 'mdi:shield-home'),
    tile('automation.cameras_pessoa_detectada_notificar_com_foto', 'Aviso de pessoa', 'mdi:account-alert')], 'mdi:robot-outline'),
  section('Casa', [
    { type: 'todo-list', entity: 'todo.lista_de_compras', title: 'Lista de compras', ...mod() },
    info('binary_sensor.ex511_status_da_wan', 'Internet', 'mdi:web'),
    info('sensor.ex511_download_speed', 'Download', 'mdi:download', { grid_options: { columns: 6 } }),
    info('sensor.ex511_upload_speed', 'Upload', 'mdi:upload', { grid_options: { columns: 6 } })], 'mdi:home-heart'),
], { badges: ['weather.forecast_casa', 'person.wenderson'].map((entity) => ({ type: 'entity', entity, show_name: false, show_icon: true, show_state: true })) });

const rooms = ROOMS.map(([p, a, n, i, groups]) => view(n, p, i, [
  { type: 'grid', column_span: 4, cards: [area(null, a, n, 'full')] },
  ...groups.map(([t, cards, span]) => section(t, cards, null, span))]));

const cameras = view('Câmeras', 'cameras', 'mdi:cctv', [
  { type: 'grid', column_span: 4, cards: [camCard(Object.keys(CAMS), true)] },
  ...Object.keys(CAMS).map(camSettings)]);

const config = { title: 'HomeOs', views: [home, cameras, ...rooms] };
const hass = document.querySelector('home-assistant').hass;
const list = await hass.callWS({ type: 'lovelace/dashboards/list' });
if (!list.some((d) => d.url_path === 'home-os')) {
  await hass.callWS({ type: 'lovelace/dashboards/create', url_path: 'home-os', title: 'HomeOs', icon: 'mdi:home-variant',
    show_in_sidebar: true, require_admin: false, mode: 'storage' });
}
await hass.callWS({ type: 'lovelace/config/save', url_path: 'home-os', config });
'ok: ' + config.views.length + ' abas';
