// The stored AI brief of an open desk card, read and written exactly as nter.pro's record panel does
// (website src/shell/record/useRecordBrief.js). Opening a record first only reads (mode 'read',
// which never writes). Only when nothing is stored does the card say it is writing and ask for the
// write, which the platform pays for; while another request writes it, the card reads again every
// two seconds for about a minute. Whatever the answer, it is shown once the NTER animation has run
// for this record (2.5 s). A brief seen this session is not asked for again.
import { useEffect, useState } from 'react';
import { api, isSample } from '../services/index.js';

export const RECORD_BRIEF_POLL_MS = 2_000;
export const RECORD_BRIEF_WAIT_MS = 60_000;
export const RECORD_BRIEF_ANIMATION_MS = 2_500;
const CACHE_MAX = 300;
const cache = new Map();

export function clearDeskBriefCache() {
  cache.clear();
}

function remember(key, brief) {
  cache.delete(key);
  cache.set(key, brief);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** A ready answer in either format, or {state: 'error'} when it lacks its required parts (as the website). */
export function readyBrief(body) {
  const at = { model: body.model || null, writtenAt: body.writtenAt || null, sample: Boolean(body.sample) };
  if (body.format === 1 || (body.format === undefined && Array.isArray(body.points))) {
    const points = Array.isArray(body.points) ? body.points.filter((p) => text(p)) : [];
    if (!text(body.headline) || !points.length) return { state: 'error' };
    return { state: 'ready', format: 1, headline: body.headline, points, ...at };
  }
  if (!text(body.brief) || !text(body.why)) return { state: 'error' };
  const tags = (Array.isArray(body.tags) ? body.tags : []).filter((t) => text(t)).slice(0, 4);
  return { state: 'ready', format: 2, brief: body.brief, why: body.why, watch: text(body.watch) ? body.watch : '', tags, ...at };
}

/** One request to desk-brief, in the website's states: ready | missing | pending | unavailable | error. */
export async function getDeskBrief({ module, row, mode, signal }) {
  if (!row || typeof row !== 'object' || row.status === 'source_status' || !module?.feature) return { state: 'none' };
  let body;
  try {
    body = await api.recordBrief({ module, row, generate: mode !== 'read', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { state: err?.status === 401 ? 'unavailable' : 'error' };
  }
  if (!body || body.ok === false) return { state: 'error' };
  if (body.state === 'ready') return readyBrief(body);
  if (['pending', 'unavailable', 'missing'].includes(body.state)) return { state: body.state };
  return { state: 'error' };
}

const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(aborted()); }, { once: true });
  });
}

/** The key a record's brief is held under for the session. */
export const briefKey = (module, row) => JSON.stringify([module?.feature || '', module?.tier || '', row?.id ?? '', row?.title ?? row?.bill_name ?? row?.name ?? '', row?.date ?? row?.date_introduced ?? '']);

/**
 * Returns {state, record}: 'none', 'guest' (signed out: the app offers sign-in), 'loading', 'writing',
 * 'unavailable', 'error', or 'ready' with the brief. `record` names the record the state belongs to.
 */
export function useDeskBrief({ module, row, signedIn }) {
  const [result, setResult] = useState({ key: '', brief: null });
  const [revealed, setRevealed] = useState('');
  const enabled = Boolean(module?.feature && row && typeof row === 'object' && row.status !== 'source_status');
  const guest = enabled && !signedIn && !isSample;
  const key = enabled ? `${guest ? 'guest:' : ''}${briefKey(module, row)}` : '';

  useEffect(() => {
    if (!key) return undefined;
    // The NTER animation plays every time a record opens, as on the website (F214).
    const reveal = setTimeout(() => setRevealed(key), RECORD_BRIEF_ANIMATION_MS);
    const unreveal = () => { clearTimeout(reveal); setRevealed(''); };
    if (guest || cache.has(key)) return unreveal;
    const ac = new AbortController();
    const started = Date.now();
    let writingSince = 0;
    const show = (brief) => {
      if (ac.signal.aborted) return;
      if (brief.state === 'writing' && !writingSince) writingSince = Date.now();
      const land = () => {
        if (brief.state === 'ready') remember(key, brief);
        setResult({ key, brief });
      };
      const hold = brief.state === 'ready' && writingSince ? writingSince + RECORD_BRIEF_ANIMATION_MS - Date.now() : 0;
      if (hold <= 0) { land(); return; }
      const timer = setTimeout(() => { if (!ac.signal.aborted) land(); }, hold);
      ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    };
    const ask = (mode) => getDeskBrief({ module, row, mode, signal: ac.signal });
    (async () => {
      let brief = await ask('read');
      for (;;) {
        if (brief.state === 'missing') {
          show({ state: 'writing' });
          brief = await ask('write');
          if (brief.state === 'missing') brief = { state: 'error' };
          continue;
        }
        if (brief.state !== 'pending') { show(brief); return; }
        show({ state: 'writing' });
        if (Date.now() - started + RECORD_BRIEF_POLL_MS > RECORD_BRIEF_WAIT_MS) { show({ state: 'error' }); return; }
        await sleep(RECORD_BRIEF_POLL_MS, ac.signal);
        brief = await ask('read');
      }
    })().catch((err) => { if (err?.name !== 'AbortError') show({ state: 'error' }); });
    return () => { ac.abort(); unreveal(); };
    // The key identifies the record; an equivalent re-created row does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!enabled) return { state: 'none' };
  if (guest) return { state: revealed === key ? 'guest' : 'loading', record: key };
  const brief = cache.has(key) ? cache.get(key) : result.key === key && result.brief ? result.brief : { state: 'loading' };
  if (revealed !== key && brief.state !== 'writing') return { state: 'loading', record: key };
  return { ...brief, record: key };
}
