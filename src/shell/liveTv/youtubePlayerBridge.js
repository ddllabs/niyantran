// F348: reads the playback state of a YouTube embed and sends it mute commands over the iframe's
// postMessage protocol, so muting does not reload the video. No YouTube script is loaded. Everything
// the iframe sends is untrusted data: only the iframe's own window, from a YouTube origin, is heard.
const ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];
// initialDelivery is ignored: only onReady and infoDelivery show the player is taking commands.
const EVENTS = ['onReady', 'infoDelivery'];
const EMPTY = { ready: false, positionS: null, durationS: null, playerState: null, muted: null, updatedAt: null };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function originOf(iframe) {
  try {
    if (!iframe) return null;
    const o = new URL(iframe.src).origin;
    return ORIGINS.includes(o) ? o : null;
  } catch { return null; }
}

export const isYoutubeIframe = (iframe) => originOf(iframe) !== null;
export const isYoutubeUrl = (url) => { try { return ORIGINS.includes(new URL(url).origin); } catch { return false; } };

// onMutedChange(muted) is called when the player reports a mute value different from the last one.
export function createYoutubePlayerBridge({ getIframe, win = window, onMutedChange }) {
  let snap = { ...EMPTY };
  let current = null;
  let pendingMuted = null;
  let timer = null;
  let listening = false;

  const post = (iframe, payload) => {
    const origin = originOf(iframe);
    if (!origin || !iframe.contentWindow) return false;
    iframe.contentWindow.postMessage(JSON.stringify(payload), origin);
    return true;
  };
  const sendMute = (iframe, muted) => post(iframe, { event: 'command', func: muted ? 'mute' : 'unMute', args: [] });

  function onMessage(ev) {
    const iframe = current;
    if (!iframe || !ev || ev.source !== iframe.contentWindow || ev.origin !== originOf(iframe)) return;
    let msg = ev.data;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
    if (!msg || typeof msg !== 'object' || !EVENTS.includes(msg.event)) return;
    const info = msg.info && typeof msg.info === 'object' ? msg.info : {};
    const wasReady = snap.ready;
    const prevMuted = snap.muted;
    snap = {
      ready: true,
      positionS: num(info.currentTime) ?? snap.positionS,
      durationS: num(info.duration) ?? snap.durationS,
      playerState: num(info.playerState) ?? snap.playerState,
      muted: typeof info.muted === 'boolean' ? info.muted : snap.muted,
      updatedAt: Date.now(),
    };
    if (!wasReady && pendingMuted !== null) { sendMute(iframe, pendingMuted); pendingMuted = null; }
    if (snap.muted !== prevMuted && snap.muted !== null && onMutedChange) onMutedChange(snap.muted);
  }

  function tick() {
    const iframe = getIframe() || null;
    if (iframe !== current) { if (current) pendingMuted = null; current = iframe; snap = { ...EMPTY }; }
    if (current && !snap.ready) post(current, { event: 'listening', id: 1, channel: 'widget' });
  }

  return {
    start() {
      if (listening) return;
      listening = true;
      win.addEventListener('message', onMessage);
      timer = win.setInterval(tick, 500);
      tick();
    },
    stop() {
      if (!listening) return;
      listening = false;
      win.removeEventListener('message', onMessage);
      if (timer !== null) win.clearInterval(timer);
      timer = null;
      current = null;
      snap = { ...EMPTY };
      pendingMuted = null;
    },
    setMuted(muted) {
      if (current && snap.ready) sendMute(current, !!muted);
      else pendingMuted = !!muted;
    },
    // F363: moves the player to a second in the video. Only to the trusted YouTube origin, only once the
    // player is taking commands. Returns whether a command was sent (it does not say the player moved).
    seekTo(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return false;
      if (!current || !snap.ready || getIframe() !== current) return false;
      const sent = post(current, { event: 'command', func: 'seekTo', args: [Math.floor(seconds), true] });
      // The position held so far is from before the move: forget it until the player reports a new one.
      if (sent) snap = { ...snap, positionS: null };
      return sent;
    },
    // Empty as soon as the iframe is another element, without waiting for the next tick.
    getSnapshot: () => (current !== null && getIframe() === current ? snap : EMPTY),
  };
}
