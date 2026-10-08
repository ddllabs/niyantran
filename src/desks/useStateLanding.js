import { useEffect, useRef, useState } from 'react';
import { fetchFeature } from '../lib/featureFeed.js';
import { STATE_MODULES, projectStateSummary } from '../lib/stateLandingSummary.js';

export async function loadStateSummaries({ modules = STATE_MODULES, signal, onSummary, fetcher = fetchFeature }) {
  const queue = [...modules];
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const module = queue.shift();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let timer;
      try {
        const request = module.configured ? fetcher({ tier: module.tier, feature: module.feature, signal: controller.signal }) : Promise.resolve({ ok: true, tier: module.tier, feature: module.feature, rows: [], source: { adapter: 'planned', note: 'No implemented data source for this reference module.' } });
        const raw = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => { abort(); reject(new Error('Summary timeout')); }, 30000); })]);
        if (!signal?.aborted) onSummary(projectStateSummary(module, raw));
      } catch {
        if (!signal?.aborted) onSummary(projectStateSummary(module, null));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

export function useStateLanding() {
  const [summaries, setSummaries] = useState({});
  const [attempt, setAttempt] = useState(0);
  const current = useRef({});
  useEffect(() => {
    const controller = new AbortController();
    void loadStateSummaries({ modules: STATE_MODULES.filter(module => !current.current[module.feature]), signal: controller.signal, onSummary: summary => {
      current.current = { ...current.current, [summary.feature]: summary };
      setSummaries(current.current);
    } });
    return () => controller.abort();
  }, [attempt]);
  const retry = feature => {
    delete current.current[feature];
    setSummaries({ ...current.current });
    setAttempt(value => value + 1);
  };
  return { summaries, retry };
}
