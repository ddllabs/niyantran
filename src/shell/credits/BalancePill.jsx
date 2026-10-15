/**
 * The header's balance pill and its glance popover (F184 spec §2). The popover grows from the pill,
 * closes on Escape, a click outside or focus leaving it, and hands focus back to the pill on Escape.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { formatCredits, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { loadUsageActivity, loadUsageSeries, rowChat } from '../../lib/creditUsage.js';
import { paceModel, periodBar } from '../../lib/creditsVisual.js';
import { BalanceRing, balanceState } from './BalanceRing.jsx';
import { PeriodBar, paceSentence } from './CreditsVisuals.jsx';
import { goAccount } from './accountRoute.js';

/**
 * Closes an open popover on a press outside `root`, on Escape (focus returns to the pill), and when
 * focus moves out of `root`. Returns the cleanup.
 */
export function watchPopover({ doc, root, onClose, focusPill }) {
  const inside = (node) => Boolean(node && root && root.contains(node));
  const onDown = (e) => { if (!inside(e.target)) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { onClose(); focusPill(); } };
  const onFocusOut = (e) => { if (e.relatedTarget && !inside(e.relatedTarget)) onClose(); };
  doc.addEventListener('mousedown', onDown);
  doc.addEventListener('keydown', onKey);
  root?.addEventListener('focusout', onFocusOut);
  return () => {
    doc.removeEventListener('mousedown', onDown);
    doc.removeEventListener('keydown', onKey);
    root?.removeEventListener('focusout', onFocusOut);
  };
}

/** "18 days to renewal", or for sign-up credits "18 days until they expire". */
export function daysLeftText(credits, now = Date.now()) {
  const ends = Date.parse(credits?.cycleEndsAt || '');
  if (!Number.isFinite(ends) || ends <= now) return '';
  const days = Math.ceil((ends - now) / 86400000);
  const word = days === 1 ? 'day' : 'days';
  return credits.plan === 'free' ? `${days} ${word} until they expire` : `${days} ${word} to renewal`;
}

function useCredits(userId) {
  const [credits, setCredits] = useState(() => serverCredits(userId));
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const sync = () => { if (live) setCredits(serverCredits(userId)); };
    const off = subscribeCredits(sync);
    Promise.resolve(refreshCredits()).then(() => { sync(); if (live) setTried(true); });
    return () => { live = false; off(); };
  }, [userId]);
  return { credits, failed: tried && !credits };
}

function Glance({ credits, failed, id, onOpenPage }) {
  const [extra, setExtra] = useState({ pace: null, latest: null });
  const cycleStart = credits?.cycleStartsAt || null;
  const ready = Boolean(credits);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    Promise.all([
      cycleStart ? loadUsageSeries(cycleStart, new Date().toISOString(), 'day') : null,
      loadUsageActivity({ offset: 0, limit: 2, grouped: true }),
    ]).then(([series, page]) => {
      if (!live) return;
      setExtra({ pace: series ? paceSentence(paceModel({ credits, points: series.points })) : null, latest: page?.rows || [] });
    });
    return () => { live = false; };
    // The balance itself changes after every answer; the pace and the latest answers are read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cycleStart]);
  if (!credits) {
    return (
      <div id={id} className="cp-pop" role="dialog" aria-label="Credits at a glance">
        <p className="cu-note">{failed ? 'Your credits could not be checked just now.' : 'Loading your credits…'}</p>
        <button type="button" className="cp-pop-open" onClick={onOpenPage}>Open credits page</button>
      </div>
    );
  }
  const bar = periodBar(credits);
  const days = daysLeftText(credits);
  return (
    <div id={id} className="cp-pop" role="dialog" aria-label="Credits at a glance">
      <div className="cp-pop-head">
        <BalanceRing credits={credits} size={52} />
        <div>
          <p className="cp-pop-num">{formatCredits(bar.left)} <span>credits left</span></p>
          <p className="cp-dim">{bar.total ? `of ${formatCredits(bar.total)}` : ''}{days ? ` · ${days}` : ''}</p>
        </div>
      </div>
      <PeriodBar credits={credits} compact />
      {credits.held > 0 ? <p className="cp-dim cp-pop-line">{formatCredits(credits.held)} held for a running answer</p> : null}
      {extra.pace ? <p className={`cp-pop-pace${extra.pace.tone === 'warn' ? ' cp-warn' : ''}`}>{extra.pace.text}</p> : null}
      {extra.latest?.length ? (
        <>
          <p className="cp-pop-kicker">Latest</p>
          <ul className="cp-pop-list">
            {extra.latest.map((r, i) => <li key={r.turnKey || i}><span>{r.question || rowChat(r)}</span><strong>{formatCredits(r.credits)}</strong></li>)}
          </ul>
        </>
      ) : null}
      <button type="button" className="cp-pop-open" onClick={onOpenPage}>Open credits page</button>
    </div>
  );
}

export default function BalancePill({ user }) {
  const { credits, failed } = useCredits(user?.id || null);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const id = useId();
  const state = balanceState(credits, failed);

  useEffect(() => {
    if (!open) return undefined;
    const stop = watchPopover({ doc: document, root: wrap.current, onClose: () => setOpen(false), focusPill: () => button.current?.focus({ preventScroll: true }) });
    wrap.current?.querySelector('.cp-pop-open')?.focus({ preventScroll: true });
    return stop;
  }, [open]);

  if (!user?.id) return null;
  const left = credits ? Math.max(Math.round(credits.balance - (credits.held || 0)), 0) : null;
  const words = state === 'unchecked' ? 'Credits unavailable' : state === 'loading' ? 'Credits' : `${formatCredits(left)} credits`;
  const label = state === 'unchecked' ? 'Credits could not be checked.' : state === 'loading' ? 'Credits.' : `${words} left.`;
  return (
    <div className={`cp-pill-wrap${open ? ' open' : ''}`} ref={wrap}>
      <button type="button" ref={button} className={`cp-pill cp-pill-${state}`} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={`${label} Open the summary.`} onClick={() => setOpen((v) => !v)}>
        <BalanceRing credits={credits} failed={failed} />
        <span className="cp-pill-text">{words}</span>
      </button>
      {open ? <Glance credits={credits} failed={failed} id={id} onOpenPage={() => { setOpen(false); goAccount('credits'); }} /> : null}
    </div>
  );
}
