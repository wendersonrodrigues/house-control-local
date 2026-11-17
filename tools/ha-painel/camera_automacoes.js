// Automações das câmeras (17/11/2026): cria no HA os ajudantes, as automações (todas DESLIGADAS ao
// nascer) e o painel "Automações das câmeras" (/homeos-automacoes), com abas Todas + uma por câmera
// e a explicação de cada automação na própria página.
// Uso: abrir o HA logado, colar no console e rodar (requer uix/card_mod, como o HomeOs).
//
// Pode rodar de novo: ajudantes que já existem ficam como estão; automações que já existem são
// regravadas (o texto daqui vale), mas o liga/desliga de cada uma é mantido; só as novas nascem
// desligadas. Também regrava:
//   - "Câmeras - Pessoa detectada (notificar com foto)": passa a obedecer às regras (horário, modo
//     visita, pessoas conhecidas, casa vazia) quando a automação da regra está ligada;
//   - "Portão - Aberto há muito tempo": fica quieta enquanto a versão com tempo ajustável estiver ligada.
// Cópia das versões anteriores: build/ha-automacoes-cameras.antes-2026-11-17.txt (fora do git).
// As regras são achadas pelo id (attributes.id), não pelo nome da entidade: renomear no HA não quebra.

const hass = document.querySelector('home-assistant').hass;
const S = hass.states;
const TOKEN = hass.auth.data.access_token;
const NOTIFY = 'notify.mobile_app_kactohome';
const CAMS = { frente: 'Frente', garagem: 'Garagem', sala: 'Sala', cozinha: 'Cozinha', corredor: 'Corredor', quintal: 'Quintal' };
const IDS = Object.keys(CAMS);
const camPage = (c) => `/homeos-cameras/${c}`;

// ---------- ajudantes ----------
const HELPERS = [
  ...IDS.flatMap((c) => [
    ['input_select', `horario_${c}`, { name: `Horário ${CAMS[c]}`, options: ['Sempre', 'Só à noite', 'Horário personalizado'], initial: 'Sempre', icon: 'mdi:clock-outline' }],
    ['input_datetime', `horario_inicio_${c}`, { name: `Horário início ${CAMS[c]}`, has_date: false, has_time: true, initial: '22:00:00', icon: 'mdi:clock-start' }],
    ['input_datetime', `horario_fim_${c}`, { name: `Horário fim ${CAMS[c]}`, has_date: false, has_time: true, initial: '06:00:00', icon: 'mdi:clock-end' }],
    ['input_boolean', `dentro_do_horario_${c}`, { name: `Dentro do horário ${CAMS[c]}`, icon: 'mdi:clock-check-outline' }],
  ]),
  ['input_number', 'intervalo_visitas', { name: 'Intervalo visitas', min: 1, max: 60, step: 1, initial: 10, mode: 'slider', unit_of_measurement: 'min', icon: 'mdi:timer-sand' }],
  ['input_number', 'duracao_visitas', { name: 'Duração visitas', min: 0, max: 24, step: 1, initial: 4, mode: 'slider', unit_of_measurement: 'h', icon: 'mdi:timer-off-outline' }],
  ['input_datetime', 'ultima_notificacao_geral', { name: 'Última notificação geral', has_date: true, has_time: true, icon: 'mdi:bell-clock' }],
  ['input_number', 'portao_aberto_minutos', { name: 'Portão aberto minutos', min: 1, max: 60, step: 1, initial: 10, mode: 'slider', unit_of_measurement: 'min', icon: 'mdi:garage-open-variant' }],
  ['input_select', 'portao_camera', { name: 'Portão câmera', options: ['Garagem', 'Frente'], initial: 'Garagem', icon: 'mdi:cctv' }],
  ['input_boolean', 'portao_aberto_alexa', { name: 'Portão aberto Alexa', initial: true, icon: 'mdi:account-voice' }],
  ['input_number', 'calcada_parada_segundos', { name: 'Calçada parada segundos', min: 10, max: 300, step: 10, initial: 30, mode: 'slider', unit_of_measurement: 's', icon: 'mdi:human-handsdown' }],
];
const criados = [];
for (const [dom, id, cfg] of HELPERS) {
  if (S[`${dom}.${id}`]) continue;
  const r = await hass.callWS({ type: `${dom}/create`, ...cfg });
  if (r.id !== id) throw new Error(`ajudante ${dom}.${id} nasceu como ${dom}.${r.id}`);
  criados.push(`${dom}.${id}`);
}

// Sensores do Frigate que as sugeridas usam (vêm desligados de fábrica na integração)
const FPS = IDS.map((c) => `sensor.${c}_camera_fps`);
const reg = await hass.callWS({ type: 'config/entity_registry/list' });
for (const e of [...FPS, 'sensor.frigate_status', 'sensor.frigate_ov_0_inference_speed']) {
  const r = reg.find((x) => x.entity_id === e);
  if (r?.disabled_by) await hass.callWS({ type: 'config/entity_registry/update', entity_id: e, disabled_by: null });
}

