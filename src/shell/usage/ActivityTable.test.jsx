// F153: All AI activity - paging, expanding a question into its calls, the filters and switches, the
// chat links, deleted and dictation rows, the pre-launch note, and credits only, never rupees or dollars (F184).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ActivityTable, { rowKey } from './ActivityTable.jsx';
import { FIRST_FILTERS, csvName, nextFilters, toggled } from './ActivityDialog.jsx';

const answer = {
  turnKey: 'a1', createdAt: '2026-10-14T06:30:00Z', conversationId: 'c1', title: 'Rate cut', question: 'What did the RBI do?',
  status: 'succeeded', model: 'google/gemini-3.7-flash', calls: 3, tokens: 3310, credits: 47.5,
  detail: [
    { role: 'search', model: 'google/gemini-3.7-flash', effort: 'low', tokens: 1000, credits: 19, free: false, status: 'succeeded' },
    { role: 'answer', model: 'google/gemini-3.7-flash', effort: 'xhigh', tokens: 2000, credits: 28.5, free: false, status: 'succeeded' },
    { role: 'repair', model: 'google/gemini-3.5-flash-lite', effort: null, tokens: 310, credits: 0, free: true, status: 'succeeded' },
  ],
};
const deleted = { ...answer, turnKey: 'c1', conversationId: null, title: null, question: null, calls: 1, credits: 9.5, model: 'deepseek/deepseek-v4-flash', detail: [answer.detail[1]] };
const dictation = { turnKey: null, createdAt: '2026-10-14T07:00:00Z', conversationId: null, title: null, question: null, status: 'failed',
  model: 'openai/whisper-large-v3-turbo', calls: 1, tokens: 0, credits: 0, detail: [{ role: 'dictation', model: 'openai/whisper-large-v3-turbo', effort: null, tokens: 0, credits: 0, free: true, status: 'failed' }] };
const early = { ...answer, turnKey: 'e1', createdAt: '2026-10-13T06:30:00Z', credits: 0, calls: 1, detail: [] };

function props(over = {}) {
  return {
    state: { status: 'ready', total: 120, rows: [answer, deleted, dictation] },
    filters: FIRST_FILTERS, offset: 0, pageSize: 50, expanded: new Set(), models: ['google/gemini-3.7-flash', 'deepseek/deepseek-v4-flash'],
    rate: 0.1, exporting: false, exportError: '',
    onFilter: vi.fn(), onPage: vi.fn(), onToggleRow: vi.fn(), onOpenChat: vi.fn(), onExport: vi.fn(),
    ...over,
  };
}
const html = (over) => renderToStaticMarkup(<ActivityTable {...props(over)} />);

function elements(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && node.props) {
    if (typeof node.type === 'function') return elements(node.type(node.props), out);
    out.push(node);
    elements(node.props.children, out);
  }
  return out;
}
const text = (node) => elements(node).flatMap((e) => [e.props.children].flat(Infinity)).filter((c) => typeof c === 'string' || typeof c === 'number').join('');
const buttons = (p) => elements(ActivityTable(p)).filter((e) => e.type === 'button');
const labelled = (p, re) => buttons(p).find((b) => re.test(text(b)) || re.test(b.props['aria-label'] || ''));

describe('the table', () => {
  it('shows when, chat and model, calls, tokens, credits only, and a status pill', () => {
    const out = html();
    expect(out).toMatch(/<th scope="col">When<\/th><th scope="col">Chat<\/th>/);
    expect(out).toContain('14 Oct, 12:00');
    expect(out).toContain('>Rate cut</button>');
    expect(out).toContain('class="cu-chat-model" title="google/gemini-3.7-flash">gemini-3.7-flash');
    expect(out).toMatch(/<span class="cu-credits-num">47\.5<\/span><\/span>/);
    expect(out).not.toContain('₹');
    expect(out).toContain('title="3,310 tokens"');
    expect(out).toContain('class="cu-pill cu-pill-succeeded">Succeeded');
    expect(out).toContain('class="cu-pill cu-pill-failed">Failed');
    expect(out).not.toMatch(/\$|usd|dollar/i);
  });

  it('names a deleted conversation and a dictation call, neither of them a link', () => {
    const out = html();
    expect(out).toContain('<span class="cu-chat-gone">Deleted conversation</span>');
    expect(out).toMatch(/<td class="cu-chat"><span class="">Dictation<\/span>/);
    expect(out.match(/class="cu-chat-open"/g)).toHaveLength(1);
  });

  it('opens a saved chat from its title', () => {
    const p = props();
    labelled(p, /^Rate cut$/).props.onClick();
    expect(p.onOpenChat).toHaveBeenCalledWith('c1');
  });

  it('marks a row from before credits with the launch note', () => {
    const out = html({ state: { status: 'ready', total: 1, rows: [early] } });
    expect(out).toContain('title="Credits started on 14 Oct 2026"');
    expect(out).toContain('* Credits started on 14 Oct 2026; earlier calls show 0 credits.');
    expect(html()).not.toContain('Credits started');
    // A failed answer is free anyway: no launch note for it.
    expect(html({ state: { status: 'ready', total: 1, rows: [{ ...early, status: 'failed' }] } })).not.toContain('Credits started');
  });

  it('says what it is doing when loading, failing or empty', () => {
    expect(html({ state: { status: 'loading', total: 0, rows: [] } })).toContain('Loading activity');
    expect(html({ state: { status: 'error', total: 0, rows: [] } })).toContain('could not be loaded');
    expect(html({ state: { status: 'ready', total: 0, rows: [] } })).toContain('No AI activity matches these filters.');
  });
});

