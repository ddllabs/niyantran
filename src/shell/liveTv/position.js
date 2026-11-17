// F344 S3: what the fact-check session reads from the player: where it is and what it is doing.
// Pure, so the rule (an unknown or nonsensical position is no position) is tested without a player.

/** { positionS, playerState } from a bridge snapshot, or null when the position is not known. */
export function positionSample(snapshot) {
  const p = snapshot?.positionS;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return null;
  const state = snapshot.playerState;
  return { positionS: p, playerState: typeof state === 'number' ? state : null };
}
