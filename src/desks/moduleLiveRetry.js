/**
 * F159: a module page whose answer the server gave from stored records because live data was still
 * loading (`served: 'archive'`, src/lib/featureFeed.js) asks again, as a landing count does
 * (landingRetry.js): the live fetch keeps running on the server and a later request usually gets
 * its answer. The edge keeps such an answer for a few seconds only (`API_CACHE.cdnArchive`,
 * api/router.js), less than the first wait below, so a retry reaches the server.
 * - No records yet ("pending"): asked again 6 s and 15 s after the first answer, then given up.
 * - Stored records on screen ("stored"): asked again once after 8 s; live records replace them.
 * A genuine failure (no `served: 'archive'`), a live attempt that failed on the server
 * (`source.liveFailed`: it is not slow, so asking again soon would not help) and a paged answer are
 * not retried.
 */
import { hasRealRows } from '../lib/archiveFeed.js';
import { PENDING_RETRY_AFTER_MS, wait } from './landingRetry.js';

export { PENDING_RETRY_AFTER_MS };
export const STORED_RETRY_AFTER_MS = 8000;

/** What a reader sees while a module waits for live data, and once it has stopped waiting. */
export const LIVE_WAIT_TEXT = 'Live data is taking longer than usual. Retrying…';
export const MODULE_UNAVAILABLE_TEXT = 'This module couldn’t load right now.';

/** 'pending' (nothing to show yet), 'stored' (stored records on screen) or null (nothing to retry). */
export function liveFollowUpKind(feed) {
  if (!feed || feed.paged || feed.served !== 'archive' || feed.liveGaveUp || liveFailed(feed)) return null;
  return hasRealRows(feed) ? 'stored' : 'pending';
}

/** How a page holds while it has no records to show: 'wait' (still asking), 'gaveUp', or null. */
export function liveHoldState(feed) {
  if (!feed || feed.paged || feed.served !== 'archive' || hasRealRows(feed)) return null;
  return feed.liveGaveUp || liveFailed(feed) ? 'gaveUp' : 'wait';
}

/** The server's live attempt failed (server/featureFeed.mjs), as opposed to running late. */
export function liveFailed(feed) {
  return feed?.source?.liveFailed === true;
}

const isLive = (body) => hasRealRows(body) && body.served !== 'archive';

/** Stored records kept on screen once retrying stops: no longer says that live data is loading. */
function storedSettled(body) {
  const note = String(body.source?.note || '').replace(/\s*Live data is still loading\.?\s*$/i, '');
  return { ...body, liveGaveUp: true, source: { ...(body.source || {}), note } };
}

async function ask(refetch) {
  try {
    return await refetch();
  } catch {
    return null;
  }
}

/**
 * Follows `first` up through `refetch` and hands each answer worth showing to `publish`. Stops,
 * without publishing, once `signal` aborts (the reader left the module).
 */
export async function followUpLive({
  first,
  refetch,
  publish,
  signal,
  pendingAfterMs = PENDING_RETRY_AFTER_MS,
  storedAfterMs = STORED_RETRY_AFTER_MS,
}) {
  const kind = liveFollowUpKind(first);
  if (!kind) return;
  const answeredAt = Date.now();
  if (kind === 'stored') {
    await wait(storedAfterMs, signal);
    if (signal?.aborted) return;
    const next = await ask(refetch);
    if (signal?.aborted) return;
    if (isLive(next)) {
      publish({ ...next, updatedLive: true });
      return;
    }
    // Still stored: stop saying that live data is loading.
    publish(storedSettled(first));
    return;
  }
  for (const after of pendingAfterMs) {
    await wait(Math.max(0, answeredAt + after - Date.now()), signal);
    if (signal?.aborted) return;
    const next = await ask(refetch);
    if (signal?.aborted) return;
    if (next && liveFollowUpKind(next) !== 'pending') {
      // Stored records instead of live ones: retrying stops here, so the note stops promising live data.
      publish(isLive(next) ? { ...next, updatedLive: true } : hasRealRows(next) ? storedSettled(next) : next);
      return;
    }
  }
  publish({ ...first, liveGaveUp: true });
}
