/**
 * The header's balance pill and its glance popover (F184 spec §2), and the ring both use. The ring
 * shows the share of this period's credits left; its colour follows the same states as the chat
 * (lowBalance(): amber; none left or overdrawn: red; unreadable: a dash). The popover grows from the
 * pill, closes on Escape or a click outside, and hands focus back to the pill.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { formatCredits, lowBalance, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { loadUsageActivity, loadUsageSeries, rowChat } from '../../lib/creditUsage.js';
import { paceModel, periodBar } from '../../lib/creditsVisual.js';
import { PeriodBar, paceSentence } from './CreditsVisuals.jsx';
import { goAccount } from './accountRoute.js';
import './creditsPage.css';

/** ok | low | empty | unchecked | loading, for the ring's colour and the pill's words. */
export function balanceState(credits, failed = false) {
  if (!credits) return failed ? 'unchecked' : 'loading';
  if (credits.balance - (credits.held || 0) <= 0) return 'empty';
  return lowBalance(credits) ? 'low' : 'ok';
}

export function BalanceRing({ credits, failed = false, size = 20 }) {
  const state = balanceState(credits, failed);
  const bar = credits ? periodBar(credits) : null;
  const share = bar && bar.total > 0 ? Math.min(1, bar.left / bar.total) : state === 'ok' || state === 'low' ? 1 : 0;
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`cp-ring cp-ring-${state}`} width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className="cp-ring-track" cx="18" cy="18" r={r} />
      {state === 'unchecked' || state === 'loading'
        ? <line className="cp-ring-dash" x1="11" x2="25" y1="18" y2="18" />
        : <circle className="cp-ring-fill" cx="18" cy="18" r={r} strokeDasharray={`${(share * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 18 18)" />}
    </svg>
  );
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

function Glance({ credits, id, onOpenPage, now = Date.now() }) {
  const [extra, setExtra] = useState({ pace: null, latest: null });
  const cycleStart = credits?.cycleStartsAt || null;
  useEffect(() => {
    let live = true;
    Promise.all([
      cycleStart ? loadUsageSeries(cycleStart, new Date().toISOString(), 'day') : null,
      loadUsageActivity({ offset: 0, limit: 2, grouped: true }),
    ]).then(([series, page]) => {
      if (!live) return;
      setExtra({ pace: series ? paceSentence(paceModel({ credits, points: series.points })) : null, latest: page?.rows || [] });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleStart]);
  if (!credits) return <div id={id} className="cp-pop" role="dialog" aria-label="Credits at a glance"><p className="cu-note">Your credits could not be checked just now.</p></div>;
  const bar = periodBar(credits);
  const ends = Date.parse(credits.cycleEndsAt || '');
  const daysLeft = Number.isFinite(ends) && ends > now ? Math.ceil((ends - now) / 86400000) : null;
  return (
    <div id={id} className="cp-pop" role="dialog" aria-label="Credits at a glance">
      <div className="cp-pop-head">
        <BalanceRing credits={credits} size={52} />
        <div>
          <p className="cp-pop-num">{formatCredits(bar.left)} <span>credits left</span></p>
          <p className="cp-dim">{bar.total ? `of ${formatCredits(bar.total)}` : ''}{daysLeft !== null ? ` · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to renewal` : ''}</p>
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
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector('.cp-pop-open')?.focus();
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user?.id) return null;
  const left = credits ? Math.max(Math.round(credits.balance - (credits.held || 0)), 0) : null;
  const words = state === 'unchecked' ? 'Credits unavailable' : state === 'loading' ? 'Credits' : `${formatCredits(left)} credits`;
  return (
    <div className={`cp-pill-wrap${open ? ' open' : ''}`} ref={wrap}>
      <button type="button" ref={button} className={`cp-pill cp-pill-${state}`} aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={state === 'unchecked' ? 'Credits could not be checked. Open the summary.' : `${words} left. Open the summary.`}
        onClick={() => setOpen((v) => !v)}>
        <BalanceRing credits={credits} failed={failed} />
        <span className="cp-pill-text">{words}</span>
      </button>
      {open ? <Glance credits={credits} id={id} onOpenPage={() => { setOpen(false); goAccount('credits'); }} /> : null}
    </div>
  );
}
