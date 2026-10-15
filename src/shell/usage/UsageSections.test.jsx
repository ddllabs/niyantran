// F184: the credits page - its side menu, sections and status bar - with the Overview's figures and
// pictures, and F153's AI analytics (now the Usage section), all in credits only and never a dollar.
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
import { periodLine } from '../../lib/creditsVisual.js';
import CreditsPage, { SECTION_PARTS, filterModels } from '../credits/CreditsPage.jsx';
import OverviewSection from '../credits/OverviewSection.jsx';
import { UsageHeatmap } from '../credits/CreditsVisuals.jsx';
import UsageAnalytics from './UsageAnalytics.jsx';

const CREDITS = {
  userId: 'u1', balance: 1500, held: 0, available: 1500, debt: 0, plan: 'plus', allowance: 2000,
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

describe('the Overview', () => {
  const html = (over = {}) => renderToStaticMarkup(
    <OverviewSection credits={CREDITS} cycle={{ status: 'ready', summary: SUMMARY }} series={{ status: 'ready', points: POINTS }}
      recent={{ status: 'ready', rows: [{ turnKey: 't1', createdAt: '2026-10-14T06:30:00Z', conversationId: 'c1', title: 'Rate cut', question: 'What did the RBI do?', status: 'succeeded', model: 'google/gemini-3.7-flash', calls: 3, tokens: 3310, credits: 47.5, detail: [] }] }}
      onOpenChat={vi.fn()} now={Date.parse('2026-10-20T06:30:00Z')} {...over} />,
  );

  it('names the billing period, or the sign-up credits on Free', () => {
    expect(periodLine(CREDITS)).toBe('Billing period · 14 Oct 2026 – 14 Nov 2026 · renews 14 Nov 2026');
    expect(periodLine({ ...CREDITS, plan: 'free' })).toBe('Sign-up credits · valid until 14 Nov 2026');
  });

  it('leads with what is left, the period bar, this period\'s figures and the lifetime spend', () => {
    const out = html();
    expect(out).toMatch(/<h3 id="cp-left-title" class="cp-big">1,500<span class="cu-sr"> credits left<\/span><\/h3>/);
    expect(out).toContain('credits left of 2,000 this period');
    expect(out).toContain('25 days to renewal');
    expect(out).toContain('aria-label="Used 500, Monthly left 1,500"');
    expect(out).toMatch(/Model calls this period<\/dt><dd>42<span class="cp-dim"> · 3 failed/);
    expect(out).toContain('title="22,70,000 tokens"');
    expect(out).toContain('Lifetime spend</dt><dd>813 credits');
    expect(out).not.toContain('₹');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('draws the pace, where the credits went with readable names, the latest answers and the lots', () => {
    const out = html();
    expect(out).toMatch(/<svg viewBox="0 0 640 210" class="cp-pace-svg" role="img" aria-label="Used 500 credits of 2,000 credits so far this period/);
    expect(out).toContain('Gemini 3.7 Flash');
    expect(out).toContain('Claude Sonnet 5');
    expect(out).not.toContain('Text Embedding');
    expect(out).toContain('Including 35 credits for 7 web searches.');
    expect(out).toContain('>What did the RBI do?</button>');
    expect(out).toMatch(/Monthly[\s\S]*1,500 credits[\s\S]*Expires 14 Nov 2026/);
  });

  it('labels lifetime figures as such when no period is open, and shows the pace note instead of loading (review)', () => {
    const out = html({ credits: { ...CREDITS, cycleStartsAt: null, cycleEndsAt: null }, series: { status: 'idle', points: [] } });
    expect(out).toContain('No credits period is open · lifetime figures');
    expect(out).toContain('Model calls so far</dt>');
    expect(out).toContain('Where your credits went so far');
    expect(out).not.toContain('Loading the pace');
    expect(out).toContain('The pace appears once a billing period is open.');
  });

  it('says sign-up credits expire rather than renew (review)', () => {
    const out = html({ credits: { ...CREDITS, plan: 'free' } });
    expect(out).toContain('25 days until they expire');
    expect(out).not.toContain('renewal');
  });

  it('says when its parts are loading or could not load', () => {
    expect(html({ cycle: { status: 'error', summary: null } })).toContain('usage could not be loaded just now.');
    expect(html({ series: { status: 'loading', points: [] } })).toContain('Loading the pace');
    expect(html({ recent: { status: 'error', rows: [] } })).toContain('Your latest answers could not be loaded just now.');
    expect(renderToStaticMarkup(<OverviewSection credits={null} creditsFailed cycle={{}} series={{}} recent={{}} />)).toContain('Your credits could not be loaded just now.');
  });
});

describe('B. AI analytics', () => {
  const html = (over = {}) => renderToStaticMarkup(
    <UsageAnalytics range="30d" measure="credits" groupBy="model"
      state={{ status: 'ready', summary: SUMMARY, series: { bucket: 'day', points: POINTS }, window: { from: '2026-09-14T18:30:00.000Z', to: '2026-10-14T10:00:00.000Z' } }}
      chart={buildChart(POINTS)} onRange={vi.fn()} onMeasure={vi.fn()} onGroupBy={vi.fn()} onToggle={vi.fn()} {...over} />,
  );

  it('shows the range, the measure tabs and the range menu', () => {
    const out = html();
    expect(out).toMatch(/Usage by model · Last 30 days · 15 Sept? 2026 – 14 Oct 2026/);
    expect(out).toMatch(/<button type="button" aria-pressed="true" class="on">Credits<\/button><button type="button" aria-pressed="false" class="">Tokens/);
    expect(out).toContain('<option value="lifetime">Lifetime (by month)</option>');
  });

  it('shows the five figures, the IST caption, highlights and features, in credits only (F184)', () => {
    const out = html();
    expect(out).toMatch(/Credits spent[\s\S]*500/);
    expect(out).not.toContain('₹');
    expect(out).toMatch(/Model calls<\/span><span class="cu-fig-value">42<\/span><span class="cu-fig-sub">3 failed/);
    expect(out).toMatch(/Models used<\/span><span class="cu-fig-value">4<\/span><span class="cu-fig-sub">3 providers/);
    expect(out).toMatch(/Web searches<\/span><span class="cu-fig-value">7<\/span><span class="cu-fig-sub">35 credits</);
    expect(out).toContain('Rolling window in IST — independent of your billing period, so these totals can differ from the Overview.');
    expect(out).toMatch(/Top provider[\s\S]*Google[\s\S]*60% of credits/);
    expect(out).toMatch(/Most used[\s\S]*Gemini 3\.7 Flash[\s\S]*30 calls/);
    expect(out).toMatch(/Best value[\s\S]*DeepSeek V4 Flash[\s\S]*3\.33 credits a call/);
    // By feature: an icon per row, what it did, its credits and share; dictation is free (owner, 2026-10-15).
    expect(out).toMatch(/<span class="cu-feature-icon cu-feature-research" aria-hidden="true"><svg[\s\S]*?<span class="cu-feature-name">AI research<\/span><span class="cu-feature-sub">40 calls · 7 searches<\/span><\/span><span class="cu-feature-num">500 credits<span class="cu-feature-share">100%<\/span>/);
    expect(out).toMatch(/<span class="cu-feature-name">Dictation<\/span><span class="cu-feature-sub">2 calls<\/span><\/span><span class="cu-feature-free">Free<\/span>/);
    expect(out).toContain('Credits started on 14 Oct 2026; earlier calls show 0 credits.');
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('changes measure and range', () => {
    const onMeasure = vi.fn();
    const onRange = vi.fn();
    const out = UsageAnalytics({ range: '30d', measure: 'credits', groupBy: 'model', state: { status: 'ready', summary: SUMMARY }, chart: null, onMeasure, onRange });
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

describe('the page', () => {
  it('has a side menu: a balance card, the four sections with the open one marked, and its parts as links', () => {
    store.credits = CREDITS;
    const out = renderToStaticMarkup(<CreditsPage section="usage" user={{ id: 'u1' }} ent={{ plan: 'plus', status: 'active' }} />);
    expect(out).toMatch(/<nav class="cp-menu" aria-label="Credits">/);
    expect(out).toMatch(/<p class="cp-balance-num">1,500<\/p><p class="cp-dim">credits left<\/p>/);
    expect(out).toMatch(/href="#\/account\/credits" class="cp-menu-item">Overview<\/a>[\s\S]*href="#\/account\/usage" class="cp-menu-item on" aria-current="page">Usage<\/a>[\s\S]*href="#\/account\/activity"[\s\S]*href="#\/account\/billing" class="cp-menu-item">Plan and invoices<\/a>/);
    expect(out).toMatch(/<button type="button">Chart and legend<\/button>[\s\S]*<button type="button">Daily use<\/button>/);
    expect(out).toContain('<h2 id="cp-section-title" class="cp-title" tabindex="-1">Usage</h2>');
    expect(out).toContain('Where did my credits go?');
    expect(out).toContain('AI analytics');
    expect(out).toContain('<div id="cp-heat">');
    expect(out).not.toMatch(/role="dialog"|aria-modal/);
    expect(out).not.toMatch(NO_DOLLAR);
  });

  it('points every menu part at an element the section renders', () => {
    expect(SECTION_PARTS.credits.map(([id]) => id)).toEqual(['cp-left-title', 'cp-pace-title', 'cp-where-title', 'cp-recent-title', 'cp-lots-title']);
    expect(SECTION_PARTS.usage.map(([id]) => id)).toEqual(['cu-analytics-title', 'cp-heat', 'cu-highlights']);
    expect(SECTION_PARTS.billing.map(([id]) => id)).toEqual(['plan-billing-title', 'plan-change-title', 'plan-invoices-title']);
  });

  it('shows the status bar above the section', () => {
    store.credits = { ...CREDITS, balance: 150, available: 150 };
    const out = renderToStaticMarkup(<CreditsPage section="credits" user={{ id: 'u1' }} ent={{ plan: 'plus', status: 'active' }} />);
    expect(out).toMatch(/<p class="cp-status-msg cp-tone-warn" role="status"><span>Running low: 150 credits left this cycle.<\/span><button type="button" class="cp-link">See plans<\/button><\/p>/);
  });

  it('asks a signed-out visitor to sign in', () => {
    store.credits = null;
    expect(renderToStaticMarkup(<CreditsPage user={null} />)).toContain('Sign in to see your credits.');
  });

  it('offers every model either summary has seen in the activity filter, most credits first', () => {
    expect(filterModels({ byModel: [{ model: 'a/x', credits: 1 }, { model: 'unknown', credits: 9 }] }, { byModel: [{ model: 'b/y', credits: 5 }, { model: 'a/x', credits: 1 }] }, null))
      .toEqual(['b/y', 'a/x']);
  });
});

describe('the 90-day heat map', () => {
  it('draws real grid rows, oldest day first, with each day named, and five shades', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const out = renderToStaticMarkup(<UsageHeatmap points={[{ bucket: '2026-10-24', credits: 160 }, { bucket: '2026-10-20', credits: 40 }]} now={now} columns={45} />);
    expect(out.match(/role="row"/g)).toHaveLength(2);
    expect(out.match(/role="gridcell"/g)).toHaveLength(90);
    expect(out).toMatch(/<div role="row" class="cp-heat-row"><span id="cp-heat-0" role="gridcell" class="cp-heat-cell cp-lv0" aria-label="27 Jul: 0 credits, no use"/);
    expect(out).toContain('id="cp-heat-89" role="gridcell" class="cp-heat-cell cp-lv4 on" aria-label="24 Oct: 160 credits, busiest"');
    expect(out).toContain('Busiest: 24 Oct, 160 credits');
    expect(renderToStaticMarkup(<UsageHeatmap points={[]} now={now} columns={30} />).match(/role="row"/g)).toHaveLength(3);
  });
});
