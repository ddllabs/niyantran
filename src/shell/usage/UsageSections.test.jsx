// F153: sections A and B of the Credits usage page, the small version in Plan & billing, and the page
// itself - figures with their rupee value, the period line, top models, the analytics figures and
// captions, and never a dollar.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ credits: null }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../../lib/creditsStore.js', async (original) => ({
  ...(await original()),
  serverCredits: () => store.credits,
  subscribeCredits: () => () => {},
  refreshCredits: () => Promise.resolve(null),
}));

import { buildChart } from '../../lib/usageChart.js';
import CreditsUsage, { filterModels } from './CreditsUsage.jsx';
import UsageActivityCard, { periodLine } from './UsageActivityCard.jsx';
import UsageAnalytics from './UsageAnalytics.jsx';
import { Sparkline, UsageMini } from './UsageMini.jsx';

const CREDITS = {
  userId: 'u1', balance: 1500, held: 0, available: 1500, debt: 0, plan: 'plus', inrPerCredit: 0.1, allowance: 2000,
  cycleStartsAt: '2026-10-14T05:46:00Z', cycleEndsAt: '2026-11-14T05:46:00Z', usedThisCycle: 500,
  lots: [{ kind: 'monthly', remaining: 1500, expiresAt: '2026-11-14T05:46:00Z' }], recent: [],
};
const SUMMARY = {
  credits: 500, calls: 42, failedCalls: 3, tokens: 2270000, answers: 20, answersFree: 2, webSearches: 7, webSearchCredits: 35,
  modelsUsed: 4, providers: 3, lifetimeCredits: 812.5,
  byModel: [
    { model: 'google/gemini-3.7-flash', provider: 'google', credits: 300, calls: 30, tokens: 2000000 },
    { model: 'anthropic/claude-sonnet-5', provider: 'anthropic', credits: 180, calls: 2, tokens: 200000 },
    { model: 'deepseek/deepseek-v4-flash', provider: 'deepseek', credits: 20, calls: 6, tokens: 60000 },
    { model: 'openai/text-embedding-3-small', provider: 'openai', credits: 0, calls: 4, tokens: 10000 },
  ],
  byFeature: [{ feature: 'research', calls: 40, credits: 500, searches: 7 }, { feature: 'dictation', calls: 2, credits: 0, searches: 0 }],
};
const POINTS = [
  { bucket: '2026-10-13', model: null, credits: 0, calls: 0, tokens: 0 },
  { bucket: '2026-10-14', model: 'google/gemini-3.7-flash', credits: 300, calls: 30, tokens: 2000000 },
];
const NO_DOLLAR = /\$|usd|dollar/i;

