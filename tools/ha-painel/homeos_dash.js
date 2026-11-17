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
// A lâmpada como no app (web/src/style.css .tile.lamp): a etiqueta pequena acima do nome ("LUZ",
// "LUZ LED", as do Mac), o anel à direita como o interruptor da parede: vermelho apagada, azul
// brilhando acesa, com o card em degradê azul. Toque liga/desliga; segurar abre os detalhes.
const LAMP_ON = "is_state(config.entity, 'on')";
const light = (e, n, tag = 'Luz') => ({ type: 'tile', entity: e, name: n, color: WARM, vertical: false,
  tap_action: { action: 'toggle' }, hold_action: { action: 'more-info' }, icon_tap_action: { action: 'toggle' },
  card_mod: { style: {
    '.': `{% set on = ${LAMP_ON} %}
ha-card { position: relative; overflow: hidden; border-radius: 18px !important; color: #e9edf2; --primary-text-color: {{ '#fff' if on else '#e9edf2' }};
  background: {{ 'radial-gradient(120% 90% at 50% 120%, #0a78c8 0%, #00508d 38%, #0b2741 72%, #0d1e2f 100%)' if on else 'linear-gradient(165deg, #0d1e2f 0%, #07131f 100%)' }} !important;
  border: 1px solid {{ 'rgba(145,204,255,0.38)' if on else 'rgba(145,204,255,0.13)' }} !important;
  box-shadow: {{ '0 16px 30px -20px #0a78c8, inset 0 1px 0 rgba(233,237,242,0.1)' if on else 'none' }} !important; }
ha-card::after { content: ''; position: absolute; right: 16px; top: 50%; width: 24px; height: 24px; margin-top: -12px; box-sizing: border-box; border-radius: 50%; pointer-events: none;
  border: 2.5px solid {{ '#bfe3ff' if on else '#ff4d4d' }};
  box-shadow: {{ '0 0 12px 2px rgba(120,190,255,0.95), 0 0 3px rgba(233,245,255,0.9), inset 0 0 6px rgba(145,204,255,0.8)' if on else '0 0 10px 0 rgba(255,70,70,0.75), inset 0 0 6px rgba(255,70,70,0.5)' }}; }
ha-tile-icon { display: none !important; }
ha-tile-info { padding-right: 34px; }
ha-tile-info::before { content: '${tag.toUpperCase()}'; display: block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.09em; color: #8ccbe9; opacity: 0.9; margin-bottom: 1px; }
ha-tile-info [slot=secondary] { display: none; }`,
    'ha-tile-container $': '.background { background: none !important; } /* transparent, not hidden: it takes the tap */',
    'ha-tile-container ha-tile-info $': '.primary { font-size: 14px; font-weight: 600; }',
  } } });
const info = (e, n, i, kw = {}) => tile(e, n, i, BLUE, { tap_action: { action: 'more-info' }, ...kw });
const heading = (text, icon, nav) => ({ type: 'heading', heading: text, heading_style: 'subtitle',
  ...(icon && { icon }), ...(nav && { tap_action: { action: 'navigate', navigation_path: nav } }) });
// O portão como no app: a foto do portão fechado ou aberto (com o brilho âmbar enquanto aberto) e
// o botão embaixo (Abrir / Fechar / Parar). O toque aciona o portão (cover.toggle) e o HA pede
// confirmação antes, o equivalente aos dois toques do app; segurar abre os detalhes.
const GATE_ON = "states(config.entity) in ['open', 'opening', 'closing']";
const GATE_FADE = 'linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%), linear-gradient(180deg, transparent 0, #000 16%, #000 80%, transparent 100%)';
const gate = () => ({ type: 'tile', entity: 'cover.portao_garagem', name: 'Portão', color: BLUE, vertical: false,
  tap_action: { action: 'perform-action', perform_action: 'cover.toggle', target: { entity_id: 'cover.portao_garagem' },
    confirmation: { text: 'Acionar o portão da garagem?' } },
  hold_action: { action: 'more-info' }, icon_tap_action: { action: 'more-info' },
  grid_options: { columns: 6, rows: 'auto' },
  ...sceneStyle(GATE_ON, '#c88a3a', { name: 'gate', on: 'gate-open', off: 'gate-closed', fade: GATE_FADE, box: 'width: 118%; aspect-ratio: 1; left: -9%; top: -13%;' },
    `ha-tile-icon { display: none !important; }
ha-card::after { content: '{{ "Parar" if states(config.entity) in ["opening", "closing"] else "Fechar" if is_state(config.entity, "open") else "Abrir" }}';
  position: absolute; z-index: 1; left: 12px; right: 12px; bottom: 12px; height: 34px; border-radius: 12px; pointer-events: none;
  display: grid; place-items: center; font: 600 14px/1 var(--ha-font-family-body); color: #e9edf2;
  background: rgba(4,13,23,0.62); box-shadow: inset 0 0 0 1px rgba(145,204,255,0.24); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }`) });
