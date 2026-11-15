// The line to Home Assistant the cameras use, wherever the page runs:
//   - the Home Assistant edition (the iPad, the "HomeOs 3D" dashboard) already has one
//     (ha/connection.js): it is used as it is;
//   - inside the Mac or iPhone app the connection lives in Swift, which hands over the
//     addresses (local first, then the external one) and the token when a camera opens
//     ('camera.access'); the page then opens a socket of its own just for the video, and
//     closes it a minute after the last camera closes.
// In a plain browser (vite dev) there is no Home Assistant: cameras are unavailable.

import { call, isNative } from '../bridge.js';
import { connectWithToken } from '../ha/connection.js';

const IDLE_MS = 60_000;

export function createCameraAccess({ ha = null } = {}) {
  let own = null;      // Promise of our own socket (native apps)
  let idle = 0;
  let inUse = false;   // a camera is on screen

  function later() {
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (inUse || !own) return;
      const p = own;
      own = null;
      p.then((c) => c.close(), () => {});
    }, IDLE_MS);
  }

  async function open() {
    if (ha) return ha;
    if (!isNative) throw new Error('Câmeras só no app ou no painel do Home Assistant');
    clearTimeout(idle);
    if (!own) {
      own = (async () => {
        const a = await call('camera.access');
        if (!a?.token) throw new Error(a?.error || 'Conecte o Home Assistant para ver as câmeras');
        return connectWithToken(a.urls || [a.url], a.token);
      })();
      own.catch(() => { own = null; });
    }
    return own;
  }

  return {
    available: Boolean(ha) || isNative,
    /** The connection for a camera going on screen, opened if needed. */
    use() { inUse = true; return open(); },
    /** Opened ahead of a click (a room with a camera came into view): the click is quicker. */
    warm() {
      if (!this.available || ha) return;
      open().then(() => { if (!inUse) later(); }, () => {});
    },
    /** No camera on screen any more: our own socket closes after a while. */
    release() {
      inUse = false;
      if (!ha && own) later();
    },
  };
}