// ---------- automações ----------
// As regras ligadas, pelo id: {{ 'cameras_regra_horario' in regra }}
const REGRAS = ['cameras_regra_horario', 'cameras_regra_visitas', 'cameras_regra_conhecidos', 'cameras_sugerida_casa_vazia'];
const REGRA_VAR = `{% set ns = namespace(on=[]) %}{% for a in states.automation if a.state == 'on' and a.attributes.id in ${JSON.stringify(REGRAS).replace(/"/g, "'")} %}{% set ns.on = ns.on + [a.attributes.id] %}{% endfor %}{{ ns.on }}`;
const NOME_CAM = `{{ ${JSON.stringify(CAMS).replace(/"/g, "'")}.get(cam, cam) }}`;
const DENTRO = "{% set c = repeat.item %}{% set m = states('input_select.horario_' ~ c) %}{% if m == 'Só à noite' %}{{ is_state('sun.sun', 'below_horizon') }}{% elif m == 'Horário personalizado' %}{% set i = today_at(states('input_datetime.horario_inicio_' ~ c)) %}{% set f = today_at(states('input_datetime.horario_fim_' ~ c)) %}{% set n = now() %}{{ (i <= n and n < f) if i <= f else (n >= i or n < f) }}{% else %}{{ true }}{% endif %}";
const fotoCam = (cam, extra = {}) => ({ image: `/api/camera_proxy/camera.${cam}`, entity_id: `camera.${cam}`, url: camPage(cam), ...extra });

