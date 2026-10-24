import { useEffect, useState, useCallback, useRef } from 'react';
import { savedHomeNews } from './homeNews.js';
import { homeLiveApiEnabled } from './apiMode.js';

/**
 * Fetch latest articles from nter.news via /api/home/latest.
 * The old September seed is never presented as current news.
 */
export async function fetchNterLatest({ signal, limit = 12, fresh = false } = {}) {
  if (homeLiveApiEnabled()) {
    try {
      const url = `/api/home/latest?limit=${encodeURIComponent(limit)}${fresh ? '&fresh=1' : ''}`;
      const res = await fetch(url, { signal, cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (body?.delivery === 'rss' && Array.isArray(body.rows)) return body;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }
  return { ok: false, delivery: 'rss', rows: [], checked_at: null, updated: null,
    note: 'nter.news stories are temporarily unavailable.', source: 'nter.news',
    waiting: true, archive: true, stale: true };
}

/**
 * Hook to consume live Latest rail data with periodic background polling.
 */
export function useNterLatest({ pollIntervalMs = 60000, limit = 12, enabled = true } = {}) {
  const [data, setData] = useState({
    rows: [],
    loading: true,
    error: null,
    updated: null,
    ageH: null,
    waiting: false,
    note: '',
    checked_at: null,
    archive: false,
    stale: false,
  });

  const abortRef = useRef(null);

  const loadData = useCallback(async (fresh = false) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetchNterLatest({ signal: ac.signal, limit, fresh });
      if (ac.signal.aborted) return;
      setData(prev => {
        const previous = savedHomeNews({ ...prev, delivery: 'rss' });
        const next = res.ok ? res : previous ? { ...previous, stale: true, archive: true, note: res.note } : res;
        return { ...next, loading: false, error: next.rows.length ? null : !res.ok ? res.note : null };
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setData((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load latest intelligence',
      }));
    }
  }, [limit]);

  useEffect(() => {
    if (!enabled) return;
    loadData();

    const visible = () => { if (!document.hidden) loadData(); };
    document.addEventListener('visibilitychange', visible);
    const interval = pollIntervalMs > 0 ? setInterval(() => {
      // Only poll when page is visible
      if (typeof document !== 'undefined' && document.hidden) return;
      loadData();
    }, pollIntervalMs) : null;

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      abortRef.current?.abort();
    };
  }, [enabled, loadData, pollIntervalMs]);

  return {
    ...data,
    refresh: () => loadData(true),
  };
}
