import { useEffect, useState } from 'react';
import { entryFingerprintFnv, peekDeskBrief } from '../lib/deskBrief.js';

/**
 * Shows organised entry intelligence for a selected row when already cached.
 * Does NOT call Gemini on select — models run only from AI Research after Send
 * (or when a brief was previously saved).
 */
export function useEntryBrief({ feed, selected, loading }) {
  const [result, setResult] = useState({ key: '', brief: null, err: '', busy: false });
  const feature = feed?.feature || '';
  const tier = feed?.tier || '';
  const rowKey =
    selected?.record_id ||
    selected?.id ||
    selected?.source_url ||
    selected?.title ||
    selected?.name ||
    selected?.bill_name ||
    '';
  const fp = selected && feature ? entryFingerprintFnv(selected, feature, tier) : '';

  const key = JSON.stringify([feature, tier, rowKey, fp]);
  const enabled = Boolean(!loading && feature && selected && selected.status !== 'source_status');

  useEffect(() => {
    if (!enabled) {
      setResult({ key: '', brief: null, err: '', busy: false });
      return undefined;
    }
    const ac = new AbortController();
    let alive = true;
    setResult({ key, brief: null, err: '', busy: true });
    peekDeskBrief({ feature, tier, row: selected, signal: ac.signal, scope: 'entry' })
      .then((brief) => {
        if (alive) setResult({ key, brief: brief || null, err: '', busy: false });
      })
      .catch((e) => {
        if (alive && e?.name !== 'AbortError') {
          setResult({ key, brief: null, err: 'Organised summary unavailable for this entry.', busy: false });
        }
      });
    return () => {
      alive = false;
      ac.abort();
    };
    // The identity includes the fingerprint; a re-created equivalent row does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Effects run after render: fence the visible result now, before the new lookup starts.
  if (!enabled || result.key !== key) return { brief: null, err: '', busy: enabled };
  return { brief: result.brief, err: result.err, busy: result.busy };
}

/** Plain lines from a brief, suitable for existing copy blocks. */
export function briefPlainLines(brief) {
  if (!brief) return [];
  const out = [];
  if (brief.headline) out.push(String(brief.headline).trim());
  for (const s of brief.summary || []) {
    const t = String(s || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Append intel lines into existing copy without duplicating. */
export function mergeBriefText(base, lines, { maxExtra = 3 } = {}) {
  const t = String(base || '').trim();
  const extra = (lines || []).filter((line) => {
    const s = String(line || '').trim();
    return s && (!t || !t.includes(s.slice(0, Math.min(40, s.length))));
  });
  return [t, ...extra.slice(0, maxExtra)].filter(Boolean).join(' ');
}
