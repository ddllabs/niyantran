/**
 * F156 (spec docs/specs/2026-10-14-paged-module-lists.md, section 8.1): a landing count whose live
 * source missed the server's 4 s limit answers `availability: 'error'` with `served: 'archive'`,
 * although the late live answer usually reaches the server a few seconds later. Such a count is
 * pending, not unavailable: it is shown as loading and asked for again 6 s and 15 s after its first
 * answer, and only then shown as unavailable. A real failure (no `served: 'archive'`) is final.
 */
export const PENDING_RETRY_AFTER_MS = [6000, 15000];
const CONCURRENCY = 3;

export function isPendingCount(summary) {
  return summary?.availability === 'error' && summary?.served === 'archive';
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function retryPending({ first, fetchOne, feature, signal, publish, retryAfterMs }) {
  const answeredAt = Date.now();
  let summary = first;
  for (const after of retryAfterMs) {
    if (!isPendingCount(summary)) break;
    publish({ ...summary, pending: true });
    await wait(Math.max(0, answeredAt + after - Date.now()), signal);
    if (signal?.aborted) return;
    summary = await fetchOne(feature);
    if (signal?.aborted) return;
  }
  publish(summary);
}

/**
 * Requests each feature's summary through `fetchOne` (which never throws: it returns the hook's own
 * "unavailable" summary on a failure), at most three at a time, and publishes each answer. A pending
 * answer is retried off the queue, so it does not hold up the other modules.
 */
export async function loadLandingSummaries({ features, signal, fetchOne, publish, retryAfterMs = PENDING_RETRY_AFTER_MS }) {
  const queue = [...features];
  const retries = [];
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const feature = queue.shift();
      const summary = await fetchOne(feature);
      if (signal?.aborted) return;
      if (isPendingCount(summary)) retries.push(retryPending({ first: summary, fetchOne, feature, signal, publish, retryAfterMs }));
      else publish(summary);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  await Promise.all(retries);
}

/** Features a landing hook (re)requests: those with no summary yet, or one still pending. */
export function featuresToLoad(features, current) {
  return features.filter((feature) => feature && (!current[feature] || current[feature].pending));
}
