/**
 * F182: the home conflict pulse has two sources, and the server (server/homeApi.mjs) and the browser
 * fallback (homeStatic.js) must tell them apart the same way.
 *
 * - The Open Fronts register: an embedded file, read on every request and never saved as a snapshot.
 *   It names itself with `meta.window === REGISTER_WINDOW`.
 * - An agent snapshot: a saved payload with a positive marker, `source === AGENT_SNAPSHOT_SOURCE`.
 *   Nothing in this repository writes one (the agent was the former upstream's). Anything else found
 *   in a conflict.json (a stored copy of the register, a cache from the GDELT era) is not one.
 */
export const REGISTER_WINDOW = 'embedded Open Fronts snapshot';
export const AGENT_SNAPSHOT_SOURCE = 'agent';
export const REGISTER_NOTE =
  'Original HTML Open Fronts table (geopolitics_war_tracker). This is a stored register, not a live wire. No records were invented.';

export function isAgentSnapshot(snap) {
  return Boolean(snap?.rows?.length) && snap.source === AGENT_SNAPSHOT_SOURCE && snap.meta?.window !== REGISTER_WINDOW;
}
