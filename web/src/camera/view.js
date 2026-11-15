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

export function createCameraBox({ access, onSize = () => {} }) {
  // The picture: one camera whole, or a custom view made of parts of several, one above the
  // other (the gate: the top half of the garage's dual-lens stream, then the bottom half of the
  // front's). The zoom moves the whole stage.
  const stage = h('div.cam-stage');
  const frame = h('div.cam-frame', stage);
  // New <video>s for each play: a late answer for an older one can only clear its own.
  let shown = [];        // [{ camera, part: 'full' | 'top' | 'bottom', video, pane }]
  const partAspect = (p) => (p.video?.videoWidth && p.video.videoHeight
    ? p.video.videoWidth / (p.part === 'full' ? p.video.videoHeight : p.video.videoHeight / 2)
    : p.part === 'full' ? 16 / 9 : 16 / 9);
  /** The box's proportions from its parts' (stacked parts: their heights add up). */
  function takeAspect() {
    if (!shown.length) return;
    const inv = shown.reduce((sum, p) => sum + 1 / partAspect(p), 0);
    for (const p of shown) if (p.pane) p.pane.style.flexGrow = String(1 / partAspect(p));
    aspect = Math.min(2.4, Math.max(0.6, 1 / inv));
    fit();
  }
  function freshVideo() {
    const v = h('video.cam-video', { muted: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
    v.muted = true;
    v.setAttribute('playsinline', '');
    for (const ev of ['loadedmetadata', 'resize', 'loadeddata']) v.addEventListener(ev, () => { if (shown.some((p) => p.video === v)) takeAspect(); });
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
  let playing = [];      // [{ stop }], one per video
  let serial = 0;        // each play; a late answer for an older one is dropped
  let aspect = 16 / 9;

  /* ---------- size: the camera's own proportions, as large as the screen allows ----------
     Beside the model (an iPad lying down, html.split): inside the model's side, above the
     room tabs. Everywhere else (the Mac, a phone, an iPad standing): as wide as the panel
     less a margin, as tall as that makes it (up to what leaves room for some cards), and the
     cards move down below it (onSize: the panel sets --cam-h). */
  const RESERVE = 190; // px kept below the box for the cards, in the full-width layout
  function fit() {
    const w = dock.clientWidth;
    if (!w || dock.hidden) return;
    let bw;
    let bh;
    if (document.documentElement.classList.contains('split')) {
      const hgt = dock.clientHeight;
      if (!hgt) return;
      bw = Math.min(w, hgt * aspect);
      bh = bw / aspect;
    } else {
      const clip = dock.parentElement;
      // the room tabs at the foot (a phone, an iPad) take their height off too
      const tabs = clip?.querySelector('.panel.rooms-bottom:not(.hidden) .rooms');
      const foot = tabs ? clip.getBoundingClientRect().bottom - tabs.getBoundingClientRect().top : 0;
      const room = (clip?.clientHeight || innerHeight) - dock.offsetTop - RESERVE - foot;
      bw = w;
      bh = bw / aspect;
      if (bh > room && room > 120) { bh = room; bw = bh * aspect; }
    }
    box.style.width = `${Math.round(bw)}px`;
    box.style.height = `${Math.round(bh)}px`;
    onSize(Math.round(bh));
    clampView();
    apply();
  }
  new ResizeObserver(fit).observe(dock);
  addEventListener('resize', () => requestAnimationFrame(fit));

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
    stage.style.transform = view.s === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
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
      retry ? h('button.cam-retry', { onclick: () => play(lastView) }, 'Tentar de novo') : null,
    ] : []));
    status.hidden = !text;
    box.classList.toggle('waiting', Boolean(text));
  }

  function renderChips() {
    chips.replaceChildren(...(cameras.length > 1 ? cameras.map((c) => h(`button.cam-chip${c === current ? '.on' : ''}`,
      { onclick: () => { if (c !== current) play([{ camera: c, part: 'full' }]); } }, c.name)) : []));
  }

  let lastView = [];
  /** Plays `view`: [{ camera, part }], one camera whole or parts of several stacked. */
  async function play(view) {
    const mine = ++serial;
    for (const p of playing) p.stop();
    playing = [];
    lastView = view;
    current = view.length === 1 && view[0].part === 'full' ? view[0].camera : null;
    name.textContent = view.map((p) => p.camera.name).join(' + ');
    renderChips();
    resetZoom();
    say('Conectando à câmera…');
    shown = view.map((p) => {
      const video = freshVideo();
      const pane = p.part === 'full' ? null : h('div.cam-pane', { 'data-part': p.part }, video);
      return { ...p, video, pane };
    });
    stage.replaceChildren(...shown.map((p) => p.pane || p.video));
    stage.classList.toggle('stacked', shown.length > 1 || shown.some((p) => p.pane));
    takeAspect();
    let ha;
    try {
      ha = await access.use();
    } catch (e) {
      if (mine === serial) say(`Sem imagem da câmera${e?.message ? ` (${e.message})` : ''}`, true);
      return;
    }
    if (mine !== serial) return;
    const results = await Promise.allSettled(shown.map((p) => playCamera(ha, p.camera.link.id, p.video, {
      onState: (st) => { if (mine === serial && st === 'fallback') say('Conectando (modo alternativo)…'); },
      isCancelled: () => mine !== serial,
    })));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (mine !== serial) { for (const p of ok) p.stop(); return; }
    playing = ok;
    if (!ok.length) {
      const e = results[0].reason;
      console.warn('[câmera]', e);
      const why = { 'Camera not found': 'câmera não encontrada no Home Assistant' }[e?.message] || e?.message;
      say(`Sem imagem da câmera${why ? ` (${why})` : ''}`, true);
      return;
    }
    say('');
    // a part that did not come: its name over the empty place
    results.forEach((r, i) => {
      if (r.status === 'rejected') (shown[i].pane || stage).append(h('div.cam-part-off', `${shown[i].camera.name}: sem imagem`));
    });
    // WebKit may report the picture's size a little after the first frame, without an event
    for (let i = 0; i < 30 && mine === serial && shown.some((p) => !p.video.videoWidth); i++) await new Promise((r) => setTimeout(r, 100));
    if (mine === serial) takeAspect();
  }

  return {
    el: dock,
    ptzLayer,
    get isOpen() { return !dock.hidden; },
    /** The plan id of the camera on screen whole, or null (closed, or a custom view). */
    get currentId() { return dock.hidden ? null : current?.id ?? null; },
    /** True when camera `id` is on screen, whole or as part of a custom view. */
    shows(id) { return !dock.hidden && shown.some((p) => p.camera.id === id); },
    /** Shows the first of `list` (the cameras of the room in view). */
    open(list) {
      cameras = list;
      dock.hidden = false;
      fit();
      play([{ camera: list[0], part: 'full' }]);
    },
    /** A custom view: parts of cameras stacked, [{ camera, part: 'top' | 'bottom' | 'full' }]. */
    openView(view) {
      cameras = [];
      dock.hidden = false;
      fit();
      play(view);
    },
    /** Stops the video and Home Assistant's stream, and hides the box. */
    close() {
      if (dock.hidden) return;
      serial++;
      for (const p of playing) p.stop();
      playing = [];
      current = null;
      stage.replaceChildren();
      shown = [];
      dock.hidden = true;
      say('');
      access.release();
    },
  };
}