const AUTOS = [
  // 1. Horário por câmera
  { id: 'cameras_regra_horario', alias: 'Câmeras - Horário das notificações',
    description: 'Cada câmera só notifica dentro do horário dela (Sempre, Só à noite ou Horário personalizado). A detecção e a gravação continuam; só o aviso fica de fora.',
    triggers: [{ trigger: 'time_pattern', minutes: '/1' }, { trigger: 'homeassistant', event: 'start' },
      { trigger: 'state', to: null, entity_id: ['sun.sun', ...IDS.flatMap((c) => [`input_select.horario_${c}`, `input_datetime.horario_inicio_${c}`, `input_datetime.horario_fim_${c}`])] }],
    actions: [{ repeat: { for_each: IDS, sequence: [
      { variables: { dentro: DENTRO } },
      { if: [{ condition: 'template', value_template: "{{ dentro != is_state('input_boolean.dentro_do_horario_' ~ repeat.item, 'on') }}" }],
        then: [{ action: "input_boolean.turn_{{ 'on' if dentro else 'off' }}", target: { entity_id: "input_boolean.dentro_do_horario_{{ repeat.item }}" } }] },
    ] } }],
    mode: 'single' },

  // 2. Modo visita: no máximo uma notificação a cada X minutos (todas as câmeras juntas)
  { id: 'cameras_regra_visitas', alias: 'Câmeras - Modo visita (intervalo entre notificações)',
    description: 'No máximo uma notificação de pessoa a cada X minutos, somando todas as câmeras. Desliga sozinha depois da duração escolhida (0 = só quando desligar).',
    triggers: [{ trigger: 'time_pattern', minutes: '/5' }],
    conditions: [{ condition: 'template', value_template: "{% set h = states('input_number.duracao_visitas')|float(0) %}{{ h > 0 and (now() - this.last_changed).total_seconds() >= h * 3600 }}" }],
    actions: [
      { action: 'automation.turn_off', target: { entity_id: '{{ this.entity_id }}' }, data: { stop_actions: false } },
      { action: NOTIFY, data: { title: 'Modo visita desligado', message: "Passou o tempo escolhido ({{ states('input_number.duracao_visitas')|int }} h). As notificações das câmeras voltam ao normal.",
        data: { url: '/homeos-automacoes/todas', tag: 'modo-visita', push: { 'interruption-level': 'passive' } } } },
    ],
    mode: 'single' },

  // 3. Pessoas conhecidas: só ficam salvas (registro em Atividade)
  { id: 'cameras_regra_conhecidos', alias: 'Câmeras - Pessoas conhecidas só ficam salvas',
    description: 'Rosto reconhecido pelo Frigate não notifica: fica salvo (foto, clipe) e entra em Atividade. Só pessoas desconhecidas avisam.',
    triggers: [{ trigger: 'mqtt', topic: 'frigate/events' }],
    variables: { cam: '{{ trigger.payload_json.after.camera }}', nome: NOME_CAM,
      pessoa: "{% set s = trigger.payload_json.after.sub_label %}{{ (s[0] if s is iterable and s is not string else s) if s else '' }}" },
    conditions: [{ condition: 'template', value_template: "{{ trigger.payload_json.type == 'end' and trigger.payload_json.after.label == 'person' and pessoa != '' }}" }],
    actions: [{ action: 'logbook.log', data: { name: '{{ pessoa }}', message: 'reconhecido(a) na câmera {{ nome }}: ficou salvo, sem notificação', entity_id: 'camera.{{ cam }}' } }],
    mode: 'queued', max: 20 },

  // 4. Portão aberto por X minutos, com a foto da câmera
  { id: 'portao_aberto_tempo_camera', alias: 'Portão - Aberto por tempo ajustável (com câmera)',
    description: 'Portão aberto por X minutos: notificação com a foto da câmera escolhida e o botão Fechar portão; repete a cada X minutos (até 3 vezes). Enquanto ligada, a "Portão - Aberto há muito tempo" fica quieta.',
    triggers: [{ trigger: 'state', entity_id: 'cover.portao_garagem', to: 'open', for: { minutes: "{{ states('input_number.portao_aberto_minutos')|int(10) }}" } }],
    variables: { x: "{{ states('input_number.portao_aberto_minutos')|int(10) }}", cam: "{{ 'frente' if is_state('input_select.portao_camera', 'Frente') else 'garagem' }}" },
    actions: [{ repeat: { count: 3, sequence: [
      { action: NOTIFY, data: { title: 'Portão aberto', message: 'O portão da garagem está aberto há {{ x * repeat.index }} minutos.',
        data: { ...fotoCam('{{ cam }}'), tag: 'portao', group: 'portao', push: { 'interruption-level': 'time-sensitive' },
          actions: [{ action: 'FECHAR_PORTAO', title: 'Fechar portão', destructive: true }, { action: 'URI', title: 'Ver ao vivo', uri: 'entityId:camera.{{ cam }}' }] } } },
      { if: [{ condition: 'state', entity_id: 'input_boolean.portao_aberto_alexa', state: 'on' }],
        then: [{ action: 'notify.send_message', target: { entity_id: 'notify.echo_show_familia_announce' }, data: { message: 'Atenção: o portão da garagem está aberto há {{ x * repeat.index }} minutos.' } }] },
      { wait_for_trigger: [{ trigger: 'state', entity_id: 'cover.portao_garagem', to: 'closed' }], timeout: { minutes: '{{ x }}' }, continue_on_timeout: true },
      { condition: 'state', entity_id: 'cover.portao_garagem', state: 'open' },
    ] } }],
    mode: 'single' },

  // ---------- sugeridas ----------
  { id: 'cameras_sugerida_sem_imagem', alias: 'Câmeras - Sugerida: câmera sem imagem',
    description: 'Avisa quando uma câmera fica 5 minutos sem imagem no Frigate (cabo, energia, NVR) e quando ela volta.',
    triggers: [{ trigger: 'numeric_state', entity_id: FPS, below: 1, for: { minutes: 5 }, id: 'caiu' },
      { trigger: 'numeric_state', entity_id: FPS, above: 1, for: { minutes: 1 }, id: 'voltou' }],
    variables: { cam: "{{ trigger.entity_id.split('.')[1].split('_')[0] }}", nome: NOME_CAM },
    actions: [{ action: NOTIFY, data: {
      title: "{{ 'Câmera sem imagem' if trigger.id == 'caiu' else 'Câmera voltou' }}",
      message: "{{ ('A câmera ' ~ nome ~ ' está sem imagem há 5 minutos.') if trigger.id == 'caiu' else ('A câmera ' ~ nome ~ ' voltou a mandar imagem.') }}",
      data: { url: camPage('{{ cam }}'), tag: 'camera-sem-imagem-{{ cam }}', group: 'frigate-sistema' } } }],
    mode: 'queued', max: 12 },

  { id: 'cameras_sugerida_frigate_fora', alias: 'Câmeras - Sugerida: Frigate fora do ar ou lento',
    description: 'Avisa se o Frigate parar (3 min fora do ar) ou ficar lento (detector acima de 100 ms por 10 min), e quando volta ao normal.',
    triggers: [
      { trigger: 'template', value_template: "{{ states('sensor.frigate_status') != 'running' }}", for: { minutes: 3 }, id: 'fora' },
      { trigger: 'template', value_template: "{{ states('sensor.frigate_status') == 'running' }}", for: { minutes: 1 }, id: 'voltou' },
      { trigger: 'numeric_state', entity_id: 'sensor.frigate_ov_0_inference_speed', above: 100, for: { minutes: 10 }, id: 'lento' }],
    actions: [{ action: NOTIFY, data: {
      title: "{{ {'fora': 'Frigate fora do ar', 'voltou': 'Frigate de volta', 'lento': 'Frigate lento'}[trigger.id] }}",
      message: "{{ {'fora': 'O Frigate parou há 3 minutos (estado: ' ~ states('sensor.frigate_status') ~ '). Sem detecção nem gravação até voltar.', 'voltou': 'O Frigate voltou a funcionar.', 'lento': 'O detector está levando ' ~ states('sensor.frigate_ov_0_inference_speed') ~ ' ms por imagem (o normal é cerca de 35 ms).'}[trigger.id] }}",
      data: { url: '/lovelace/frigate', tag: 'frigate-status', group: 'frigate-sistema' } } }],
    mode: 'queued', max: 5 },

  { id: 'cameras_sugerida_casa_vazia', alias: 'Câmeras - Sugerida: casa vazia, alerta crítico',
    description: 'Com todos fora de casa, pessoa desconhecida em qualquer câmera vira alerta crítico (toca mesmo no silencioso). Ao sair todo mundo, liga a notificação das câmeras de fora.',
    triggers: [{ trigger: 'state', entity_id: 'zone.home', to: '0', for: { minutes: 2 } }],
    actions: [
      { action: 'input_boolean.turn_on', target: { entity_id: ['frente', 'garagem', 'corredor', 'quintal'].map((c) => `input_boolean.notificar_${c}`) } },
      { action: NOTIFY, data: { title: 'Casa vazia', message: 'Notificação das câmeras de fora ligada. Pessoa desconhecida vai tocar mesmo no silencioso até alguém voltar.',
        data: { url: '/homeos-automacoes/todas', tag: 'casa-vazia', push: { 'interruption-level': 'passive' } } } },
    ],
    mode: 'single' },

  { id: 'cameras_sugerida_vigilancia_sair', alias: 'Câmeras - Sugerida: vigilância da Sala ao sair de casa',
    description: 'Liga a vigilância da Sala e da Cozinha quando todos saem de casa e desliga quando alguém chega (privacidade de quem está em casa).',
    triggers: [{ trigger: 'state', entity_id: 'zone.home', to: '0', for: { minutes: 5 }, id: 'saiu' },
      { trigger: 'state', entity_id: 'zone.home', from: '0', id: 'chegou' }],
    conditions: [{ condition: 'template', value_template: "{{ trigger.id == 'saiu' or trigger.to_state.state not in ['unknown', 'unavailable'] }}" }],
    actions: [{ action: "input_boolean.turn_{{ 'on' if trigger.id == 'saiu' else 'off' }}", target: { entity_id: 'input_boolean.vigilancia_da_sala' } }],
    mode: 'restart' },

  { id: 'cameras_sugerida_calcada', alias: 'Câmeras - Sugerida: pessoa parada na calçada',
    description: 'Avisa com foto quando alguém fica parado na calçada da Frente (zona "Calçada Frente") por mais de X segundos.',
    triggers: [{ trigger: 'state', entity_id: 'binary_sensor.calcada_baixo_person_occupancy', to: 'on', for: { seconds: "{{ states('input_number.calcada_parada_segundos')|int(30) }}" } }],
    actions: [{ action: NOTIFY, data: { title: 'Pessoa parada na calçada',
      message: "Alguém está na calçada da Frente há mais de {{ states('input_number.calcada_parada_segundos')|int }} segundos.",
      data: { ...fotoCam('frente'), tag: 'calcada-parada', group: 'frigate', push: { 'interruption-level': 'time-sensitive' },
        actions: [{ action: 'URI', title: 'Ver ao vivo', uri: 'entityId:camera.frente' }] } } }],
    mode: 'single' },

  { id: 'cameras_sugerida_portao_abriu', alias: 'Câmeras - Sugerida: foto quando o portão abre',
    description: 'Quando o portão abre à noite ou com a casa vazia, manda a foto da Garagem uns segundos depois (quem entrou ou saiu).',
    triggers: [{ trigger: 'state', entity_id: 'cover.portao_garagem', from: 'closed', to: ['opening', 'open'] }],
    conditions: [{ condition: 'or', conditions: [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }, { condition: 'state', entity_id: 'zone.home', state: '0' }] }],
    actions: [{ delay: { seconds: 6 } }, { action: NOTIFY, data: { title: 'Portão abriu',
      message: "{{ 'Casa vazia: ' if is_state('zone.home', '0') else '' }}o portão da garagem abriu às {{ now().strftime('%H:%M') }}.",
      data: { ...fotoCam('garagem'), tag: 'portao-abriu', group: 'portao', push: { 'interruption-level': 'time-sensitive' },
        actions: [{ action: 'FECHAR_PORTAO', title: 'Fechar portão', destructive: true }, { action: 'URI', title: 'Ver ao vivo', uri: 'entityId:camera.garagem' }] } } }],
    mode: 'single' },
];

