// F366 slice B: the panel header's status line and the block line. Both read only figures the session
// view already carries (state, minutes bought, seconds left, the final answer; the credits held are in the rate line); nothing is
// charged or computed here beyond a time shown.
import { formatClock, minutesText } from './factCheckText.js';

// Seconds of silence after which the panel says it is not hearing anything; the panel's notice (FactCheckPanel.jsx)
// and the page's captions (LiveTvPage.jsx) both read it.
export const SILENT_NOTICE_MS = 30000;

/** { text, tone } where tone is off | wait | on | bad (the dot's colour is never the only signal: the text says it). */
export function statusLine(session) {
  switch (session.status) {
    case 'choosing': return { text: 'Choose a length', tone: 'off' };
    case 'sharing': return { text: 'Waiting for sharing', tone: 'wait' };
    case 'starting': return { text: 'Starting…', tone: 'wait' };
    case 'ending': return { text: 'Finishing…', tone: 'wait' };
    case 'ended': return { text: 'Ended', tone: 'off' };
    case 'error': return { text: 'Stopped by an error', tone: 'bad' };
    case 'running': {
      const started = session.transcript.length > 0 || session.claims.length > 0;
      if (!started) return { text: 'Listening…', tone: 'on' };
      const elapsed = session.minutesBought * 60 - session.secondsLeft;
      return { text: `Checking · ${formatClock(elapsed)} elapsed`, tone: 'on' };
    }
    default: return { text: 'Off', tone: 'off' };
  }
}

/** { text, fraction, low } for the thin bar under the header, or null where the view has no block to show. */
export function blockLine(session) {
  const bought = session.minutesBought;
  if (!(bought > 0)) return null;
  const total = bought * 60;
  if (session.status === 'running' || session.status === 'ending') {
    const left = Math.max(0, session.secondsLeft);
    const elapsed = Math.min(total, Math.max(0, total - session.secondsLeft));
    // A one-minute block is low only for its last 30 seconds (it would be low from its first second otherwise).
    const low = left <= (bought === 1 ? 30 : 60);
    const head = low ? (bought === 1 ? '30 seconds left in this block' : '1 minute left in this block') : `${formatClock(elapsed)} of ${minutesText(bought)} used`;
    return { text: head, fraction: Math.min(1, elapsed / total), low };
  }
  if (session.status === 'ended' && typeof session.final?.minutes_used === 'number') {
    const used = session.final.minutes_used;
    return { text: `${used} of ${minutesText(bought)} used`, fraction: Math.min(1, used / bought), low: false };
  }
  return null;
}
