/**
 * F169 phase 4 (C3 review): the loaders' in-memory caches are skipped inside a feed refresh, so
 * the store records what the source says now, at the time it said it, never an answer fetched up
 * to a day earlier. Outside a refresh the caches work as before. A refresh still fills them.
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