// A notificação de pessoa, agora obedecendo às regras (versão anterior: ver o cabeçalho)
const PESSOA = { id: 'cameras_pessoa_notificacao', alias: 'Câmeras - Pessoa detectada (notificar com foto)',
  description: 'Frigate: notifica pessoa por câmera (Notificar, Confiança, Intervalo, Zona). Obedece às regras do painel Automações das câmeras (horário, modo visita, pessoas conhecidas, casa vazia) quando estão ligadas.',
  triggers: [{ trigger: 'mqtt', topic: 'frigate/events' }],
  conditions: [
    { condition: 'template', alias: 'Câmera monitorada e com notificação ligada', value_template: "{{ cam in ['frente','garagem','quintal','corredor','sala','cozinha'] and is_state('input_boolean.notificar_' ~ cam, 'on') }}" },
    { condition: 'template', alias: 'Passou a atender confiança e zona agora (inclui o fim da detecção, para quem passa rápido)', value_template: "{% set thr = states('input_number.confianca_' ~ cam)|float(70) / 100 %}{% set zona = is_state('input_boolean.exigir_zona_' ~ cam, 'on') %}{% set a = trigger.payload_json.after %}{% set b = trigger.payload_json.before %}{% set t = trigger.payload_json.type %}{% set qa = a.label == 'person' and (a.top_score|float(0)) >= thr and (not zona or (a.entered_zones|default([])|length) > 0) and not (a.false_positive|default(false)) %}{% set qb = t != 'new' and (b.label == 'person' and (b.top_score|float(0)) >= thr and (not zona or (b.entered_zones|default([])|length) > 0) and not (b.false_positive|default(false))) %}{{ t in ['new','update','end'] and qa and not qb }}" },
    { condition: 'template', alias: 'Regra de horário: dentro do horário da câmera', value_template: "{{ 'cameras_regra_horario' not in regra or is_state('input_boolean.dentro_do_horario_' ~ cam, 'on') }}" },
    { condition: 'template', alias: 'Respeitou o intervalo mínimo da câmera', value_template: "{% set iv = {'5 s':5,'10 s':10,'30 s':30,'1 min':60,'2 min':120,'5 min':300}.get(states('input_select.intervalo_' ~ cam), 30) %}{% set last = as_timestamp(states('input_datetime.ultima_notificacao_' ~ cam), 0) %}{{ (as_timestamp(now()) - last) >= iv }}" },
    { condition: 'template', alias: 'Modo visita: uma notificação a cada X minutos (todas as câmeras)', value_template: "{% if 'cameras_regra_visitas' in regra %}{{ (as_timestamp(now()) - as_timestamp(states('input_datetime.ultima_notificacao_geral'), 0)) >= states('input_number.intervalo_visitas')|float(10) * 60 }}{% else %}{{ true }}{% endif %}" },
  ],
  actions: [
    { variables: { nome_pessoa: "{% set s = trigger.payload_json.after.sub_label %}{{ (s[0] if s is iterable and s is not string else s) if s else '' }}" } },
    { if: [{ condition: 'template', value_template: "{{ nome_pessoa == '' }}" }],
      then: [
        { wait_for_trigger: [{ trigger: 'mqtt', topic: 'frigate/events', payload: 'sim', value_template: "{{ 'sim' if (value_json.after.sub_label) else 'nao' }}" }], timeout: { seconds: 4 }, continue_on_timeout: true },
        { variables: { nome_pessoa: "{% if wait.trigger and wait.trigger.payload_json.after.id == evento %}{% set s = wait.trigger.payload_json.after.sub_label %}{{ s[0] if (s is iterable and s is not string) else s }}{% endif %}" } },
      ] },
    { variables: { modo: "{{ states('input_select.pessoas_conhecidas') }}", conhecido: "{{ nome_pessoa != '' }}" } },
    { condition: 'template', alias: 'Pessoa conhecida: só registrar (escolha ou regra ligada)', value_template: "{{ not (conhecido and (modo == 'Só registrar' or 'cameras_regra_conhecidos' in regra)) }}" },
    { variables: { critico: "{{ 'cameras_sugerida_casa_vazia' in regra and is_state('zone.home', '0') and not conhecido }}" } },
    { action: 'input_datetime.set_datetime', target: { entity_id: ['input_datetime.ultima_notificacao_{{ cam }}', 'input_datetime.ultima_notificacao_geral'] }, data: { timestamp: '{{ now().timestamp() }}' } },
    { delay: { seconds: 1 } },
    { action: NOTIFY, data: {
      title: "{{ (nome_pessoa ~ ' na ' ~ nome) if conhecido else ('Casa vazia: pessoa desconhecida' if critico else 'Pessoa desconhecida') }}",
      message: "{{ nome }} às {{ now().strftime('%H:%M') }} · confiança {{ score }}%",
      data: { image: '/api/frigate/notifications/{{ evento }}/snapshot.jpg', url: camPage('{{ cam }}'), tag: 'frigate-{{ cam }}', group: 'frigate',
        push: "{% if critico %}{{ {'interruption-level': 'critical', 'sound': {'name': 'default', 'critical': 1, 'volume': 1.0}} }}{% else %}{{ {'interruption-level': ('passive' if (conhecido and modo == 'Avisar em silêncio com o nome') else 'time-sensitive')} }}{% endif %}",
        actions: [{ action: 'URI', title: 'Abrir câmera e histórico', uri: camPage('{{ cam }}') }, { action: 'URI', title: 'Ao vivo', uri: 'entityId:camera.{{ cam }}' }] } } },
  ],
  mode: 'queued', max: 20,
  variables: { regra: REGRA_VAR, cam: '{{ trigger.payload_json.after.camera }}', nome: `{{ ${JSON.stringify(CAMS).replace(/"/g, "'")}.get(trigger.payload_json.after.camera, trigger.payload_json.after.camera) }}`,
    evento: '{{ trigger.payload_json.after.id }}', score: '{{ ((trigger.payload_json.after.top_score|float(0)) * 100) | round(0) | int }}' },
  trace: { stored_traces: 30 } };

