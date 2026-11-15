// Gera e grava o painel "HomeOs" (url /home-os) no HA. Uso: abrir o HA no navegador já logado,
// colar este arquivo no console (DevTools) e rodar. Requer uix (card_mod) para o visual de vidro.
const BASE = '/home-os', WARM = '#ffb46b', BLUE = '#3d8bff';
const BG = 'radial-gradient(90% 70% at 20% 0%, #5b6f8f 0%, transparent 60%), radial-gradient(80% 80% at 90% 100%, #6e5a4a 0%, transparent 60%), #2b3140';
const GLASS = `ha-card { background: rgba(255,255,255,0.055) !important; border: 1px solid rgba(255,255,255,0.085) !important; border-radius: 20px !important; box-shadow: none !important; backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3); color: #f3f5fa; --primary-text-color: #f3f5fa; --secondary-text-color: rgba(222,230,247,0.58); }`;
const GLASS_ON = GLASS + ` ha-card.active { background: rgba(255,180,107,0.16) !important; border-color: rgba(255,180,107,0.35) !important; }`;
const PLAIN = `ha-card { background: none !important; border: 0 !important; box-shadow: none !important; }`;
const GREET_CSS = PLAIN + ` ha-card { color: #f3f5fa; padding: 4px 4px 0 !important; } ha-markdown { padding: 0 !important; } ha-markdown h2 { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; margin: 0 0 2px; color: #f3f5fa; } ha-markdown p { color: rgba(222,230,247,0.58); margin: 0; font-size: 14px; }`;
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
    ['Ar-condicionado', [ac('climate.central_sala', 'Ar da Sala')]],
    ['TV', [media('media_player.tv_lg', 'TV LG', 'mdi:television'),
      tile('switch.sala_de_estar_tv_lg_screen', 'Tela da TV', 'mdi:monitor'), appleTv()]], camRoom('sala')]],
  ['office', 'home_office', 'Home Office', 'mdi:chair-rolling', [
    ['Luzes', [light('light.home_office_centro', 'Centro'), light('light.home_office_spots', 'Spots'),
      light('light.home_office_led', 'LED')]],
    ['Monitor e Alexa', [media('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
      tile('switch.lg_webos_u701sb_screen', 'Tela do monitor', 'mdi:monitor'),
      media('media_player.home_office_echo_show_familia', 'Echo Show', 'mdi:speaker-message')]]]],
  ['cozinha', 'cozinha', 'Cozinha', 'mdi:stove', [
    ['Luzes', [light('light.cozinha_mesa', 'Mesa'), light('light.cozinha_bancada', 'LED da Bancada'),
      light('light.cozinha_spots', 'Spots')]]]],
  ['circulacao', 'circulacao', 'Circulação', 'mdi:shoe-print', [
    ['Luzes', [light('light.circulacao_centro', 'Centro'), light('light.circulacao_led', 'LED')]]]],
  ['suite', 'quarto', 'Suíte', 'mdi:bed-king', [
    ['Luzes', [light('light.suite_centro', 'Centro'), light('light.suite_led', 'LED')]],
    ['Ar-condicionado', [ac('climate.central_quarto', 'Ar do Quarto')]]]],
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
  { type: 'grid', column_span: 4, cards: [{ type: 'markdown', content: GREETING, text_only: true, card_mod: { style: { '.': 'ha-card { background: none !important; border: 0 !important; box-shadow: none !important; padding: 0 4px !important; }', 'ha-markdown$': 'h2 { font-size: 32px; font-weight: 700; letter-spacing: -0.6px; margin: 0 0 4px; color: #f3f5fa; } p { color: rgba(222,230,247,0.62); margin: 0; font-size: 15px; }' } } }] },
  section('Atalhos', [gate(),
    script('script.apagar_todas_as_luzes', 'Apagar todas', 'mdi:lightbulb-group-off-outline'),
    script('script.ligar_todas_as_luzes', 'Ligar todas', 'mdi:lightbulb-group-outline'),
    script('script.ligar_luzes_externas', 'Externas: ligar', 'mdi:outdoor-lamp'),
    script('script.apagar_luzes_externas', 'Externas: apagar', 'mdi:coach-lamp')], 'mdi:lightning-bolt'),
  section('Cômodos', ROOMS.map(([p, a, n]) => area(p, a, n, 6)), 'mdi:floor-plan', 2),
  { type: 'grid', column_span: 2, cards: [heading('Câmeras', 'mdi:cctv', `${BASE}/cameras`), camCard(Object.keys(CAMS))] },
  section('Clima', [ac('climate.central_sala', 'Ar da Sala'), ac('climate.central_quarto', 'Ar do Quarto'),
    { type: 'weather-forecast', entity: 'weather.forecast_casa', forecast_type: 'daily', show_forecast: true, name: 'Tempo', ...mod() }],
    'mdi:thermometer'),
  section('Mídia', [media('media_player.tv_lg', 'TV LG', 'mdi:television'), appleTv(),
    media('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
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
