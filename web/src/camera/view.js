// The camera box: a room's camera, live, over the model (at the top on the Mac and the
// phone, on the left of an iPad lying down). Opened only by a camera's card in the room in
// view, closed when that room is left: one camera streams at a time, never in the background.
//
// Zoom: the mouse wheel (or a trackpad pinch) over the picture, around the pointer; a pinch
// on a touch screen; drag to move around a zoomed picture; double-click to go back.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { playCamera } from './live.js';

const MAX_ZOOM = 8;

export function createCameraBox({ access }) {
  const frame = h('div.cam-frame');
  // A new <video> for each play: a late answer for an older one can only clear its own.
  let video = null;
  const takeAspect = (v) => {
    if (v !== video || !v.videoWidth || !v.videoHeight) return;
    aspect = Math.min(2.4, Math.max(0.75, v.videoWidth / v.videoHeight));
    fit();
  };
  function freshVideo() {
    const v = h('video.cam-video', { muted: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.addEventListener('loadedmetadata', () => takeAspect(v));
    v.addEventListener('resize', () => takeAspect(v));
    v.addEventListener('loadeddata', () => takeAspect(v));
    video = v;
    frame.replaceChildren(v);
    return v;
  }
  const ptzLayer = h('div.cam-ptz', { hidden: true }); // camera/ptz.js: the arrows go here
  const status = h('div.cam-status');
  const name = h('span.cam-name');
  const zoomTag = h('span.cam-zoom', { hidden: true });
  const chips = h('div.cam-chips');
  const bar = h('div.cam-bar', h('span.cam-live', h('i'), 'AO VIVO'), name, zoomTag, chips);
  const box = h('div.cam-box', frame, ptzLayer, bar, status);
  const dock = h('div.cam-dock', { hidden: true }, box);

  let cameras = [];
  let current = null;
  let playing = null;    // { stop }
  let serial = 0;        // each play; a late answer for an older one is dropped
  let aspect = 16 / 9;

  /* ---------- size: the camera's own proportions, as large as the dock allows ---------- */
  function fit() {
    const w = dock.clientWidth;
    const hgt = dock.clientHeight;
    if (!w || !hgt) return;
    const bw = Math.min(w, hgt * aspect);
    box.style.width = `${Math.round(bw)}px`;
    box.style.height = `${Math.round(bw / aspect)}px`;
    clampView();
    apply();
  }
  new ResizeObserver(fit).observe(dock);

  /* ---------- digital zoom ---------- */
  const view = { s: 1, x: 0, y: 0 };
  function clampView() {
    const w = frame.clientWidth;
    const hgt = frame.clientHeight;
    view.s = Math.min(MAX_ZOOM, Math.max(1, view.s));
    view.x = Math.min(0, Math.max(w - w * view.s, view.x));
    view.y = Math.min(0, Math.max(hgt - hgt * view.s, view.y));
  }
  function apply() {
    if (!video) return;
    video.style.transform = view.s === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    zoomTag.hidden = view.s < 1.05;
    zoomTag.textContent = `${view.s.toFixed(1).replace('.', ',')}×`;
    box.classList.toggle('zoomed', view.s > 1.01);
  }
  /** Zooms by `factor` keeping the point (px, py) of the frame where it is. */
  function zoomAt(factor, px, py) {
    const s = Math.min(MAX_ZOOM, Math.max(1, view.s * factor));
    const k = s / view.s;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.s = s;
    clampView();
    apply();
  }
  function resetZoom() { view.s = 1; view.x = 0; view.y = 0; apply(); }
  const local = (ev) => { const r = frame.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

  frame.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [px, py] = local(ev);
    // a trackpad pinch arrives as a wheel with ctrlKey and small steps
    const step = ev.ctrlKey ? 0.01 : ev.deltaMode === 1 ? 0.05 : 0.0022;
    zoomAt(Math.exp(-ev.deltaY * step), px, py);
  }, { passive: false });

  const pointers = new Map();
  let pinch = null;
  let drag = null;
  frame.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, local(ev));
    frame.setPointerCapture(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
      drag = null;
    } else if (pointers.size === 1 && view.s > 1) {
      const [px, py] = local(ev);
      drag = { px, py, x: view.x, y: view.y };
    }
  });
  frame.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, local(ev));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      zoomAt(d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch.d = d;
    } else if (drag) {
      const [px, py] = local(ev);
      view.x = drag.x + px - drag.px;
      view.y = drag.y + py - drag.py;
      clampView();
      apply();
    }
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) drag = null;
  };
  frame.addEventListener('pointerup', up);
  frame.addEventListener('pointercancel', up);
  frame.addEventListener('dblclick', (ev) => {
    if (view.s > 1.01) resetZoom();
    else { const [px, py] = local(ev); zoomAt(2.5, px, py); }
  });

  /* ---------- playing ---------- */
  function say(text, retry = false) {
    status.replaceChildren(...(text ? [
      retry ? icon('cameraOff', 22, 1.8) : h('span.cam-spin'),
      h('span', text),
      retry ? h('button.cam-retry', { onclick: () => play(current) }, 'Tentar de novo') : null,
    ] : []));
    status.hidden = !text;
    box.classList.toggle('waiting', Boolean(text));
  }

  function renderChips() {
    chips.replaceChildren(...(cameras.length > 1 ? cameras.map((c) => h(`button.cam-chip${c === current ? '.on' : ''}`,
      { onclick: () => { if (c !== current) play(c); } }, c.name)) : []));
  }

  async function play(camera) {
    const mine = ++serial;
    playing?.stop();
    playing = null;
    current = camera;
    name.textContent = camera.name;
    renderChips();
    resetZoom();
    say('Conectando à câmera…');
    aspect = 16 / 9;
    fit();
    try {
      const ha = await access.use();
      if (mine !== serial) return;
      const p = await playCamera(ha, camera.link.id, freshVideo(), {
        onState: (s) => { if (mine === serial && s === 'fallback') say('Conectando (modo alternativo)…'); },
        isCancelled: () => mine !== serial,
      });
      if (mine !== serial) { p.stop(); return; }
      playing = p;
      say('');
      // WebKit may report the picture's size a little after the first frame, without an event
      const v = video;
      for (let i = 0; i < 30 && v === video && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
      takeAspect(v);
    } catch (e) {
      if (mine !== serial) return;
      console.warn('[câmera]', e);
      const why = { 'Camera not found': 'câmera não encontrada no Home Assistant' }[e?.message] || e?.message;
      say(`Sem imagem da câmera${why ? ` (${why})` : ''}`, true);
    }
  }

  return {
    el: dock,
    ptzLayer,
    get isOpen() { return !dock.hidden; },
    /** The plan id of the camera on screen, or null. */
    get currentId() { return dock.hidden ? null : current?.id ?? null; },
    /** Shows the first of `list` (the cameras of the room in view). */
    open(list) {
      cameras = list;
      dock.hidden = false;
      fit();
      play(list[0]);
    },
    /** Stops the video and Home Assistant's stream, and hides the box. */
    close() {
      if (dock.hidden) return;
      serial++;
      playing?.stop();
      playing = null;
      current = null;
      frame.replaceChildren();
      video = null;
      dock.hidden = true;
      say('');
      access.release();
    },
  };
}
