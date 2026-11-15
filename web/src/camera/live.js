// A camera's live video, through Home Assistant: WebRTC first (Home Assistant's own go2rtc
// takes the stream from Frigate's restream, about half a second to the first frame, full
// resolution), HLS if WebRTC fails (slower to start, but Safari plays it natively).
//
// `ha` is the small connection of ha/connection.js ({ call, subscribe, base }). Nothing is
// kept between two plays: stop() closes the peer connection and Home Assistant's session,
// so no camera keeps streaming once its box is closed.

const FIRST_FRAME_MS = 9000;

/** Plays `entity` (camera.xxx) in `video`. Resolves to { stop, kind } once a frame shows. */
export async function playCamera(ha, entity, video, { onState, isCancelled } = {}) {
  let stop = () => {};
  let stopped = false;
  const cancelled = { get now() { return stopped || Boolean(isCancelled?.()); } };
  const stopAll = () => { stopped = true; stop(); clear(video); };
  try {
    onState?.('connecting');
    stop = await webrtc(ha, entity, video, cancelled);
    return { stop: stopAll, kind: 'webrtc' };
  } catch (e) {
    stop();
    clear(video);
    if (cancelled.now) throw e;
    console.warn('[câmera] WebRTC falhou, tentando HLS:', e?.message || e);
  }
  onState?.('fallback');
  stop = await hls(ha, entity, video, cancelled);
  return { stop: stopAll, kind: 'hls' };
}

function clear(video) {
  try { video.pause(); } catch { /* not playing */ }
  video.srcObject = null;
  if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
}

/** Resolves once `video` shows a frame; rejects after a while or if `cancelled`. */
function firstFrame(video, cancelled, ms = FIRST_FRAME_MS) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth) { resolve(); return; }
    const done = (ok, why) => {
      clearTimeout(timer);
      clearInterval(poll);
      video.removeEventListener('loadeddata', onData);
      if (ok) resolve(); else reject(new Error(why));
    };
    const onData = () => done(true);
    const timer = setTimeout(() => done(false, 'a câmera não mandou imagem'), FIRST_FRAME_MS);
    const poll = setInterval(() => { if (cancelled.now) done(false, 'cancelado'); }, 150);
    video.addEventListener('loadeddata', onData);
  });
}

async function webrtc(ha, entity, video, cancelled) {
  let config = {};
  try {
    config = (await ha.call({ type: 'camera/webrtc/get_client_config', entity_id: entity })) || {};
  } catch { /* an older Home Assistant: no STUN servers, fine at home */ }
  const pc = new RTCPeerConnection(config.configuration || {});
  if (config.dataChannel) pc.createDataChannel(config.dataChannel);
  pc.addTransceiver('video', { direction: 'recvonly' }); // the picture only: no sound
  let unsub = null;
  let failed = null;
  const stop = () => {
    const u = unsub;
    unsub = null;
    try { u?.(); } catch { /* the socket went away */ }
    pc.close();
  };
  pc.ontrack = (ev) => {
    if (!video.srcObject) video.srcObject = ev.streams[0] || new MediaStream([ev.track]);
    video.play?.().catch(() => {});
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let session = null;
    const early = [];
    const sendCandidate = (candidate) => ha.call({ type: 'camera/webrtc/candidate', entity_id: entity, session_id: session, candidate })
      .catch(() => {});
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const c = { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex };
      if (session) sendCandidate(c); else early.push(c);
    };
    unsub = await ha.subscribe({ type: 'camera/webrtc/offer', entity_id: entity, offer: offer.sdp }, async (ev) => {
      if (ev.type === 'session') {
        session = ev.session_id;
        for (const c of early.splice(0)) sendCandidate(c);
      } else if (ev.type === 'answer') {
        try { await pc.setRemoteDescription({ type: 'answer', sdp: ev.answer }); } catch (e) { failed = e.message; }
      } else if (ev.type === 'candidate') {
        try { await pc.addIceCandidate(ev.candidate); } catch { /* a candidate this side cannot use */ }
      } else if (ev.type === 'error') {
        failed = ev.message || ev.code || 'erro do Home Assistant';
      }
    }, { once: true });
    if (cancelled.now) throw new Error('cancelado');
    await Promise.race([
      firstFrame(video, cancelled),
      new Promise((_, reject) => {
        const t = setInterval(() => {
          if (failed || pc.connectionState === 'failed' || cancelled.now) { clearInterval(t); reject(new Error(failed || 'WebRTC não conectou')); }
          if (video.readyState >= 2) clearInterval(t);
        }, 200);
      }),
    ]);
    return stop;
  } catch (e) {
    stop();
    throw e;
  }
}

async function hls(ha, entity, video, cancelled) {
  const res = await ha.call({ type: 'camera/stream', entity_id: entity, format: 'hls' });
  if (cancelled.now) throw new Error('cancelado');
  if (!video.canPlayType('application/vnd.apple.mpegurl')) throw new Error('este navegador não toca HLS');
  video.src = new URL(res.url, ha.base).href;
  video.play?.().catch(() => {});
  await firstFrame(video, cancelled, 20000); // HLS waits for its first segments
  return () => {};
}
