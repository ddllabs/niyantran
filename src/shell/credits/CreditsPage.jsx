/**
 * The credits page (F184, docs/specs/2026-10-15-credits-page.md): one page in the terminal at
 * #/account/<section>, with a side menu (a balance card, then Overview, Usage, Activity, Plan and
 * invoices) and a status bar above every section. It replaces F153's Credits usage dialog and F110's
 * Plan & billing modal; nothing they showed is dropped. Each section reads only the reports it shows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openConversation, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { loadUsageActivity, loadUsageSeries, loadUsageSummary, rangeWindow } from '../../lib/creditUsage.js';
import { buildChart } from '../../lib/usageChart.js';
import UsageAnalytics from '../usage/UsageAnalytics.jsx';
import PlanBilling from '../PlanBilling.jsx';
import ActivitySection from './ActivitySection.jsx';
import { BalanceRing } from './BalancePill.jsx';
import { StatusBar, UsageHeatmap } from './CreditsVisuals.jsx';
import OverviewSection from './OverviewSection.jsx';
import { ACCOUNT_SECTIONS, accountHash, takeAccountPlan } from './accountRoute.js';
import '../usage/creditsUsage.css';
import './creditsPage.css';

/** The models the activity filter offers: every model either summary has seen, most credits first. */
export function filterModels(...summaries) {
  const seen = new Map();
  for (const s of summaries) for (const m of s?.byModel || []) seen.set(m.model, (seen.get(m.model) || 0) + m.credits);
  return [...seen.entries()].filter(([m]) => m !== 'unknown').sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([m]) => m);
}

/** The parts of each section, as in-page links under the open item in the side menu. */
export const SECTION_PARTS = {
  credits: [['cp-left-title', 'This period'], ['cp-pace-title', 'Pace'], ['cp-where-title', 'Where credits went'], ['cp-recent-title', 'Recent answers'], ['cp-lots-title', 'Credits by expiry']],
  usage: [['cu-analytics-title', 'Chart and legend'], ['cp-heat', 'Daily use'], ['cu-highlights', 'Highlights and features']],
  activity: [],
  billing: [['plan-billing-title', 'Your plan'], ['plan-change-title', 'Change plan'], ['plan-invoices-title', 'Invoices']],
};

