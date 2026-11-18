// F362: the "Fact-check reports" screen. The view is a plain function of the controller's state, so every state is rendered
// without a browser; the clicks are made by finding the button in the element tree and calling its handler, wired to the real
// controller over a fake database client.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));

import { ReportsView } from './FactcheckReportsPage.jsx';
import { ACTION_ERROR, LOAD_ERROR, createReportsController } from './factcheckReports.js';

const raw = (over = {}) => ({
  claim_id: 'c-1', video_id: 'VIDEO000001', channel_id: 'chan-1', video_kind: 'recorded', claim_en: 'The bridge opened in 1990.',
  status: 'checked', verdict: 'contradicted', verdict_reason: 'It opened in 1994.',
  sources: [{ url: 'https://example.test/a', title: 'Source A' }], shared: true, hidden_at: null, report_count: 2,
  newest_report_at: '2026-11-18T10:05:00Z', report_reasons: ['wrong year', 'misleading'], ...over,
});
const HIDDEN = raw({ claim_id: 'c-2', video_id: 'VIDEO000002', claim_en: 'Hidden claim text', hidden_at: '2026-11-18T09:00:00Z', report_count: 1, report_reasons: ['abuse'] });
const ok = (data) => Promise.resolve({ data, error: null });

function fakeClient(rows = [raw(), HIDDEN], extra = {}) {
  const calls = [];
  return {
    calls,
    rpc: vi.fn((name, args) => {
      calls.push([name, args]);
      if (name === 'factcheck_reports_admin') return ok({ total: rows.length, rows });
      return extra[name] ?? ok({ ok: true });
    }),
  };
}

// The view wired to a controller, as the page does: handlers call the controller.
function wired(client) {
  const ctl = createReportsController(client, { pageSize: 25 });
  const handlers = () => ({
    onAsk: ctl.ask, onCancel: ctl.cancel, onConfirm: () => ctl.confirm(), onRetry: () => ctl.load(), onPage: (o) => ctl.goTo(o),
  });
  return { ctl, tree: () => ReportsView({ state: ctl.getState(), ...handlers() }), markup: () => renderToStaticMarkup(createElement(ReportsView, { state: ctl.getState(), ...handlers() })) };
}

function nodes(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => nodes(n, predicate, out)); return out; }
  if (predicate(node)) out.push(node);
  nodes(node.props?.children, predicate, out);
  return out;
}
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const buttons = (tree, label) => nodes(tree, (n) => n.type === 'button' && (typeof label === 'string' ? text(n).includes(label) : label.test(text(n))));
const card = (tree, claimId) => nodes(tree, (n) => n.type === 'li' && n.key === claimId)[0];

const idle = (over = {}) => ({ status: 'ready', rows: [], total: 0, offset: 0, pageSize: 25, pending: null, busy: false, actionError: null, ...over });
const render = (state) => renderToStaticMarkup(createElement(ReportsView, { state, onAsk() {}, onCancel() {}, onConfirm() {}, onRetry() {}, onPage() {} }));

describe('the states', () => {
  it('names the page, and says it is loading', () => {
    const markup = render(idle({ status: 'loading' }));
    expect(markup).toMatch(/<h1[^>]*>Fact-check reports<\/h1>/);
    expect(markup).toMatch(/Loading reports/);
    expect(markup).not.toMatch(/No open reports/);
  });

  it('says "No open reports." when there are none', () => {
    expect(render(idle())).toContain('No open reports.');
  });

  it('shows a fixed error as an alert with a Try again button, and no server text', () => {
    const markup = render(idle({ status: 'error', message: 'permission denied secret-detail', detail: 'secret-detail' }));
    expect(markup).toMatch(/role="alert"/);
    expect(markup).toContain(LOAD_ERROR);
    expect(markup).toMatch(/>Try again</);
    expect(markup).not.toContain('secret-detail');
  });

  it('Try again reads the list again', () => {
    const onRetry = vi.fn();
    const tree = ReportsView({ state: idle({ status: 'error' }), onRetry, onAsk() {}, onCancel() {}, onConfirm() {}, onPage() {} });
    buttons(tree, 'Try again')[0].props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the action error on the claim it belongs to, as an alert', async () => {
    const client = fakeClient([raw(), HIDDEN], { factcheck_report_dismiss: ok({ ok: false, reason: 'not_found' }) });
    const { ctl, markup } = wired(client);
    await ctl.load();
    ctl.ask('c-1', 'dismiss');
    await ctl.confirm();
    const html = markup();
    expect(html).toContain(ACTION_ERROR);
    expect(html).toMatch(/role="alert"[^>]*>[^<]*That did not work/);
    expect(html).not.toContain('not_found');
    expect(html.split(ACTION_ERROR).length - 1).toBe(1);
  });
});

