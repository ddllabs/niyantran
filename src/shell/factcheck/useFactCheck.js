// F344 T6: React glue for the fact-check controller. Kept thin on purpose: the logic is in
// factCheckController.js. Uses only useState and useEffect, called unconditionally, so the hook
// order of LiveTvPage stays the same whether the page is open or closed.
import { useEffect, useState } from 'react';
import { INITIAL_VIEW, createFactCheckController } from './factCheckController.js';

/**
 * open    the page is open (the flag is read on open; a session ends on close)
 * target  what is playing, as one string, or null; a change ends a running session
 * getPosition  () => { positionS, playerState } | null, the player's position (recorded videos only are used)
 * start   { videoId, channelId, videoKind, startPositionS, seed } for a session started now;
 *         getStartPositionS(), when given, is read at confirm time and replaces startPositionS
 */
export function withPosition(start) {
  const { getStartPositionS, ...rest } = start;
  if (typeof getStartPositionS !== 'function') return start;
  const p = getStartPositionS();
  return { ...rest, startPositionS: Number.isInteger(p) && p >= 0 ? p : null };
}

export function useFactCheck({ open, target, start, getPosition }) {
  const [view, setView] = useState(INITIAL_VIEW);
  // The controller outlives renders; it reads the newest getPosition through this holder.
  const [source] = useState(() => ({ read: null }));
  source.read = getPosition || null;
  const [controller] = useState(() => createFactCheckController({
    onChange: (next) => setView(next),
    getPosition: () => (source.read ? source.read() : null),
  }));

  useEffect(() => {
    if (!open) return undefined;
    void controller.load();
    return () => { void controller.close(); };
  }, [open, controller]);

  useEffect(() => { controller.setTarget(target); }, [target, controller]);
  // Shared results are looked up for the video that is playing, when it is a recorded one.
  useEffect(() => { controller.setVideo({ videoId: start.videoId, videoKind: start.videoKind }); }, [start.videoId, start.videoKind, controller]);

  const actions = {
    choose: () => controller.choose(),
    cancel: () => controller.cancel(),
    confirm: (minutes, price) => { void controller.start(withPosition(start), minutes, price); },
    stop: () => { void controller.stop(); },
    retry: () => controller.retry(),
    endOrphan: () => { void controller.endOrphan(); },
    dismiss: () => controller.dismiss(),
  };
  return { view, actions };
}