function useReport(enabled, load, deps) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve(load()).then((value) => { if (live) setState(value ? { status: 'ready', value } : { status: 'error' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return state;
}

export default function CreditsPage({ section = 'credits', user, ent }) {
  const userId = user?.id || null;
  const [credits, setCredits] = useState(() => serverCredits(userId));
  const [creditsTried, setCreditsTried] = useState(false);
  const [range, setRange] = useState('30d');
  const [measure, setMeasure] = useState('credits');
  const [groupBy, setGroupBy] = useState('model');
  const [hidden, setHidden] = useState(() => new Set());
  const [plan, setPlan] = useState(() => (section === 'billing' ? takeAccountPlan() : null));
  const heading = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const sync = () => { if (live) setCredits(serverCredits(userId)); };
    const off = subscribeCredits(sync);
    Promise.resolve(refreshCredits()).then(() => { sync(); if (live) setCreditsTried(true); });
    return () => { live = false; off(); };
  }, [userId]);

  // A section change moves focus to its heading, as a page change would; the first render does not.
  // A plan handed over on the way to Plan and invoices (the chat's Upgrade) is picked up then.
  useEffect(() => {
    if (section === 'billing') {
      const handed = takeAccountPlan();
      if (handed !== null) setPlan(handed);
    }
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
  }, [section]);

  const cycleStart = credits?.cycleStartsAt || null;
  const ready = Boolean(userId && credits);
  const overview = section === 'credits';
  const usage = section === 'usage';
  const cycle = useReport(ready, () => loadUsageSummary(cycleStart, new Date().toISOString()), [cycleStart]);
  const series = useReport(ready && overview && Boolean(cycleStart), () => loadUsageSeries(cycleStart, new Date().toISOString(), 'day'), [cycleStart]);
  const recent = useReport(Boolean(userId) && overview, () => loadUsageActivity({ offset: 0, limit: 5, grouped: true }), []);
  const win = useMemo(() => rangeWindow(range), [range]);
  const analytics = useReport(Boolean(userId) && usage, () => Promise.all([loadUsageSummary(win.from, win.to), loadUsageSeries(win.from, win.to, win.bucket)])
    .then(([summary, s]) => (summary && s ? { summary, series: s } : null)), [win.from, win.to, win.bucket]);
  const heat = useReport(Boolean(userId) && usage, () => { const w = rangeWindow('90d'); return loadUsageSeries(w.from, w.to, 'day'); }, []);

  const analyticsState = analytics.status === 'ready'
    ? { status: 'ready', summary: analytics.value.summary, series: analytics.value.series, window: win }
    : { status: analytics.status, summary: null, series: null, window: win };
  const chart = useMemo(() => (analyticsState.series
    ? buildChart(analyticsState.series.points, { measure, groupBy, hidden, bucketKind: analyticsState.series.bucket })
    : null), [analyticsState.series, measure, groupBy, hidden]);

  const failed = creditsTried && !credits;
  const meta = ACCOUNT_SECTIONS.find((s) => s.id === section) || ACCOUNT_SECTIONS[0];
  const openChat = (id) => openConversation(id);
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!userId) return <main className="cp-page"><p className="cu-note">Sign in to see your credits.</p></main>;

  return (
    <div className="cp-page cu-series">
      <nav className="cp-menu" aria-label="Credits">
        <div className="cp-balance">
          <BalanceRing credits={credits} failed={failed} size={44} />
          <div>
            <p className="cp-balance-num">{credits ? Math.max(Math.round(credits.balance - (credits.held || 0)), 0).toLocaleString('en-IN') : '—'}</p>
            <p className="cp-dim">{credits ? 'credits left' : failed ? 'could not be checked' : 'loading…'}</p>
          </div>
        </div>
        <ul className="cp-menu-list">
          {ACCOUNT_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={accountHash(s.id)} className={`cp-menu-item${s.id === section ? ' on' : ''}`} aria-current={s.id === section ? 'page' : undefined}>{s.label}</a>
              {s.id === section && SECTION_PARTS[s.id].length ? (
                <ul className="cp-menu-parts">
                  {SECTION_PARTS[s.id].map(([id, label]) => <li key={id}><button type="button" onClick={() => jump(id)}>{label}</button></li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>

      <main className="cp-main" aria-labelledby="cp-section-title">
        <p className="cp-crumb">Credits</p>
        <h2 id="cp-section-title" className="cp-title" ref={heading} tabIndex={-1}>{meta.label}</h2>
        <p className="cp-question">{meta.question}</p>
        <StatusBar credits={credits} failed={failed} />

        {overview ? (
          <OverviewSection credits={credits} creditsFailed={failed} cycle={{ status: cycle.status, summary: cycle.value || null }}
            series={{ status: series.status, points: series.value?.points || [] }}
            recent={{ status: recent.status, rows: recent.value?.rows || [] }} onOpenChat={openChat} />
        ) : null}

        {usage ? (
          <UsageAnalytics
            range={range}
            measure={measure}
            groupBy={groupBy}
            state={analyticsState}
            chart={chart}
            onRange={(r) => { setRange(r); setHidden(new Set()); }}
            onMeasure={setMeasure}
            onGroupBy={(g) => { setGroupBy(g); setHidden(new Set()); }}
            onToggle={(key) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
            afterChart={(
              <div id="cp-heat">
                {heat.status === 'error' ? <p className="cu-note cu-error" role="alert">Daily use could not be loaded just now.</p>
                  : heat.status === 'loading' ? <p className="cu-note" role="status">Loading daily use…</p>
                    : <UsageHeatmap points={heat.value?.points || []} />}
              </div>
            )}
          />
        ) : null}

        {section === 'activity' ? <ActivitySection models={filterModels(cycle.value)} onOpenChat={openChat} /> : null}

        {section === 'billing' ? <PlanBilling key={plan || 'none'} ent={ent} user={user} initialPlan={plan} /> : null}
      </main>
    </div>
  );
}
