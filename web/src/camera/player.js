// The clip player of the camera box (a Frigate detection, camera/console.js), in the manner of
// the Frigate card of Home Assistant: the clip fills the box; a play button in the middle
// while it is stopped; at the foot the time, a progress bar to scrub, sound, the clip's
// details, download, and the other clips of the camera in a drawer at the right.
//
// It starts muted: a muted clip may start by itself on an iPhone (one with sound waits for a
// tap, and Low Power Mode stops even that, when the big play button is the way in).

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const time = (s) => {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function createClipPlayer() {
  const video = h('video.cp-video', { playsInline: true, muted: true, preload: 'auto', disablePictureInPicture: true });
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  const big = h('button.cp-big', { 'aria-label': 'Tocar' }, icon('play', 30, 2));
  const spin = h('span.cp-spin', { hidden: true });
  const failMsg = h('div.cp-fail', { hidden: true });
  const title = h('span.cp-title');
  // a recording: the static REC tag (no live mark, nothing blinking); ✕ goes back to the camera
  const rec = h('span.cp-rec', 'REC');
  const back = h('button.cp-back', { title: 'Fechar a gravação', 'aria-label': 'Fechar a gravação' }, icon('close', 16, 2.4));
  const playBtn = h('button.cp-btn', { 'aria-label': 'Tocar ou pausar' }, icon('play', 17, 2.2));
  const now = h('span.cp-time', '00:00');
  const total = h('span.cp-time.total', '--:--');
  const seek = h('input.cp-seek', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Posição do clipe' });
  const soundBtn = h('button.cp-btn', { 'aria-label': 'Som', title: 'Som' }, icon('mute', 17, 2.2));
  const infoBtn = h('button.cp-btn', { 'aria-label': 'Detalhes', title: 'Detalhes' }, icon('info', 17, 2.2));
  const downBtn = h('a.cp-btn', { 'aria-label': 'Baixar o vídeo', title: 'Baixar o vídeo', target: '_blank', rel: 'noopener' }, icon('download', 17, 2.2));
  const listBtn = h('button.cp-btn', { 'aria-label': 'Outros clipes', title: 'Outros clipes' }, icon('drawerOpen', 17, 2.2));
  const foot = h('div.cp-foot', playBtn, now, seek, total, soundBtn, infoBtn, downBtn, listBtn);

  // the clip's details, over the picture (as the card's information panel)
  const infoRows = h('div.cp-info-rows');
  const viewedBtn = h('button.cp-info-act', { title: 'Marcar como visto' }, icon('check', 18, 2.4));
  const infoDown = h('a.cp-info-act', { title: 'Baixar o vídeo', target: '_blank', rel: 'noopener' }, icon('download', 18, 2.4));
  const infoClose = h('button.cp-info-close', { 'aria-label': 'Fechar' }, icon('close', 18, 2.4));
  const infoTitle = h('div.cp-info-title');
  const info = h('div.cp-info', { hidden: true },
    h('div.cp-info-head', infoTitle, h('div.cp-info-acts', viewedBtn, infoDown), infoClose), infoRows);

  // the other clips: a drawer at the right
  const drawerList = h('div.cp-drawer-list');
  const drawer = h('div.cp-drawer', drawerList);

  const el = h('div.cam-clip', { hidden: true },
    video, big, spin, failMsg,
    h('div.cp-top', rec, title, back),
    foot, info, drawer);

  let opts = {};
  let scrubbing = false;
  let hideTimer = 0;

  function paint() {
    const paused = video.paused || video.ended;
    big.hidden = !paused || !failMsg.hidden;
    playBtn.replaceChildren(icon(paused ? 'play' : 'pause', 17, 2.2));
    soundBtn.replaceChildren(icon(video.muted ? 'mute' : 'sound', 17, 2.2));
    if (!scrubbing && Number.isFinite(video.duration) && video.duration > 0) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    seek.style.setProperty('--p', `${(Number(seek.value) / 10).toFixed(1)}%`);
    now.textContent = time(video.currentTime);
    total.textContent = time(video.duration);
    el.classList.toggle('playing', !paused);
  }
  function wake() {
    el.classList.add('awake');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!video.paused && !scrubbing) el.classList.remove('awake'); }, 2800);
  }
  const toggle = () => { if (video.paused || video.ended) video.play().catch(() => paint()); else video.pause(); wake(); };
  for (const ev of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'ended', 'volumechange']) video.addEventListener(ev, paint);
  video.addEventListener('waiting', () => { spin.hidden = false; });
  for (const ev of ['playing', 'canplay', 'pause']) video.addEventListener(ev, () => { spin.hidden = true; });
  video.addEventListener('error', () => {
    spin.hidden = true;
    failMsg.hidden = false;
    failMsg.textContent = 'Não foi possível tocar este clipe.';
    paint();
  });
  big.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  video.addEventListener('click', () => {
    if (el.classList.contains('drawer')) { setDrawer(false); return; } // a tap beside the drawer folds it
    if (el.classList.contains('awake')) toggle(); else wake();
  });
  soundBtn.addEventListener('click', (e) => { e.stopPropagation(); video.muted = !video.muted; wake(); });
  seek.addEventListener('input', () => {
    scrubbing = true;
    if (Number.isFinite(video.duration)) video.currentTime = (Number(seek.value) / 1000) * video.duration;
    paint();
  });
  seek.addEventListener('change', () => { scrubbing = false; wake(); });
  infoBtn.addEventListener('click', (e) => { e.stopPropagation(); info.hidden = !info.hidden; infoBtn.classList.toggle('on', !info.hidden); });
  infoClose.addEventListener('click', (e) => { e.stopPropagation(); info.hidden = true; infoBtn.classList.remove('on'); });
  viewedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (opts.viewed == null) return;
    opts.viewed = !opts.viewed;
    viewedBtn.classList.toggle('done', opts.viewed);
    opts.onViewed?.(opts.viewed);
  });
  listBtn.addEventListener('click', (e) => { e.stopPropagation(); setDrawer(!el.classList.contains('drawer')); });
  function setDrawer(open) {
    el.classList.toggle('drawer', open);
    listBtn.replaceChildren(icon(open ? 'drawerClose' : 'drawerOpen', 17, 2.2));
    listBtn.classList.toggle('on', open);
    if (open) drawerList.querySelector('.playing')?.scrollIntoView({ block: 'nearest' });
  }
  for (const ev of ['pointerdown', 'wheel', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
  el.addEventListener('pointermove', wake);

  return {
    el,
    get isOpen() { return !el.hidden; },
    /**
     * Plays a clip: { url, title, info: [[icon, text]], download, viewed (true/false, or null
     * when it cannot be marked), onViewed(v), list: [Element] (the drawer), onBack }.
     */
    open(o) {
      const wasOpen = !el.hidden;
      opts = o;
      el.hidden = false;
      failMsg.hidden = true;
      spin.hidden = false;
      title.textContent = o.title || '';
      infoTitle.replaceChildren(h('i.cp-dot'), o.title || '');
      infoRows.replaceChildren(...(o.info || []).filter(([, t]) => t).map(([g, t]) => h('span.cp-info-row', icon(g, 17, 2), t)));
      viewedBtn.hidden = o.viewed == null;
      viewedBtn.classList.toggle('done', Boolean(o.viewed));
      for (const a of [downBtn, infoDown]) { a.hidden = !o.download; if (o.download) { a.href = o.download; a.setAttribute('download', ''); } }
      drawerList.replaceChildren(...(o.list || []));
      listBtn.hidden = !(o.list || []).length;
      back.onclick = (e) => { e.stopPropagation(); o.onBack?.(); };
      // the drawer opens with the first clip, as the card does once a clip plays (wide boxes only)
      // the drawer opens only from its button (as the Frigate card)
      if (!wasOpen) setDrawer(false);
      else drawerList.querySelector('.playing')?.scrollIntoView({ block: 'nearest' });
      video.src = o.url;
      video.muted = true;
      seek.value = '0';
      paint();
      video.play().catch(() => { spin.hidden = true; paint(); });
      wake();
    },
    /** Updates the drawer (the clip on screen marked) without reloading the video. */
    setList(list) { drawerList.replaceChildren(...list); },
    close() {
      el.hidden = true;
      info.hidden = true;
      infoBtn.classList.remove('on');
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
    pause() { video.pause(); },
    video,
  };
}
