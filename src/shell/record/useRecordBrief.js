import { useEffect, useState } from 'react';
import { entryFingerprintFnv, getRecordBrief } from '../../lib/deskBrief.js';

/** How often a panel asks again while another request is writing the brief. */
export const RECORD_BRIEF_POLL_MS = 2_000;
/** How long a panel waits for that before it says the brief is unavailable. */
export const RECORD_BRIEF_WAIT_MS = 60_000;
/**
 * F211 (owner 2026-10-16): the client's writing animation runs 2.5 s; a brief written faster waits
 * for it to finish rather than cutting it off. F214 (owner 2026-10-16): it plays every time a record's
 * brief is shown, so a stored brief, or one seen earlier this session, also waits for it.
 */
export const RECORD_BRIEF_ANIMATION_MS = 2_500;
/** Briefs kept for the session, so a record opened again is not asked for again. */
const CACHE_MAX = 300;
const cache = new Map();

/** For tests: forget the briefs seen this session. */
export function clearRecordBriefCache() {
  cache.clear();
}

function remember(key, brief) {
  cache.delete(key);
  cache.set(key, brief);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

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
 * The stored AI brief of the selected record (F123; owner decisions 2026-10-15 and 2026-10-16). A
 * brief is written once, by the first viewer's request at the platform's cost, and read by every
 * later one. Opening a record first only reads (mode 'read', which never writes): a stored brief is
 * shown as it arrives, never as "writing". Only when nothing is stored does the panel say it is
 * writing and ask for the write; while another request writes it, this reads again every two seconds
 * for about a minute. A brief seen this session is not asked for again. Whatever the answer, it is
 * shown once the animation has run for this record (F214).
 *
 * Returns {state, record}: 'none' (nothing to brief, no record), 'loading' (reading), 'writing' (a
 * brief is being written), 'unavailable', 'error', or 'ready' with the brief as getRecordBrief gives
 * it (format 2: brief, why, watch, tags; format 1: headline, points), model and writtenAt. A new
 * record or an unmount aborts the request and stops the polling.
 */
export function useRecordBrief({ feed, selected, loading }) {
  const [result, setResult] = useState({ key: '', brief: null });
  // The record whose animation has run; cleared when the record changes, so a reopened one replays it.
  const [revealed, setRevealed] = useState('');
  const feature = feed?.feature || '';
  const tier = feed?.tier || '';
  const enabled = Boolean(!loading && feature && selected && typeof selected === 'object' && selected.status !== 'source_status');
  const key = enabled ? JSON.stringify([feature, tier, entryFingerprintFnv(selected, feature, tier)]) : '';

  useEffect(() => {
    if (!key) return undefined;
    const reveal = setTimeout(() => setRevealed(key), RECORD_BRIEF_ANIMATION_MS);
    const unreveal = () => { clearTimeout(reveal); setRevealed(''); };
    if (cache.has(key)) return unreveal;
    const ac = new AbortController();
    const started = Date.now();
    let writingSince = 0;
    const show = (brief) => {
      if (ac.signal.aborted) return;
      if (brief.state === 'writing' && !writingSince) writingSince = Date.now();
      // Remembered when shown, so a held brief does not skip the end of the animation.
      const land = () => {
        if (brief.state === 'ready') remember(key, brief);
        setResult({ key, brief });
      };
      const hold = brief.state === 'ready' && writingSince ? writingSince + RECORD_BRIEF_ANIMATION_MS - Date.now() : 0;
      if (hold <= 0) {
        land();
        return;
      }
      const timer = setTimeout(() => { if (!ac.signal.aborted) land(); }, hold);
      ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    };
    const ask = (mode) => getRecordBrief({ tier, feature, row: selected, signal: ac.signal, ...(mode ? { mode } : {}) });
    (async () => {
      let brief = await ask('read');
      for (;;) {
        if (brief.state === 'missing') {
          // Nothing stored: this request writes it.
          show({ state: 'writing' });
          brief = await ask();
          if (brief.state === 'missing') brief = { state: 'error' };
          continue;
        }
        if (brief.state !== 'pending') {
          show(brief);
          return;
        }
        // Another request is writing it: a real write; read again until it lands.
        show({ state: 'writing' });
        if (Date.now() - started + RECORD_BRIEF_POLL_MS > RECORD_BRIEF_WAIT_MS) {
          show({ state: 'error' });
          return;
        }
        await sleep(RECORD_BRIEF_POLL_MS, ac.signal);
        brief = await ask('read');
      }
    })().catch((err) => {
      if (err?.name !== 'AbortError') show({ state: 'error' });
    });
    return () => { ac.abort(); unreveal(); };
    // The key carries the record's fingerprint; an equivalent re-created row does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { state: 'none' };
  // Effects run after render: fence the visible result now, before the new lookup starts.
  const brief = cache.has(key) ? cache.get(key) : result.key === key && result.brief ? result.brief : { state: 'loading' };
  // Until the animation has run, only the writing state shows through (it names a real write). `record`
  // names the record the state belongs to, so the card restarts the animation when it changes.
  if (revealed !== key && brief.state !== 'writing') return { state: 'loading', record: key };
  return { ...brief, record: key };
}
