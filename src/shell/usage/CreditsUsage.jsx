/**
 * The Credits usage page (open-work F153, docs/specs/2026-10-14-credits-usage-page.md): a full-screen
 * panel opened from the profile menu, Plan & billing and the chat's credit chip (niy-open-usage),
 * like Plan & billing. Sections: A. AI activity this period; B. AI analytics over a rolling IST
 * range; C. All AI activity (a dialog over the page); D. Credits by expiry. Credits only (F184).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openConversation, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { loadUsageSeries, loadUsageSummary, rangeWindow } from '../../lib/creditUsage.js';
import { buildChart } from '../../lib/usageChart.js';
import CreditLots from '../CreditLots.jsx';
import ActivityDialog from './ActivityDialog.jsx';
import UsageActivityCard from './UsageActivityCard.jsx';
import UsageAnalytics from './UsageAnalytics.jsx';
import './creditsUsage.css';

/** The models the activity filter offers: every model either summary has seen, most credits first. */
export function filterModels(...summaries) {
  const seen = new Map();
  for (const s of summaries) for (const m of s?.byModel || []) seen.set(m.model, (seen.get(m.model) || 0) + m.credits);
  return [...seen.entries()].filter(([m]) => m !== 'unknown').sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([m]) => m);
}

export default function CreditsUsage({ user, onClose }) {
  const userId = user?.id || null;
  const [credits, setCredits] = useState(() => serverCredits(userId));
  const [creditsTried, setCreditsTried] = useState(false);
  const [cycle, setCycle] = useState({ status: 'loading', summary: null });
  const [range, setRange] = useState('30d');
  const [measure, setMeasure] = useState('credits');
  const [groupBy, setGroupBy] = useState('model');
  const [hidden, setHidden] = useState(() => new Set());
  const [analytics, setAnalytics] = useState({ status: 'loading', summary: null, series: null, window: null });
  const [allOpen, setAllOpen] = useState(false);
  const card = useRef(null);
  const viewAll = useRef(null);
  const state = useRef({ allOpen, onClose });
  state.current = { allOpen, onClose };

  useEffect(() => {
    card.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (state.current.allOpen) {
        setAllOpen(false);
        viewAll.current?.focus();
      } else {
        state.current.onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const sync = () => { if (live) setCredits(serverCredits(userId)); };
    const off = subscribeCredits(sync);
    Promise.resolve(refreshCredits()).then(() => { sync(); if (live) setCreditsTried(true); });
    return () => { live = false; off(); };
  }, [userId]);

  // Section A: this period, from where used_this_cycle counts (lifetime when there is no cycle).
  const creditsReady = Boolean(credits);
  const cycleStart = credits?.cycleStartsAt || null;
  useEffect(() => {
    if (!userId || !creditsReady) return undefined;
    let live = true;
    setCycle((c) => ({ ...c, status: 'loading' }));
    loadUsageSummary(cycleStart, new Date().toISOString()).then((summary) => {
      if (live) setCycle(summary ? { status: 'ready', summary } : { status: 'error', summary: null });
    });
    return () => { live = false; };
  }, [userId, creditsReady, cycleStart]);

  // Section B: the rolling range.
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const win = rangeWindow(range);
    setAnalytics((a) => ({ ...a, status: 'loading', window: win }));
    Promise.all([loadUsageSummary(win.from, win.to), loadUsageSeries(win.from, win.to, win.bucket)]).then(([summary, series]) => {
      if (!live) return;
      setAnalytics(summary && series ? { status: 'ready', summary, series, window: win } : { status: 'error', summary: null, series: null, window: win });
    });
    return () => { live = false; };
  }, [userId, range]);

  const chart = useMemo(() => (analytics.series
    ? buildChart(analytics.series.points, { measure, groupBy, hidden, bucketKind: analytics.series.bucket })
    : null), [analytics.series, measure, groupBy, hidden]);

  const models = filterModels(cycle.summary, analytics.summary);

  return (
    <div className="cu-root" role="dialog" aria-modal="true" aria-labelledby="cu-title">
      <button type="button" className="cu-scrim" aria-label="Close credits usage" tabIndex={-1} onClick={() => onClose?.()} />
      <div className="cu-page" ref={card} tabIndex={-1} aria-hidden={allOpen || undefined}>
        <div className="cu-head">
          <div>
            <p className="cu-kicker">AI CREDITS</p>
            <h2 id="cu-title">Credits usage</h2>
          </div>
          <button type="button" className="cu-x" aria-label="Close" onClick={() => onClose?.()}>×</button>
        </div>
        {!userId ? (
          <p className="cu-note">Sign in to see your credits usage.</p>
        ) : (
          <div className="cu-sections">
            <UsageActivityCard
              credits={credits}
              state={!credits && creditsTried ? { status: 'error' } : cycle}
              onViewAll={() => setAllOpen(true)}
              viewAllRef={viewAll}
            />
            <UsageAnalytics
              range={range}
              measure={measure}
              groupBy={groupBy}
              state={analytics}
              chart={chart}
              onRange={(r) => { setRange(r); setHidden(new Set()); }}
              onMeasure={setMeasure}
              onGroupBy={(g) => { setGroupBy(g); setHidden(new Set()); }}
              onToggle={(key) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
            />
            <section className="cu-card" aria-labelledby="cu-lots-title">
              <header className="cu-card-head"><h3 id="cu-lots-title">Credits by expiry</h3></header>
              {credits ? <CreditLots lots={credits.lots} /> : <p className="cu-note">{creditsTried ? 'Your credits could not be loaded just now.' : 'Loading credits…'}</p>}
            </section>
          </div>
        )}
      </div>
      {allOpen ? (
        <ActivityDialog
          models={models}
          onClose={() => { setAllOpen(false); viewAll.current?.focus(); }}
          onOpenChat={(id) => { openConversation(id); onClose?.(); }}
        />
      ) : null}
    </div>
  );
}
