import { useCallback, useEffect, useRef, useState } from 'react';
import { STATE_MODULES, projectStateSummary } from '../lib/stateLandingSummary.js';
import { loadLandingSummaries } from './landingRetry.js';

const AVAILABILITY = new Set(['ready', 'empty', 'unavailable', 'error']);
const planned = module => projectStateSummary(module, { ok: true, tier: module.tier, feature: module.feature, rows: [], source: { adapter: 'planned', note: 'No implemented data source for this reference module.' } });

/**
 * F157: one count per module from /api/state-landing (server/stateLandingSummary.mjs), not the
 * module's rows. Planned modules have no source and are summarised here without a request.
 */
export async function loadStateSummaries({ modules = STATE_MODULES, signal, onSummary, fetcher = fetch, retryAfterMs }) {
  const byFeature = new Map();
  for (const module of modules) {
    if (module.configured) byFeature.set(module.feature, module);
    else if (!signal?.aborted) onSummary(planned(module));
  }
  async function fetchOne(feature) {
    const module = byFeature.get(feature);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 45000);
    let summary;
    try {
      const response = await fetcher(`/api/state-landing?${new URLSearchParams({ feature })}`, { signal: controller.signal });
      summary = await response.json();
      const counted = Number.isInteger(summary.count) && summary.count >= 0 && ['ready', 'empty'].includes(summary.availability);
      const uncounted = summary.count === null && ['unavailable', 'error'].includes(summary.availability);
      const coverageUnavailable = summary.ok === false && summary.count === null && summary.availability === 'error';
      if ((!response.ok && !coverageUnavailable) || summary.version !== 1 || summary.tier !== module.tier || summary.feature !== feature || !AVAILABILITY.has(summary.availability) || (!counted && !uncounted)) throw new Error('Invalid summary');
    } catch {
      summary = projectStateSummary(module, null);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
    return summary;
  }
  const publish = summary => { if (!signal?.aborted) onSummary(summary); };
  await loadLandingSummaries({ features: [...byFeature.keys()], signal, fetchOne, publish, retryAfterMs });
}

export function useStateLanding() {
  const [summaries, setSummaries] = useState({});
  const controllerRef = useRef(null);
  const publish = useCallback(s => setSummaries(previous => ({ ...previous, [s.feature]: s })), []);
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller;
    setSummaries({});
    void loadStateSummaries({ signal: controller.signal, onSummary: publish });
    return () => controller.abort();
  }, [publish]);
  const retry = useCallback(feature => {
    const signal = controllerRef.current?.signal;
    const module = STATE_MODULES.find(item => item.feature === feature);
    if (!signal || signal.aborted || !module) return;
    setSummaries(previous => {
      const next = { ...previous };
      delete next[feature];
      return next;
    });
    void loadStateSummaries({ modules: [module], signal, onSummary: publish });
  }, [publish]);
  return { summaries, retry };
}