// Os atalhos como no app (web/src/style.css .scene / .glyph-ring): uma caixinha com o ícone num
// anel brilhante, vermelho para o que apaga, azul para o que liga, e o nome embaixo. Um toque roda.
const OFF_SCRIPT = /apagar|desligar|fechar/i;
const script = (e, n, i) => {
  const off = OFF_SCRIPT.test(e) || OFF_SCRIPT.test(n);
  const ring = off
    ? 'border: 2px solid #ff5a5a; color: #ffd6d6; box-shadow: 0 0 10px rgba(255,70,70,0.6), inset 0 0 6px rgba(255,70,70,0.35);'
    : 'border: 2px solid #9fd2ff; color: #e3f3ff; box-shadow: 0 0 10px rgba(120,190,255,0.65), inset 0 0 6px rgba(145,204,255,0.4);';
  return { type: 'tile', entity: e, name: n, icon: i, color: BLUE, vertical: true,
    // a script runs; a button (as the Alexa's routines) is pressed
    tap_action: { action: 'perform-action', perform_action: e.startsWith('button.') ? 'button.press' : 'script.turn_on', target: { entity_id: e } },
    hold_action: { action: 'more-info' }, icon_tap_action: { action: 'perform-action', perform_action: e.startsWith('button.') ? 'button.press' : 'script.turn_on', target: { entity_id: e } },
    card_mod: { style: {
      '.': `ha-card { border-radius: 18px !important; background: rgba(145,204,255,0.07) !important; border: 1px solid rgba(145,204,255,0.15) !important; box-shadow: none !important; }
ha-tile-icon { --tile-icon-color: ${off ? '#ffd6d6' : '#e3f3ff'}; --tile-icon-size: 16px; }
ha-tile-info [slot=secondary] { display: none; }`,
      'ha-tile-container $': '.background { background: none !important; }',
      'ha-tile-icon $': `.container { width: 30px !important; height: 30px !important; box-sizing: border-box; border-radius: 50% !important; background: none !important; ${ring} }
.container::before, .container::after { display: none !important; }`,
      'ha-tile-container ha-tile-info $': '.primary { font-size: 13px; font-weight: 600; text-align: center; }',
    } } };
};
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
  background: url('${IMG}/{{ '${picture.on || picture.name + '-on'}' if on else '${picture.off || picture.name + '-off'}' }}.jpg') center / cover no-repeat;
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
  grid_options: { columns: 6, rows: 'auto' }, features_position: 'bottom', features: [{ type: 'target-temperature' }],
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
// picture: as fotos do card (img/<name>-off/-on.jpg) e onde ficam; a TV por padrão, o Apple TV a caixinha.
const TV_PICTURE = { name: 'tv', box: 'width: 118%; aspect-ratio: 1; left: -4%; top: 12%;' };
const APPLE_TV_PICTURE = { name: 'appletv', box: 'width: 112%; aspect-ratio: 1; left: -6%; top: 6%;' };
const tvCard = (e, n, i, picture = TV_PICTURE) => ({ type: 'tile', entity: e, name: n, icon: i, color: BLUE, vertical: false,
  tap_action: { action: 'more-info' }, icon_tap_action: { action: 'toggle' },
  state_content: ['media_title', 'source'],
  grid_options: { columns: 6, rows: 'auto' }, features_position: 'bottom', features: [{ type: 'media-player-volume-slider' }],
  ...sceneStyle(TV_ON, '#6fa8ff', picture, TV_BADGE) });

