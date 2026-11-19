// F362: the administrator's fact-check reports: the read, the three actions, and the state machine that makes every action
// wait for a confirmation. The database is a fake client; nothing here calls the network.
import { describe, expect, it, vi } from 'vitest';
import {
  ACTION_ERROR, LOAD_ERROR, REPORT_ACTIONS, createReportsController, loadReports, refundNotice, runReportAction, safeHttpUrl, shapeReportRows,
  shapeRefund,
} from './factcheckReports.js';

const raw = (over = {}) => ({
  claim_id: 'c-1', video_id: 'VIDEO000001', channel_id: 'chan-1', video_kind: 'recorded', claim_en: 'The bridge opened in 1990.',
  status: 'checked', verdict: 'contradicted', verdict_reason: 'It opened in 1994.',
  sources: [{ url: 'https://example.test/a', title: 'A' }], shared: true, hidden_at: null, report_count: 2,
  newest_report_at: '2026-11-18T10:00:00Z', report_reasons: ['wrong year', 'misleading'], ...over,
});
const payload = (rows, total = rows.length) => ({ total, rows });
const ok = (data) => Promise.resolve({ data, error: null });

/** A fake client: `answers` maps a function name to what its call returns (or a function of the args). */
function fakeClient(answers = {}) {
  const calls = [];
  return {
    calls,
    rpc: vi.fn((name, args) => {
      calls.push([name, args]);
      const a = answers[name];
      return typeof a === 'function' ? a(args) : a ?? ok(null);
    }),
  };
}

describe('shapeReportRows', () => {
  it('keeps the agreed fields under readable names', () => {
    const [row] = shapeReportRows([raw()]);
    expect(row).toMatchObject({
      claimId: 'c-1', videoId: 'VIDEO000001', channelId: 'chan-1', videoKind: 'recorded', claim: 'The bridge opened in 1990.',
      status: 'checked', verdict: 'contradicted', verdictReason: 'It opened in 1994.', shared: true, hiddenAt: null, reportCount: 2,
      newestReportAt: '2026-11-18T10:00:00Z', reasons: ['wrong year', 'misleading'],
    });
    expect(row.sources).toEqual([{ title: 'A', href: 'https://example.test/a' }]);
  });

  it('drops anything that identifies a person, even if the server sent it', () => {
    const [row] = shapeReportRows([raw({ user_id: 'u-1', reporter_id: 'u-2', email: 'a@b.test', session_id: 's-1', reported_by: 'x' })]);
    expect(Object.keys(row).sort()).toEqual([
      'channelId', 'claim', 'claimId', 'hiddenAt', 'newestReportAt', 'reasons', 'reportCount', 'shared', 'sources', 'status', 'verdict',
      'verdictReason', 'videoId', 'videoKind',
    ]);
    expect(JSON.stringify(row)).not.toMatch(/u-1|u-2|a@b\.test|s-1/);
  });

  it('caps the reasons at ten and keeps only text', () => {
    const many = Array.from({ length: 14 }, (_, i) => `r${i}`);
    expect(shapeReportRows([raw({ report_reasons: many })])[0].reasons).toEqual(many.slice(0, 10));
    expect(shapeReportRows([raw({ report_reasons: ['ok', 7, null, { a: 1 }, ''] })])[0].reasons).toEqual(['ok']);
  });

  it('turns a link that is not http or https into plain text', () => {
    const [row] = shapeReportRows([raw({
      sources: [{ url: 'javascript:alert(1)', title: 'Bad' }, { url: 'data:text/html,x', title: 'Data' }, { url: 'http://ok.test/x', title: 'Http' }, { url: 'not a url', title: '' }, 'junk'],
    })]);
    expect(row.sources).toEqual([
      { title: 'Bad', href: null }, { title: 'Data', href: null }, { title: 'Http', href: 'http://ok.test/x' }, { title: 'not a url', href: null },
    ]);
  });

  it('skips rows without a claim id and survives anything that is not a list', () => {
    expect(shapeReportRows([{ claim_en: 'no id' }, null, raw()]).map((r) => r.claimId)).toEqual(['c-1']);
    expect(shapeReportRows(undefined)).toEqual([]);
    expect(shapeReportRows('x')).toEqual([]);
  });
});

