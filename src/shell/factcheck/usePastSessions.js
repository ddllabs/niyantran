// F360 T2: React glue for "Past sessions". The queries are in pastSessions.js; this holds the list, the
// opened row, the delete confirmation and the reload when a session ends on the page.
// Every async result is dropped after unmount or when a newer load has started.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient.js';
import { deleteLiveSession, fetchSessionClaims, listSettledSessions } from './pastSessions.js';

const FINISHED = new Set(['ended', 'error']);

/**
 * client         the Supabase client (tests pass a fake)
 * sessionStatus  the page's own session status; a change to ended or error reloads the list (D9)
 */
export function usePastSessions({ client = supabase, sessionStatus = 'idle' } = {}) {
  const [list, setList] = useState({ phase: 'loading', rows: [], hasMore: false });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});
  const [removal, setRemoval] = useState(null);
  const [notice, setNotice] = useState('');
  const [reloads, setReloads] = useState(0);
  const alive = useRef(true);
  const generation = useRef(0); // a reload or retry invalidates answers still on their way
  const state = useRef({});
  state.current = { list, details, removal, openId };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const loadDetail = useCallback((id) => {
    setDetails((d) => ({ ...d, [id]: { phase: 'loading', claims: [], capped: false } }));
    void fetchSessionClaims({ client, sessionId: id }).then((out) => {
      if (!alive.current) return;
      setDetails((d) => ({
        ...d,
        [id]: out.ok ? { phase: 'ready', claims: out.claims, capped: out.capped } : { phase: 'error', claims: [], capped: false },
      }));
    });
  }, [client]);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    // Rows already on screen stay while a reload runs; only an empty list shows "loading".
    setList((l) => (l.rows.length || l.phase === 'ready' ? l : { phase: 'loading', rows: [], hasMore: false }));
    setMoreFailed(false);
    setMoreBusy(false); // a Show more still in flight is dropped below, so it can no longer clear this itself
    // Kept details may be stale after a reload: drop them, and fetch again the one that is open.
    setDetails({});
    if (state.current.openId) loadDetail(state.current.openId);
    void listSettledSessions({ client, offset: 0 }).then((out) => {
      if (!alive.current || generation.current !== mine) return;
      setList((l) => {
        if (out.ok) return { phase: 'ready', rows: out.rows, hasMore: out.hasMore };
        return l.rows.length ? l : { phase: 'error', rows: [], hasMore: false };
      });
    });
  }, [client, reloads, loadDetail]);

  const previous = useRef(sessionStatus);
  useEffect(() => {
    if (FINISHED.has(sessionStatus) && !FINISHED.has(previous.current)) setReloads((n) => n + 1);
    previous.current = sessionStatus;
  }, [sessionStatus]);

  const retry = useCallback(() => {
    setList({ phase: 'loading', rows: [], hasMore: false });
    setReloads((n) => n + 1);
  }, []);

  const showMore = useCallback(() => {
    const { list: l } = state.current;
    if (moreBusy || !l.hasMore) return;
    const mine = generation.current;
    setMoreBusy(true);
    setMoreFailed(false);
    void listSettledSessions({ client, offset: l.rows.length }).then((out) => {
      if (!alive.current || generation.current !== mine) return;
      setMoreBusy(false);
      if (!out.ok) { setMoreFailed(true); return; }
      setList((cur) => {
        const have = new Set(cur.rows.map((r) => r.id));
        return { phase: 'ready', rows: [...cur.rows, ...out.rows.filter((r) => !have.has(r.id))], hasMore: out.hasMore };
      });
    });
  }, [client, moreBusy]);

  const toggle = useCallback((id) => {
    setNotice('');
    if (state.current.openId === id) { setOpenId(null); return; }
    setOpenId(id);
    const have = state.current.details[id];
    if (!have || have.phase === 'error') loadDetail(id);
  }, [loadDetail]);

  const askDelete = useCallback((id) => {
    const row = state.current.list.rows.find((r) => r.id === id);
    if (!row || row.video_kind !== 'live' || state.current.removal?.phase === 'busy') return;
    setNotice('');
    setRemoval({ id, phase: 'confirm' });
  }, []);

  const cancelDelete = useCallback(() => setRemoval(null), []);

  const confirmDelete = useCallback((id) => {
    const cur = state.current.removal;
    const row = state.current.list.rows.find((r) => r.id === id);
    if (!cur || cur.id !== id || cur.phase === 'busy' || !row) return;
    setRemoval({ id, phase: 'busy' });
    void deleteLiveSession({ client, session: row }).then((out) => {
      if (!alive.current) return;
      if (!out.ok) { setRemoval({ id, phase: 'error' }); return; }
      setList((l) => ({ ...l, rows: l.rows.filter((r) => r.id !== id) }));
      setOpenId((o) => (o === id ? null : o));
      setDetails((d) => { const { [id]: _gone, ...rest } = d; return rest; });
      setRemoval(null);
      setNotice('deleted');
    });
  }, [client]);

  return {
    phase: list.phase, rows: list.rows, hasMore: list.hasMore, moreBusy, moreFailed,
    openId, details, removal, notice,
    retry, showMore, toggle, retryDetail: loadDetail, askDelete, cancelDelete, confirmDelete,
  };
}
