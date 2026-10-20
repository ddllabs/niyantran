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
import { BalanceRing } from './BalanceRing.jsx';
import { StatusBar, UsageHeatmap } from './CreditsVisuals.jsx';
import OverviewSection from './OverviewSection.jsx';
import { ACCOUNT_SECTIONS, accountHash, accountPlan } from './accountRoute.js';
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
  billing: [['billing-current-title', 'Your plan'], ['plan-change-title', 'Choose your plan'], ['topup-title', 'Credit top-ups'], ['billing-history-title', 'Billing history']],
};

// Scroll only the credits page, keeping the Terminal header fixed. Legacy targets
// remain available when the original billing layout is serving outside Test Preview.
export function jumpToPart(page, id, doc = document, win = window) {
  const legacy = { 'billing-current-title': 'plan-billing-title', 'billing-history-title': 'plan-invoices-title' }[id];
  const el = doc.getElementById(id) || (legacy && doc.getElementById(legacy));
  if (!page || !el) return;
  const still = win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const top = page.scrollTop + el.getBoundingClientRect().top - page.getBoundingClientRect().top - 12;
  page.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
}

/** One report while `enabled`: loading, then ready with its value, or error. Idle while not enabled. */
function useReport(enabled, load, deps) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle' });
  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.status === 'loading' ? { status: 'idle' } : s));
      return undefined;
    }
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
  const plan = section === 'billing' ? accountPlan() : null;
  const heading = useRef(null);
  const pageRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const sync = () => { if (live) setCredits(serverCredits(userId)); };
    const off = subscribeCredits(sync);
    Promise.resolve(refreshCredits()).then(() => { sync(); if (live) setCreditsTried(true); });
    return () => { live = false; off(); };
  }, [userId]);

  // Opening the page or a section starts at its top and moves focus to its heading, as a page change
  // would, without scrolling anything else.
  useEffect(() => {
    pageRef.current?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [section]);

  const cycleStart = credits?.cycleStartsAt || null;
  const ready = Boolean(userId && credits);
  const overview = section === 'credits';
  const usage = section === 'usage';
  const activity = section === 'activity';
  const cycle = useReport(ready && overview, () => loadUsageSummary(cycleStart, new Date().toISOString()), [cycleStart]);
  // The activity filter offers every model ever used, so last month's answers can still be filtered.
  const lifetime = useReport(Boolean(userId) && activity, () => loadUsageSummary(null, new Date().toISOString()), []);
  const series = useReport(ready && overview && Boolean(cycleStart), () => loadUsageSeries(cycleStart, new Date().toISOString(), 'day'), [cycleStart]);
  const recent = useReport(Boolean(userId) && overview, () => loadUsageActivity({ offset: 0, limit: 5, grouped: true }), []);
  // The window is taken when the report is read, so opening Usage again reads up to now.
  const analytics = useReport(Boolean(userId) && usage, () => {
    const w = rangeWindow(range);
    return Promise.all([loadUsageSummary(w.from, w.to), loadUsageSeries(w.from, w.to, w.bucket)])
      .then(([summary, s]) => (summary && s ? { summary, series: s, window: w } : null));
  }, [range]);
  const win = analytics.value?.window?.range === range ? analytics.value.window : rangeWindow(range);
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
  const jump = (id) => jumpToPart(pageRef.current, id);

  if (!userId) return <main className="cp-page"><p className="cu-note">Sign in to see your credits.</p></main>;

  return (
    <div className="cp-page cu-series" ref={pageRef}>
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
        {/* Plan and invoices says when the month ends itself. */}
        <StatusBar credits={credits} failed={failed} skip={section === 'billing' ? ['renews'] : []} />

        {overview ? (
          <OverviewSection credits={credits} creditsFailed={failed} cycle={{ status: cycle.status, summary: cycle.value || null }}
            series={{ status: cycleStart ? series.status : 'ready', points: series.value?.points || [] }}
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

        {activity ? <ActivitySection models={filterModels(lifetime.value)} onOpenChat={openChat} /> : null}

        {section === 'billing' ? <PlanBilling key={userId + ':' + (plan || 'none')} ent={ent} user={user} initialPlan={plan} credits={credits} creditsTried={creditsTried} /> : null}
      </main>
    </div>
  );
}
