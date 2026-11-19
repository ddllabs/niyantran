// F344 S3: what the fact-check session reads from the player: where it is and what it is doing.
// Pure, so the rule (an unknown or nonsensical position is no position) is tested without a player.

/** { positionS, playerState } from a bridge snapshot, or null when the position is not known. */
export function positionSample(snapshot) {
  const p = snapshot?.positionS;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return null;
  const state = snapshot.playerState;
  return { positionS: p, playerState: typeof state === 'number' ? state : null };
}

/**
 * Seconds left in a video, from the player's own duration and position (both finite, the duration above
 * zero, the result above zero); null otherwise. The caller decides whether the video may be treated as recorded.
 */
export function remainingSecondsOf(info) {
  const d = info?.durationS;
  const p = info?.positionS;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return null;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return null;
  const left = Math.floor(d - p);
  return left > 0 ? left : null;
}
