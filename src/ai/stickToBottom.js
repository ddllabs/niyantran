/**
 * Keeps the thread's scroller on its newest message while the reader is there (F46). A reader
 * who scrolls up is left alone until they send, or open another thread. `getEl` returns the
 * element that actually scrolls (.ai-v2-body).
 */
const SLACK_PX = 48;

export function createStickToBottom(getEl, slack = SLACK_PX) {
  let stuck = true;
  let lastTop = 0;
  return {
    /** A new thread: start at the bottom again. */
    reset() {
      stuck = true;
    },
    /** The reader scrolled: stay stuck only while they are within `slack` of the bottom. */
    onScroll() {
      const el = getEl();
      if (!el) return;
      stuck = el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
      lastTop = el.scrollTop;
    },
    /** Shown again after being hidden (panel-loading A): the bottom if stuck, else where it was. */
    restore() {
      const el = getEl();
      if (el) el.scrollTop = stuck ? el.scrollHeight : lastTop;
    },
    /** Content changed: follow it down if stuck, or always when `force` (the reader sent). */
    follow({ force = false } = {}) {
      const el = getEl();
      if (!el) return;
      if (force) stuck = true;
      if (stuck) el.scrollTop = el.scrollHeight;
    },
  };
}
