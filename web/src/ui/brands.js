// The app or system a TV or monitor is showing, as its logo: Netflix on the TV, the Apple
// symbol for a Mac on the monitor, PlayStation on the console input. Matched by name on what
// Home Assistant reports (app, input, title); simple flat marks drawn here, so nothing is
// fetched. Anything else falls back to the picture Home Assistant has, then to the TV icon.
import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (inner, view = '0 0 24 24') => {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', view);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = inner;
  return el;
};

const BRANDS = [
  {
    id: 'apple', name: 'Apple', bg: '#f2f2f4', match: /\b(mac|macos|macbook|imac|apple|airplay)\b/i,
    // The system font draws the real Apple symbol on a Mac or an iPhone (U+F8FF).
    mark: () => h('span.brand-glyph', '\uF8FF'),
  },
  {
    id: 'playstation', name: 'PlayStation', bg: '#0b3fa8', match: /\b(playstation|ps[345]|ps vita)\b/i,
    mark: () => svg(
      '<path fill="#fff" d="M9.2 3.6v15.6l3.4 1.1V7.2c0-.7.3-1.1.8-.9.6.2.8.8.8 1.4v5.2c2.2 1 3.9 0 3.9-2.8 0-2.9-1-4.2-4-5.2-1.2-.4-3.4-1-4.9-1.3z"/>'
      + '<path fill="#fff" opacity=".9" d="M13.6 16.7l5.6-2c.6-.2.7-.5.2-.7-.5-.2-1.4-.1-2 .1l-3.8 1.4v-2.2l.2-.1s1.1-.4 2.6-.6c1.5-.2 3.4 0 4.9.6 1.7.6 1.9 1.4 1.5 2-.4.6-1.6 1-1.6 1l-7.6 2.7v-2.2zM3 16.5c-1.7-.5-2-1.5-1.2-2.1.7-.5 2-.9 2-.9l5.1-1.8v2.2l-3.7 1.3c-.6.2-.7.5-.2.7.5.2 1.4.1 2-.1l1.9-.7v2c-.1 0-.3.1-.4.1-1.9.3-3.9.2-5.5-.7z"/>'),
  },
  {
    id: 'netflix', name: 'Netflix', bg: '#000', match: /netflix/i,
    mark: () => svg('<path fill="#e50914" d="M6 2h3.6l2.4 7.2V2h3.6v20c-1.2-.2-2.4-.3-3.6-.3L9.6 14.4V21.6c-1.2.1-2.4.3-3.6.5z"/><path fill="#b1060f" d="M9.6 2 15.6 22c-1.2-.2-2.4-.3-3.6-.3L6 2z" opacity=".55"/>'),
  },
  {
    id: 'youtube', name: 'YouTube', bg: '#fff', match: /youtube/i,
    mark: () => svg('<rect x="2" y="5.5" width="20" height="13" rx="4" fill="#ff0000"/><path fill="#fff" d="M10 9v6l5.2-3z"/>'),
  },
  {
    id: 'spotify', name: 'Spotify', bg: '#121212', match: /spotify/i,
    mark: () => svg('<circle cx="12" cy="12" r="10" fill="#1ed760"/><g fill="none" stroke="#121212" stroke-linecap="round"><path stroke-width="1.9" d="M6.6 9.3c3.6-1 7.8-.7 11 1"/><path stroke-width="1.6" d="M7.2 12.4c3-.8 6.3-.5 9 .9"/><path stroke-width="1.3" d="M7.8 15.3c2.4-.6 4.8-.4 6.9.7"/></g>'),
  },
];

/** The brand of what `tv` (its panel state) is showing, or null. */
export function brandOf(tv) {
  if (!tv?.on) return null;
  const said = [tv.app, tv.source, tv.title].filter(Boolean);
  for (const b of BRANDS) if (said.some((s) => b.match.test(s))) return b;
  return null;
}

/** A square logo tile for `brand`, sized by its container (CSS .brand-logo). */
export function brandLogo(brand) {
  return h('span.brand-logo', { vars: { '--brand-bg': brand.bg }, title: brand.name }, brand.mark());
}