describe('a claim', () => {
  it('shows its fields', async () => {
    const { ctl, markup } = wired(fakeClient());
    await ctl.load();
    const html = markup();
    for (const t of ['The bridge opened in 1990.', 'VIDEO000001', 'chan-1', 'Contradicted', 'It opened in 1994.', 'Source A', '2 open reports', 'wrong year', 'misleading', '2026-11-18 10:05 UTC']) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('href="https://example.test/a"');
    expect(html).toMatch(/Shared/);
    expect(html).toContain('1 open report<');
  });

  it('offers all three actions, with their wording', async () => {
    const { ctl, tree } = wired(fakeClient());
    await ctl.load();
    const mine = card(tree(), 'c-1');
    expect(buttons(mine, 'Hide claim')).toHaveLength(1);
    expect(buttons(mine, 'Dismiss reports')).toHaveLength(1);
    expect(buttons(mine, "Remove this video's shared results")).toHaveLength(1);
  });

  it('does not offer Hide on a claim that is already hidden, and marks it Hidden', async () => {
    const { ctl, tree, markup } = wired(fakeClient());
    await ctl.load();
    const hidden = card(tree(), 'c-2');
    expect(buttons(hidden, 'Hide claim')).toHaveLength(0);
    expect(buttons(hidden, 'Dismiss reports')).toHaveLength(1);
    expect(buttons(hidden, "Remove this video's shared results")).toHaveLength(1);
    const pill = (c) => nodes(c, (n) => n.type === 'span' && text(n) === 'Hidden');
    expect(pill(hidden)).toHaveLength(1);
    expect(pill(card(tree(), 'c-1'))).toHaveLength(0);
    expect(markup()).toContain('Hidden claim text');
  });
});

