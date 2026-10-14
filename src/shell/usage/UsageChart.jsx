/**
 * The stacked bar chart of AI analytics (F153, spec "Charts (no library)"): hand-built SVG drawn at
 * the measured width (ResizeObserver), dashed gridlines on four round ticks, day or month labels, a
 * tooltip on hover, tap or focus, and a "Show as table" disclosure with the same numbers.
 * UsageChartView is hook-free; UsageChart adds the measuring and the interaction state.
 */
import { useEffect, useRef, useState } from 'react';
import { Dot } from './usageParts.jsx';

const HEIGHT = 220;
const PAD = { top: 10, right: 8, bottom: 24, left: 46 };

export function chartSummary(chart, valueText) {
  if (!chart || chart.empty) return 'No usage in this range.';
  const top = chart.series.filter((s) => !s.hidden).slice(0, 3).map((s) => `${s.label} ${valueText(s.total)}`);
  return `${chart.buckets.length} ${chart.bucketKind === 'month' ? 'months' : 'days'}, ${valueText(chart.grand)} in total. Largest: ${top.join(', ')}.`;
}

function Tooltip({ bucket, x, width, valueText }) {
  const rows = bucket.values.filter((v) => !v.hidden && v.value > 0);
  const left = Math.min(Math.max(x - 90, 0), Math.max(width - 180, 0));
  return (
    <div className="cu-tip" style={{ left }} role="status">
      <strong>{bucket.label}</strong>
      {rows.length ? rows.map((v) => (
        <span key={v.key} className="cu-tip-row"><Dot slot={v.slot} />{v.label}<b>{valueText(v.value)}</b></span>
      )) : <span className="cu-tip-row">No usage</span>}
      <span className="cu-tip-row cu-tip-total">Total<b>{valueText(bucket.total)}</b></span>
    </div>
  );
}

export function ChartTable({ chart, valueText }) {
  const shown = chart.series.filter((s) => !s.hidden);
  return (
    <div className="cu-table-wrap">
      <table className="cu-table cu-chart-table">
        <caption className="cu-sr">Usage by {chart.bucketKind === 'month' ? 'month' : 'day'} and {chart.groupBy}</caption>
        <thead>
          <tr>
            <th scope="col">{chart.bucketKind === 'month' ? 'Month' : 'Day'}</th>
            {shown.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {chart.buckets.map((b) => (
            <tr key={b.bucket}>
              <th scope="row">{b.label}</th>
              {shown.map((s) => <td key={s.key}>{valueText(b.values.find((v) => v.key === s.key)?.value || 0)}</td>)}
              <td>{valueText(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageChartView({ chart, width, active = null, onActive = () => {}, showTable = false, onToggleTable = () => {}, valueText }) {
  const w = Math.max(240, width || 640);
  const plotW = w - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const n = Math.max(chart.buckets.length, 1);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(36, slot * 0.7));
  const top = chart.ticks[chart.ticks.length - 1] || 1;
  const y = (v) => PAD.top + plotH * (1 - v / top);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));
  const cx = (i) => PAD.left + slot * i + slot / 2;
  return (
    <div className="cu-chart">
      <div className="cu-chart-box">
        <svg
          className="cu-svg"
          viewBox={`0 0 ${w} ${HEIGHT}`}
          width={w}
          height={HEIGHT}
          role="img"
          aria-label={chartSummary(chart, valueText)}
          onMouseLeave={() => onActive(null)}
        >
          {chart.ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'cu-axis' : 'cu-grid'} x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="cu-tick" x={PAD.left - 6} y={y(t) + 3} textAnchor="end">{valueText(t)}</text>
            </g>
          ))}
          {chart.buckets.map((b, i) => (
            <g
              key={b.bucket}
              className={`cu-bar${active === i ? ' on' : ''}`}
              tabIndex={0}
              aria-label={`${b.label}: ${valueText(b.total)}`}
              onMouseEnter={() => onActive(i)}
              onFocus={() => onActive(i)}
              onBlur={() => onActive(null)}
              onClick={() => onActive(active === i ? null : i)}
            >
              <rect className="cu-hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} />
              {b.segments.map((s) => (
                <rect
                  key={s.key}
                  className="cu-seg"
                  x={cx(i) - barW / 2}
                  y={y(s.y1)}
                  width={barW}
                  height={Math.max(0, y(s.y0) - y(s.y1))}
                  style={{ fill: `var(--cu-s${s.slot})` }}
                >
                  <title>{`${b.label} · ${s.label}: ${valueText(s.value)}`}</title>
                </rect>
              ))}
              {i % every === 0 ? (
                <text className="cu-tick" x={cx(i)} y={HEIGHT - 6} textAnchor="middle">{b.label}</text>
              ) : null}
            </g>
          ))}
        </svg>
        {active !== null && chart.buckets[active] ? (
          <Tooltip bucket={chart.buckets[active]} x={cx(active)} width={w} valueText={valueText} />
        ) : null}
      </div>
      <button type="button" className="cu-disclose" aria-expanded={showTable} onClick={() => onToggleTable()}>
        {showTable ? 'Hide table' : 'Show as table'}
      </button>
      {showTable ? <ChartTable chart={chart} valueText={valueText} /> : null}
    </div>
  );
}

export default function UsageChart({ chart, status, valueText }) {
  const box = useRef(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState(null);
  const [showTable, setShowTable] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width || 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [chart]);
  let body;
  if (status === 'loading') body = <p className="cu-note cu-chart-state" role="status">Loading the chart…</p>;
  else if (status === 'error') body = <p className="cu-note cu-chart-state cu-error" role="alert">The chart could not be loaded just now.</p>;
  else if (!chart || chart.empty) body = <p className="cu-note cu-chart-state">No AI usage in this range yet.</p>;
  else {
    body = (
      <UsageChartView chart={chart} width={width} active={active} onActive={setActive}
        showTable={showTable} onToggleTable={() => setShowTable((v) => !v)} valueText={valueText} />
    );
  }
  return <div className="cu-chart-measure" ref={box}>{body}</div>;
}
