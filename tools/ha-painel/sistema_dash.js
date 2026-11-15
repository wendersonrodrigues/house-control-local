// Gera e grava a "Visão geral" do HA como o painel de SISTEMA da casa (15/11/2026): só o que o
// painel HomeOs (homeos_dash.js) e o app não têm. Luzes, ar, TV, portão e os ajustes de
// notificação das câmeras ficam no HomeOs; aqui ficam:
//   - Sistema:      atualizações pendentes, backup, pessoas e aparelhos, conectividade;
//   - Frigate:      por câmera, o que o Frigate grava e detecta (detecção, movimento, gravação,
//                   fotos, alertas, contraste), e quem foi reconhecido onde;
//   - Automações:   ligar/desligar cada automação, as chaves de apoio e os scripts.
// Visual: o do app HomeOs (o mesmo vidro escuro do homeos_dash.js; tema HomeOs).
// Uso: abrir o HA logado, colar no console e rodar (requer uix/card_mod, como o HomeOs).
// O painel antigo ficou guardado em /backup-visao-geral (escondido, só administradores).

const BLUE = '#5aa2ff';
const BG = 'radial-gradient(120% 55% at 50% 0%, #0b2741 0%, rgba(11, 39, 65, 0) 62%) fixed, #040d17';
const GLASS = `ha-card { background: linear-gradient(165deg, rgba(13,30,47,0.92) 0%, rgba(7,19,31,0.92) 100%) !important; border: 1px solid rgba(145,204,255,0.13) !important; border-radius: 20px !important; box-shadow: none !important; color: #e9edf2; --primary-text-color: #e9edf2; --secondary-text-color: rgba(233,237,242,0.64); }`;
const ALERT = `ha-card { background: linear-gradient(165deg, rgba(60,30,8,0.9) 0%, rgba(30,16,6,0.9) 100%) !important; border: 1px solid rgba(255,180,107,0.35) !important; border-radius: 20px !important; box-shadow: none !important; color: #ffe2c4; }`;
const PLAIN = `ha-card { background: none !important; border: 0 !important; box-shadow: none !important; }`;
const mod = (css = GLASS) => ({ card_mod: { style: css } });

const HA = document.querySelector('home-assistant').hass;
const S = HA.states;
const has = (e) => Boolean(S[e]);
const name = (e) => S[e]?.attributes?.friendly_name || e;

const heading = (heading, icon) => ({ type: 'heading', heading, heading_style: 'title', ...(icon && { icon }) });
const tile = (entity, nm, icon, kw = {}) => ({ type: 'tile', entity, vertical: false, color: BLUE,
  ...(nm && { name: nm }), ...(icon && { icon }), ...kw, ...mod() });
const toggle = (entity, nm, icon) => tile(entity, nm, icon, { tap_action: { action: 'toggle' }, features: [{ type: 'toggle' }], features_position: 'inline' });
const run = (entity, nm, icon) => tile(entity, nm, icon, { tap_action: { action: 'perform-action', perform_action: 'script.turn_on', target: { entity_id: entity } },
  icon_tap_action: { action: 'perform-action', perform_action: 'script.turn_on', target: { entity_id: entity } }, hold_action: { action: 'more-info' } });
const half = { grid_options: { columns: 6 } };
const section = (title, cards, icon, span = 1) => ({ type: 'grid', column_span: span, cards: [heading(title, icon), ...cards] });
const view = (title, path, icon, sections) => ({ title, path, icon, type: 'sections', max_columns: 4, dense_section_placement: true, background: BG, sections });
const md = (content, css = PLAIN) => ({ type: 'markdown', content, ...mod(css) });

// ---------- Sistema ----------
const UPDATES = Object.keys(S).filter((k) => k.startsWith('update.'));
const updatesCard = {
  type: 'vertical-stack', cards: [
    // tudo em dia: uma linha só
    { ...md(`<ha-icon icon="mdi:check-decagram"></ha-icon> &nbsp;**Tudo atualizado.** Nenhuma atualização pendente.`, GLASS + ' ha-card { padding: 4px 6px; } ha-icon { color: #5fe08a; }'),
      visibility: UPDATES.map((e) => ({ condition: 'state', entity: e, state_not: 'on' })) },
    // as pendentes, cada uma com o botão do HA
    ...UPDATES.map((e) => ({ ...tile(e, name(e).replace(/ Update$/, ''), null, { tap_action: { action: 'more-info' }, ...mod(ALERT) }),
      visibility: [{ condition: 'state', entity: e, state: 'on' }] })),
  ] };