const section = (title, cards, icon, span = 1) => ({ type: 'grid', column_span: span, cards: [heading(title, icon), ...cards] });

const CAMS = { garagem: 'Garagem', frente: 'Frente', sala: 'Sala', cozinha: 'Cozinha', corredor: 'Corredor', quintal: 'Quintal' };
const PTZ = ['frente', 'sala'];
const camCard = (ids, grid = false) => ({ type: 'custom:advanced-camera-card',
  cameras: ids.map((id) => ({ camera_entity: `camera.${id}`, title: CAMS[id] })), view: { default: 'live' },
  live: { zoomable: true, lazy_unload: ['hidden'],
    ...(grid && { display: { mode: 'grid', grid_selected_width_factor: 1, grid_max_columns: 3 } }),
    controls: { thumbnails: { mode: grid ? 'none' : 'below' }, ptz: ids.length === 1 && PTZ.includes(ids[0]) ? { mode: 'auto', hide_zoom: false, position: 'bottom-right' } : { mode: 'off' },
      ...(grid && { next_previous: { style: 'none' } }) } },
  grid_options: { columns: 'full' }, ...mod(GLASS + ' ha-card { overflow: hidden; }') });
const half = { grid_options: { columns: 6 } };
const appleTv = () => tvCard('media_player.apple_tv', 'Apple TV', 'mdi:apple', APPLE_TV_PICTURE);

// A Alexa (Echo Show do Home Office), como no app (web/src/ui/panel.js alexaTile): a foto do
// aparelho, o que está tocando (senão "Ocioso"), embaixo o último comando de voz e o volume;
// o ícone à direita é o "Não perturbe" (aceso enquanto ligado; um toque liga/desliga). As
// entidades da Alexa Devices são achadas pelo nome do aparelho (as rotinas da conta têm o e-mail
// no id e não entram no repositório): "<aparelho> Do not disturb", "<aparelho> Voice event", e
// os botões "<conta> Alexa, bom dia" viram atalhos.
const ECHO = 'media_player.home_office_echo_show_familia';
const HA_STATES = document.querySelector('home-assistant').hass.states;
const fname = (k) => (HA_STATES[k]?.attributes?.friendly_name || '');
const ECHO_NAME = fname(ECHO).toLowerCase();
const echoOwn = (domain, re) => Object.keys(HA_STATES).find((k) => k.startsWith(`${domain}.`) && ECHO_NAME
  && fname(k).toLowerCase().startsWith(ECHO_NAME) && re.test(k));
const ALEXA_VOICE = echoOwn('event', /voice/);
const ALEXA_DND = echoOwn('switch', /do_not_disturb/);
const ALEXA_ROUTINES = Object.keys(HA_STATES).filter((k) => k.startsWith('button.') && /\bAlexa,\s*/i.test(fname(k)))
  .map((k) => { const r = fname(k).replace(/^.*\bAlexa,\s*/i, ''); return [k, r.charAt(0).toUpperCase() + r.slice(1)]; });
