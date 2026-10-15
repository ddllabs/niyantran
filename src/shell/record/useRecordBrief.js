import { useEffect, useState } from 'react';
import { entryFingerprintFnv, getRecordBrief } from '../../lib/deskBrief.js';

/** How often a panel asks again while another request is writing the brief. */
export const RECORD_BRIEF_POLL_MS = 2_000;
/** How long a panel waits for that before it says the brief is unavailable. */
export const RECORD_BRIEF_WAIT_MS = 60_000;

const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Waits ms, or rejects at once when the signal is (or becomes) aborted: no poll after a close. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(aborted());
    }, { once: true });
  });
}

/**
 * The stored AI brief of the selected record (F123; owner decisions 2026-10-15). Opening a
 * record's panel asks for it; the first viewer's request writes it at the platform's cost and
 * every later viewer reads it. While another request is writing it, this asks again every two
 * seconds for about a minute. Returns {state} where state is 'none' (nothing to brief),
 * 'loading', 'pending', 'unavailable', 'error', or 'ready' with headline, points, model and
 * writtenAt. A new record or an unmount aborts the request and stops the polling.
 */
export function useRecordBrief({ feed, selected, loading }) {
  const [result, setResult] = useState({ key: '', brief: null });
  const feature = feed?.feature || '';
  const tier = feed?.tier || '';
  const enabled = Boolean(!loading && feature && selected && typeof selected === 'object' && selected.status !== 'source_status');
  const key = enabled ? JSON.stringify([feature, tier, entryFingerprintFnv(selected, feature, tier)]) : '';

  useEffect(() => {
    if (!key) return undefined;
    const ac = new AbortController();
    const started = Date.now();
    const show = (brief) => {
      if (!ac.signal.aborted) setResult({ key, brief });
    };
    (async () => {
      for (;;) {
        const brief = await getRecordBrief({ tier, feature, row: selected, signal: ac.signal });
        show(brief);
        if (brief.state !== 'pending') return;
        if (Date.now() - started + RECORD_BRIEF_POLL_MS > RECORD_BRIEF_WAIT_MS) {
          show({ state: 'error' });
          return;
        }
        await sleep(RECORD_BRIEF_POLL_MS, ac.signal);
      }
    })().catch((err) => {
      if (err?.name !== 'AbortError') show({ state: 'error' });
    });
    return () => ac.abort();
    // The key carries the record's fingerprint; an equivalent re-created row does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { state: 'none' };
  // Effects run after render: fence the visible result now, before the new lookup starts.
  if (result.key !== key || !result.brief) return { state: 'loading' };
  return result.brief;
}