describe('the confirmations', () => {
  const cases = [
    ['Hide claim', 'hide', ['factcheck_claim_hide', { p_claim: 'c-1' }], /Hide this claim\?/],
    ['Dismiss reports', 'dismiss', ['factcheck_report_dismiss', { p_claim: 'c-1' }], /Dismiss the open reports/],
    ["Remove this video's shared results", 'remove', ['factcheck_video_remove', { p_video_id: 'VIDEO000001' }], /Remove all shared results of video VIDEO000001\?/],
  ];
  for (const [label, kind, call, wording] of cases) {
    it(`${kind}: the first click asks, only the second runs it`, async () => {
      const client = fakeClient();
      const { ctl, tree, markup } = wired(client);
      await ctl.load();
      const acts = () => client.calls.filter(([n]) => n !== 'factcheck_reports_admin');
      buttons(card(tree(), 'c-1'), label)[0].props.onClick();
      expect(acts()).toEqual([]);
      expect(markup()).toMatch(wording);
      const yes = buttons(card(tree(), 'c-1'), /^Yes/);
      expect(yes).toHaveLength(1);
      await yes[0].props.onClick();
      expect(acts()).toEqual([call]);
    });
  }

  it('cancel closes it and calls nothing', async () => {
    const client = fakeClient();
    const { ctl, tree, markup } = wired(client);
    await ctl.load();
    buttons(card(tree(), 'c-1'), 'Dismiss reports')[0].props.onClick();
    buttons(card(tree(), 'c-1'), 'Cancel')[0].props.onClick();
    expect(client.calls.filter(([n]) => n !== 'factcheck_reports_admin')).toEqual([]);
    expect(markup()).not.toMatch(/Dismiss the open reports/);
    expect(buttons(card(tree(), 'c-1'), 'Dismiss reports')).toHaveLength(1);
  });

  it('the remove confirmation names the video, says it cannot be undone and that its reports stay open', async () => {
    const { ctl, tree } = wired(fakeClient());
    await ctl.load();
    buttons(card(tree(), 'c-2'), "Remove this video's shared results")[0].props.onClick();
    const words = text(card(tree(), 'c-2'));
    expect(words).toContain('VIDEO000002');
    expect(words).toMatch(/deletes the stored transcript of every session of this video, for every user/i);
    expect(words).toMatch(/stops sharing all of them/i);
    expect(words).toMatch(/paid to unlock these results lose access and are not refunded/i);
    expect(words).toMatch(/cannot be undone/i);
    expect(words).toMatch(/this video's reports stay open until dismissed/i);
  });

  it('opens one confirmation at a time and marks it for assistive technology', async () => {
    const { ctl, tree, markup } = wired(fakeClient());
    await ctl.load();
    buttons(card(tree(), 'c-1'), 'Dismiss reports')[0].props.onClick();
    buttons(card(tree(), 'c-2'), 'Dismiss reports')[0].props.onClick();
    expect(nodes(tree(), (n) => n.props?.['data-confirm-for']).map((n) => n.props['data-confirm-for'])).toEqual(['c-2']);
    expect(markup()).toMatch(/role="group"/);
    expect(markup()).toMatch(/aria-labelledby="fcr-confirm-c-2"/);
  });

  it('the list is read again after an action', async () => {
    const client = fakeClient();
    const { ctl, tree } = wired(client);
    await ctl.load();
    const before = client.calls.filter(([n]) => n === 'factcheck_reports_admin').length;
    buttons(card(tree(), 'c-1'), 'Dismiss reports')[0].props.onClick();
    await buttons(card(tree(), 'c-1'), /^Yes/)[0].props.onClick();
    expect(client.calls.filter(([n]) => n === 'factcheck_reports_admin').length).toBe(before + 1);
  });
});

describe('a question whose claim has left the list', () => {
  it('shows the fixed error at the top of the page, as an alert, once', () => {
    const html = render(idle({ rows: [{ claimId: 'c-9', claim: 'Other', videoId: 'V9', channelId: '', videoKind: '', status: 'checked', verdict: null, verdictReason: '', sources: [], shared: true, hiddenAt: null, reportCount: 1, newestReportAt: null, reasons: [] }], total: 1, actionError: { claimId: 'gone', text: ACTION_ERROR } }));
    expect(html.split(ACTION_ERROR).length - 1).toBe(1);
    expect(html).toMatch(/role="alert"[^>]*>[^<]*That did not work/);
  });
});

describe('text from outside is shown as text', () => {
  const nasty = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  it('escapes markup in a reason and in the claim text', async () => {
    const { ctl, markup } = wired(fakeClient([raw({ report_reasons: [nasty], claim_en: nasty, verdict_reason: nasty })]));
    await ctl.load();
    const html = markup();
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('makes a link only of an http or https address', async () => {
    const sources = [
      { url: 'javascript:alert(1)', title: 'Script link' }, { url: 'data:text/html,x', title: 'Data link' },
      { url: 'https://ok.test/p', title: 'Good link' }, { url: 'http://plain.test/p', title: 'Plain link' },
    ];
    const { ctl, markup, tree } = wired(fakeClient([raw({ sources })]));
    await ctl.load();
    const html = markup();
    expect(html).not.toMatch(/href="javascript|href="data/i);
    expect(html).toContain('Script link');
    expect(html).toContain('Data link');
    const hrefs = nodes(tree(), (n) => n.type === 'a').map((n) => n.props.href);
    expect(hrefs).toEqual(['https://ok.test/p', 'http://plain.test/p']);
    for (const a of nodes(tree(), (n) => n.type === 'a')) expect(a.props.rel).toMatch(/noopener/);
  });
});

describe('paging', () => {
  it('shows no pager for one page, and Next / Previous for several', () => {
    expect(render(idle({ rows: [], total: 0 }))).not.toMatch(/Next/);
    const rows = [];
    const many = idle({ rows, total: 60, offset: 25 });
    const onPage = vi.fn();
    const tree = ReportsView({ state: many, onPage, onAsk() {}, onCancel() {}, onConfirm() {}, onRetry() {} });
    expect(text(tree)).toContain('26–50 of 60');
    buttons(tree, 'Next')[0].props.onClick();
    buttons(tree, 'Previous')[0].props.onClick();
    expect(onPage.mock.calls).toEqual([[50], [0]]);
  });
});
