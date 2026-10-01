// Admin Documents tab (R8, plan B4): the upload summary and confirm gate, the
// duplicate warning that holds back every byte until the admin chooses, and the
// jobs table with its actions by status. The usersPage.test.jsx technique:
// renderToStaticMarkup and a walk of the element tree; corpusUpload.js is mocked,
// so nothing here reads a PDF or touches the network.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  pairs: [
    { tier: 'global', feature: 'Treaties' },
    { tier: 'national', feature: 'Cabinet Decisions' },
    { tier: 'national', feature: 'Union Budget' },
    { tier: 'state', feature: 'Cabinet Decisions' },
  ],
}));
vi.mock('../lib/corpusUpload.js', () => ({
  deskPairs: () => fixtures.pairs,
  planUpload: vi.fn(),
  uploadPlan: vi.fn(),
  createAdminIngestApi: vi.fn(() => ({ jobs: vi.fn(async () => ({ ok: true, jobs: [], next_before: null })) })),
}));

import DocumentsPage, {
  DuplicateWarning,
  JobsTable,
  PartProgress,
  PlanSummary,
  UploadForm,
  askDuplicates,
  deskGroups,
  describeResult,
  formatMB,
  formatUsd,
  jobActions,
  mergeJobs,
  metaFromDraft,
  relativeTime,
  shouldPoll,
  titleFromFileName,
  uploadFile,
  validateDraft,
} from './DocumentsPage.jsx';

const NOW = Date.parse('2026-10-01T12:00:00Z');

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, predicate); if (hit) return hit; }
    return null;
  }
  if (predicate(node)) return node;
  if (typeof node.type === 'function') return find(node.type(node.props), predicate);
  return find(node.props?.children, predicate);
}
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
};
const button = (tree, label) => find(tree, (n) => n.type === 'button' && textOf(n) === label);
const buttonTag = (markup, label) => markup.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? null;

const PLAN = {
  file_name: 'Budget at a Glance.pdf',
  file_sha256: 'a'.repeat(64),
  page_count: 25,
  encrypted: false,
  estimated_usd: 0.1,
  parts: [
    { part_index: 0, page_offset: 0, page_count: 10, sha256: 'b'.repeat(64), byte_size: 500_000 },
    { part_index: 1, page_offset: 10, page_count: 10, sha256: 'c'.repeat(64), byte_size: 450_000 },
    { part_index: 2, page_offset: 20, page_count: 5, sha256: 'd'.repeat(64), byte_size: 300_000 },
  ],
};
const DRAFT = { title: 'Budget at a Glance', desk: 'national|Union Budget', file_url: '', note: '', splitEvery: '' };

beforeEach(() => vi.clearAllMocks());

// ─── Formatting ──────────────────────────────────────────────────────────────

