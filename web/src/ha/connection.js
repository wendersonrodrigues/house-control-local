// The page's own line to Home Assistant, for the tablet edition served from Home Assistant
// itself (/local/homeos/). Nothing is pasted and no token lives in the code:
//   1. inside a Home Assistant dashboard (a "Webpage" dashboard: an iframe of the same
//      origin) it borrows the frontend's own connection, already signed in;
//   2. opened on its own (Safari, or added to the Home Screen) it uses the sign-in this
//      browser already has for Home Assistant, or asks Home Assistant's own login page once,
//      then keeps refreshing that session like the frontend does.
// Either way the result is { call(message), subscribe(message, onEvent) → unsubscribe, base }.

const OWN_KEY = 'homeos:ha-auth:v1';
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

/** The frontend's connection when this page is inside a Home Assistant dashboard. */
async function borrowed() {
  let host;
  try {
    host = window.parent !== window ? window.parent : null;
    if (!host?.hassConnection) return null; // another origin throws; not inside HA is undefined
  } catch { return null; }
  const { conn } = await host.hassConnection;
  return {
    kind: 'frontend',
    base: location.origin,
    call: (msg) => conn.sendMessagePromise(msg),
    subscribe: (msg, fn) => conn.subscribeMessage(fn, msg), // resolves to the unsubscribe
    onReconnect: (fn) => conn.addEventListener('ready', fn),
    close: () => {},
  };
}

// ---- standalone: an access token that is kept fresh ----

function storedAuth() {
  const own = read(OWN_KEY);
  if (own?.refresh_token || own?.access_token) return own;
  // The frontend's own session on this origin ("keep me signed in").
  const theirs = read('hassTokens');
  if (theirs?.refresh_token && (!theirs.hassUrl || theirs.hassUrl === location.origin)) {
    return { ...theirs, hassUrl: location.origin, clientId: theirs.clientId || `${location.origin}/` };
  }
  return null;
}

async function tokenRequest(base, body) {
  const res = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw Object.assign(new Error(`login recusado (HTTP ${res.status})`), { status: res.status });
  return res.json();
}

/** Sends the browser to Home Assistant's login page; it comes back here with ?code=. */
function signIn() {
  // back through the entry page (index.html), which opens the current version with ?code=
  const back = `${location.origin}${location.pathname.replace(/app\.html$/, 'index.html')}`;
  const params = new URLSearchParams({ client_id: `${location.origin}/`, redirect_uri: back, state: 'homeos' });
  location.assign(`${location.origin}/auth/authorize?${params}`);
  return new Promise(() => {}); // leaving the page
}

/** The code Home Assistant's login page sent back, turned into a session (and the URL cleaned). */
async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code || q.get('state') !== 'homeos') return null;
  const clientId = `${location.origin}/`;
  const t = await tokenRequest(location.origin, { grant_type: 'authorization_code', code, client_id: clientId });
  const auth = { ...t, hassUrl: location.origin, clientId, expires: Date.now() + t.expires_in * 1000 };
  write(OWN_KEY, auth);
  for (const k of ['code', 'state', 'storeToken']) q.delete(k);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  return auth;
}

async function freshToken(auth) {
  // A long-lived token (pasted for a test) has no expiry and nothing to refresh.
  if (!auth.refresh_token || (auth.expires && auth.expires - Date.now() > 60_000)) return auth.access_token;
  const t = await tokenRequest(auth.hassUrl, { grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.clientId });
  Object.assign(auth, { access_token: t.access_token, expires: Date.now() + t.expires_in * 1000 });
  // Only our own copy is rewritten; the frontend keeps managing its own.
  if (read(OWN_KEY)?.refresh_token === auth.refresh_token) write(OWN_KEY, auth);
  return auth.access_token;
}

/** A WebSocket of our own, reconnecting by itself, with the same small interface. */
async function standalone() {
  const auth = (await finishSignIn()) || storedAuth();
  if (!auth) return signIn();
  try {
    await freshToken(auth);
  } catch (e) {
    if (e.status === 400 || e.status === 403) { // the session was revoked: sign in again
      try { localStorage.removeItem(OWN_KEY); } catch { /* ignore */ }
      return signIn();
    }
    throw e;
  }
  return socket([auth.hassUrl || location.origin], () => freshToken(auth), 'own');
}

