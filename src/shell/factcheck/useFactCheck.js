// F344 T6: React glue for the fact-check controller. Kept thin on purpose: the logic is in
// factCheckController.js. Uses only useState and useEffect, called unconditionally, so the hook
// order of LiveTvModal stays the same whether the modal is open or closed.
import { useEffect, useState } from 'react';
import { INITIAL_VIEW, createFactCheckController } from './factCheckController.js';

/**
 * open    the modal is open (the flag is read on open; a session ends on close)
 * target  what is playing, as one string, or null; a change ends a running session
 * start   { videoId, channelId, videoKind, startPositionS, seed } for a session started now
 */
export function useFactCheck({ open, target, start }) {
  const [view, setView] = useState(INITIAL_VIEW);
  const [controller] = useState(() => createFactCheckController({ onChange: (next) => setView(next) }));

  useEffect(() => {
    if (!open) return undefined;
    void controller.load();
    return () => { void controller.close(); };
  }, [open, controller]);

  useEffect(() => { controller.setTarget(target); }, [target, controller]);

  const actions = {
    choose: () => controller.choose(),
    cancel: () => controller.cancel(),
    confirm: (minutes, price) => { void controller.start(start, minutes, price); },
    stop: () => { void controller.stop(); },
    retry: () => controller.retry(),
    endOrphan: () => { void controller.endOrphan(); },
    dismiss: () => controller.dismiss(),
  };
  return { view, actions };
}