const sistema = view('Sistema', 'sistema', 'mdi:server', [
  section('Atualizações', [updatesCard], 'mdi:update'),
  section('Backup', [
    tile('sensor.backup_last_successful_automatic_backup', 'Último backup', 'mdi:backup-restore', { state_content: ['last_changed'] }),
    tile('sensor.backup_next_scheduled_automatic_backup', 'Próximo backup', 'mdi:calendar-clock'),
  ].filter((c) => has(c.entity)), 'mdi:archive'),
  section('Pessoas e aparelhos', [
    ...Object.keys(S).filter((k) => k.startsWith('person.')).map((e) => tile(e, null, null, { tap_action: { action: 'more-info' } })),
    ...Object.keys(S).filter((k) => k.startsWith('device_tracker.')).map((e) => tile(e, null, null, { tap_action: { action: 'more-info' }, ...half })),
  ], 'mdi:account-group'),
  section('Conectividade', Object.keys(S).filter((k) => /conectividade|connectivity/.test(k) && k.startsWith('binary_sensor.'))
    .map((e) => tile(e, name(e).replace(/ Conectividade$/, ''), null, { tap_action: { action: 'more-info' }, ...half })), 'mdi:lan-connect'),
]);

// ---------- Frigate ----------
const CAMS = [['frente', 'Frente'], ['garagem', 'Garagem'], ['sala', 'Sala'], ['cozinha', 'Cozinha'], ['corredor', 'Corredor'], ['quintal', 'Quintal']];
const FRIGATE_SWITCHES = [
  ['detect', 'Detecção', 'mdi:motion-sensor'], ['motion', 'Movimento', 'mdi:run'], ['recordings', 'Gravação', 'mdi:record-rec'],
  ['snapshots', 'Fotos', 'mdi:camera'], ['review_alerts', 'Alertas', 'mdi:alert-circle-outline'], ['review_detections', 'Revisão das detecções', 'mdi:eye-check-outline'],
  ['improve_contrast', 'Contraste noturno', 'mdi:contrast-box'],
];
const camSection = ([id, nm]) => section(nm, [
  // compactos, dois por linha: um toque liga/desliga, segurar abre os detalhes
  ...FRIGATE_SWITCHES.filter(([s]) => has(`switch.${id}_${s}`)).map(([s, label, icon]) => tile(`switch.${id}_${s}`, label, icon,
    { tap_action: { action: 'toggle' }, icon_tap_action: { action: 'toggle' }, hold_action: { action: 'more-info' }, ...half })),
], 'mdi:cctv');
const PEOPLE = Object.keys(S).filter((k) => /^sensor\.frigate_.+_last_camera$/.test(k));
const frigate = view('Frigate', 'frigate', 'mdi:cctv', [
  section('Servidor', [
    ...['update.frigate_server', 'update.frigate_update'].filter(has).map((e) => tile(e, e.endsWith('server') ? 'Frigate (servidor)' : 'Frigate (integração)', 'mdi:cctv', { tap_action: { action: 'more-info' } })),
    run('script.ligar_deteccao_cameras', 'Ligar detecção em todas', 'mdi:cctv'),
    run('script.desligar_deteccao_cameras', 'Desligar detecção em todas', 'mdi:cctv-off'),
  ], 'mdi:server-network'),
  // só quem já foi reconhecido em alguma câmera (os outros dizem "Unknown")
  section('Quem foi visto onde', PEOPLE.map((e) => ({ ...tile(e, name(e).replace(/^Frigate /, '').replace(/ Last Camera$/, ''), 'mdi:face-recognition', { tap_action: { action: 'more-info' } }), ...half,
    visibility: [{ condition: 'state', entity: e, state_not: 'Unknown' }, { condition: 'state', entity: e, state_not: 'unknown' }, { condition: 'state', entity: e, state_not: 'unavailable' }] })), 'mdi:face-recognition'),
  ...CAMS.map(camSection),
]);

// ---------- Automações ----------
const AUTOS = Object.keys(S).filter((k) => k.startsWith('automation.'));
const group = (prefix) => AUTOS.filter((e) => name(e).startsWith(prefix));
const autoTile = (e) => toggle(e, name(e).replace(/^(Câmeras|Portão) - /, ''), null);
const BOOLS = Object.keys(S).filter((k) => k.startsWith('input_boolean.') && !/^input_boolean\.(notificar_|exigir_zona_|lab_)/.test(k));
const SCRIPTS = Object.keys(S).filter((k) => k.startsWith('script.'));
const automacoes = view('Automações', 'automacoes', 'mdi:robot', [
  section('Câmeras', group('Câmeras').map(autoTile), 'mdi:cctv'),
  section('Portão', group('Portão').map(autoTile), 'mdi:garage-variant'),
  section('Outras', AUTOS.filter((e) => !/^(Câmeras|Portão) - /.test(name(e))).map(autoTile), 'mdi:robot'),
  section('Chaves', BOOLS.map((e) => ({ ...toggle(e, name(e), null), ...half })), 'mdi:toggle-switch'),
  section('Scripts', SCRIPTS.map((e) => ({ ...run(e, name(e), null), ...half })), 'mdi:script-text-play'),
].filter((s) => s.cards.length > 1));

const config = { title: 'Sistema', views: [sistema, frigate, automacoes] };
const target = window.__SISTEMA_TARGET__ || null; // null = a Visão geral (o painel padrão)
await HA.callWS({ type: 'lovelace/config/save', url_path: target, config });
window.__SISTEMA_RESULT__ = { gravado: target || 'Visão geral', abas: config.views.map((v) => `${v.title} (${v.sections.length})`) };
console.log('Painel de sistema gravado', window.__SISTEMA_RESULT__);
