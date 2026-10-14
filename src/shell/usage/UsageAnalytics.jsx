/**
 * Section B of the Credits usage page (F153): AI analytics over a rolling IST window. Hook-free apart
 * from the chart it renders. `state` is {status, summary, series, window} for my_usage_summary and
 * my_usage_timeseries over the selected range.
 */
import { creditsText, formatCredits } from '../../lib/creditsStore.js';
import {
  CREDITS_STARTED_AT, CREDITS_STARTED_NOTE, MEASURES, RANGES, dayText, featureLabel, formatTokens, indianNumber,
  modelName, providerName,
} from '../../lib/creditUsage.js';
import { bucketLabel, highlights } from '../../lib/usageChart.js';
import UsageChart from './UsageChart.jsx';
import UsageLegend from './UsageLegend.jsx';
import { ChartIcon, Credits, Figure, Tokens } from './usageParts.jsx';

export function valueFormatter(measure) {
  if (measure === 'tokens') return formatTokens;
  if (measure === 'calls') return indianNumber;
  return formatCredits;
}

function rangeLine(range, state) {
  const label = RANGES.find((r) => r.id === range)?.label || '';
  const win = state?.window;
  const points = state?.series?.points || [];
  const from = win?.from ? dayText(win.from) : points.length ? bucketLabel(points[0].bucket, 'month') : '';
  const to = win?.to ? dayText(win.to) : '';
  return [`Usage by model · ${label}`, from && to ? `${from} – ${to}` : ''].filter(Boolean).join(' · ');
}

function Highlights({ summary }) {
  const h = highlights(summary);
  return (
    <div className="cu-highs">
      <Figure label="Top provider" sub={h.topProvider ? `${Math.round(h.topProvider.share)}% of credits` : null}>
        {h.topProvider ? providerName(h.topProvider.provider) : '—'}
      </Figure>
      <Figure label="Most used" sub={h.mostUsed ? `${indianNumber(h.mostUsed.calls)} calls` : null}>
        <span title={h.mostUsed?.model}>{h.mostUsed ? modelName(h.mostUsed.model) : '—'}</span>
      </Figure>
      <Figure label="Best value" sub={h.bestValue ? `${formatCredits(h.bestValue.perCall)} credits a call` : 'Needs 5 calls on a model'}>
        <span title={h.bestValue?.model}>{h.bestValue ? modelName(h.bestValue.model) : '—'}</span>
      </Figure>
    </div>
  );
}

function ByFeature({ summary }) {
  const features = summary?.byFeature || [];
  return (
    <ul className="cu-features">
      {features.map((f) => (
        <li key={f.feature} className="cu-feature">
          <span className="cu-feature-name">{featureLabel(f.feature)}</span>
          <span className="cu-feature-num">
            {indianNumber(f.calls)} {f.calls === 1 ? 'call' : 'calls'}
            {f.feature === 'dictation' ? ' · free' : (
              <>
                {` · ${creditsText(f.credits)}`}
                {` · ${indianNumber(f.searches)} ${f.searches === 1 ? 'search' : 'searches'}`}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function UsageAnalytics({
  range, measure, groupBy, state, chart, onRange, onMeasure, onGroupBy, onToggle, afterChart = null,
}) {
  const summary = state?.summary || null;
  const valueText = valueFormatter(measure);
  const status = state?.status || 'loading';
  const early = !state?.window?.from || Date.parse(state.window.from) < Date.parse(CREDITS_STARTED_AT);
  return (
    <section className="cu-card" aria-labelledby="cu-analytics-title">
      <header className="cu-card-head">
        <h3 id="cu-analytics-title"><ChartIcon /> AI analytics</h3>
        <p className="cu-sub">{rangeLine(range, state)}</p>
      </header>
      <div className="cu-controls">
        <div className="cu-seg-ctl" role="group" aria-label="Measure">
          {MEASURES.map((m) => (
            <button key={m.id} type="button" aria-pressed={measure === m.id} className={measure === m.id ? 'on' : ''} onClick={() => onMeasure(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <label className="cu-select">
          <span className="cu-sr">Range</span>
          <select value={range} onChange={(e) => onRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}{r.id === 'lifetime' ? ' (by month)' : ''}</option>)}
          </select>
        </label>
      </div>
      {status === 'error' ? (
        <p className="cu-note cu-error" role="alert">Analytics could not be loaded just now.</p>
      ) : status === 'loading' && !summary ? (
        <p className="cu-note" role="status">Loading analytics…</p>
      ) : (
        <div className="cu-figs cu-figs-five">
          <Figure label="Credits spent"><Credits value={summary?.credits ?? 0} /></Figure>
          <Figure label="Model calls" sub={`${indianNumber(summary?.failedCalls ?? 0)} failed`}>{indianNumber(summary?.calls ?? 0)}</Figure>
          <Figure label="Tokens"><Tokens value={summary?.tokens ?? 0} /></Figure>
          <Figure label="Models used" sub={`${indianNumber(summary?.providers ?? 0)} ${summary?.providers === 1 ? 'provider' : 'providers'}`}>
            {indianNumber(summary?.modelsUsed ?? 0)}
          </Figure>
          <Figure label="Web searches" sub={creditsText(summary?.webSearchCredits ?? 0)}>
            {indianNumber(summary?.webSearches ?? 0)}
          </Figure>
        </div>
      )}
      <p className="cu-caption">Rolling window in IST — independent of your billing period, so these totals can differ from the Overview.</p>
      {early ? <p className="cu-caption">{CREDITS_STARTED_NOTE}; earlier calls show 0 credits.</p> : null}
      <div className="cu-chart-row">
        <UsageChart chart={chart} status={status} valueText={valueText} />
        <UsageLegend chart={chart} groupBy={groupBy} onGroupBy={onGroupBy} onToggle={onToggle} valueText={valueText} />
      </div>
      {afterChart}
      {summary ? (
        <>
          <h4 className="cu-h4" id="cu-highlights">Highlights</h4>
          <Highlights summary={summary} />
          <h4 className="cu-h4">By feature</h4>
          <ByFeature summary={summary} />
        </>
      ) : null}
    </section>
  );
}
