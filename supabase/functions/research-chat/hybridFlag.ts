// The `hybrid_search` kill switch (F288). Read per qualifying search, cached per isolate, and never able to fail a search:
// a read that cannot be completed is "off", which is the vector-only search of today.
import { type HybridConfig, parseHybridFlag } from '../_shared/retrieval.ts';

export const HYBRID_FLAG_KEY = 'hybrid_search';
/** How long an answer is trusted: a flip takes effect within this, plus isolate churn. */
export const HYBRID_FLAG_TTL_MS = 15_000;
/** How long "unreadable" is remembered, so an outage costs one bounded wait per isolate per window, not one per search. */
export const HYBRID_FLAG_FAILURE_TTL_MS = 5_000;
/** The flag read's own bound, much shorter than a search's. */
export const HYBRID_FLAG_READ_TIMEOUT_MS = 500;

export interface HybridFlagCacheDeps {
  now(): number;
  /** The error kind only (its name), never its message. */
  onFailure?(kind: string): void;
}

export interface HybridFlagCache {
  /**
   * The current switch. `read` returns the row's `value` (undefined when there is no row) and rejects on a timeout or
   * database error; it runs only when the cache is empty or expired. Never rejects.
   */
  get(read: () => Promise<unknown>): Promise<HybridConfig>;
  reset(): void;
}

export function createHybridFlagCache(deps: HybridFlagCacheDeps): HybridFlagCache {
  let cached: { config: HybridConfig; until: number } | null = null;
  let inFlight: Promise<HybridConfig> | null = null;
  const load = async (read: () => Promise<unknown>): Promise<HybridConfig> => {
    try {
      const config = parseHybridFlag(await read());
      cached = { config, until: deps.now() + HYBRID_FLAG_TTL_MS };
      return config;
    } catch (e) {
      deps.onFailure?.(e instanceof Error ? e.name : 'unknown');
      const config = parseHybridFlag(undefined);
      cached = { config, until: deps.now() + HYBRID_FLAG_FAILURE_TTL_MS };
      return config;
    }
  };
  return {
    get(read) {
      if (cached && deps.now() < cached.until) return Promise.resolve(cached.config);
      if (inFlight) return inFlight;
      // `load` never rejects. It clears itself here, after it is stored, and only if still current: a reader that throws
      // before returning a promise settles `load` before this line, and clearing from inside `load` would run first and
      // leave the settled promise in `inFlight` for good.
      const p = load(read);
      inFlight = p;
      void p.then(() => {
        if (inFlight === p) inFlight = null;
      });
      return p;
    },
    reset() {
      cached = null;
      inFlight = null;
    },
  };
}
