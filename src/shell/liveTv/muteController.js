// F348: decides what a mute toggle does. The bridge mutes without a reload; when the embed does not
// confirm the new value by the deadline (or is not a YouTube embed) onFallback asks for a remount.
import { isYoutubeIframe } from './youtubePlayerBridge.js';

export function createMuteController({
  bridge, getIframe, onFallback, onMutedChange, timeoutMs = 3000,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms), clearTimeoutFn = (id) => clearTimeout(id),
}) {
  let timer = null;
  let pending = null; // the value asked for and not yet confirmed

  const clear = () => { if (timer !== null) clearTimeoutFn(timer); timer = null; };
  const confirmed = (muted) => { const s = bridge.getSnapshot(); return s.ready && s.muted === muted; };

  return {
    request(muted) {
      clear();
      const iframe = getIframe();
      if (!isYoutubeIframe(iframe)) { pending = null; onFallback(); return; }
      bridge.setMuted(muted);
      if (confirmed(muted)) { pending = null; return; }
      pending = muted;
      timer = setTimeoutFn(() => {
        timer = null;
        const done = getIframe() !== iframe || confirmed(muted);
        pending = null;
        if (!done) onFallback();
      }, timeoutMs);
    },
    // A mute value the player reported. While a request is open, only its own value counts and it
    // is our own change; anything else is the old value still arriving.
    notifyMuted(muted) {
      if (pending !== null) {
        if (muted === pending) { pending = null; clear(); }
        return;
      }
      if (onMutedChange) onMutedChange(muted);
    },
    dispose() { clear(); pending = null; },
  };
}
