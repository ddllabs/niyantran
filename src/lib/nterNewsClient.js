import { useEffect, useState, useCallback, useRef } from 'react';
import { homeLatestFromStatic } from './homeStatic.js';
import { homeLiveApiEnabled } from './apiMode.js';

/**
 * Fetch latest articles from nter.news via /api/home/latest.
 * Falls back to static seed when offline or API is unavailable.
 */
export async function fetchNterLatest({ signal, limit = 12 } = {}) {
  const tryApi = homeLiveApiEnabled();
  if (tryApi) {
    try {
      const url = `/api/home/latest?limit=${encodeURIComponent(limit)}`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.ok !== false && Array.isArray(body.rows)) {
          return {
            ok: true,
            rows: body.rows,
            note: body.note || 'Latest from nter.news.',
            source: body.source || 'nter.news',
            updated: body.updated || null,
            ageH: body.ageH ?? null,
            waiting: Boolean(body.waiting || !body.rows.length),
            archive: Boolean(body.archive),
          };
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Network or API failure falls through to static seed
    }
  }

  // Fallback to static seed
  try {
    const staticData = await homeLatestFromStatic(signal);
    if (staticData) return staticData;
  } catch {
    /* ignore in non-browser env */
  }

  return {
    ok: true,
    rows: [],
    note: 'Waiting for nter.news articles.',
    source: 'nter.news',
    waiting: true,
    archive: false,
  };
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
  });

  const abortRef = useRef(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetchNterLatest({ signal: ac.signal, limit });
      setData({
        rows: res.rows || [],
        loading: false,
        error: null,
        updated: res.updated || null,
        ageH: res.ageH ?? null,
        waiting: Boolean(res.waiting || !res.rows?.length),
        note: res.note || '',
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

    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const interval = setInterval(() => {
      // Only poll when page is visible
      if (typeof document !== 'undefined' && document.hidden) return;
      loadData();
    }, pollIntervalMs);

    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, loadData, pollIntervalMs]);

  return {
    ...data,
    refresh: loadData,
  };
}