describe('safeHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(safeHttpUrl('https://a.test/x?y=1')).toBe('https://a.test/x?y=1');
    expect(safeHttpUrl('HTTP://a.test')).toBe('http://a.test/');
    for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:1', 'data:text/html,1', 'file:///etc/passwd', '//a.test', '/relative', '', null, 7]) {
      expect(safeHttpUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('loadReports', () => {
  it('asks for the page and shapes it', async () => {
    const client = fakeClient({ factcheck_reports_admin: ok(payload([raw()], 31)) });
    const result = await loadReports(client, { offset: 25, limit: 25 });
    expect(client.calls).toEqual([['factcheck_reports_admin', { p_offset: 25, p_limit: 25 }]]);
    expect(result).toMatchObject({ status: 'ready', total: 31 });
    expect(result.rows).toHaveLength(1);
  });

  it('is an empty ready state when nothing is reported', async () => {
    const result = await loadReports(fakeClient({ factcheck_reports_admin: ok(payload([], 0)) }), { offset: 0, limit: 25 });
    expect(result).toEqual({ status: 'ready', total: 0, rows: [] });
  });

  it('turns every failure into the fixed error, without the server text', async () => {
    const secret = 'permission denied for table factcheck_reports secret-detail';
    const cases = [
      fakeClient({ factcheck_reports_admin: Promise.resolve({ data: null, error: { code: '42501', message: secret } }) }),
      fakeClient({ factcheck_reports_admin: Promise.reject(new Error(secret)) }),
      fakeClient({ factcheck_reports_admin: () => { throw new Error(secret); } }),
      fakeClient({ factcheck_reports_admin: ok({ total: 'x', rows: 'nope' }) }),
      fakeClient({ factcheck_reports_admin: ok(null) }),
    ];
    for (const client of cases) {
      const result = await loadReports(client, { offset: 0, limit: 25 });
      expect(result).toEqual({ status: 'error' });
      expect(JSON.stringify(result)).not.toContain('secret-detail');
    }
    expect(LOAD_ERROR).not.toContain('secret-detail');
  });
});

describe('runReportAction', () => {
  const target = { claimId: 'c-1', videoId: 'VIDEO000001' };
  it('calls the matching database function with its one argument', async () => {
    const client = fakeClient({ factcheck_claim_hide: ok({ ok: true }), factcheck_report_dismiss: ok({ ok: true }), factcheck_video_remove: ok({ ok: true, pieces_deleted: 3, sessions: 1 }) });
    expect(await runReportAction(client, 'hide', target)).toEqual({ ok: true });
    expect(await runReportAction(client, 'dismiss', target)).toEqual({ ok: true });
    expect(await runReportAction(client, 'remove', target)).toEqual({ ok: true });
    expect(client.calls).toEqual([
      ['factcheck_claim_hide', { p_claim: 'c-1' }],
      ['factcheck_report_dismiss', { p_claim: 'c-1' }],
      ['factcheck_video_remove', { p_video_id: 'VIDEO000001' }],
    ]);
  });

  it('reads ok as a value: not_found and anything else but true is a failure', async () => {
    for (const data of [{ ok: false, reason: 'not_found' }, {}, null, 'ok', { ok: 'true' }, { ok: 1 }]) {
      const client = fakeClient({ factcheck_claim_hide: ok(data) });
      expect(await runReportAction(client, 'hide', target), JSON.stringify(data)).toEqual({ ok: false });
    }
  });

  it('turns a refusal or a thrown error into a failure with no server text', async () => {
    const secret = 'Platform administrators only secret-detail';
    for (const answer of [Promise.resolve({ data: null, error: { code: '42501', message: secret } }), Promise.reject(new Error(secret)), () => { throw new Error(secret); }]) {
      const result = await runReportAction(fakeClient({ factcheck_report_dismiss: answer }), 'dismiss', target);
      expect(result).toEqual({ ok: false });
    }
  });

  it('refuses an unknown action, or one without its argument, without calling the database', async () => {
    const client = fakeClient();
    expect(await runReportAction(client, 'purge', target)).toEqual({ ok: false });
    expect(await runReportAction(client, 'hide', { videoId: 'V' })).toEqual({ ok: false });
    expect(await runReportAction(client, 'remove', { claimId: 'c' })).toEqual({ ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(Object.keys(REPORT_ACTIONS).sort()).toEqual(['dismiss', 'hide', 'remove']);
  });
});

describe('the refund counts of a removal (F364)', () => {
  const target = { claimId: 'c-1', videoId: 'VIDEO000001' };
  it('passes the two counts through as numbers, for a removal only', async () => {
    const client = fakeClient({ factcheck_video_remove: ok({ ok: true, pieces_deleted: 3, sessions: 1, unlocks_refunded: 3, credits_refunded: 700 }), factcheck_claim_hide: ok({ ok: true, unlocks_refunded: 3, credits_refunded: 700 }) });
    expect(await runReportAction(client, 'remove', target)).toEqual({ ok: true, refund: { unlocks: 3, credits: 700 } });
    expect(await runReportAction(client, 'hide', target)).toEqual({ ok: true });
  });

  it('uses the counts only when both are finite, non-negative numbers (and the unlock count a whole number)', () => {
    expect(shapeRefund({ unlocks_refunded: 0, credits_refunded: 0 })).toEqual({ unlocks: 0, credits: 0 });
    expect(shapeRefund({ unlocks_refunded: 2, credits_refunded: 12.5 })).toEqual({ unlocks: 2, credits: 12.5 });
    for (const bad of [
      {}, null, { unlocks_refunded: 3 }, { credits_refunded: 3 }, { unlocks_refunded: '3', credits_refunded: 700 }, { unlocks_refunded: 3, credits_refunded: '700' },
      { unlocks_refunded: -1, credits_refunded: 5 }, { unlocks_refunded: 1, credits_refunded: -5 }, { unlocks_refunded: 1.5, credits_refunded: 5 },
      { unlocks_refunded: Infinity, credits_refunded: 5 }, { unlocks_refunded: 1, credits_refunded: NaN }, { unlocks_refunded: 1, credits_refunded: null },
      { unlocks_refunded: '<b>x</b>', credits_refunded: '<script>' },
    ]) expect(shapeRefund(bad)).toBeNull();
  });

  it('a removal answered by the old function (no counts) still succeeds, with no refund claim', async () => {
    const client = fakeClient({ factcheck_video_remove: ok({ ok: true, pieces_deleted: 3, sessions: 1 }) });
    expect(await runReportAction(client, 'remove', target)).toEqual({ ok: true });
  });

  it('the sentence is fixed words around the numbers, with the right singular and plural', () => {
    expect(refundNotice({ unlocks: 3, credits: 700 })).toBe('Video removed. 3 unlocks refunded, 700 credits returned to the users who paid.');
    expect(refundNotice({ unlocks: 1, credits: 1234.5 })).toBe('Video removed. 1 unlock refunded, 1,234.5 credits returned to the users who paid.');
    expect(refundNotice({ unlocks: 0, credits: 0 })).toBe('Video removed. No unlocks needed a refund.');
  });

  it('the controller shows the sentence after a good removal, keeps it through the reload, and clears it on the next question or page change', async () => {
    const rows = [raw()];
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(rows, 1)), factcheck_video_remove: ok({ ok: true, pieces_deleted: 3, sessions: 1, unlocks_refunded: 2, credits_refunded: 300 }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    expect(c.getState().notice).toBeNull();
    c.ask('c-1', 'remove');
    await c.confirm();
    expect(c.getState().notice).toBe('Video removed. 2 unlocks refunded, 300 credits returned to the users who paid.');
    expect(c.getState().status).toBe('ready');
    c.ask('c-1', 'dismiss');
    expect(c.getState().notice).toBeNull();
    c.cancel();
    c.ask('c-1', 'remove');
    await c.confirm();
    expect(c.getState().notice).not.toBeNull();
    await c.goTo(0);
    expect(c.getState().notice).toBeNull();
  });

  it('no sentence after a failed removal, after hide or dismiss, or when the server sent no counts', async () => {
    for (const [kind, answer] of [
      ['remove', ok({ ok: false, reason: 'not_found' })],
      ['remove', ok({ ok: true, pieces_deleted: 3, sessions: 1 })],
      ['remove', ok({ ok: true, unlocks_refunded: '3', credits_refunded: '700' })],
      ['hide', ok({ ok: true, unlocks_refunded: 3, credits_refunded: 700 })],
      ['dismiss', ok({ ok: true, unlocks_refunded: 3, credits_refunded: 700 })],
    ]) {
      const fn = { remove: 'factcheck_video_remove', hide: 'factcheck_claim_hide', dismiss: 'factcheck_report_dismiss' }[kind];
      const client = fakeClient({ factcheck_reports_admin: () => ok(payload([raw()], 1)), [fn]: answer });
      const c = createReportsController(client, { pageSize: 25 });
      await c.load();
      c.ask('c-1', kind);
      await c.confirm();
      expect(c.getState().notice).toBeNull();
    }
  });

  it('a refusal shows the fixed error and no sentence, and never any server text', async () => {
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload([raw()], 1)), factcheck_video_remove: Promise.resolve({ data: null, error: { message: 'Platform administrators only secret-detail' } }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    await c.confirm();
    expect(c.getState().notice).toBeNull();
    expect(c.getState().actionError.text).toBe(ACTION_ERROR);
    expect(JSON.stringify(c.getState())).not.toContain('secret-detail');
  });
});

describe('the controller: nothing runs before the second step', () => {
  const rows = [raw(), raw({ claim_id: 'c-2', video_id: 'VIDEO000002', hidden_at: '2026-11-18T09:00:00Z' })];
  const ready = (extra = {}) => fakeClient({ factcheck_reports_admin: () => ok(payload(rows, 2)), factcheck_claim_hide: ok({ ok: true }), factcheck_report_dismiss: ok({ ok: true }), factcheck_video_remove: ok({ ok: true }), ...extra });
  const mutating = (client) => client.calls.filter(([n]) => n !== 'factcheck_reports_admin');

  it('loads on start: loading, then the rows', async () => {
    const client = ready();
    const c = createReportsController(client, { pageSize: 25 });
    expect(c.getState().status).toBe('loading');
    await c.load();
    expect(c.getState()).toMatchObject({ status: 'ready', total: 2, offset: 0 });
    expect(c.getState().rows.map((r) => r.claimId)).toEqual(['c-1', 'c-2']);
    expect(client.calls[0]).toEqual(['factcheck_reports_admin', { p_offset: 0, p_limit: 25 }]);
  });

  it('shows the fixed error and retries', async () => {
    let fail = true;
    const client = ready({ factcheck_reports_admin: () => (fail ? Promise.resolve({ data: null, error: { message: 'boom secret-detail' } }) : ok(payload(rows, 2))) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    expect(c.getState()).toMatchObject({ status: 'error' });
    expect(JSON.stringify(c.getState())).not.toContain('secret-detail');
    fail = false;
    await c.load();
    expect(c.getState().status).toBe('ready');
  });

  for (const kind of ['hide', 'dismiss', 'remove']) {
    it(`${kind}: asking only opens the confirmation; the call happens on confirm`, async () => {
      const client = ready();
      const c = createReportsController(client, { pageSize: 25 });
      await c.load();
      c.ask('c-1', kind);
      expect(c.getState().pending).toEqual({ claimId: 'c-1', kind });
      expect(mutating(client)).toEqual([]);
      await c.confirm();
      const expected = { hide: ['factcheck_claim_hide', { p_claim: 'c-1' }], dismiss: ['factcheck_report_dismiss', { p_claim: 'c-1' }], remove: ['factcheck_video_remove', { p_video_id: 'VIDEO000001' }] }[kind];
      expect(mutating(client)).toEqual([expected]);
      expect(c.getState().pending).toBeNull();
    });
  }

  it('cancel closes the confirmation and calls nothing', async () => {
    const client = ready();
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    c.cancel();
    expect(c.getState().pending).toBeNull();
    await c.confirm();
    expect(mutating(client)).toEqual([]);
  });

  it('confirm with nothing pending does nothing; asking again replaces the earlier question', async () => {
    const client = ready();
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    await c.confirm();
    expect(mutating(client)).toEqual([]);
    c.ask('c-1', 'dismiss');
    c.ask('c-2', 'remove');
    expect(c.getState().pending).toEqual({ claimId: 'c-2', kind: 'remove' });
    await c.confirm();
    expect(mutating(client)).toEqual([['factcheck_video_remove', { p_video_id: 'VIDEO000002' }]]);
  });

  it('refuses to ask Hide on a claim that is already hidden', async () => {
    const client = ready();
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-2', 'hide');
    expect(c.getState().pending).toBeNull();
    await c.confirm();
    expect(mutating(client)).toEqual([]);
  });

  it('reloads the list after an action', async () => {
    const client = ready();
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    const before = client.calls.filter(([n]) => n === 'factcheck_reports_admin').length;
    c.ask('c-1', 'dismiss');
    await c.confirm();
    expect(client.calls.filter(([n]) => n === 'factcheck_reports_admin').length).toBe(before + 1);
  });

  it('shows the fixed action error when ok is false, keeps the list, and reads it again', async () => {
    const client = ready({ factcheck_claim_hide: ok({ ok: false, reason: 'not_found' }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    const loads = client.calls.length;
    c.ask('c-1', 'hide');
    await c.confirm();
    const s = c.getState();
    expect(s.actionError).toEqual({ claimId: 'c-1', text: ACTION_ERROR });
    expect(s.pending).toBeNull();
    expect(s.rows).toHaveLength(2);
    expect(client.calls.map(([n]) => n).slice(loads)).toEqual(['factcheck_claim_hide', 'factcheck_reports_admin']);
    expect(JSON.stringify(s)).not.toContain('not_found');
    c.ask('c-1', 'dismiss');
    expect(c.getState().actionError).toBeNull();
  });

  it('shows the action error, without server text, when the call is refused or throws', async () => {
    const client = ready({ factcheck_video_remove: Promise.reject(new Error('Platform administrators only secret-detail')) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    await c.confirm();
    expect(c.getState().actionError).toEqual({ claimId: 'c-1', text: ACTION_ERROR });
    expect(JSON.stringify(c.getState())).not.toContain('secret-detail');
  });

  it('ignores a second confirm while the first is running', async () => {
    let release;
    const client = ready({ factcheck_report_dismiss: () => new Promise((r) => { release = () => r({ data: { ok: true }, error: null }); }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'dismiss');
    const first = c.confirm();
    const second = c.confirm();
    expect(c.getState().busy).toBe(true);
    release();
    await Promise.all([first, second]);
    expect(client.calls.filter(([n]) => n === 'factcheck_report_dismiss')).toHaveLength(1);
    expect(c.getState().busy).toBe(false);
  });

  it('pages: next and previous change the offset, and a page emptied by an action steps back', async () => {
    const page2 = [raw({ claim_id: 'c-30' })];
    const client = ready({
      factcheck_reports_admin: ({ p_offset }) => ok(p_offset === 0 ? payload(rows, 26) : payload(page2, 26)),
    });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    await c.goTo(25);
    expect(c.getState()).toMatchObject({ offset: 25, total: 26 });
    expect(c.getState().rows.map((r) => r.claimId)).toEqual(['c-30']);
    // the only claim on page 2 is dismissed: the list is now one page of 25
    client.rpc.mockImplementation((name, args) => {
      client.calls.push([name, args]);
      if (name === 'factcheck_reports_admin') return ok(args.p_offset === 0 ? payload(rows, 25) : payload([], 25));
      return ok({ ok: true });
    });
    c.ask('c-30', 'dismiss');
    await c.confirm();
    expect(c.getState()).toMatchObject({ offset: 0, status: 'ready' });
    expect(c.getState().rows).toHaveLength(2);
  });

  it('drops an answer that arrives after a newer request', async () => {
    const resolvers = [];
    const client = fakeClient({ factcheck_reports_admin: () => new Promise((r) => resolvers.push(r)) });
    const c = createReportsController(client, { pageSize: 25 });
    const first = c.load();
    const second = c.load();
    resolvers[1]({ data: payload([raw({ claim_id: 'new' })]), error: null });
    await second;
    resolvers[0]({ data: payload([raw({ claim_id: 'old' })]), error: null });
    await first;
    expect(c.getState().rows.map((r) => r.claimId)).toEqual(['new']);
  });

  it('tells subscribers about every change, and stops after unsubscribe', async () => {
    const c = createReportsController(ready(), { pageSize: 25 });
    const seen = vi.fn();
    const off = c.subscribe(seen);
    await c.load();
    expect(seen).toHaveBeenCalled();
    off();
    seen.mockClear();
    c.ask('c-1', 'hide');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('the controller: stale questions and failed actions', () => {
  const rows = [raw(), raw({ claim_id: 'c-2', video_id: 'VIDEO000002' })];
  const mutating = (client) => client.calls.filter(([n]) => n !== 'factcheck_reports_admin');

  it('closes an open confirmation when the page changes', async () => {
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(rows, 40)) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    await c.goTo(25);
    expect(c.getState()).toMatchObject({ pending: null, offset: 25 });
    await c.confirm();
    expect(mutating(client)).toEqual([]);
  });

  it('closes the confirmation and the action error when a page change follows a failed action', async () => {
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(rows, 40)), factcheck_report_dismiss: ok({ ok: false }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'dismiss');
    await c.confirm();
    expect(c.getState().actionError).not.toBeNull();
    await c.goTo(25);
    expect(c.getState().actionError).toBeNull();
  });

  it('keeps the action error on its claim through the re-read that follows a failed action', async () => {
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(rows, 2)), factcheck_claim_hide: ok({ ok: false, reason: 'not_found' }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'hide');
    await c.confirm();
    expect(c.getState()).toMatchObject({ status: 'ready', actionError: { claimId: 'c-1', text: ACTION_ERROR } });
    expect(client.calls.filter(([n]) => n === 'factcheck_reports_admin')).toHaveLength(2);
  });

  it('asks the question about one claim, and runs it on that claim after the list is reordered', async () => {
    let order = rows;
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(order, 2)), factcheck_video_remove: ok({ ok: true }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    order = [rows[1], rows[0]];
    await c.load();
    expect(c.getState().rows.map((r) => r.claimId)).toEqual(['c-2', 'c-1']);
    expect(c.getState().pending).toEqual({ claimId: 'c-1', kind: 'remove' });
    await c.confirm();
    expect(mutating(client)).toEqual([['factcheck_video_remove', { p_video_id: 'VIDEO000001' }]]);
  });

  it('runs nothing, and says so, when the claim asked about is gone after a reload', async () => {
    let order = rows;
    const client = fakeClient({ factcheck_reports_admin: () => ok(payload(order, order.length)), factcheck_video_remove: ok({ ok: true }) });
    const c = createReportsController(client, { pageSize: 25 });
    await c.load();
    c.ask('c-1', 'remove');
    order = [rows[1]];
    await c.load();
    await c.confirm();
    expect(mutating(client)).toEqual([]);
    expect(c.getState()).toMatchObject({ pending: null, actionError: { claimId: 'c-1', text: ACTION_ERROR } });
  });
});