const ECHO_PICTURE = { name: 'echo', box: 'width: 112%; aspect-ratio: 1; left: -6%; top: 4%;' };
const ALEXA_ON = "states(config.entity) not in ['off', 'unavailable', 'unknown']";
const alexaCard = () => ({ type: 'tile', entity: ECHO, name: 'Alexa', icon: 'mdi:bell-sleep-outline', color: BLUE, vertical: false,
  tap_action: { action: 'more-info' },
  icon_tap_action: ALEXA_DND ? { action: 'perform-action', perform_action: 'switch.toggle', target: { entity_id: ALEXA_DND } } : { action: 'more-info' },
  state_content: ['media_title', 'state'],
  grid_options: { columns: 6, rows: 'auto' }, features_position: 'bottom', features: [{ type: 'media-player-volume-slider' }],
  ...sceneStyle(ALEXA_ON, '#2fa8ff', ECHO_PICTURE, `{% set dnd = ${ALEXA_DND ? `is_state('${ALEXA_DND}', 'on')` : 'false'} %}
{% set said = ${ALEXA_VOICE ? `state_attr('${ALEXA_VOICE}', 'voice_command')` : 'none'} %}
ha-tile-icon { --tile-icon-color: {{ '#06162c' if dnd else 'rgba(233,237,242,0.72)' }}; }
ha-card::after { content: '{{ ("“" ~ said ~ "”") if said else "" }}'; position: absolute; z-index: 1; pointer-events: none;
  left: 12px; right: 12px; bottom: 62px; display: {{ 'block' if said else 'none' }}; padding: 7px 12px 7px 30px; border-radius: 12px;
  font: 500 12px/1.2 var(--ha-font-family-body); color: #dcecff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: rgba(4,13,23,0.62) ${svgUrl("<g fill='none' stroke='#8ccbe9' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z'/><path d='M19 10v2a7 7 0 0 1-14 0v-2'/><path d='M12 19v3'/></g>")} 10px center / 13px no-repeat;
  box-shadow: inset 0 0 0 1px rgba(145,204,255,0.2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }`),
});
// o "Não perturbe" aceso: o círculo do ícone em azul claro, como o botão do card do app
const ALEXA_ICON = { 'ha-tile-icon $': `.container { background: {{ '#8fb4ff' if dnd else 'rgba(4,13,23,0.55)' }} !important; box-shadow: {{ '0 0 18px -4px #8fb4ff' if dnd else 'none' }}; }
.container::before, .container::after { display: none !important; }` };
const alexa = () => { const c = alexaCard(); Object.assign(c.card_mod.style, { 'ha-tile-icon $': `{% set dnd = ${ALEXA_DND ? `is_state('${ALEXA_DND}', 'on')` : 'false'} %}\n${ALEXA_ICON['ha-tile-icon $']}` }); return c; };
const alexaRoutines = () => ALEXA_ROUTINES.map(([e, n]) => ({ ...script(e, n, /noite/i.test(n) ? 'mdi:weather-night' : /dia/i.test(n) ? 'mdi:weather-sunny' : 'mdi:account-voice'), grid_options: { columns: 6 } }));

