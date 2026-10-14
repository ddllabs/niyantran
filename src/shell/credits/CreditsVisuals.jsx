/**
 * The credits page's pictures (F184, spec §3): the period bar, the pace chart, the 90-day heat map,
 * where credits went, and the status bar. Data shaping lives in src/lib/creditsVisual.js; these draw
 * it. Hook-free except the heat map's keyboard cursor. Credits only.
 */
import { useState } from 'react';
import { creditsText, formatCredits, refreshCredits } from '../../lib/creditsStore.js';
import { modelLabel, providerOf } from '../../lib/creditUsage.js';
import { heatmapCells, paceModel, periodBar, statusMessages } from '../../lib/creditsVisual.js';
import { shareText } from '../../lib/usageChart.js';
import { lotLabel } from '../CreditLots.jsx';
import { goAccount } from './accountRoute.js';

const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function segmentLabel(s) {
  if (s.key === 'used') return 'Used';
  if (s.key === 'held') return 'Held for a running answer';
  return `${lotLabel(s.key)} left`;
}

/** This period as one bar with its legend; `compact` drops the legend (the popover). */
export function PeriodBar({ credits, compact = false }) {
  const bar = periodBar(credits);
  if (!bar.total && !bar.overdrawn) return null;
  const summary = bar.segments.map((s) => `${segmentLabel(s)} ${formatCredits(s.value)}`).join(', ');
  return (
    <div className={`cp-period${compact ? ' cp-period-compact' : ''}`}>
      <div className="cp-bar" role="img" aria-label={bar.overdrawn ? `Overdrawn by ${creditsText(bar.overdrawn)}` : summary}>
        {bar.segments.map((s) => (
          <span key={s.key} className={`cp-seg cp-seg-${s.key}`} style={{ flexGrow: s.value }} title={`${segmentLabel(s)}: ${creditsText(s.value)}`} />
        ))}
        {bar.overdrawn ? <span className="cp-seg cp-seg-over" style={{ flexGrow: Math.max(bar.overdrawn, bar.used * 0.04) }} /> : null}
      </div>
      {compact ? null : (
        <ul className="cp-legend">
          {bar.segments.map((s) => (
            <li key={s.key}>
              <span className={`cp-swatch cp-seg-${s.key}`} aria-hidden="true" />
              <span className="cp-legend-label">{segmentLabel(s)}</span>
              <strong>{formatCredits(s.value)}</strong>
              <span className="cp-legend-sub">
                {s.key === 'used' ? 'this period' : s.key === 'held' ? 'released or charged when it ends' : s.expiresAt ? `expire ${day(s.expiresAt)}` : 'no expiry'}
              </span>
            </li>
          ))}
          {bar.overdrawn ? (
            <li><span className="cp-swatch cp-seg-over" aria-hidden="true" /><span className="cp-legend-label">Overdrawn</span><strong>{formatCredits(bar.overdrawn)}</strong><span className="cp-legend-sub">taken from your next credits</span></li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** The pace estimate as one sentence, or null. Shared by the chart and the popover. */
export function paceSentence(model) {
  const p = model?.projection;
  if (!p) return null;
  if (p.runOutAt) return { tone: 'warn', text: `At this pace you would run out around ${day(p.runOutAt)}.` };
  return { tone: 'ok', text: `At this pace about ${creditsText(Math.round(p.leftAtRenewal))} would be left at renewal.` };
}

const W = 640;
const H = 210;
const PAD = { l: 44, r: 16, t: 14, b: 26 };

/** Cumulative credits this period against an even pace, with the estimate dotted. */
export function PaceChart({ credits, points, now = Date.now() }) {
  const m = paceModel({ credits, points, now });
  if (!m || !m.total) return <p className="cu-note">The pace appears once a billing period is open.</p>;
  const x = (d) => PAD.l + ((W - PAD.l - PAD.r) * d) / m.totalDays;
  const y = (v) => H - PAD.b - ((H - PAD.t - PAD.b) * Math.min(v, m.total)) / m.total;
  const line = [`${x(0)},${y(0)}`, ...m.days.map((d) => `${x(d.day + 1).toFixed(1)},${y(d.cumulative).toFixed(1)}`)].join(' ');
  const lastDay = m.days.at(-1);
  const tx = x(lastDay.day + 1);
  const ty = y(lastDay.cumulative);
  const p = m.projection;
  const endX = p?.runOutAt
    ? x(Math.min(m.totalDays, (Date.parse(p.runOutAt) - Date.parse(credits.cycleStartsAt)) / 86400000))
    : x(m.totalDays);
  const endY = p?.runOutAt ? y(m.total) : y(m.total - (p?.leftAtRenewal || 0));
  const sentence = paceSentence(m);
  const ahead = Math.round(m.used - m.evenToday);
  return (
    <div className="cp-pace">
      <svg viewBox={`0 0 ${W} ${H}`} className="cp-pace-svg" role="img"
        aria-label={`Used ${creditsText(m.used)} of ${creditsText(m.total)} so far this period, against an even pace of ${creditsText(Math.round(m.evenToday))}.${sentence ? ` ${sentence.text}` : ''}`}>
        <line className="cp-axis" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
        <line className="cp-grid" x1={PAD.l} x2={W - PAD.r} y1={y(m.total)} y2={y(m.total)} />
        <text className="cp-tick" x={PAD.l - 6} y={y(m.total) + 4} textAnchor="end">{formatCredits(m.total)}</text>
        <text className="cp-tick" x={PAD.l - 6} y={y(0) + 4} textAnchor="end">0</text>
        <text className="cp-tick" x={PAD.l} y={H - 6}>{day(credits.cycleStartsAt)}</text>
        <text className="cp-tick" x={W - PAD.r} y={H - 6} textAnchor="end">{day(credits.cycleEndsAt)}</text>
        <line className="cp-even" x1={x(0)} y1={y(0)} x2={x(m.totalDays)} y2={y(m.total)} />
        <polygon className="cp-used-fill" points={`${line} ${tx},${y(0)}`} />
        <polyline className="cp-used" points={line} />
        {p ? <line className={`cp-proj${p.runOutAt ? ' cp-proj-warn' : ''}`} x1={tx} y1={ty} x2={endX} y2={endY} /> : null}
        <circle className="cp-today" cx={tx} cy={ty} r="5" />
      </svg>
      <p className="cp-pace-key">
        <span><i className="cp-key-used" aria-hidden="true" />Used so far</span>
        <span><i className="cp-key-even" aria-hidden="true" />Even pace</span>
        {p ? <span><i className="cp-key-proj" aria-hidden="true" />Estimate</span> : null}
      </p>
      <p className={`cp-pace-note${sentence?.tone === 'warn' ? ' cp-warn' : ''}`}>
        {ahead > 0 ? `${creditsText(ahead)} ahead of an even pace. ` : ahead < 0 ? `${creditsText(-ahead)} behind an even pace. ` : 'On an even pace. '}
        {sentence ? `${sentence.text} An estimate from your average since ${day(credits.cycleStartsAt)}.` : 'An estimate appears after three days.'}
      </p>
    </div>
  );
}

const LEVEL_TEXT = ['no use', 'light', 'moderate', 'heavy', 'busiest'];

/** The last 90 days, two rows of 45 days, with a keyboard cursor and a readout. */
export function UsageHeatmap({ points, now = Date.now() }) {
  const cells = heatmapCells(points, now, 90);
  const [cursor, setCursor] = useState(cells.length - 1);
  const busiest = cells.reduce((b, c) => (c.value > (b?.value || 0) ? c : b), null);
  const at = cells[Math.min(cursor, cells.length - 1)];
  const move = (e) => {
    const step = { ArrowRight: 2, ArrowLeft: -2, ArrowDown: 1, ArrowUp: -1, Home: -cells.length, End: cells.length }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setCursor((c) => Math.max(0, Math.min(cells.length - 1, c + step)));
  };
  return (
    <div className="cp-heat">
      <div className="cp-heat-head">
        <h4 className="cu-h4">Daily use · last 90 days</h4>
        <p className="cp-heat-busiest">{busiest ? `Busiest: ${day(busiest.date)}, ${creditsText(Math.round(busiest.value))}` : 'No credits used in the last 90 days'}</p>
      </div>
      <div className="cp-heat-grid" role="grid" aria-label="Credits used each day for the last 90 days. Use the arrow keys to move between days."
        tabIndex={0} onKeyDown={move} aria-activedescendant={`cp-heat-${cursor}`}>
        {cells.map((c, i) => (
          <span key={c.date} id={`cp-heat-${i}`} role="gridcell" className={`cp-heat-cell cp-lv${c.level}${i === cursor ? ' on' : ''}`}
            aria-label={`${day(c.date)}: ${creditsText(Math.round(c.value))}, ${LEVEL_TEXT[c.level]}`}
            title={`${day(c.date)}: ${creditsText(Math.round(c.value))}`} onMouseEnter={() => setCursor(i)} />
        ))}
      </div>
      <div className="cp-heat-foot">
        <p className="cp-heat-readout" aria-live="polite">{at ? `${day(at.date)}: ${creditsText(Math.round(at.value))}` : ''}</p>
        <p className="cp-heat-scale" aria-hidden="true">Less{[0, 1, 2, 3, 4].map((l) => <span key={l} className={`cp-heat-cell cp-lv${l}`} />)}More</p>
      </div>
    </div>
  );
}

/** This period's credits by model: one 100% bar and the list below it. */
export function WhereCreditsWent({ summary }) {
  const models = (summary?.byModel || []).filter((m) => m.credits > 0);
  const total = models.reduce((s, m) => s + m.credits, 0);
  if (!total) return <p className="cu-note">No credits used this period yet.</p>;
  const top = models.slice(0, 5);
  const rest = models.slice(5).reduce((s, m) => s + m.credits, 0);
  const rows = [...top.map((m, i) => ({ key: m.model, name: modelLabel(m.model), provider: providerOf(m.model), credits: m.credits, calls: m.calls, slot: i })), ...(rest > 0 ? [{ key: 'other', name: 'Other models', credits: rest, slot: 7 }] : [])];
  const max = rows[0].credits;
  return (
    <div className="cp-where">
      <div className="cp-bar cp-bar-thin" role="img" aria-label={rows.map((r) => `${r.name} ${shareText((100 * r.credits) / total)}`).join(', ')}>
        {rows.map((r) => <span key={r.key} className={`cp-seg cp-s${r.slot}`} style={{ flexGrow: r.credits }} title={`${r.name}: ${creditsText(r.credits)}`} />)}
      </div>
      <ul className="cp-where-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className={`cp-swatch cp-s${r.slot}`} aria-hidden="true" />
            <span className="cp-where-name" title={r.key}>{r.name}{r.calls ? <span className="cp-dim"> · {r.calls} {r.calls === 1 ? 'call' : 'calls'}</span> : null}</span>
            <span className="cp-mini" aria-hidden="true"><span className={`cp-s${r.slot}`} style={{ width: `${Math.round((100 * r.credits) / max)}%` }} /></span>
            <strong>{formatCredits(r.credits)}</strong>
            <span className="cp-dim cp-share">{shareText((100 * r.credits) / total)}</span>
          </li>
        ))}
      </ul>
      {summary.webSearchCredits > 0 ? <p className="cp-dim cp-where-note">Including {creditsText(summary.webSearchCredits)} for {summary.webSearches} web {summary.webSearches === 1 ? 'search' : 'searches'}.</p> : null}
    </div>
  );
}

/** Every state the app tells the user about, at the top of each section (spec §1). */
export function StatusBar({ credits, failed, now = Date.now() }) {
  const messages = statusMessages({ credits, failed, now });
  if (!messages.length) return null;
  return (
    <div className="cp-status">
      {messages.map((m) => (
        <p key={m.key} className={`cp-status-msg cp-tone-${m.tone}`} role={m.tone === 'danger' ? 'alert' : 'status'}>
          <span>{m.text}</span>
          {m.key === 'low' || m.key === 'empty' ? <button type="button" className="cp-link" onClick={() => goAccount('billing')}>See plans</button> : null}
          {m.key === 'unchecked' ? <button type="button" className="cp-link" onClick={() => refreshCredits()}>Retry</button> : null}
        </p>
      ))}
    </div>
  );
}
