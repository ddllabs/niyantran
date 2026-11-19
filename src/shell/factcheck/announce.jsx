// Review 2: one shared status node for each view (the panel, the past-sessions section) carries every copy,
// export and download confirmation, instead of a live region on every card, part and bar. The region is emptied
// first and the message set a moment later, so the same message pressed twice is announced twice. The message
// clears itself. After the view is gone a late answer (a clipboard promise) writes nothing.
import { createContext, useContext, useEffect, useState } from 'react';

const HOLD_MS = 4000; // how long a message stays
const GAP_MS = 50;    // between emptying the region and writing the message

export function createAnnouncer() {
  let sink = null;
  let gap = null;
  let hold = null;
  const stop = () => { clearTimeout(gap); clearTimeout(hold); gap = null; hold = null; };
  return {
    attach(set) {
      sink = set;
      return () => { stop(); sink = null; };
    },
    say(message) {
      if (!sink) return;
      stop();
      sink('');
      gap = setTimeout(() => {
        if (!sink) return;
        sink(message);
        hold = setTimeout(() => { if (sink) sink(''); }, HOLD_MS);
      }, GAP_MS);
    },
  };
}

const AnnounceContext = createContext(() => {});
export const AnnounceProvider = AnnounceContext.Provider;
/** The `say(message)` function of the nearest view; a no-op outside one. */
export const useAnnounce = () => useContext(AnnounceContext);

/** The one status node. role="status" is a polite live region. */
export function AnnouncerRegion({ announcer }) {
  const [text, setText] = useState('');
  useEffect(() => announcer.attach(setText), [announcer]);
  return <p className="fc-sr" role="status">{text}</p>;
}
