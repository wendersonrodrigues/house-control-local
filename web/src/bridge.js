// Thin bridge to the native shell (the macOS menu bar app or the iPhone app). In a plain
// browser every call is a no-op, so the same bundle runs under `vite dev` too.

const handler = window.webkit?.messageHandlers?.house;

export const isNative = Boolean(handler);

// 'ios' inside the iPhone app (or with ?platform=ios in a browser, to work on that layout).
// 'ha' when served by Home Assistant itself (/local/homeos/…, a tablet on the wall): the
// page talks to Home Assistant on its own (ha/connection.js), with no native shell around it.
export const platform = window.__HOUSE_BOOT__?.platform
  || new URLSearchParams(location.search).get('platform') || (handler ? 'macos' : location.pathname.startsWith('/local/') ? 'ha' : 'web');
export const isPhone = platform === 'ios';
export const isHA = platform === 'ha';
// A finger, not a pointer: the phone, and the tablet running the Home Assistant edition.
export const isTouch = isPhone || isHA;
// The tablet layout (model beside a wider panel, more card columns): the Home Assistant
// edition, and the iOS app on an iPad (its shell boots with `tablet: true`; ?tablet=1 in a
// browser together with ?platform=ios).
export const isTablet = isHA || (isPhone && Boolean(window.__HOUSE_BOOT__?.tablet
  || new URLSearchParams(location.search).get('tablet')));

// Without a native shell, something else may carry the commands (Home Assistant's own
// connection on a tablet): `fn(type, payload)` answers `call` instead of the shell.
let transport = null;
export function setTransport(fn) { transport = fn; }
/** True when commands reach real devices (a native shell, or a transport). */
export const canCall = () => Boolean(handler || transport);

export function post(type, payload = {}) {
  handler?.postMessage({ type, ...payload });
}

// A tap you can feel, on the iPhone only: 'tick' for a step of a slider, 'light' /
// 'medium' for a switch or a scene, 'error' when a device refuses a change.
export function haptic(kind = 'light') {
  if (isPhone) post('haptic', { kind });
}

// Native -> JS entry points are attached here by main.js.
export const incoming = (window.house = window.house || {});

// Request/response on top of the one-way message channel.
let nextId = 1;
const pending = new Map();

export function call(type, payload = {}) {
  if (transport) return transport(type, payload);
  if (!handler) return Promise.reject(new Error('Disponível só dentro do app'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    handler.postMessage({ type, callId: id, ...payload });
  });
}

incoming.reply = (id, result) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (result && result.error) p.reject(Object.assign(new Error(result.error), { detail: result }));
  else p.resolve(result);
};