/**
 * A WebSocket to Home Assistant at the first of `bases` that answers (the local address,
 * then the external one), signed in with what `token()` gives. Reconnects by itself, moving
 * to the next address when one stops answering. `subscribe` resolves to a function that ends
 * that subscription; `{ once: true }` subscriptions (a camera's WebRTC session) are not
 * started again after a reconnection.
 */
async function socket(bases, token, kind) {
  let at = 0;
  let ws = null;
  let nextId = 1;
  let closed = false;
  let started = false; // the first connection is tried address by address below
  const waiting = new Map();      // id -> { resolve, reject }
  const subs = new Map();         // id -> { msg, fn, once }
  const reconnected = new Set();
  let ready = null;
  let retry = 1000;

  function open() {
    ready = new Promise((resolve, reject) => {
      let authed = false;
      const sock = new WebSocket(`${bases[at].replace(/^http/, 'ws')}/api/websocket`);
      ws = sock;
      // an address that does not answer at all (the local one, away from home) gives up soon
      const timer = setTimeout(() => { if (!authed) sock.close(); }, 6000);
      sock.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'auth_required') {
          try { sock.send(JSON.stringify({ type: 'auth', access_token: await token() })); } catch (e) { reject(e); sock.close(); }
        } else if (m.type === 'auth_ok') {
          authed = true;
          clearTimeout(timer);
          retry = 1000;
          resolve();
        } else if (m.type === 'auth_invalid') {
          reject(new Error('O Home Assistant recusou o login'));
        } else if (m.type === 'result') {
          const w = waiting.get(m.id);
          if (!w) return;
          waiting.delete(m.id);
          if (m.success) w.resolve(m.result);
          else w.reject(Object.assign(new Error(m.error?.message || 'O Home Assistant recusou'), { code: m.error?.code }));
        } else if (m.type === 'event') {
          subs.get(m.id)?.fn(m.event);
        }
      };
      sock.onclose = () => {
        for (const w of waiting.values()) w.reject(new Error('Sem conexão com o Home Assistant'));
        waiting.clear();
        reject(new Error('Sem conexão com o Home Assistant'));
        if (ws !== sock || closed || !started) return;
        if (!authed) at = (at + 1) % bases.length; // this address did not answer: try the other one
        setTimeout(() => {
          if (closed) return;
          open();
          ready.then(() => {
            // the subscriptions start again under new ids, then whoever asked re-reads the states
            const old = [...subs.values()];
            subs.clear();
            for (const s of old) if (!s.once) send({ ...s.msg }, s);
            for (const fn of reconnected) fn();
          }).catch(() => {});
        }, bases.length > 1 && !authed ? 0 : retry);
        if (authed || at === 0) retry = Math.min(retry * 2, 30000);
      };
    });
    ready.catch(() => {});
  }

  function send(msg, sub) {
    const id = nextId++;
    if (sub) subs.set(id, sub);
    const answer = new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ ...msg, id }));
    });
    return sub ? answer.then(() => id, (e) => { subs.delete(id); throw e; }) : answer;
  }

  // The first connection: each address in turn, once.
  let firstError = null;
  for (let tries = 0; tries < bases.length; tries++) {
    open();
    try { await ready; firstError = null; break; } catch (e) {
      firstError = e;
      ws?.close();
      if (/recusou/.test(e.message)) break; // the token, not the address
      at = (at + 1) % bases.length;
    }
  }
  if (firstError) { closed = true; throw firstError; }
  started = true;
  return {
    kind,
    get base() { return bases[at]; },
    call: async (msg) => { await ready; return send(msg); },
    subscribe: async (msg, fn, { once = false } = {}) => {
      await ready;
      const sub = { msg, fn, once };
      const id = await send(msg, sub);
      let current = id;
      return async () => {
        // after a reconnection the subscription lives under another id
        for (const [k, v] of subs) if (v === sub) current = k;
        if (!subs.delete(current)) return;
        try { await send({ type: 'unsubscribe_events', subscription: current }); } catch { /* gone with the socket */ }
      };
    },
    onReconnect: (fn) => reconnected.add(fn),
    close: () => { closed = true; ws?.close(); },
  };
}

/**
 * Home Assistant with a long-lived token, for the native apps (the Mac, the iPhone), whose
 * own connection lives in Swift: the page opens this one only for what Swift does not carry
 * (a camera's live video). `bases`: the addresses to try, in order.
 */
export function connectWithToken(bases, token) {
  return socket(bases.filter(Boolean), async () => token, 'token');
}

/** Home Assistant, however this page can reach it. */
export async function connectHA() {
  return (await borrowed()) || standalone();
}
