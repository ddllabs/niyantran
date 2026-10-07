import { useEffect, useRef, useState } from 'react';

const unavailable = feature => ({ feature, resourceKey: feature, count: null, availability: 'error', sourceMode: 'unknown', columns: [], sources: [], locations: [] });
export async function loadEntertainmentSummaries({ features, signal, onSummary, fetcher = fetch }) {
  const queue = [...new Set(features)];
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const feature = queue.shift(), controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 45000);
      let summary;
      try {
        const response = await fetcher(`/api/entertainment-landing?${new URLSearchParams({ feature })}`, { signal: controller.signal });
        summary = await response.json();
        const counted = summary.ok === true && (summary.availability === 'unavailable' ? summary.count === null : Number.isInteger(summary.count) && summary.count >= 0);
        const failedCoverage = summary.ok === false && summary.count === null && summary.availability === 'error';
        if ((!response.ok && !failedCoverage) || summary.version !== 1 || summary.feature !== feature || summary.resourceKey !== feature || (!counted && !failedCoverage)) throw new Error('Invalid summary');
      } catch { summary = unavailable(feature); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      if (!signal?.aborted) onSummary(summary);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

export function useEntertainmentLanding(features) {
  const [summaries, setSummaries] = useState({});
  const [attempt, setAttempt] = useState(0);
  const current = useRef({});
  const key = features.join('\0');
  useEffect(() => { current.current = {}; setSummaries({}); }, [key]);
  useEffect(() => {
    const controller = new AbortController();
    void loadEntertainmentSummaries({ features: key.split('\0').filter(feature => feature && !current.current[feature]), signal: controller.signal, onSummary: summary => {
      current.current = { ...current.current, [summary.feature]: summary };
      setSummaries(current.current);
    } });
    return () => controller.abort();
  }, [key, attempt]);
  const retry = feature => {
    delete current.current[feature];
    setSummaries({ ...current.current });
    setAttempt(value => value + 1);
  };
  return { summaries, retry };
}
