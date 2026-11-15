// The weather on the start page: Home Assistant's weather entity (met.no, "Forecast Casa"),
// as a card in the app's look: the sky's icon in a glowing ring, the temperature large, what
// the sky is doing in Portuguese, humidity / wind / UV, and the next days. Read only while the
// card is on screen (ha/live.js).

import { h } from './dom.js';
import { icon } from './icons.js';
import { watchEntities, whileVisible } from '../ha/live.js';

const SKY = {
  'clear-night': ['Céu limpo', 'clearNight'],
  cloudy: ['Nublado', 'cloud'],
  exceptional: ['Tempo instável', 'alert'],
  fog: ['Neblina', 'fog'],
  hail: ['Granizo', 'hail'],
  lightning: ['Trovoadas', 'storm'],
  'lightning-rainy': ['Chuva com trovoadas', 'storm'],
  partlycloudy: ['Parcialmente nublado', 'cloudSun'],
  pouring: ['Chuva forte', 'rain'],
  rainy: ['Chuva', 'drizzle'],
  snowy: ['Neve', 'snow'],
  'snowy-rainy': ['Chuva e neve', 'snow'],
  sunny: ['Ensolarado', 'sun'],
  windy: ['Ventania', 'wind'],
  'windy-variant': ['Vento e nuvens', 'wind'],
};
// warm for the sun, blue for rain, grey for clouds
const TINT = { sun: '#ffc36b', cloudSun: '#ffd28f', clearNight: '#b9c8ff', cloudMoon: '#b9c8ff', drizzle: '#6fb8ff', rain: '#5aa2ff', storm: '#a99cff' };

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const round = (n) => (typeof n === 'number' ? Math.round(n) : null);

/** `night()`: the sun is down (a partly cloudy night shows the moon). */
export function createWeather({ access, entity = null, night = () => false }) {
  const glyph = h('div.wx-glyph');
  const temp = h('div.wx-temp');
  const sky = h('div.wx-sky');
  const facts = h('div.wx-facts');
  const days = h('div.wx-days');
  // the panel shows it on the start page only (hidden elsewhere, it is not read)
  const el = h('div.weather.loading',
    h('div.wx-now', glyph, h('div.wx-text', temp, sky, facts)),
    days);

  let shownIcon = '';
  function iconFor(cond) {
    const name = SKY[cond]?.[1] || 'cloud';
    return name === 'cloudSun' && night() ? 'cloudMoon' : name;
  }
  function render(s, forecast) {
    const off = !s || ['unavailable', 'unknown'].includes(s.state);
    el.classList.toggle('loading', off);
    if (off) { sky.textContent = s ? 'Previsão indisponível' : ''; return; }
    const a = s.attributes || {};
    const name = iconFor(s.state);
    if (name !== shownIcon) { glyph.replaceChildren(icon(name, 30, 1.7)); shownIcon = name; }
    el.style.setProperty('--wx', TINT[name] || '#a1c3e1');
    temp.replaceChildren(String(round(a.temperature) ?? '–'), h('span', a.temperature_unit || '°C'));
    sky.textContent = SKY[s.state]?.[0] || s.state;
    const wind = round(a.wind_speed);
    facts.replaceChildren(...[
      a.humidity != null ? [icon('dry', 13, 2), `${round(a.humidity)}%`] : null,
      wind != null ? [icon('wind', 13, 2), `${wind} ${a.wind_speed_unit || 'km/h'}`] : null,
      a.uv_index != null ? [icon('sun', 13, 2), `UV ${round(a.uv_index)}`] : null,
    ].filter(Boolean).map((parts) => h('span', ...parts)));
    const list = (forecast || []).slice(0, 5);
    days.hidden = !list.length;
    const today = new Date().toDateString();
    days.replaceChildren(...list.map((f) => {
      const d = new Date(f.datetime);
      const rain = round(f.precipitation_probability);
      return h('div.wx-day',
        h('div.wx-day-name', d.toDateString() === today ? 'Hoje' : DAYS[d.getDay()]),
        icon(SKY[f.condition]?.[1] || 'cloud', 18, 1.8),
        h('div.wx-day-temp', h('b', `${round(f.temperature) ?? '–'}°`), f.templow != null ? h('span', `${round(f.templow)}°`) : null),
        rain ? h('div.wx-day-rain', `${rain}%`) : null);
    }));
  }

  let current = null;
  let forecast = [];
  whileVisible(el, () => {
    let stopForecast = null;
    let chosen = null;
    const stop = watchEntities(access, 'weather',
      (all) => {
        const w = all.find((s) => s.entity_id === entity) || all.find((s) => s.entity_id.startsWith('weather.'));
        chosen = w?.entity_id || null;
        return chosen ? [chosen] : [];
      },
      (states, ha) => {
        current = states.get(chosen);
        render(current, forecast);
        if (chosen && !stopForecast) {
          stopForecast = ha.subscribe({ type: 'weather/subscribe_forecast', entity_id: chosen, forecast_type: 'daily' }, (ev) => {
            forecast = ev?.forecast || [];
            render(current, forecast);
          });
          stopForecast.catch(() => {});
        }
      },
      { onError: () => {} });
    return () => { stopForecast?.then((off) => off(), () => {}); stop(); };
  });
  return { el, refresh() { render(current, forecast); } };
}
