/**
 * The small version of the Credits usage page, inside Plan & billing (F153): this period's four
 * figures in a compact row, the top three models, a 30-day sparkline of credits, and "See credits
 * usage →". It replaces Plan & billing's "Recent answers" list, which moved to All AI activity.
 * UsageMini is hook-free; UsageMiniCard reads the two reports it needs.
 */
import { useEffect, useState } from 'react';
import { creditsText } from '../../lib/creditsStore.js';
import { loadUsageSeries, loadUsageSummary, rangeWindow } from '../../lib/creditUsage.js';
import { bucketTotals } from '../../lib/usageChart.js';
import { CycleFigures, TopModels } from './UsageActivityCard.jsx';

const W = 160;
const H = 36;

export function Sparkline({ points }) {
  const totals = bucketTotals(points);
  const sum = totals.reduce((s, t) => s + t.value, 0);
  const max = Math.max(...totals.map((t) => t.value), 0);
  const step = totals.length > 1 ? W / (totals.length - 1) : W;
  const path = totals.map((t, i) => `${(i * step).toFixed(1)},${(H - 2 - (max > 0 ? (t.value / max) * (H - 4) : 0)).toFixed(1)}`).join(' ');
  return (
    <svg className="cu-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      aria-label={`Credits per day over the last ${totals.length} days: ${creditsText(sum)} in total`}>
      <line className="cu-axis" x1="0" x2={W} y1={H - 1} y2={H - 1} />
      {totals.length ? <polyline className="cu-spark-line" points={path} /> : null}
    </svg>
  );
}

export function UsageMini({ credits, state, onSeeUsage }) {
  const status = state?.status || 'loading';
  return (
    <div className="cu-mini">
      {status === 'loading' ? (
        <p className="plan-up-note" role="status">Loading usage…</p>
      ) : status === 'error' ? (
        <p className="plan-up-note" role="alert">Usage could not be loaded just now.</p>
      ) : (
        <>
          <CycleFigures credits={credits} summary={state.summary} compact />
          <div className="cu-mini-row">
            <div className="cu-mini-col">
              <h5 className="cu-h5">Top models</h5>
              <TopModels models={state.summary?.byModel} />
            </div>
            <div className="cu-mini-col cu-mini-spark">
              <h5 className="cu-h5">Last 30 days</h5>
              <Sparkline points={state.points} />
            </div>
          </div>
        </>
      )}
      <button type="button" className="cu-link" onClick={() => onSeeUsage?.()}>
        See credits usage <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export default function UsageMiniCard({ credits, onSeeUsage }) {
  const [state, setState] = useState({ status: 'loading', summary: null, points: [] });
  const userId = credits?.userId || null;
  const start = credits?.cycleStartsAt || null;
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const month = rangeWindow('30d');
    Promise.all([loadUsageSummary(start, new Date().toISOString()), loadUsageSeries(month.from, month.to, 'day')]).then(([summary, series]) => {
      if (!live) return;
      setState(summary ? { status: 'ready', summary, points: series?.points || [] } : { status: 'error', summary: null, points: [] });
    });
    return () => { live = false; };
  }, [userId, start]);
  return <UsageMini credits={credits} state={state} onSeeUsage={onSeeUsage} />;
}
