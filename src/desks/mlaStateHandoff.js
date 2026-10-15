import { MLA_STATES } from '../lib/mlaStates.js';

/**
 * F196: a state chosen on the Party Organisation Map, for MLA Directory to open with. The map's state
 * links point at MLA Directory's address; just before the browser follows one, the map remembers the
 * state here, and MLA Directory's State picker starts on it. Kept for a few seconds only, so a later
 * visit to MLA Directory from the menu starts on "All states" as before.
 */
const KEEP_MS = 10_000;
let pending = { state: '', at: 0 };

export function rememberMlaState(state) {
  pending = { state: MLA_STATES.includes(state) ? state : '', at: Date.now() };
}

/** The state remembered in the last few seconds, or ''. */
export function pendingMlaState() {
  return pending.state && Date.now() - pending.at <= KEEP_MS ? pending.state : '';
}

export function clearPendingMlaState() {
  pending = { state: '', at: 0 };
}
