/**
 * Global app flags from /api/app-flags (testing phase, etc.).
 * Hydrated at boot; admin Overview can flip testingPhase for all seats.
 */

const EVENT = 'niy-app-flags';

const DEFAULTS = {
  testingPhase: false,
  updatedAt: '',
};

let cache = { ...DEFAULTS };
let hydratePromise = null;

function emit() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { ...cache } }));
  }
}

export function loadAppFlags() {
  return { ...cache };
}

export function isTestingPhase() {
  return Boolean(cache.testingPhase);
}

export function applyAppFlags(flags) {
  cache = {
    testingPhase: Boolean(flags?.testingPhase),
    updatedAt: String(flags?.updatedAt || ''),
  };
  emit();
  return loadAppFlags();
}

export async function hydrateAppFlags({ force = false } = {}) {
  if (hydratePromise && !force) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const res = await fetch('/api/app-flags', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.flags) {
        return applyAppFlags(data.flags);
      }
    } catch {
      /* keep cache */
    }
    return loadAppFlags();
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export async function saveAppFlags(patch) {
  const res = await fetch('/api/app-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `App flags HTTP ${res.status}`);
  }
  return applyAppFlags(data.flags);
}

export function subscribeAppFlags(fn) {
  const on = () => fn(loadAppFlags());
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