describe('formatting helpers', () => {
  it('shows megabytes in decimal units, two places under 10 MB and one above', () => {
    expect(formatMB(1_250_000)).toBe('1.25 MB');
    expect(formatMB(52_400_000)).toBe('52.4 MB');
    expect(formatMB(0)).toBe('0.00 MB');
  });

  it('shows dollars to four places', () => {
    expect(formatUsd(0.1)).toBe('$0.1000');
    expect(formatUsd(0.01234)).toBe('$0.0123');
    expect(formatUsd(null)).toBe('$0.0000');
  });

  it('says how far a time is from now, both ways', () => {
    expect(relativeTime('2026-10-01T12:00:30Z', NOW)).toBe('in 30 s');
    expect(relativeTime('2026-10-01T12:05:00Z', NOW)).toBe('in 5 min');
    expect(relativeTime('2026-10-01T11:57:00Z', NOW)).toBe('3 min ago');
    expect(relativeTime('2026-10-01T09:00:00Z', NOW)).toBe('3 h ago');
    expect(relativeTime('2026-09-28T12:00:00Z', NOW)).toBe('3 d ago');
    expect(relativeTime('2026-10-01T11:59:58Z', NOW)).toBe('just now');
    expect(relativeTime(null, NOW)).toBe('—');
  });

  it('takes the title from the file name without .pdf', () => {
    expect(titleFromFileName('Budget at a Glance.pdf')).toBe('Budget at a Glance');
    expect(titleFromFileName('REPORT.PDF')).toBe('REPORT');
    expect(titleFromFileName('notes')).toBe('notes');
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

describe('PlanSummary', () => {
  it('shows pages, parts, size and the OCR-only estimate', () => {
    const markup = renderToStaticMarkup(createElement(PlanSummary, { plan: PLAN, fileBytes: 1_250_000 }));
    expect(markup).toContain('25 pages');
    expect(markup).toContain('3 parts');
    expect(markup).toContain('1.25 MB');
    expect(markup).toContain('$0.1000');
    expect(markup).toContain('OCR only; embedding adds under 1 %');
    expect(markup).not.toContain('Encrypted');
  });

  it('flags an encrypted file and says one part for a whole file', () => {
    const plan = { ...PLAN, page_count: 1, encrypted: true, parts: [PLAN.parts[0]] };
    const markup = renderToStaticMarkup(createElement(PlanSummary, { plan, fileBytes: 1_000 }));
    expect(markup).toContain('1 page');
    expect(markup).toContain('1 part');
    expect(markup).toContain('Encrypted');
  });
});

// ─── Form and confirm gate ───────────────────────────────────────────────────

describe('the desk choice', () => {
  it('groups the catalog pairs by tier, in catalog order', () => {
    expect(deskGroups(fixtures.pairs)).toEqual([
      { tier: 'global', features: ['Treaties'] },
      { tier: 'national', features: ['Cabinet Decisions', 'Union Budget'] },
      { tier: 'state', features: ['Cabinet Decisions'] },
    ]);
  });

  it('renders one required select of tier|feature options under tier groups, with no default', () => {
    const markup = renderToStaticMarkup(createElement(UploadForm, { draft: { ...DRAFT, desk: '' }, pairs: fixtures.pairs, planCurrent: true, onChange: () => {} }));
    expect(markup.match(/<select/g)).toHaveLength(1);
    expect(markup).toMatch(/<select[^>]*required=""/);
    expect(markup).toContain('<optgroup label="national"><option value="national|Cabinet Decisions">Cabinet Decisions</option><option value="national|Union Budget">Union Budget</option></optgroup>');
    expect(markup).toContain('<optgroup label="state"><option value="state|Cabinet Decisions">Cabinet Decisions</option></optgroup>');
    // The placeholder is chosen and cannot be picked back; React marks the chosen option selected="".
    expect(markup).toMatch(/<option value="" disabled=""[^>]*>Choose a desk<\/option>/);
  });

  it('labels every input', () => {
    const markup = renderToStaticMarkup(createElement(UploadForm, { draft: DRAFT, pairs: fixtures.pairs, planCurrent: true, onChange: () => {} }));
    for (const label of ['Title', 'Desk', 'Source URL (optional)', 'Note (optional)', 'Split every N pages (advanced)']) {
      expect(markup).toContain(`<span>${label}</span>`);
    }
    expect(markup.match(/<label/g)).toHaveLength(5);
  });
});

describe('the confirm gate', () => {
  const confirm = (draft, extra = {}) => buttonTag(
    renderToStaticMarkup(createElement(UploadForm, { draft, pairs: fixtures.pairs, planCurrent: true, onChange: () => {}, ...extra })),
    'Upload and ingest',
  );

  it('is enabled for a title and a catalog desk', () => {
    expect(validateDraft(DRAFT, fixtures.pairs).valid).toBe(true);
    expect(confirm(DRAFT)).not.toContain('disabled');
  });

  it('stays disabled without a title, without a desk, or with a desk not in the catalog', () => {
    for (const draft of [{ ...DRAFT, title: '   ' }, { ...DRAFT, desk: '' }, { ...DRAFT, desk: 'national|Nope' }, { ...DRAFT, title: 'x'.repeat(301) }]) {
      expect(validateDraft(draft, fixtures.pairs).valid).toBe(false);
      expect(confirm(draft)).toContain('disabled=""');
    }
  });

  it('refuses a source URL that is not http(s) and a split that is not a whole number', () => {
    expect(validateDraft({ ...DRAFT, file_url: 'ftp://x.example/a.pdf' }, fixtures.pairs).errors.file_url).toBeTruthy();
    expect(validateDraft({ ...DRAFT, file_url: 'https://x.example/a.pdf' }, fixtures.pairs).valid).toBe(true);
    expect(validateDraft({ ...DRAFT, splitEvery: '2.5' }, fixtures.pairs).errors.splitEvery).toBeTruthy();
    expect(validateDraft({ ...DRAFT, splitEvery: '0' }, fixtures.pairs).valid).toBe(false);
    expect(validateDraft({ ...DRAFT, splitEvery: '10' }, fixtures.pairs).valid).toBe(true);
  });

  it('stays disabled while the plan does not match the split, or while busy', () => {
    expect(confirm(DRAFT, { planCurrent: false })).toContain('disabled=""');
    expect(confirm(DRAFT, { busy: true })).toContain('disabled=""');
  });

  it('confirms and skips through the callbacks', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    const tree = UploadForm({ draft: DRAFT, pairs: fixtures.pairs, planCurrent: true, onChange: () => {}, onConfirm, onSkip });
    button(tree, 'Upload and ingest').props.onClick();
    button(tree, 'Skip').props.onClick();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('sends the desk pair and trimmed fields as uploadPlan meta', () => {
    expect(metaFromDraft({ ...DRAFT, title: '  Budget  ', file_url: ' ', note: ' n ' }, PLAN)).toEqual({
      title: 'Budget', desk_tier: 'national', desk_feature: 'Union Budget', file_url: null, note: 'n', file_name: 'Budget at a Glance.pdf',
    });
  });
});

// ─── Duplicates and the upload ───────────────────────────────────────────────

const DUPES = [{ document_id: 'doc-r7', source_key: 'corpus:budget-2026', title: 'Union Budget 2026', indexed: true, job_status: 'succeeded' }];

describe('the duplicate warning gate', () => {
  it('warns which documents already hold the file, with a choice', () => {
    const markup = renderToStaticMarkup(createElement(DuplicateWarning, { documents: DUPES, onAccept: () => {}, onCancel: () => {} }));
    expect(markup).toContain('This file is already in the corpus as “Union Budget 2026” (corpus:budget-2026); uploading adds a second copy.');
    expect(markup).toContain('role="alert"');
    expect(buttonTag(markup, 'Upload a second copy')).toBeTruthy();
    expect(buttonTag(markup, 'Cancel this file')).toBeTruthy();
  });

  it('holds until the admin accepts', async () => {
    let prompt = null;
    const choice = askDuplicates(DUPES, (p) => { prompt = p; });
    let settled = false;
    choice.then(() => { settled = true; });
    await Promise.resolve();
    expect(prompt.documents).toBe(DUPES);
    expect(settled).toBe(false);
    prompt.accept();
    await expect(choice).resolves.toBeUndefined();
  });

  it('sends no bytes before the choice, and none at all when cancelled', async () => {
    const sent = [];
    const upload = vi.fn(async (plan, meta, { onDuplicates }) => {
      await onDuplicates(DUPES);
      sent.push(plan.file_sha256);
      return { document_id: 'doc-1', job_id: 'job-1', duplicates: DUPES };
    });
    let prompt = null;
    const run = uploadFile({ plan: PLAN, draft: DRAFT, upload, api: {}, onProgress: () => {}, setPrompt: (p) => { prompt = p; } });
    await vi.waitFor(() => expect(prompt).not.toBeNull());
    expect(sent).toEqual([]);
    prompt.cancel();
    await expect(run).resolves.toEqual({ tone: 'warn', text: 'Budget at a Glance.pdf: cancelled; nothing was uploaded.' });
    expect(sent).toEqual([]);
  });

  it('uploads once accepted, and clears the prompt', async () => {
    const setPrompt = vi.fn();
    const upload = vi.fn(async (plan, meta, { onDuplicates }) => {
      await onDuplicates(DUPES);
      return { document_id: 'doc-1', job_id: 'job-1', duplicates: DUPES };
    });
    const run = uploadFile({ plan: PLAN, draft: DRAFT, upload, api: {}, onProgress: () => {}, setPrompt });
    await vi.waitFor(() => expect(setPrompt).toHaveBeenCalled());
    setPrompt.mock.calls[0][0].accept();
    await expect(run).resolves.toEqual({ tone: 'ok', text: 'Budget at a Glance.pdf: registered; processing will start shortly.' });
    expect(setPrompt.mock.calls.at(-1)).toEqual([null]);
    expect(upload.mock.calls[0][1]).toMatchObject({ desk_tier: 'national', desk_feature: 'Union Budget' });
  });
});

describe('describeResult', () => {
  it('reports an existing upload with its title and status', () => {
    expect(describeResult({ existing: { document_id: 'd', source_key: 'upload:x', title: 'Old', indexed: true, job_status: 'succeeded' } }, 'a.pdf'))
      .toEqual({ tone: 'warn', text: 'a.pdf: already uploaded as “Old” (succeeded).' });
    expect(describeResult({ existing: { document_id: 'd-9' } }, 'a.pdf'))
      .toEqual({ tone: 'warn', text: 'a.pdf: already uploaded (document d-9).' });
  });

  it('shows the error message as written for admins', () => {
    const err = Object.assign(new Error('Page 3 alone is 61.0 MB, over the 50.0 MB part limit.'), { code: 'page_too_large' });
    expect(describeResult(err, 'a.pdf')).toEqual({ tone: 'err', text: 'a.pdf: Page 3 alone is 61.0 MB, over the 50.0 MB part limit.' });
  });
});

describe('PartProgress', () => {
  it('shows each part with its pages and state', () => {
    const markup = renderToStaticMarkup(createElement(PartProgress, { parts: PLAN.parts, progress: { 0: 'stored', 1: 'uploading' } }));
    expect(markup).toContain('Part 1 · pages 1–10');
    expect(markup).toContain('Part 2 · pages 11–20');
    expect(markup).toContain('Part 3 · pages 21–25');
    expect(markup).toMatch(/data-state="stored"[^>]*>[\s\S]*?stored/);
    expect(markup).toContain('uploading');
    expect(markup).toContain('waiting');
  });
});

// ─── Jobs ────────────────────────────────────────────────────────────────────

const LONG_ERROR = 'Mistral answered 429 Too Many Requests while reading part 2; the job will try again after its backoff window has passed and the rate limit has reset';
const job = (over) => ({
  job_id: 'j', document_id: 'd', title: 'T', source_key: 'upload:x', desk_tier: 'national', desk_feature: 'Union Budget',
  status: 'queued', stage: 'ocr', ocr_pages: 0, pages_total: 25, attempts: 0, next_attempt_at: null, error_code: null, last_error: null,
  ocr_cost_usd: 0, embed_tokens: 0, embed_cost_usd: 0, requested_by_email: 'admin@example.test', created_at: '2026-10-01T11:50:00Z', finished_at: null,
  ...over,
});
const JOBS = [
  job({ job_id: 'j-backoff', document_id: 'd1', title: 'Budget', attempts: 2, ocr_pages: 10, next_attempt_at: '2026-10-01T12:02:00Z', error_code: 'ocr_rate_limited', last_error: LONG_ERROR, ocr_cost_usd: 0.04, embed_cost_usd: 0.0003 }),
  job({ job_id: 'j-running', document_id: 'd2', status: 'running', stage: 'embed' }),
  job({ job_id: 'j-failed', document_id: 'd3', status: 'failed', attempts: 3 }),
  job({ job_id: 'j-r7', document_id: 'd4', status: 'failed', source_key: 'corpus:r7-doc' }),
  job({ job_id: 'j-cancel-live', document_id: 'd5', status: 'cancelled' }),
  job({ job_id: 'j-done-live', document_id: 'd5', status: 'succeeded', stage: 'done' }),
  job({ job_id: 'j-cancelled', document_id: 'd6', status: 'cancelled' }),
  job({ job_id: 'j-indexed', document_id: 'd7', status: 'failed', indexed: true }),
];
const byId = (id) => JOBS.find((j) => j.job_id === id);

describe('jobActions', () => {
  it('offers Retry on failed or cancelled, Cancel on queued or running', () => {
    expect(jobActions(byId('j-backoff'), JOBS)).toEqual({ retry: false, cancel: true, discard: false });
    expect(jobActions(byId('j-running'), JOBS)).toEqual({ retry: false, cancel: true, discard: false });
    expect(jobActions(byId('j-done-live'), JOBS)).toEqual({ retry: false, cancel: false, discard: false });
  });

  it('offers Discard only for a failed or cancelled upload: document that never went live', () => {
    expect(jobActions(byId('j-failed'), JOBS)).toEqual({ retry: true, cancel: false, discard: true });
    expect(jobActions(byId('j-cancelled'), JOBS)).toEqual({ retry: true, cancel: false, discard: true });
    expect(jobActions(byId('j-r7'), JOBS).discard).toBe(false);
    expect(jobActions(byId('j-cancel-live'), JOBS).discard).toBe(false);
    expect(jobActions(byId('j-indexed'), JOBS).discard).toBe(false);
  });
});

describe('shouldPoll', () => {
  it('polls while any job is queued or running, and stops otherwise', () => {
    expect(shouldPoll([job({ status: 'succeeded' }), job({ status: 'queued' })])).toBe(true);
    expect(shouldPoll([job({ status: 'running' })])).toBe(true);
    expect(shouldPoll([job({ status: 'succeeded' }), job({ status: 'failed' }), job({ status: 'cancelled' })])).toBe(false);
    expect(shouldPoll([])).toBe(false);
  });
});

describe('mergeJobs', () => {
  it('replaces refreshed rows, keeps older loaded ones, newest first', () => {
    const current = [job({ job_id: 'a', status: 'queued', created_at: '2026-10-01T11:00:00Z' }), job({ job_id: 'b', created_at: '2026-10-01T10:00:00Z' })];
    const fresh = [job({ job_id: 'c', created_at: '2026-10-01T11:30:00Z' }), job({ job_id: 'a', status: 'running', created_at: '2026-10-01T11:00:00Z' })];
    expect(mergeJobs(current, fresh).map((j) => [j.job_id, j.status])).toEqual([['c', 'queued'], ['a', 'running'], ['b', 'queued']]);
  });
});

describe('JobsTable', () => {
  const props = (over = {}) => ({ jobs: JOBS, now: NOW, busyId: null, confirmId: null, onRetry: vi.fn(), onCancel: vi.fn(), onAskDiscard: vi.fn(), onDiscard: vi.fn(), onKeep: vi.fn(), ...over });
  const html = (over) => renderToStaticMarkup(createElement(JobsTable, props(over)));
  const rowMarkup = (markup, id) => {
    const start = markup.indexOf(`data-job="${id}"`);
    return markup.slice(start, markup.indexOf('</tr>', start));
  };

  it('sits in the scrolling table wrapper with every column', () => {
    const markup = html();
    expect(markup).toMatch(/^<div class="adm-table-wrap"><table class="adm-table">/);
    for (const h of ['Title', 'Pages', 'Stage', 'Status', 'Attempts', 'Next attempt', 'Error', 'Cost', 'Requested by', 'Created']) {
      expect(markup).toContain(`<th>${h}</th>`);
    }
  });

  it('shows attempts, the backoff time, the error, the cost and the requester', () => {
    const row = rowMarkup(html(), 'j-backoff');
    expect(row).toContain('Budget');
    expect(row).toContain('national · Union Budget');
    expect(row).toContain('10 / 25');
    expect(row).toContain('<td>2</td>');
    expect(row).toContain('in 2 min');
    expect(row).toContain(`title="ocr_rate_limited: ${LONG_ERROR}"`);
    expect(row).toContain('ocr_rate_limited: Mistral answered 429');
    expect(row).toContain('…');
    expect(row).toContain('$0.0403');
    expect(row).toContain('admin@example.test');
    expect(row).toContain('10 min ago');
    expect(row).toContain('class="adm-pill archive"');
  });

  it('shows no next attempt for a running job', () => {
    expect(rowMarkup(html(), 'j-running')).toContain('<td>—</td>');
  });

  it('renders the buttons each status allows', () => {
    const markup = html();
    const has = (id, label) => Boolean(buttonTag(rowMarkup(markup, id), label));
    expect([has('j-backoff', 'Cancel'), has('j-backoff', 'Retry'), has('j-backoff', 'Discard')]).toEqual([true, false, false]);
    expect([has('j-failed', 'Retry'), has('j-failed', 'Discard'), has('j-failed', 'Cancel')]).toEqual([true, true, false]);
    expect([has('j-r7', 'Retry'), has('j-r7', 'Discard')]).toEqual([true, false]);
    expect(has('j-cancel-live', 'Discard')).toBe(false);
    expect(rowMarkup(markup, 'j-done-live')).not.toContain('<button');
  });

  it('asks for an in-page confirmation before discarding', () => {
    const p = props();
    const tree = JobsTable(p);
    const row = find(tree, (n) => n.type === 'tr' && n.key === 'j-failed');
    button(row, 'Discard').props.onClick();
    expect(p.onAskDiscard).toHaveBeenCalledWith(byId('j-failed'));
    expect(p.onDiscard).not.toHaveBeenCalled();

    const confirming = props({ confirmId: 'j-failed' });
    const confirmRow = find(JobsTable(confirming), (n) => n.type === 'tr' && n.key === 'j-failed');
    expect(textOf(confirmRow)).toContain('Discard this upload?');
    button(confirmRow, 'Confirm discard').props.onClick();
    button(confirmRow, 'Keep').props.onClick();
    expect(confirming.onDiscard).toHaveBeenCalledWith(byId('j-failed'));
    expect(confirming.onKeep).toHaveBeenCalledOnce();
  });

  it('retries and cancels through the callbacks, and disables a busy row', () => {
    const p = props();
    const tree = JobsTable(p);
    button(find(tree, (n) => n.type === 'tr' && n.key === 'j-failed'), 'Retry').props.onClick();
    button(find(tree, (n) => n.type === 'tr' && n.key === 'j-running'), 'Cancel').props.onClick();
    expect(p.onRetry).toHaveBeenCalledWith(byId('j-failed'));
    expect(p.onCancel).toHaveBeenCalledWith(byId('j-running'));
    expect(buttonTag(rowMarkup(html({ busyId: 'j-failed' }), 'j-failed'), 'Retry')).toContain('disabled=""');
  });

  it('says so when there are no jobs', () => {
    expect(html({ jobs: [] })).toContain('No ingest jobs yet.');
  });
});

// ─── The page ────────────────────────────────────────────────────────────────

describe('DocumentsPage', () => {
  it('renders the upload card with a multiple PDF picker, and the jobs card', () => {
    const markup = renderToStaticMarkup(createElement(DocumentsPage, { api: { jobs: vi.fn() } }));
    expect(markup).toContain('<h1 class="adm-h1">Documents</h1>');
    expect(markup).toMatch(/<input type="file" multiple="" accept="application\/pdf,\.pdf"/);
    expect(markup).toContain('<span>PDF files</span>');
    expect(markup).toContain('Loading jobs…');
    expect(markup).not.toContain('role="alert"');
  });
});