const api = async (path, body) => {
  const r = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const live = () => document.querySelector('home-assistant').hass.states; // o objeto hass muda a cada estado novo
const entityOf = (id) => Object.keys(live()).find((k) => k.startsWith('automation.') && live()[k].attributes.id === id);

// O portão antigo fica quieto enquanto o novo estiver ligado; os links passam ao painel Câmeras
const antigo = await api('config/automation/config/portao_aberto_tempo');
antigo.conditions = (antigo.conditions || []).filter((c) => c.alias !== 'Só se a versão com tempo ajustável estiver desligada');
antigo.conditions.push({ condition: 'template', alias: 'Só se a versão com tempo ajustável estiver desligada',
  value_template: "{{ states.automation | selectattr('attributes.id', 'eq', 'portao_aberto_tempo_camera') | map(attribute='state') | list != ['on'] }}" });
antigo.description = 'Aberto por 5 min: notificação com foto + Echo. Repete a cada 10 min (até 3x) enquanto aberto. Quieta enquanto "Portão - Aberto por tempo ajustável (com câmera)" estiver ligada.';
const fixUrls = (o) => JSON.parse(JSON.stringify(o).replaceAll('/lovelace/cam-garagem', camPage('garagem')));
await api('config/automation/config/portao_aberto_tempo', fixUrls(antigo));
const h23 = await api('config/automation/config/portao_fechar_23h');
await api('config/automation/config/portao_fechar_23h', fixUrls(h23));

const novas = [];
for (const a of AUTOS) {
  const existia = Boolean(entityOf(a.id));
  await api(`config/automation/config/${a.id}`, a);
  if (!existia) novas.push(a.id);
}
await api('config/automation/config/cameras_pessoa_notificacao', PESSOA);

// espera o HA recarregar e desliga as que acabaram de nascer
for (let i = 0; i < 40 && !novas.every(entityOf); i++) await new Promise((r) => setTimeout(r, 250));
const desligar = novas.map(entityOf).filter(Boolean);
if (desligar.length) await hass.callService('automation', 'turn_off', { entity_id: desligar, stop_actions: true });
const E = Object.fromEntries(AUTOS.map((a) => [a.id, entityOf(a.id)]));
if (Object.values(E).some((e) => !e)) throw new Error('automação sem entidade: ' + JSON.stringify(E));

// ---------- o painel ----------
const BLUE = '#5aa2ff';
const BG = 'radial-gradient(120% 55% at 50% 0%, #0b2741 0%, rgba(11, 39, 65, 0) 62%) fixed, #040d17';
const GLASS = `ha-card { background: linear-gradient(165deg, rgba(13,30,47,0.92) 0%, rgba(7,19,31,0.92) 100%) !important; border: 1px solid rgba(145,204,255,0.13) !important; border-radius: 20px !important; box-shadow: none !important; color: #e9edf2; --primary-text-color: #e9edf2; --secondary-text-color: rgba(233,237,242,0.64); }`;
const TEXT = GLASS + ' ha-card { padding: 2px 4px; } ha-markdown { font-size: 14px; line-height: 1.45; } ha-markdown p { margin: 0 0 8px; } ha-markdown strong { color: #91ccff; }';
const PLAIN = 'ha-card { background: none !important; border: 0 !important; box-shadow: none !important; color: #e9edf2; } ha-markdown { color: rgba(233,237,242,0.72); font-size: 14px; } ha-markdown h2 { color: #e9edf2; margin: 0 0 4px; }';
const mod = (css = GLASS) => ({ card_mod: { style: css } });
const full = { grid_options: { columns: 12 } };
const half = { grid_options: { columns: 6 } };

const heading = (t, icon) => ({ type: 'heading', heading: t, heading_style: 'title', ...(icon && { icon }) });
const md = (content, css = TEXT) => ({ type: 'markdown', content, ...mod(css) });
const autoTile = (id, name, icon) => ({ type: 'tile', entity: E[id], name, icon, color: BLUE, vertical: false,
  tap_action: { action: 'toggle' }, icon_tap_action: { action: 'toggle' }, hold_action: { action: 'more-info' },
  features: [{ type: 'toggle' }], features_position: 'inline', ...full, ...mod() });
const tile = (entity, name, icon, kw = {}) => ({ type: 'tile', entity, name, icon, color: BLUE, vertical: false, tap_action: { action: 'more-info' }, ...kw, ...mod() });
const select = (e, n, i) => tile(e, n, i, { features: [{ type: 'select-options' }], features_position: 'bottom', ...full });
const slider = (e, n, i) => tile(e, n, i, { features: [{ type: 'numeric-input', style: 'slider' }], features_position: 'bottom', ...full });
const toggle = (e, n, i, kw = half) => tile(e, n, i, { tap_action: { action: 'toggle' }, icon_tap_action: { action: 'toggle' }, hold_action: { action: 'more-info' }, ...kw });
const times = (rows) => ({ type: 'entities', state_color: true, entities: rows, ...mod() });
const section = (cards) => ({ type: 'grid', cards });
const when = (entity, state) => [{ condition: 'state', entity, state }];

// textos de cada automação (o que faz, como funciona, quando usar)
const T = {
  horario: `**O que faz:** cada câmera só manda notificação dentro do horário escolhido para ela. Fora do horário o Frigate continua detectando, gravando e salvando; só o aviso no celular fica de fora.

**Como funciona:** a cada minuto confere o horário de cada câmera e liga ou desliga a marca "Dentro do horário". A notificação de pessoa só sai com a marca ligada. Desligada a automação, tudo volta a avisar como hoje.

**Ajuste por câmera** (na aba de cada câmera): *Sempre* (como hoje), *Só à noite* (do pôr ao nascer do sol) ou *Horário personalizado* (início e fim; pode virar a noite, por exemplo 22:00 até 06:00).

**Quando usar:** para não receber aviso de quem passa de dia na rua, ou de quem está em casa nas câmeras de dentro.`,
  visitas: `**O que faz:** com visita em casa ou gente na frente, junta os avisos: **no máximo uma notificação a cada X minutos**, somando todas as câmeras.

**Como funciona:** vale por cima do intervalo de cada câmera (ganha o maior). Desliga sozinha depois da duração escolhida e avisa no celular quando desligar; com duração 0, só desliga quando você desligar.

**Quando usar:** ligue quando chegar visita, em festa, obra ou movimento na rua. Lembre de desligar (ou deixe a duração cuidar disso).`,
  conhecidos: `**O que faz:** quando o Frigate reconhece o rosto de alguém cadastrado, a detecção **fica salva** (foto, clipe e uma linha em Atividade: "Fulano reconhecido na câmera Frente") e **não notifica**. Só pessoa nova ou desconhecida avisa.

**Como funciona:** a notificação espera até 4 segundos pelo reconhecimento do rosto; se veio um nome, não avisa. Desligada, vale a escolha "Pessoas conhecidas" do painel Câmeras (hoje: avisar em silêncio com o nome).

**Atenção:** quem aparece de costas ou de lado não é reconhecido e ainda avisa como desconhecido. Quanto mais fotos treinadas no Frigate (Rostos), melhor.`,
  portao: `**O que faz:** se o portão ficar aberto por **X minutos**, manda notificação com a **foto da câmera** escolhida (Garagem ou Frente) e os botões *Fechar portão* e *Ver ao vivo*. Repete a cada X minutos, até 3 vezes, enquanto continuar aberto. Se quiser, avisa também na Alexa.

**Como funciona:** substitui a "Portão - Aberto há muito tempo" (5 minutos fixos, ligada hoje): enquanto esta estiver ligada, a antiga fica quieta, para não chegar notificação dobrada. Desligando esta, a antiga volta a valer.

**Quando usar:** sempre, se preferir escolher o tempo e a câmera.`,
  semImagem: `**O que faz:** avisa quando uma câmera fica **5 minutos sem imagem** no Frigate (cabo, energia, NVR travado) e de novo quando ela volta.

**Quando usar:** para saber na hora que uma câmera caiu, em vez de descobrir quando precisar da gravação.`,
  frigate: `**O que faz:** avisa se o **Frigate parar** (3 minutos fora do ar) ou ficar **lento** (o detector acima de 100 ms por imagem durante 10 minutos; o normal com o modelo novo é cerca de 35 ms), e quando volta.

**Quando usar:** deixa ligada; quase nunca avisa, mas quando avisar é porque as câmeras estão sem detecção.`,
  casaVazia: `**O que faz:** quando **todos saem de casa** (pelo celular), pessoa **desconhecida** em qualquer câmera vira **alerta crítico**: toca mesmo com o celular no silencioso ou no Foco. Ao sair, também liga a notificação das câmeras de fora (Frente, Garagem, Corredor, Quintal).

**Como funciona:** usa a zona Casa do HA (hoje só o seu celular conta). Ao voltar alguém, os avisos voltam ao normal sozinhos.

**Quando usar:** viagens e saídas longas. O iPhone pode pedir para permitir "Alertas críticos" ao app Home Assistant.`,
  vigilancia: `**O que faz:** liga a **vigilância da Sala e da Cozinha** quando todos saem de casa (5 minutos depois) e desliga quando alguém chega.

**Como funciona:** usa a mesma chave "Vigilância (Sala + Cozinha)" do painel Câmeras: detecção, fotos, gravação da Sala e notificação das duas. Dentro de casa, as câmeras internas ficam sem detecção (privacidade).

**Quando usar:** se quiser que as câmeras de dentro só vigiem com a casa vazia, sem lembrar de ligar.`,
  calcada: `**O que faz:** avisa com a foto da Frente quando alguém fica **parado na calçada** (zona "Calçada Frente") por mais de X segundos.

**Quando usar:** para saber de quem para no portão ou fica rondando, sem avisar de quem só passa.`,
  portaoAbriu: `**O que faz:** quando o portão **abre à noite ou com a casa vazia**, manda a foto da Garagem 6 segundos depois (quem entrou ou saiu), com o botão *Fechar portão*.

**Quando usar:** para acompanhar quem chega tarde ou quem abre o portão quando você não está.`,
};

const blocks = {
  horario: (cam) => section([heading('Horário das notificações', 'mdi:clock-outline'), autoTile('cameras_regra_horario', 'Horário das notificações', 'mdi:clock-outline'),
    ...(cam ? [select(`input_select.horario_${cam}`, `Horário da ${CAMS[cam]}`, 'mdi:clock-outline'),
      { ...times([{ entity: `input_datetime.horario_inicio_${cam}`, name: 'Começa às' }, { entity: `input_datetime.horario_fim_${cam}`, name: 'Termina às' }]), visibility: when(`input_select.horario_${cam}`, 'Horário personalizado') },
      tile(`input_boolean.dentro_do_horario_${cam}`, 'Agora: dentro do horário?', 'mdi:clock-check-outline', full)]
      : [times(IDS.map((c) => ({ entity: `input_select.horario_${c}`, name: CAMS[c] })))]),
    md(T.horario)]),
  visitas: () => section([heading('Modo visita', 'mdi:account-group'), autoTile('cameras_regra_visitas', 'Modo visita', 'mdi:account-group'),
    slider('input_number.intervalo_visitas', 'Uma notificação a cada', 'mdi:timer-sand'),
    slider('input_number.duracao_visitas', 'Desligar sozinho depois de (0 = nunca)', 'mdi:timer-off-outline'), md(T.visitas)]),
  conhecidos: () => section([heading('Pessoas conhecidas', 'mdi:face-recognition'), autoTile('cameras_regra_conhecidos', 'Pessoas conhecidas só ficam salvas', 'mdi:face-recognition'),
    { ...select('input_select.pessoas_conhecidas', 'Com a automação desligada', 'mdi:face-recognition') }, md(T.conhecidos)]),
  portao: () => section([heading('Portão aberto', 'mdi:garage-open-variant'), autoTile('portao_aberto_tempo_camera', 'Portão aberto por X minutos', 'mdi:garage-open-variant'),
    slider('input_number.portao_aberto_minutos', 'Avisar depois de', 'mdi:timer-outline'),
    select('input_select.portao_camera', 'Foto da câmera', 'mdi:cctv'),
    toggle('input_boolean.portao_aberto_alexa', 'Avisar na Alexa', 'mdi:account-voice'),
    tile('cover.portao_garagem', 'Portão agora', 'mdi:garage-variant', half), md(T.portao)]),
  semImagem: () => section([heading('Câmera sem imagem', 'mdi:video-off'), autoTile('cameras_sugerida_sem_imagem', 'Câmera sem imagem', 'mdi:video-off'), md(T.semImagem)]),
  frigate: () => section([heading('Frigate fora do ar ou lento', 'mdi:server-network-off'), autoTile('cameras_sugerida_frigate_fora', 'Frigate fora do ar ou lento', 'mdi:server-network-off'),
    tile('sensor.frigate_status', 'Frigate agora', 'mdi:server', half), tile('sensor.frigate_ov_0_inference_speed', 'Detector', 'mdi:speedometer', half), md(T.frigate)]),
  casaVazia: () => section([heading('Casa vazia: alerta crítico', 'mdi:home-alert'), autoTile('cameras_sugerida_casa_vazia', 'Casa vazia: alerta crítico', 'mdi:home-alert'),
    tile('zone.home', 'Pessoas em casa', 'mdi:home-account', full), md(T.casaVazia)]),
  vigilancia: () => section([heading('Vigilância da Sala ao sair', 'mdi:shield-home'), autoTile('cameras_sugerida_vigilancia_sair', 'Vigilância da Sala ao sair de casa', 'mdi:shield-home'),
    toggle('input_boolean.vigilancia_da_sala', 'Vigilância agora', 'mdi:shield-home', full), md(T.vigilancia)]),
  calcada: () => section([heading('Pessoa parada na calçada', 'mdi:human-handsdown'), autoTile('cameras_sugerida_calcada', 'Pessoa parada na calçada', 'mdi:human-handsdown'),
    slider('input_number.calcada_parada_segundos', 'Parada há mais de', 'mdi:timer-outline'), md(T.calcada)]),
  portaoAbriu: () => section([heading('Foto quando o portão abre', 'mdi:garage-open'), autoTile('cameras_sugerida_portao_abriu', 'Foto quando o portão abre', 'mdi:garage-open'), md(T.portaoAbriu)]),
};
const SUGERIDAS = ['semImagem', 'frigate', 'casaVazia', 'vigilancia', 'calcada', 'portaoAbriu'];
const intro = (txt) => ({ type: 'grid', column_span: 4, cards: [md(txt, PLAIN)] });
const divisor = (t, icon, txt) => ({ type: 'grid', column_span: 4, cards: [heading(t, icon), ...(txt ? [md(txt, PLAIN)] : [])] });

const todas = { title: 'Todas', path: 'todas', type: 'sections', max_columns: 4, dense_section_placement: true, background: BG, sections: [
  intro(`## Automações das câmeras
Cada automação liga e desliga no botão dela; todas começaram **desligadas**. Os ajustes ficam logo abaixo do botão, e o horário de cada câmera fica na aba da câmera (no alto). Desligar uma automação devolve tudo ao jeito de antes.`),
  divisor('Pedidas', 'mdi:star-outline'),
  blocks.horario(), blocks.visitas(), blocks.conhecidos(), blocks.portao(),
  divisor('Automações sugeridas', 'mdi:lightbulb-on-outline', 'Ideias para analisar: ligue a que fizer sentido, desligue se incomodar.'),
  ...SUGERIDAS.map((k) => blocks[k]()),
] };

const CAM_SUG = { frente: ['calcada', 'semImagem'], garagem: ['portaoAbriu', 'semImagem'], sala: ['vigilancia', 'semImagem'], cozinha: ['vigilancia', 'semImagem'], corredor: ['semImagem'], quintal: ['semImagem'] };
const camView = (c) => ({ title: CAMS[c], path: c, type: 'sections', max_columns: 4, dense_section_placement: true, background: BG, sections: [
  intro(`## ${CAMS[c]}
O que vale para a câmera ${CAMS[c]}: o horário dela, os ajustes de notificação e as automações que mexem com ela. As que valem para todas as câmeras (modo visita, pessoas conhecidas) ligam e desligam aqui também.`),
  section([heading('Notificação desta câmera', 'mdi:bell-ring'),
    toggle(`input_boolean.notificar_${c}`, 'Notificar', 'mdi:bell-ring'), toggle(`input_boolean.exigir_zona_${c}`, 'Só na zona', 'mdi:vector-polygon'),
    slider(`input_number.confianca_${c}`, 'Confiança mínima', 'mdi:account-check'), select(`input_select.intervalo_${c}`, 'Intervalo mínimo desta câmera', 'mdi:timer-outline'),
    md('**Notificar** desliga os avisos só desta câmera. **Confiança mínima**: abaixo dela não avisa. **Intervalo mínimo**: tempo entre dois avisos desta câmera. **Só na zona**: avisa só quem entra na zona marcada no Frigate.')]),
  blocks.horario(c), blocks.visitas(), blocks.conhecidos(),
  ...(['garagem', 'frente'].includes(c) ? [blocks.portao()] : []),
  divisor('Sugeridas para esta câmera', 'mdi:lightbulb-on-outline'),
  ...CAM_SUG[c].map((k) => blocks[k]()),
] });

const config = { title: 'Automações das câmeras', views: [todas, ...IDS.map(camView)] };
const DASH = 'homeos-automacoes';
const list = await hass.callWS({ type: 'lovelace/dashboards/list' });
if (!list.some((d) => d.url_path === DASH)) {
  await hass.callWS({ type: 'lovelace/dashboards/create', url_path: DASH, title: 'Automações das câmeras', icon: 'mdi:cctv',
    show_in_sidebar: true, require_admin: false, mode: 'storage' });
}
await hass.callWS({ type: 'lovelace/config/save', url_path: DASH, config });
window.__CAM_AUTO__ = { ajudantesCriados: criados.length, novasDesligadas: desligar, entidades: E };
console.log('Automações das câmeras', window.__CAM_AUTO__);
