/**
 * F169 phase 4 (C3 review): the loaders' in-memory caches are neither read nor written inside a
 * feed refresh. Not read, so the store records what the source says now, at the time it said it,
 * never an answer fetched up to a day earlier. Not written, because a refresh's answer can be
 * partial: the run's gate may have closed a host after a 429, or the module may have run out of
 * time, and a loader that swallows those failures would otherwise cache what was left for every
 * ordinary request. Outside a refresh the caches work as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const refreshing = new AsyncLocalStorage();

/** Whether a cache filled at `at` (ms) may answer: within `ttlMs`, and not inside a feed refresh. */
export function cacheFresh(at, ttlMs) {
  return refreshing.getStore() !== true && Date.now() - at < ttlMs;
}

/** Runs fn (and everything it starts) with the loaders' caches skipped. */
export function withoutLoaderCaches(fn) {
  return refreshing.run(true, fn);
}

/** Whether a loader may write its cache now: never inside a feed refresh. */
export function cacheWritable() {
  return refreshing.getStore() !== true;
}
