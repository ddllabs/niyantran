import { useCallback, useEffect, useRef, useState } from 'react';
import { BILL_FEATURE, GRAPH_FEATURE, nationalResourceKey } from '../lib/nationalLandingSummary.js';

const unavailable = feature => ({ feature, resourceKey: nationalResourceKey(feature), count: null, availability: 'error', sourceMode: 'unknown', columns: [], sources: [], sectors: [] });
export async function loadNationalSummaries({ features, signal, onSummary, fetcher = fetch }) {
  const queue = [...new Set(features.map(nationalResourceKey))];
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const feature = queue.shift();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 45000);
      let summary;
      try {
        const response = await fetcher(`/api/national-landing?${new URLSearchParams({ feature })}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Summary unavailable');
        summary = await response.json();
        if (!summary.ok || summary.version !== 1 || summary.feature !== feature || summary.resourceKey !== feature || !Number.isInteger(summary.count) || summary.count < 0) throw new Error('Invalid summary');
      } catch {
        summary = unavailable(feature);
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      }
      if (signal?.aborted) return;
      onSummary(summary);
      if (feature === BILL_FEATURE && features.includes(GRAPH_FEATURE)) onSummary({
        ...summary, feature: GRAPH_FEATURE, columns: summary.graphColumns || [],
        limitations: 'A view of the bill register; these records are counted once in the desk total.',
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

export function useNationalLanding(features) {
  const [summaries, setSummaries] = useState({});
  const controllerRef = useRef(null);
  const featureKey = features.join('\0');
  const publish = useCallback(s => setSummaries(previous => ({ ...previous, [s.feature]: s })), []);
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller;
    setSummaries({});
    void loadNationalSummaries({ features: featureKey.split('\0').filter(Boolean), signal: controller.signal, onSummary: publish });
    return () => controller.abort();
  }, [featureKey, publish]);
  const retry = useCallback(feature => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted) return;
    const related = feature === BILL_FEATURE || feature === GRAPH_FEATURE ? [BILL_FEATURE, GRAPH_FEATURE] : [feature];
    setSummaries(previous => {
      const next = { ...previous };
      for (const name of related) delete next[name];
      return next;
    });
    void loadNationalSummaries({ features: related, signal, onSummary: publish });
  }, [publish]);
  return { summaries, retry };
}
