import { useEffect, useState } from 'react';
import { ensureDeskBrief } from '../lib/deskBrief.js';
import { resolveSourceBrief } from '../lib/sourceDoc.js';

/**
 * Fetches organised entry intelligence for a selected row.
 * Callers fold the result into existing detail UI — no separate summary chrome.
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

  useEffect(() => {
    if (loading || !feature || !selected || selected.status === 'source_status') {
      setBrief(null);
      setErr('');
      setBusy(false);
      return undefined;
    }
    const ac = new AbortController();
    let alive = true;
    setBusy(true);
    setErr('');
    (async () => {
      let sourceExtract = '';
      try {
        const src = await resolveSourceBrief(selected, {
          title:
            selected.bill_name ||
            selected.policy_name ||
            selected.title ||
            selected.subject ||
            selected.name ||
            '',
          signal: ac.signal,
        });
        sourceExtract = src.extract || '';
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
      }
      return ensureDeskBrief({
        feature,
        tier,
        row: selected,
        sourceNote: feed?.source?.note || '',
        sourceExtract,
        signal: ac.signal,
      });
    })()
      .then((b) => {
        if (!alive) return;
        setBrief(b);
      })
      .catch((e) => {
        if (!alive || e?.name === 'AbortError') return;
        setErr(e.message || String(e));
        setBrief(null);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [feature, tier, rowKey, feed?.source?.note, loading, selected]);

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