// Cômodos com aparelhos, na ordem do app.
const ROOMS = [
  ['garagem', 'garagem', 'Garagem', 'mdi:garage', [
    ['Portão', [gate()]], ['Luzes', [light('light.garagem', 'Luz da Garagem')]]]],
  ['sala', 'sala_de_estar', 'Sala de estar', 'mdi:sofa', [
    ['Luzes', [light('light.sala_principal', 'Principal', 'Luz Led'), light('light.sala_cortina', 'Cortina', 'Luz Led'),
      light('light.sala_de_estar_luz_central_1', 'Central 1'), light('light.sala_de_estar_luz_central_2', 'Central 2'),
      light('light.sala_de_estar_spots_da_sala', 'Spots'), light('light.sala_de_estar_luz_do_movel', 'Móvel', 'Led')]],
    ['Ar-condicionado', [acCard('climate.central_sala', 'Ar da Sala')]],
    ['TV', [tvCard('media_player.tv_lg', 'TV LG', 'mdi:television'),
      tile('switch.sala_de_estar_tv_lg_screen', 'Tela da TV', 'mdi:monitor'), appleTv()]]]],
  ['office', 'home_office', 'Home Office', 'mdi:chair-rolling', [
    ['Luzes', [light('light.home_office_centro', 'Centro'), light('light.home_office_spots', 'Spots'),
      light('light.home_office_led', 'LED')]],
    ['Monitor e Alexa', [tvCard('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
      tile('switch.lg_webos_u701sb_screen', 'Tela do monitor', 'mdi:monitor'),
      alexa(), ...alexaRoutines()]]]],
  ['cozinha', 'cozinha', 'Cozinha', 'mdi:stove', [
    ['Luzes', [light('light.cozinha_mesa', 'Mesa'), light('light.cozinha_bancada', 'LED da Bancada'),
      light('light.cozinha_spots', 'Spots')]]]],
  ['circulacao', 'circulacao', 'Circulação', 'mdi:shoe-print', [
    ['Luzes', [light('light.circulacao_centro', 'Centro'), light('light.circulacao_led', 'LED')]]]],
  ['suite', 'quarto', 'Suíte', 'mdi:bed-king', [
    ['Luzes', [light('light.suite_centro', 'Centro'), light('light.suite_led', 'LED')]],
    ['Ar-condicionado', [acCard('climate.central_quarto', 'Ar do Quarto')]]]],
  ['corredor', 'corredor', 'Corredor', 'mdi:road-variant', [['Luzes', [light('light.corredor', 'Luz do Corredor')]]]],
  ['quintal', 'quintal', 'Quintal', 'mdi:pine-tree-variant-outline', [['Luzes', [light('light.quintal', 'Luz do Quintal')]]]],
];

const GREETING = `{% set h = now().hour %}{% set luzes = states.light | selectattr('state','eq','on') | rejectattr('entity_id','search','luz_de_fundo') | list | count %}
## {{ 'Bom dia' if 5 <= h < 12 else 'Boa tarde' if 12 <= h < 18 else 'Boa noite' }}
{{ 'Nenhuma luz acesa' if luzes == 0 else (luzes ~ ' luz acesa' if luzes == 1 else luzes ~ ' luzes acesas') }} · Portão {{ 'aberto' if is_state('cover.portao_garagem','open') else 'fechado' if is_state('cover.portao_garagem','closed') else states('cover.portao_garagem') }}`;

// Os cômodos como no app: o ícone de cada um igual ao das abas do app (Lucide, web/src/ui/icons.js
// roomIcon) num anel fino, e o botão das luzes do cômodo como o botão de energia do app: anel
// vermelho com o ícone de energia quando todas estão apagadas, azul aceso quando alguma está
// acesa (diferente do anel vazio dos interruptores de cada lâmpada).
const ROOM_ICON = {
  garagem: "<path d='M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2'/><circle cx='7' cy='17' r='2'/><path d='M9 17h6'/><circle cx='17' cy='17' r='2'/>",
  sala: "<path d='M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3'/><path d='M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z'/><path d='M4 18v2'/><path d='M20 18v2'/><path d='M12 4v9'/>",
  office: "<path d='M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z'/><path d='M20.054 15.987H3.946'/>",
  cozinha: "<path d='M2 12h20'/><path d='M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8'/><path d='m4 8 16-4'/><path d='m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8'/>",
  circulacao: "<path d='M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z'/><path d='M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z'/><path d='M16 17h4'/><path d='M4 13h4'/>",
  suite: "<path d='M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8'/><path d='M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4'/><path d='M12 4v6'/><path d='M2 18h20'/>",
  corredor: "<path d='M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z'/><path d='M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z'/><path d='M16 17h4'/><path d='M4 13h4'/>",
  quintal: "<path d='M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z'/><path d='M7 16v6'/><path d='M13 19v3'/><path d='M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5'/>",
};
const svgMask = (inner) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`)}")`;
const POWER_MASK = svgMask("<path d='M12 2v10'/><path d='M18.4 6.6a9 9 0 1 1-12.77.04'/>");
const AREA_LIT = "{% set on = area_entities(config.area) | select('match', 'light\\\\.') | select('is_state', 'on') | list | count > 0 %}";
const area = (path, a, name, cols, room = path) => ({ type: 'area', area: a, display_type: 'compact', name, color: WARM,
  ...(path && { navigation_path: `${BASE}/${path}` }),
  features: [{ type: 'area-controls', controls: ['light'] }], features_position: 'inline',
  grid_options: { columns: cols }, card_mod: { style: {
    '.': GLASS.replace('ha-card {', 'ha-card { border-radius: 18px !important;') + `
ha-tile-icon { --tile-icon-color: #a1c3e1; }`,
    // the room's icon is drawn inside the tile icon (its own shadow)
    'ha-tile-icon $': `.container { box-sizing: border-box; background: none !important; border: 1.5px solid rgba(140,203,233,0.32); }
.container::before, .container::after { display: none !important; }
${ROOM_ICON[room] ? `ha-icon { display: block; width: 20px; height: 20px; color: #a1c3e1; background: currentColor;
  -webkit-mask: ${svgMask(ROOM_ICON[room])} center / 20px no-repeat; mask: ${svgMask(ROOM_ICON[room])} center / 20px no-repeat; }` : ''}`,
    ...(ROOM_ICON[room] && { 'ha-tile-icon $ ha-icon $': 'ha-svg-icon { visibility: hidden; }' }),
    'hui-card-features $ hui-card-feature $ hui-area-controls-card-feature $': `${AREA_LIT}
ha-control-button-group { --control-button-group-thickness: 36px; --control-button-group-spacing: 0; width: auto !important; flex: none !important; }
ha-control-button { --control-button-border-radius: 50%; --control-button-padding: 0;
  flex: 0 0 36px !important; width: 36px !important; min-width: 36px !important; max-width: 36px !important; height: 36px !important; aspect-ratio: 1;
  box-sizing: border-box; border-radius: 50%; overflow: hidden;
  background: {{ 'rgba(0,80,141,0.38)' if on else 'rgba(4,13,23,0.55)' }};
  --control-button-background-color: transparent; --control-button-background-opacity: 0;
  --control-button-icon-color: {{ '#eaf6ff' if on else '#ff9a9a' }}; color: {{ '#eaf6ff' if on else '#ff9a9a' }};
  border: 2px solid {{ '#bfe3ff' if on else '#ff4d4d' }};
  box-shadow: {{ '0 0 14px 2px rgba(120,190,255,0.85), inset 0 0 8px rgba(145,204,255,0.55)' if on else '0 0 12px rgba(255,70,70,0.55), inset 0 0 8px rgba(255,70,70,0.3)' }}; }
ha-domain-icon { display: block; width: 18px; height: 18px; background: currentColor; filter: drop-shadow(0 0 3px currentColor);
  -webkit-mask: ${POWER_MASK} center / 18px no-repeat; mask: ${POWER_MASK} center / 18px no-repeat; }`,
    'hui-card-features $ hui-card-feature $ hui-area-controls-card-feature $ ha-domain-icon $': 'ha-icon { visibility: hidden; }',
    // the button's own surface goes: one round layer, the ring above
    'hui-card-features $ hui-card-feature $ hui-area-controls-card-feature $ ha-control-button $': '.button { background: none !important; border-radius: 50% !important; padding: 0 !important; width: 100%; height: 100%; } .button::before { display: none !important; }',
  } } });

const view = (title, path, icon, sections, extra = {}) => ({ title, path, icon, type: 'sections', max_columns: 4,
  dense_section_placement: true, background: BG, sections, ...extra });

const WIDE = '(min-width: 870px)';
const NARROW = '(max-width: 869px)';
const greetCard = (cols, mq) => ({ type: 'markdown', content: GREETING, text_only: true, grid_options: { columns: cols },
  visibility: [{ condition: 'screen', media_query: mq }],
  card_mod: { style: { '.': 'ha-card { background: none !important; border: 0 !important; box-shadow: none !important; padding: 4px 4px 0 !important; }', 'ha-markdown$': 'h2 { font-size: 30px; font-weight: 700; letter-spacing: -0.6px; margin: 0 0 4px; color: #e9edf2; } p { color: rgba(233,237,242,0.64); margin: 0; font-size: 15px; }' } } });
// O tempo como o widget do app (web/src/ui/weather.js): compacto, no vidro escuro, os próximos dias.
const weatherCard = (cols, mq) => ({ type: 'weather-forecast', entity: 'weather.forecast_casa', forecast_type: 'daily', show_current: true, show_forecast: true,
  forecast_slots: 5, name: 'Tempo', grid_options: { columns: cols }, visibility: [{ condition: 'screen', media_query: mq }],
  ...mod(GLASS + ' ha-card { padding: 12px 14px !important; } .name-state .name { display: none; } .name-state .state { white-space: normal !important; overflow: visible !important; line-height: 1.2; } .temp { font-size: 30px !important; } .forecast .temp { font-size: 13px !important; } .forecast .day { font-size: 12px; }') });
const home = view('Casa', 'casa', 'mdi:home', [
  { type: 'grid', column_span: 4, cards: [greetCard(5, WIDE), weatherCard(7, WIDE), greetCard(12, NARROW), weatherCard(12, NARROW)] },
  section('Atalhos', [
    script('script.apagar_todas_as_luzes', 'Apagar todas', 'mdi:lightbulb-group-off-outline'),
    script('script.ligar_todas_as_luzes', 'Ligar todas', 'mdi:lightbulb-group-outline'),
    script('script.ligar_luzes_externas', 'Externas: ligar', 'mdi:outdoor-lamp'),
    script('script.apagar_luzes_externas', 'Externas: apagar', 'mdi:coach-lamp')], 'mdi:lightning-bolt'),
  section('Cômodos', ROOMS.map(([p, a, n]) => area(p, a, n, 6)), 'mdi:floor-plan', 2),
  // o portão e os ares: os cards com foto, do mesmo tamanho, dois por linha
  section('Portão e ar', [gate(), acCard('climate.central_sala', 'Ar da Sala'), acCard('climate.central_quarto', 'Ar do Quarto')], 'mdi:home-thermometer-outline'),
  section('Mídia', [tvCard('media_player.tv_lg', 'TV LG', 'mdi:television'), appleTv(),
    tvCard('media_player.home_office_monitor_lg_webos', 'Monitor LG', 'mdi:monitor'),
    alexa()], 'mdi:play-circle-outline'),
  section('Automações', [
    tile('input_boolean.luzes_por_presenca', 'Luzes por presença', 'mdi:motion-sensor'),
    tile('input_boolean.automacoes_do_portao', 'Automações do portão', 'mdi:garage-alert'),
    tile('input_boolean.vigilancia_da_sala', 'Vigilância da sala', 'mdi:shield-home'),
    tile('input_boolean.vigilancia_da_cozinha', 'Vigilância da cozinha', 'mdi:shield-home'),
    tile('automation.cameras_pessoa_detectada_notificar_com_foto', 'Aviso de pessoa', 'mdi:account-alert')], 'mdi:robot-outline'),
  section('Casa', [
    { type: 'todo-list', entity: 'todo.lista_de_compras', title: 'Lista de compras', ...mod() },
    info('binary_sensor.ex511_status_da_wan', 'Internet', 'mdi:web'),
    info('sensor.ex511_download_speed', 'Download', 'mdi:download', { grid_options: { columns: 6 } }),
    info('sensor.ex511_upload_speed', 'Upload', 'mdi:upload', { grid_options: { columns: 6 } })], 'mdi:home-heart'),
], { badges: ['person.wenderson'].map((entity) => ({ type: 'entity', entity, show_name: false, show_icon: true, show_state: true })) });

const rooms = ROOMS.map(([p, a, n, i, groups]) => view(n, p, i, [
  { type: 'grid', column_span: 4, cards: [area(null, a, n, 'full', p)] },
  ...groups.map(([t, cards, span]) => section(t, cards, null, span))]));

// ---------- o painel Câmeras (/homeos-cameras, um item no menu lateral) ----------
// Como a página de câmeras do app: uma aba por câmera no alto, cada uma com o vídeo (ao vivo,
// galeria, linha do tempo, tela cheia e PTZ do próprio card do Frigate) e todos os ajustes dela;
// a primeira aba, Todas, com as seis câmeras e os controles gerais.
const CAM_EXTRA = {   // controles que são de uma câmera só (no app: `cameras` em cameraControls)
  sala: [['input_boolean.vigilancia_da_sala', 'Vigilância da Sala', 'mdi:shield-home']],
  cozinha: [['input_boolean.vigilancia_da_cozinha', 'Vigilância da Cozinha', 'mdi:shield-home']],
  garagem: [['input_boolean.automacoes_do_portao', 'Automações do portão', 'mdi:garage-alert']],
  frente: [['input_boolean.automacoes_do_portao', 'Automações do portão', 'mdi:garage-alert']],
};
const has = (e) => Boolean(document.querySelector('home-assistant').hass.states[e]);
const camAjustes = (id) => [
  tile(`switch.${id}_detect`, 'Detecção', 'mdi:motion-sensor', BLUE, half),
  tile(`input_boolean.notificar_${id}`, 'Notificar', 'mdi:bell-ring', BLUE, half),
  tile(`input_boolean.exigir_zona_${id}`, 'Só na zona', 'mdi:vector-polygon', BLUE, half),
  ...(has(`switch.${id}_improve_contrast`) ? [tile(`switch.${id}_improve_contrast`, 'Contraste noturno', 'mdi:contrast-box', BLUE, half)] : []),
  ...(CAM_EXTRA[id] || []).map(([e, n, i]) => tile(e, n, i, BLUE, half)),
  info(`input_number.confianca_${id}`, 'Confiança mínima', 'mdi:account-check', { grid_options: { columns: 12 },
    features: [{ type: 'numeric-input', style: 'slider' }], features_position: 'bottom' }),
  info(`input_select.intervalo_${id}`, 'Intervalo mínimo', 'mdi:timer-outline', { grid_options: { columns: 12 },
    features: [{ type: 'select-options' }], features_position: 'bottom' }),
];
const camView = (id) => ({ title: CAMS[id], path: id, type: 'sections', max_columns: 3, dense_section_placement: true, background: BG,
  sections: [
    { type: 'grid', column_span: 2, cards: [camCard([id])] },
    section(`Ajustes da câmera`, camAjustes(id), 'mdi:tune-variant'),
  ] });
const geral = section('Controles gerais', [
  script('script.ligar_deteccao_cameras', 'Ligar detecção em todas', 'mdi:cctv'),
  script('script.desligar_deteccao_cameras', 'Desligar detecção em todas', 'mdi:cctv-off'),
  tile('input_boolean.vigilancia_da_sala', 'Vigilância da Sala', 'mdi:shield-home', BLUE, half),
  tile('input_boolean.vigilancia_da_cozinha', 'Vigilância da Cozinha', 'mdi:shield-home', BLUE, half),
  tile('automation.cameras_pessoa_detectada_notificar_com_foto', 'Notificações', 'mdi:bell-ring', BLUE, half),
  tile('input_boolean.luzes_por_presenca', 'Luzes por presença', 'mdi:motion-sensor', BLUE, half),
  tile('input_boolean.automacoes_do_portao', 'Automações do portão', 'mdi:garage-alert', BLUE, half),
  info('input_select.pessoas_conhecidas', 'Pessoas conhecidas', 'mdi:face-recognition', { grid_options: { columns: 12 },
    features: [{ type: 'select-options' }], features_position: 'bottom' }),
], 'mdi:tune-variant');
const camerasConfig = { title: 'Câmeras', views: [
  { title: 'Todas', path: 'todas', type: 'sections', max_columns: 3, dense_section_placement: true, background: BG,
    sections: [{ type: 'grid', column_span: 2, cards: [camCard(Object.keys(CAMS), true)] }, geral] },
  ...Object.keys(CAMS).map(camView)] };

const config = { title: 'HomeOs', views: [home, ...rooms] };
const hass = document.querySelector('home-assistant').hass;
const list = await hass.callWS({ type: 'lovelace/dashboards/list' });
if (!list.some((d) => d.url_path === 'home-os')) {
  await hass.callWS({ type: 'lovelace/dashboards/create', url_path: 'home-os', title: 'HomeOs', icon: 'mdi:home-variant',
    show_in_sidebar: true, require_admin: false, mode: 'storage' });
}
await hass.callWS({ type: 'lovelace/config/save', url_path: 'home-os', config });
if (!list.some((d) => d.url_path === 'homeos-cameras')) {
  await hass.callWS({ type: 'lovelace/dashboards/create', url_path: 'homeos-cameras', title: 'Câmeras', icon: 'mdi:cctv',
    show_in_sidebar: true, require_admin: false, mode: 'storage' });
}
await hass.callWS({ type: 'lovelace/config/save', url_path: 'homeos-cameras', config: camerasConfig });
'ok: ' + config.views.length + ' abas no HomeOs, ' + camerasConfig.views.length + ' no Câmeras';
