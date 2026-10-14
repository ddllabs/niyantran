// F153: All AI activity - paging, expanding a question into its calls, the filters and switches, the
// chat links, deleted and dictation rows, the pre-launch note, and credits only, never rupees or dollars (F184).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ActivityTable, { rowKey } from './ActivityTable.jsx';
import { FIRST_FILTERS, csvName, nextFilters, toggled } from '../credits/ActivitySection.jsx';

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
    exporting: false, exportError: '',
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

describe('the list', () => {
  it('leads each row with the question, then when, the chat, a readable model, calls and tokens, then credits (F184)', () => {
    const out = html();
    expect(out).toContain('<ul class="cp-rows" aria-label="AI activity, one row per question">');
    expect(out).toMatch(/<p class="cp-row-q">What did the RBI do\?<\/p><p class="cp-row-meta"><span>14 Oct, 12:00<\/span><button type="button" class="cu-chat-open" title="Rate cut">Rate cut<\/button><span class="cp-chip" title="google\/gemini-3\.7-flash">Gemini 3\.7 Flash<\/span><span>3 calls · <abbr class="cu-tokens" title="3,310 tokens"/);
    expect(out).toContain('1 search step');
    expect(out).toMatch(/<span class="cp-row-credits">47\.5<span class="cu-sr"> credits<\/span><\/span>/);
    expect(out).toContain('<span class="cp-s0" style="width:100%"></span>');
    expect(out).not.toContain('₹');
    // A plain success needs no pill; anything else says what happened.
    expect(out).not.toContain('cu-pill-succeeded');
    expect(out).toContain('class="cu-pill cu-pill-failed">Failed');
    expect(out).not.toMatch(/\$|usd|dollar/i);
  });

  it('names a deleted conversation and a dictation call, neither of them a link', () => {
    const out = html();
    expect(out).toContain('<p class="cp-row-q">Deleted conversation</p>');
    expect(out).toContain('<p class="cp-row-q">Dictation</p>');
    expect(out.match(/class="cu-chat-open"/g)).toHaveLength(1);
  });

  it('opens a saved chat from its title', () => {
    const p = props();
    labelled(p, /^Rate cut$/).props.onClick();
    expect(p.onOpenChat).toHaveBeenCalledWith('c1');
  });

  it('marks a row from before credits with the launch note', () => {
    const out = html({ state: { status: 'ready', total: 1, rows: [early] } });
    expect(out).toContain('<span class="cp-row-credits" title="Credits started on 14 Oct 2026">0<span class="cu-credits-note">before credits*</span>');
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

  it('shows the credits as one bar split by step, each step with its model and thinking, then every call and a total', () => {
    const out = html({ expanded: new Set(['t:a1']) });
    expect(out).toContain('aria-expanded="true" aria-controls="cu-calls-0"');
    expect(out).toContain('<li class="cp-row on">');
    expect(out).toMatch(/<div id="cu-calls-0" class="cp-calls"><p class="cp-calls-title">Where these 47\.5 credits went<\/p>/);
    expect(out).toContain('aria-label="Search and plan 19, Answer 28.5, Repair free"');
    expect(out).toMatch(/<strong>Search and plan<\/strong> <strong class="cp-role-num">19<\/strong><span class="cp-dim cp-block">Gemini 3\.7 Flash · Low thinking<\/span>/);
    expect(out).toMatch(/<strong>Answer<\/strong> <strong class="cp-role-num">28\.5<\/strong><span class="cp-dim cp-block">Gemini 3\.7 Flash · Extra high thinking<\/span>/);
    expect(out).toMatch(/<strong>Repair<\/strong> <span class="cu-free">free<\/span>/);
    expect(out).toMatch(/<td>Search and plan<\/td><td title="google\/gemini-3\.7-flash">Gemini 3\.7 Flash<\/td><td>Low<\/td>/);
    expect(out).toMatch(/<th scope="row" colSpan="3">Total<\/th>[\s\S]*<td>47\.5<\/td>/);
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
    expect(switches.map((s) => s.props['aria-checked'])).toEqual([true, false, false]);
    switches[0].props.onClick();
    switches[1].props.onClick();
    switches[2].props.onClick();
    expect(p.onFilter.mock.calls).toEqual([
      [{ model: 'deepseek/deepseek-v4-flash' }], [{ model: null }], [{ status: 'succeeded' }], [{ kind: 'dictation' }],
      [{ grouped: false }], [{ byChat: true }], [{ status: 'failed' }],
    ]);
    const failing = elements(ActivityTable(props({ filters: { ...FIRST_FILTERS, status: 'failed' } }))).filter((e) => e.props.role === 'switch');
    expect(failing[2].props['aria-checked']).toBe(true);
    failing[2].props.onClick();
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

// F184: "Group by chat" totals every matching answer per chat (ActivitySection loads them), most
// credits first, and drops the pager, which counts answers.
describe('grouped by chat', () => {
  const groups = [
    { key: 'c1', conversationId: 'c1', title: 'Rate cut', credits: 95, calls: 7, answers: 2, latest: '2026-10-14T06:30:00Z', sample: answer },
    { key: 'none', conversationId: null, title: null, credits: 0, calls: 1, answers: 1, latest: '2026-10-14T07:00:00Z', sample: dictation },
  ];
  const byChat = { ...FIRST_FILTERS, byChat: true };

  it('lists each chat with its answers, calls, latest time and credits, and opens a saved chat', () => {
    const p = props({ filters: byChat, chats: { status: 'ready', groups, capped: false } });
    const out = renderToStaticMarkup(<ActivityTable {...p} />);
    expect(out).toContain('2 chats, most credits first.');
    expect(out).toMatch(/class="cu-chat-open cp-chat-title">Rate cut<\/button><\/p><p class="cp-row-meta"><span>2 answers · 7 calls<\/span><span>latest 14 Oct, 12:00<\/span>/);
    expect(out).toContain('<p class="cp-row-q">Dictation</p>');
    expect(out).not.toContain('Showing');
    labelled(p, /^Rate cut$/).props.onClick();
    expect(p.onOpenChat).toHaveBeenCalledWith('c1');
  });

  it('says when the totals are loading, failed or capped', () => {
    expect(html({ filters: byChat, chats: { status: 'loading', groups: [] } })).toContain('Totalling your chats');
    expect(html({ filters: byChat, chats: { status: 'error', groups: [] } })).toContain('Chat totals could not be loaded just now.');
    expect(html({ filters: byChat, chats: { status: 'ready', groups, capped: true } })).toContain('2 chats, most credits first, from your latest 2,000 answers.');
    // Export follows the chats shown, not a count left from the previous filters (review).
    expect(labelled(props({ filters: byChat, state: { status: 'ready', total: 0, rows: [] }, chats: { status: 'ready', groups } }), /Export CSV/).props.disabled).toBe(false);
    expect(labelled(props({ filters: byChat, chats: { status: 'ready', groups: [] } }), /Export CSV/).props.disabled).toBe(true);
  });
});
