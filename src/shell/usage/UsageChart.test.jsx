// F153: the AI analytics chart as drawn - SVG with a summary label, focusable buckets, a title per
// segment, a tooltip, the table fallback with the same numbers, and the legend toggles.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatCredits } from '../../lib/creditsStore.js';
import { buildChart } from '../../lib/usageChart.js';
import UsageLegend from './UsageLegend.jsx';
import { UsageChartView, chartSummary } from './UsageChart.jsx';

const p = (bucket, model, credits) => ({ bucket, model, credits, calls: 1, tokens: 100 });
const POINTS = [
  { bucket: '2026-10-12', model: null, credits: 0, calls: 0, tokens: 0 },
  p('2026-10-13', 'google/gemini-3.7-flash', 30), p('2026-10-13', 'anthropic/claude-sonnet-5', 10),
  p('2026-10-14', 'google/gemini-3.7-flash', 20),
];
const chart = (hidden = new Set()) => buildChart(POINTS, { hidden });
const html = (props) => renderToStaticMarkup(<UsageChartView chart={chart()} width={640} valueText={formatCredits} {...props} />);

/** Every element of a hook-free tree, function components expanded. */
function elements(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && node.props) {
    if (typeof node.type === 'function') return elements(node.type(node.props), out);
    out.push(node);
    elements(node.props.children, out);
  }
  return out;
}

describe('the chart', () => {
  it('is one labelled SVG image with a focusable group per bucket and a title per segment', () => {
    const out = html();
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-label="3 days, 60 in total\. Largest: gemini-3\.7-flash 50, claude-sonnet-5 10\."/);
    expect(out.match(/<g class="cu-bar[^"]*" tabindex="0"/g)).toHaveLength(3);
    expect(out).toContain('aria-label="13 Oct: 40"');
    expect(out).toContain('<title>13 Oct · gemini-3.7-flash: 30</title>');
    expect(out).toContain('<title>13 Oct · claude-sonnet-5: 10</title>');
    expect(out.match(/class="cu-grid"/g)).toHaveLength(4);
    expect(out).toContain('fill:var(--cu-s');
  });

  it('shows a tooltip for the active bucket: each model, then the total', () => {
    const out = html({ active: 1 });
    expect(out).toMatch(/class="cu-tip"[\s\S]*13 Oct[\s\S]*gemini-3\.7-flash[\s\S]*30[\s\S]*claude-sonnet-5[\s\S]*10[\s\S]*Total[\s\S]*40/);
    expect(html()).not.toContain('cu-tip');
  });

  it('activates a bucket on hover, focus and tap, and lets go on blur', () => {
    const onActive = vi.fn();
    const tree = UsageChartView({ chart: chart(), width: 375, valueText: formatCredits, onActive });
    const groups = elements(tree).filter((e) => e.type === 'g' && e.props.tabIndex === 0);
    groups[2].props.onMouseEnter();
    groups[2].props.onFocus();
    groups[2].props.onClick();
    groups[2].props.onBlur();
    expect(onActive.mock.calls).toEqual([[2], [2], [2], [null]]);
  });

  it('fits a phone: 30 days at 375 px still draw thin bars inside the width', () => {
    const month = Array.from({ length: 30 }, (_, i) => p(`2026-10-${String(i + 1).padStart(2, '0')}`, 'a/b', i));
    const out = renderToStaticMarkup(<UsageChartView chart={buildChart(month)} width={343} valueText={formatCredits} />);
    expect(out).toContain('viewBox="0 0 343 220"');
    const widths = [...out.matchAll(/class="cu-seg" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(widths.length).toBe(29);
    for (const [x, w] of widths) { expect(w).toBeGreaterThanOrEqual(2); expect(x + w).toBeLessThanOrEqual(343); }
  });

  it('offers the same numbers as a real table behind a disclosure', () => {
    const closed = html();
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('<table');
    const open = html({ showTable: true });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/<table class="cu-table cu-chart-table">/);
    expect(open).toMatch(/<th scope="col">Day<\/th><th scope="col">gemini-3\.7-flash<\/th><th scope="col">claude-sonnet-5<\/th><th scope="col">Total<\/th>/);
    expect(open).toMatch(/<th scope="row">13 Oct<\/th><td>30<\/td><td>10<\/td><td>40<\/td>/);
    expect(open).toMatch(/<th scope="row">12 Oct<\/th><td>0<\/td><td>0<\/td><td>0<\/td>/);
  });

  it('leaves a hidden series out of the bars and the table', () => {
    const out = renderToStaticMarkup(<UsageChartView chart={chart(new Set(['google/gemini-3.7-flash']))} width={640} valueText={formatCredits} showTable />);
    expect(out).not.toContain('<title>13 Oct · gemini');
    expect(out).not.toContain('<th scope="col">gemini-3.7-flash');
    expect(out).toMatch(/<th scope="row">13 Oct<\/th><td>10<\/td><td>10<\/td>/);
  });

  it('never shows a dollar, and says plainly when there is nothing to draw', () => {
    expect(html({ showTable: true, active: 1 })).not.toMatch(/\$|usd|dollar/i);
    expect(chartSummary(buildChart([]), formatCredits)).toBe('No usage in this range.');
  });
});

describe('the legend', () => {
  const legend = (props = {}) => UsageLegend({ chart: chart(), groupBy: 'model', onGroupBy: vi.fn(), onToggle: vi.fn(), valueText: formatCredits, ...props });

  it('lists each series as a pressed button with its colour, provider, name, value and share', () => {
    const out = renderToStaticMarkup(legend());
    expect(out.match(/<button type="button" class="cu-leg-row" aria-pressed="true"/g)).toHaveLength(2);
    expect(out).toMatch(/gemini-3\.7-flash<\/span><span class="cu-leg-val">50<\/span><span class="cu-leg-share">83%<\/span>/);
    expect(out).toContain('data-provider="google"');
    expect(out).toContain('background:var(--cu-s');
  });

  it('toggles a series with its button, and shows it unpressed while hidden', () => {
    const onToggle = vi.fn();
    const buttons = elements(legend({ onToggle })).filter((e) => e.type === 'button' && e.props.className?.startsWith('cu-leg-row'));
    buttons[1].props.onClick();
    expect(onToggle).toHaveBeenCalledWith('anthropic/claude-sonnet-5');
    const off = renderToStaticMarkup(legend({ chart: chart(new Set(['anthropic/claude-sonnet-5'])) }));
    expect(off).toContain('class="cu-leg-row off" aria-pressed="false"');
    expect(off).toContain('Hidden from the chart');
  });

  it('switches between model and provider', () => {
    const onGroupBy = vi.fn();
    const switches = elements(legend({ onGroupBy })).filter((e) => e.type === 'button' && 'aria-pressed' in e.props && !e.props.className?.startsWith('cu-leg-row'));
    expect(switches.map((b) => [b.props.children, b.props['aria-pressed']])).toEqual([['Model', true], ['Provider', false]]);
    switches[1].props.onClick();
    expect(onGroupBy).toHaveBeenCalledWith('provider');
  });
});
