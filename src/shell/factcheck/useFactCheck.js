// F344 T6: React glue for the fact-check controller. Kept thin on purpose: the logic is in
// factCheckController.js. Uses only useState and useEffect, called unconditionally, so the hook
// order of LiveTvPage stays the same whether the page is open or closed.
import { useEffect, useState } from 'react';
import { INITIAL_VIEW, createFactCheckController } from './factCheckController.js';

/**
 * open    the page is open (the flag is read on open; a session ends on close)
 * target  what is playing, as one string, or null; a change ends a running session
 * getPosition  () => { positionS, playerState } | null, the player's position (recorded videos only are used)
 * seek    (seconds) => boolean, moves the player ("Re-analyze this block"); read through a holder, like getPosition
 * start   { videoId, channelId, videoKind, startPositionS, seed } for a session started now;
 *         getStartPositionS(), when given, is read at confirm time and replaces startPositionS
 */
export function withPosition(start) {
  const { getStartPositionS, ...rest } = start;
  if (typeof getStartPositionS !== 'function') return start;
  const p = getStartPositionS();
  return { ...rest, startPositionS: Number.isInteger(p) && p >= 0 ? p : null };
}

export function useFactCheck({ open, target, start, getPosition, seek }) {
  const [view, setView] = useState(INITIAL_VIEW);
  // The controller outlives renders; it reads the newest getPosition through this holder.
  const [source] = useState(() => ({ read: null }));
  source.read = getPosition || null;
  const [mover] = useState(() => ({ seek: null }));
  mover.seek = seek || null;
  const [controller] = useState(() => createFactCheckController({
    onChange: (next) => setView(next),
    getPosition: () => (source.read ? source.read() : null),
    seek: (s) => (mover.seek ? mover.seek(s) : false),
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
    // After "Re-analyze this block" the video is moved to the block start again first, and the start position is
    // read only after that (prepareStart is null for an ordinary start, which then goes at once).
    confirm: (minutes, price) => {
      const go = () => { void controller.start(withPosition(start), minutes, price); };
      const ready = controller.prepareStart ? controller.prepareStart() : null;
      if (ready) void ready.then(go); else go();
    },
    stop: () => { void controller.stop(); },
    retry: () => controller.retry(),
    endOrphan: () => { void controller.endOrphan(); },
    dismiss: () => controller.dismiss(),
  };
  return { view, actions };
}