describe('A. AI activity', () => {
  const html = (over = {}) => renderToStaticMarkup(
    <UsageActivityCard credits={CREDITS} state={{ status: 'ready', summary: SUMMARY }} onViewAll={vi.fn()} {...over} />,
  );

  it('names the billing period, or the sign-up credits on Free', () => {
    expect(periodLine(CREDITS)).toBe('Billing period · 14 Oct 2026 – 14 Nov 2026 · renews 14 Nov 2026');
    expect(periodLine({ ...CREDITS, plan: 'free' })).toBe('Sign-up credits · valid until 14 Nov 2026');
  });

  it('shows the four figures with rupees, the lifetime line and the top three models', () => {
    const out = html();
    expect(out).toMatch(/Credits used<\/span><span class="cu-fig-value"><span class="cu-credits"><span class="cu-credits-num">500<\/span><span class="cu-inr">≈ ₹50<\/span>/);
    expect(out).toMatch(/Credits left[\s\S]*1,500[\s\S]*≈ ₹150[\s\S]*of 2,000 this period/);
    expect(out).toMatch(/Model calls<\/span><span class="cu-fig-value">42</);
    expect(out).toContain('title="22,70,000 tokens"');
    expect(out).toContain('>2.27M</abbr>');
    expect(out).toMatch(/Lifetime spend: <strong>813 credits<\/strong><span class="cu-inr"> \(≈ ₹81\.25\)/);
    expect(out.match(/class="cu-top-row"/g)).toHaveLength(3);
    expect(out).toContain('30 calls · 300 credits');
    expect(out).toContain('View all AI activity');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('shows debt as negative, taken from the next credits', () => {
    const out = html({ credits: { ...CREDITS, balance: -50, available: -50, debt: 50 } });
    expect(out).toContain('−50');
    expect(out).toContain('taken from your next credits');
  });

  it('opens All AI activity', () => {
    const onViewAll = vi.fn();
    const tree = UsageActivityCard({ credits: CREDITS, state: { status: 'ready', summary: SUMMARY }, onViewAll });
    const button = [tree.props.children].flat().find((c) => c?.type === 'button');
    button.props.onClick();
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it('says when it is loading or could not load', () => {
    expect(html({ state: { status: 'loading' } })).toContain('Loading your usage');
    expect(html({ state: { status: 'error' } })).toContain('could not be loaded');
  });
});

describe('B. AI analytics', () => {
  const html = (over = {}) => renderToStaticMarkup(
    <UsageAnalytics range="30d" measure="credits" groupBy="model" rate={0.1}
      state={{ status: 'ready', summary: SUMMARY, series: { bucket: 'day', points: POINTS }, window: { from: '2026-09-14T18:30:00.000Z', to: '2026-10-14T10:00:00.000Z' } }}
      chart={buildChart(POINTS)} onRange={vi.fn()} onMeasure={vi.fn()} onGroupBy={vi.fn()} onToggle={vi.fn()} {...over} />,
  );

  it('shows the range, the measure tabs and the range menu', () => {
    const out = html();
    expect(out).toMatch(/Usage by model · Last 30 days · 15 Sept? 2026 – 14 Oct 2026/);
    expect(out).toMatch(/<button type="button" aria-pressed="true" class="on">Credits<\/button><button type="button" aria-pressed="false" class="">Tokens/);
    expect(out).toContain('<option value="lifetime">Lifetime (by month)</option>');
  });

  it('shows the five figures, the IST caption, highlights and features, with rupees and no dollars', () => {
    const out = html();
    expect(out).toMatch(/Credits spent[\s\S]*500[\s\S]*≈ ₹50/);
    expect(out).toMatch(/Model calls<\/span><span class="cu-fig-value">42<\/span><span class="cu-fig-sub">3 failed/);
    expect(out).toMatch(/Models used<\/span><span class="cu-fig-value">4<\/span><span class="cu-fig-sub">3 providers/);
    expect(out).toMatch(/Web searches<\/span><span class="cu-fig-value">7<\/span><span class="cu-fig-sub">35 credits · ≈ ₹3\.5</);
    expect(out).toContain('Rolling window in IST — independent of your billing period, so these totals can differ from AI activity above.');
    expect(out).toMatch(/Top provider[\s\S]*Google[\s\S]*60% of credits/);
    expect(out).toMatch(/Most used[\s\S]*gemini-3\.7-flash[\s\S]*30 calls/);
    expect(out).toMatch(/Best value[\s\S]*deepseek-v4-flash[\s\S]*3\.33 credits a call/);
    expect(out).toMatch(/AI research[\s\S]*40 calls · 500 credits[\s\S]*7 searches/);
    expect(out).toMatch(/Dictation<\/span><span class="cu-feature-num">2 calls · free/);
    expect(out).toContain('Credits started on 14 Oct 2026; earlier calls show 0 credits.');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('changes measure and range', () => {
    const onMeasure = vi.fn();
    const onRange = vi.fn();
    const out = UsageAnalytics({ range: '30d', measure: 'credits', groupBy: 'model', rate: 0.1, state: { status: 'ready', summary: SUMMARY }, chart: null, onMeasure, onRange });
    const walk = (n, f = []) => { if (Array.isArray(n)) n.forEach((c) => walk(c, f)); else if (n?.props) { f.push(n); walk(n.props.children, f); } return f; };
    const all = walk(out);
    all.find((e) => e.type === 'button' && e.props.children === 'Calls').props.onClick();
    all.find((e) => e.type === 'select').props.onChange({ target: { value: 'lifetime' } });
    expect(onMeasure).toHaveBeenCalledWith('calls');
    expect(onRange).toHaveBeenCalledWith('lifetime');
  });

  it('says when loading or failed', () => {
    expect(html({ state: { status: 'loading', summary: null } })).toContain('Loading analytics');
    expect(html({ state: { status: 'error', summary: null } })).toContain('Analytics could not be loaded');
  });
});

describe('the small version in Plan & billing', () => {
  const html = (state) => renderToStaticMarkup(<UsageMini credits={CREDITS} state={state} onSeeUsage={vi.fn()} />);

  it('shows the four figures compactly, the top three models and a 30-day sparkline', () => {
    const out = html({ status: 'ready', summary: SUMMARY, points: POINTS });
    expect(out).toContain('class="cu-figs cu-figs-compact"');
    expect(out).toMatch(/Credits used[\s\S]*Credits left[\s\S]*Model calls[\s\S]*Tokens/);
    expect(out.match(/class="cu-top-row"/g)).toHaveLength(3);
    expect(out).toMatch(/<svg class="cu-spark"[^>]*role="img"[^>]*aria-label="Credits per day over the last 2 days: 300 credits in total"/);
    expect(out).toContain('See credits usage');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('opens the page', () => {
    const onSeeUsage = vi.fn();
    const tree = UsageMini({ credits: CREDITS, state: { status: 'ready', summary: SUMMARY, points: [] }, onSeeUsage });
    [tree.props.children].flat().find((c) => c?.type === 'button').props.onClick();
    expect(onSeeUsage).toHaveBeenCalledOnce();
  });

  it('says when loading or failed, and draws a flat line without usage', () => {
    expect(html({ status: 'loading' })).toContain('Loading usage');
    expect(html({ status: 'error' })).toContain('Usage could not be loaded');
    expect(renderToStaticMarkup(<Sparkline points={[]} />)).not.toContain('polyline');
  });
});

describe('the page', () => {
  it('renders sections A, B and D in a labelled full-screen dialog', () => {
    store.credits = CREDITS;
    const out = renderToStaticMarkup(<CreditsUsage user={{ id: 'u1' }} onClose={vi.fn()} />);
    expect(out).toMatch(/<div class="cu-root" role="dialog" aria-modal="true" aria-labelledby="cu-title">/);
    expect(out).toContain('<h2 id="cu-title">Credits usage</h2>');
    expect(out).toContain('AI activity');
    expect(out).toContain('AI analytics');
    expect(out).toContain('Credits by expiry');
    expect(out).toMatch(/Monthly[\s\S]*1,500 credits[\s\S]*Expires 14 Nov 2026/);
    expect(out).not.toContain('All AI activity');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('asks a signed-out visitor to sign in', () => {
    store.credits = null;
    expect(renderToStaticMarkup(<CreditsUsage user={null} onClose={vi.fn()} />)).toContain('Sign in to see your credits usage.');
  });

  it('offers every model either summary has seen in the activity filter, most credits first', () => {
    expect(filterModels({ byModel: [{ model: 'a/x', credits: 1 }, { model: 'unknown', credits: 9 }] }, { byModel: [{ model: 'b/y', credits: 5 }, { model: 'a/x', credits: 1 }] }, null))
      .toEqual(['b/y', 'a/x']);
  });
});
