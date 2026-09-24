import { useEffect, useState } from 'react';
import { entryFingerprintFnv, peekDeskBrief } from '../lib/deskBrief.js';

/**
 * Shows organised entry intelligence for a selected row when already cached.
 * Does NOT call Gemini on select — models run only from AI Research after Send
 * (or when a brief was previously saved).
 */
export function useEntryBrief({ feed, selected, loading }) {
  const [brief, setBrief] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (loading || !feature || !selected || selected.status === 'source_status') {
      setBrief(null);
      setErr('');
      setBusy(false);
      return undefined;
    }
    const ac = new AbortController();
    let alive = true;
    const row = selected;
    setBusy(true);
    setErr('');
    peekDeskBrief({
      feature,
      tier,
      row,
      signal: ac.signal,
      scope: 'entry',
    })
      .then((b) => {
        if (!alive) return;
        setBrief(b || null);
        setErr('');
      })
      .catch((e) => {
        if (!alive || e?.name === 'AbortError') return;
        setErr(e.message || String(e));
        setBrief((prev) => prev || null);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [feature, tier, rowKey, fp, loading]);

  return { brief, err, busy };
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