describe('expanding a question', () => {
  it('offers a real button only on a grouped row with more than one call', () => {
    const out = html();
    expect(out.match(/class="cu-expand"/g)).toHaveLength(1);
    expect(out).toContain('aria-expanded="false" aria-label="Show the 3 calls of Rate cut"');
    expect(html({ filters: { ...FIRST_FILTERS, grouped: false } })).not.toContain('class="cu-expand"');
  });

  it('toggles the row by its key', () => {
    const p = props();
    labelled(p, /Show the 3 calls/).props.onClick();
    expect(p.onToggleRow).toHaveBeenCalledWith('t:a1');
  });

  it('shows the question, each call with role, model, thinking, tokens and credits or free, and a total', () => {
    const out = html({ expanded: new Set(['t:a1']) });
    expect(out).toContain('aria-expanded="true" aria-controls="cu-calls-0"');
    expect(out).toMatch(/<tr id="cu-calls-0" class="cu-detail">/);
    expect(out).toContain('What did the RBI do?');
    expect(out).toMatch(/<td>Search and plan<\/td><td title="google\/gemini-3\.7-flash">gemini-3\.7-flash<\/td><td>Low<\/td>/);
    expect(out).toMatch(/<td>Answer<\/td>[\s\S]*<td>Extra high<\/td>[\s\S]*<td>28\.5<\/td>/);
    expect(out).toMatch(/<td>Repair<\/td>[\s\S]*<span class="cu-free">free<\/span>/);
    expect(out).toMatch(/<th scope="row" colSpan="3">TOTAL<\/th>[\s\S]*<td>47\.5<\/td>/);
    expect(out).not.toContain('₹');
  });
});

describe('paging', () => {
  it('says which rows are shown and moves a page at a time', () => {
    const first = props();
    expect(html()).toContain('Showing 1–3 of 120');
    const prev = labelled(first, /^Previous$/);
    expect(prev.props.disabled).toBe(true);
    labelled(first, /^Next$/).props.onClick();
    expect(first.onPage).toHaveBeenCalledWith(50);

    const rows = Array.from({ length: 50 }, (_, i) => ({ ...dictation, createdAt: `2026-10-14T07:${String(i).padStart(2, '0')}:00Z` }));
    const second = props({ offset: 50, state: { status: 'ready', total: 120, rows } });
    expect(renderToStaticMarkup(<ActivityTable {...second} />)).toContain('Showing 51–100 of 120');
    labelled(second, /^Previous$/).props.onClick();
    expect(second.onPage).toHaveBeenCalledWith(0);

    const last = props({ offset: 100, state: { status: 'ready', total: 120, rows: rows.slice(0, 20) } });
    expect(renderToStaticMarkup(<ActivityTable {...last} />)).toContain('Showing 101–120 of 120');
    expect(labelled(last, /^Next$/).props.disabled).toBe(true);
  });
});

describe('filters and switches', () => {
  it('filters by model, status and kind, and switches grouping and failures only', () => {
    const p = props();
    const tree = elements(ActivityTable(p));
    const selects = tree.filter((e) => e.type === 'select');
    selects[0].props.onChange({ target: { value: 'deepseek/deepseek-v4-flash' } });
    selects[0].props.onChange({ target: { value: '' } });
    selects[1].props.onChange({ target: { value: 'succeeded' } });
    selects[2].props.onChange({ target: { value: 'dictation' } });
    const switches = tree.filter((e) => e.props.role === 'switch');
    expect(switches.map((s) => s.props['aria-checked'])).toEqual([true, false]);
    switches[0].props.onClick();
    switches[1].props.onClick();
    expect(p.onFilter.mock.calls).toEqual([
      [{ model: 'deepseek/deepseek-v4-flash' }], [{ model: null }], [{ status: 'succeeded' }], [{ kind: 'dictation' }],
      [{ grouped: false }], [{ status: 'failed' }],
    ]);
    const failing = elements(ActivityTable(props({ filters: { ...FIRST_FILTERS, status: 'failed' } }))).filter((e) => e.props.role === 'switch');
    expect(failing[1].props['aria-checked']).toBe(true);
    failing[1].props.onClick();
  });

  it('exports on request, and not while there is nothing or an export is running', () => {
    const p = props();
    labelled(p, /^Export CSV$/).props.onClick();
    expect(p.onExport).toHaveBeenCalledOnce();
    expect(labelled(props({ exporting: true }), /Exporting/).props.disabled).toBe(true);
    expect(labelled(props({ state: { status: 'ready', total: 0, rows: [] } }), /Export CSV/).props.disabled).toBe(true);
  });
});

describe('dialog helpers', () => {
  it('keys rows, toggles a set and names the export by its IST day', () => {
    expect(rowKey(answer, 0)).toBe('t:a1');
    expect(rowKey(dictation, 4)).toBe('r:2026-10-14T07:00:00Z:openai/whisper-large-v3-turbo:4');
    expect([...toggled(toggled(new Set(), 'a'), 'b')]).toEqual(['a', 'b']);
    expect([...toggled(new Set(['a']), 'a')]).toEqual([]);
    expect(nextFilters(FIRST_FILTERS, { status: 'failed' })).toEqual({ ...FIRST_FILTERS, status: 'failed' });
    expect(csvName(new Date('2026-10-14T20:00:00Z'))).toBe('niyantran-ai-activity-2026-10-15.csv');
  });
});
