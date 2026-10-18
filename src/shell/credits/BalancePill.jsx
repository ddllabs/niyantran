/**
 * The header's profile control and embedded credit summary (F230, retaining F184/F193 behavior).
 * Closes on Escape, a click outside or focus leaving it, and returns focus to the avatar on Escape.
 * Every credit message lives here (F193, owner 2026-10-15): the chat's refusal, low, empty, overdrawn,
 * unchecked and renewal. A new refusal opens the popover by itself, leaving focus in the chat box.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { formatCredits, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { loadUsageActivity, loadUsageSeries, rowChat } from '../../lib/creditUsage.js';
import { paceModel, periodBar, statusMessages } from '../../lib/creditsVisual.js';
import { creditNotice, refusalMessage, subscribeCreditNotice } from '../../ai/chatCreditNotice.js';
import { BalanceRing, balanceState } from './BalanceRing.jsx';
import { PeriodBar, paceSentence } from './CreditsVisuals.jsx';
import { goAccount } from './accountRoute.js';

/**
 * Closes an open popover on a press outside `root`, on Escape, and when focus moves out of `root`.
 * Escape hands focus back to the pill only from inside the popover: one opened for a refusal leaves
 * focus in the chat box, and Escape typed there keeps it there (F193 review). Returns the cleanup.
 */
export function watchPopover({ doc, root, onClose, focusPill }) {
  const inside = (node) => Boolean(node && root && root.contains(node));
  const onDown = (e) => { if (!inside(e.target)) onClose(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const within = inside(doc.activeElement);
    onClose();
    if (within) focusPill();
  };
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

/** A refusal the popover has not shown yet: a new one, or a different kind. */
export function opensFor(prev, next) {
  if (!next?.block) return false;
  return !prev || prev.block !== next.block || prev.held !== next.held;
}

/** What a notice does to the popover: open it quietly for a new refusal when it is closed. */
export function noticeStep(prev, next, isOpen) {
  const open = opensFor(prev, next) && !isOpen;
  return { open, quiet: open };
}

/** The messages at the pill: the refusal first, then the standing ones without repeating it. Held
 * credits keep the popover's own line. */
function glanceMessages(credits, failed, notice) {
  const refusal = refusalMessage(notice, credits);
  const skip = ['held'];
  if (refusal?.key === 'refused') skip.push('empty');
  if (refusal?.key === 'refused-unchecked') skip.push('unchecked');
  // statusMessages answers an unread balance before it applies `skip`, so filter here too.
  return [...(refusal ? [refusal] : []), ...statusMessages({ credits, failed, skip }).filter((m) => !skip.includes(m.key))];
}

/** 'danger' or 'warn' while a refusal or a warning stands, for the pill's dot; null otherwise. */
export function attentionTone(credits, failed, notice) {
  const tones = glanceMessages(credits, failed, notice).map((m) => m.tone);
  if (tones.includes('danger')) return 'danger';
  return tones.includes('warn') ? 'warn' : null;
}

export function GlanceMessages({ credits, failed = false, notice, onDone = () => {} }) {
  const messages = glanceMessages(credits, failed, notice);
  if (!messages.length) return null;
  const then = (act) => () => { onDone(); act(); };
  const billing = then(() => goAccount('billing'));
  return (
    <div className="cp-status cp-pop-status">
      {messages.map((m) => (
        <p key={m.key} className={`cp-status-msg cp-tone-${m.tone}`} role={m.tone === 'danger' || m.key.startsWith('refused') ? 'alert' : 'status'}>
          <span>{m.text}</span>
          {m.buy ? <><button type="button" className="cp-link" onClick={billing}>Upgrade</button><button type="button" className="cp-link" onClick={billing}>Buy credits</button></> : null}
          {m.retry ? <button type="button" className="cp-link" onClick={then(() => notice.retry())}>Try again</button> : null}
          {m.key === 'low' ? <button type="button" className="cp-link" onClick={billing}>See plans</button> : null}
          {m.key === 'empty' || m.key === 'overdrawn' ? <button type="button" className="cp-link" onClick={billing}>Upgrade</button> : null}
          {m.key === 'unchecked' ? <button type="button" className="cp-link" onClick={() => refreshCredits()}>Retry</button> : null}
        </p>
      ))}
    </div>
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

function Glance({ credits, failed, notice, onClose }) {
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
  return <CreditGlanceBody credits={credits} failed={failed} notice={notice} onClose={onClose} extra={extra} />;
}

export function CreditGlanceBody({ credits, failed, notice, onClose, extra = {} }) {
  if (!credits) {
    return (
      <section className="cp-pop cp-profile-summary" aria-label="Credits at a glance">
        <GlanceMessages credits={credits} failed={failed} notice={notice} onDone={onClose} />
        {failed ? null : <p className="cu-note">Loading your credits…</p>}
      </section>
    );
  }
  const bar = periodBar(credits);
  const days = daysLeftText(credits);
  return (
    <section className="cp-pop cp-profile-summary" aria-label="Credits at a glance">
      <GlanceMessages credits={credits} failed={failed} notice={notice} onDone={onClose} />
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
    </section>
  );
}

export default function ProfileCredits({ user, open, setOpen, onToggle, children }) {
  const { credits, failed } = useCredits(user?.id || null);
  const wrap = useRef(null);
  const button = useRef(null);
  const id = useId();
  const state = balanceState(credits, failed);
  const [notice, setNotice] = useState(creditNotice);
  const shown = useRef(creditNotice());
  // Opened for a refusal, not by the reader: focus stays in the chat box.
  const quiet = useRef(false);
  const isOpen = useRef(open);
  isOpen.current = open;

  useEffect(() => subscribeCreditNotice((next) => {
    const step = noticeStep(shown.current, next, isOpen.current);
    shown.current = next;
    setNotice(next);
    if (step.open) { quiet.current = step.quiet; setOpen(true); }
  }), [setOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const stop = watchPopover({ doc: document, root: wrap.current, onClose: () => setOpen(false), focusPill: () => button.current?.focus({ preventScroll: true }) });
    if (!quiet.current) wrap.current?.querySelector('.profile-pop-upgrade')?.focus({ preventScroll: true });
    quiet.current = false;
    return stop;
  }, [open, setOpen]);

  if (!user?.id) return null;
  const left = credits ? Math.max(Math.round(credits.balance - (credits.held || 0)), 0) : null;
  const words = state === 'unchecked' ? 'Credits unavailable' : state === 'loading' ? 'Credits' : `${formatCredits(left)} credits`;
  const tone = attentionTone(credits, failed, notice);
  const label = `${state === 'unchecked' ? 'Credits could not be checked.' : state === 'loading' ? 'Credits.' : `${words} left.`}${tone ? ' Needs attention.' : ''}`;
  return (
    <div className="profile-wrap cp-profile-wrap" ref={wrap}>
      <button type="button" ref={button} className={`avatar-btn cp-profile-trigger${open ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={`${user.name || user.email || 'Profile'}. ${label} Open account.`} onClick={() => { onToggle?.(); setOpen((v) => !v); }}>
        <span className="cp-profile-ring"><BalanceRing credits={credits} failed={failed} size={48} /></span>
        <span className="avatar">{(user.name || user.email || 'A').charAt(0).toUpperCase()}</span>
        {tone ? <span className={`cp-pill-dot cp-dot-${tone}`} aria-hidden="true" /> : null}
      </button>
      {open ? <div id={id} className="profile-pop" role="dialog" aria-label="Account">
        {children(<Glance credits={credits} failed={failed} notice={notice} onClose={() => setOpen(false)} />)}
      </div> : null}
    </div>
  );
}
