import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ActivityTicker, { clock, finishedSummary, foundSoFar, stepLabel } from './ActivityTicker.jsx';
import ResearchFlow, { actionState, measurementRows } from './ResearchFlow.jsx';

// thinking-display spec (docs/specs/2026-10-02-thinking-display.md), owner-approved 2026-10-02.
describe('thinking display', () => {
  it('consolidates model and requested effort in the activity summary', () => {
    const html = renderToStaticMarkup(<ActivityTicker model={{requested:'model/a',served:'model/b'}} effort="low" labelOf={id=>id==='model/b'?'Model B':id} timing={{total_ms:1000}} />);
    expect(html).toContain('Model B · Low');
  });
  it('shows requested model metadata on legacy turns without timings or served model', () => {
    const html=renderToStaticMarkup(<ActivityTicker model={{requested:'model/a'}} effort="low" labelOf={()=>'Model A'} />);
    expect(html).toContain('Model A · Low');
  });
  it('distinguishes failed, cancelled and incomplete actions from successful zero results', () => {
    expect(actionState({phase:'start'}, true)).toBe('Searching');
    expect(actionState({phase:'start'}, false)).toBe('Incomplete');
    expect(actionState({phase:'end',status:'error'})).toBe('Failed');
    expect(actionState({phase:'end',status:'cancelled'})).toBe('Cancelled');
    expect(actionState({phase:'end',status:'ok'})).toBe('Completed');
    expect(stepLabel({name:'search_documents',phase:'end',status:'error',input:{query:'q'},resultCount:0})).not.toContain('0 passages');
  });
  it('keeps missing measurements unavailable and measured zero, without inventing reasoning duration', () => {
    const rows=measurementRows({search_ms:0,reasoning_ms:6000,writing_ms:2300,total_ms:9000,first_answer_ms:5600},[]);
    expect(rows).toContainEqual(['Search actions','0 ms']);
    expect(rows).toContainEqual(['Reasoning duration','Not available']);
    expect(rows).toContainEqual(['Database retrieval','Not available']);
    expect(rows).toContainEqual(['Other processing','6000 ms']);
    expect(rows).toContainEqual(['First answer latency','5600 ms']);
  });
  it('§1: from Send it is one compact status line, "Starting…", with an elapsed clock', () => {
    const html = renderToStaticMarkup(<ActivityTicker active startedAt={Date.now() - 75_000} />);
    expect(html).toContain('Starting…');
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    expect(html).toContain('1:15');
    expect(renderToStaticMarkup(<ActivityTicker active lang="hi" />)).toContain('शुरू हो रहा है…');
    expect(clock(0)).toBe('0:00');
    expect(clock(3_725_000)).toBe('62:05');
  });

  it('§2: searches are labelled by what they do', () => {
    expect(stepLabel({ type: 'tool', name: 'search_documents', phase: 'start', input: { query: 'sanction' } })).toBe('Searching “sanction”…');
    expect(stepLabel({ type: 'tool', name: 'search_documents', phase: 'end', input: { query: 'sanction' }, resultCount: 40 })).toBe('Searched “sanction” · 40 passages');
    expect(stepLabel({ type: 'tool', name: 'search_documents', phase: 'end', resultCount: 1 })).toBe('Searched documents · 1 passage');
    expect(stepLabel({ type: 'tool', name: 'search_desk_rows', phase: 'end', input: { feature: 'Bill Passage Probability Index' }, resultCount: 8 })).toBe('Looked up Bill Passage Probability Index · 8 rows');
    expect(stepLabel({ type: 'tool', name: 'search_desk_rows', phase: 'start', input: {} })).toBe('Looking up the desk…');
    expect(stepLabel({ type: 'activity', text: 'Reading the results' })).toBe('Reading the results');
  });

  it('§3: "Found so far" lists each document once, merging pages, from finished searches only', () => {
    const steps = [
      { type: 'tool', name: 'search_documents', phase: 'end', step: 1, found: [{ document_id: 'A', title: 'Espionage Bill', pages: [7, 4] }, { document_id: 'B', title: 'Old Act', pages: [] }] },
      { type: 'tool', name: 'search_documents', phase: 'end', step: 2, found: [{ document_id: 'A', title: 'Espionage Bill', pages: [9, 4] }] },
      { type: 'tool', name: 'search_documents', phase: 'start', step: 3, found: [{ document_id: 'Z', title: 'Not finished', pages: [1] }] },
      { type: 'tool', name: 'search_documents', phase: 'end', step: 4, found: 'garbage' },
    ];
    expect(foundSoFar(steps)).toEqual([
      { document_id: 'A', title: 'Espionage Bill', pages: [4, 7, 9] },
      { document_id: 'B', title: 'Old Act', pages: [] },
    ]);
    const html = renderToStaticMarkup(<ActivityTicker active activity={steps} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Not finished');
  });

  it('§4: finished, it collapses to "N searches · N citations · N s", omitting zeros', () => {
    const steps = [
      { type: 'tool', name: 'search_documents', phase: 'end', step: 1, resultCount: 40 },
      { type: 'tool', name: 'search_desk_rows', phase: 'end', step: 2, resultCount: 8 },
    ];
    expect(finishedSummary({ steps, sourceCount: 3, timing: { total_ms: 53_400 } })).toBe('2 searches · 3 citations · 53 s');
    expect(finishedSummary({ steps: [steps[0]], sourceCount: 1, timing: { total_ms: 900 } })).toBe('1 search · 1 citation · 1 s');
    expect(finishedSummary({ steps: [], sourceCount: 0, timing: null })).toBe('Answered');
    expect(finishedSummary({ steps, sourceCount: 0, timing: { total_ms: 3000 }, hi: true })).toBe('2 खोज · 3 से.');
    expect(finishedSummary({ sourceCount: 2, hi: true })).toBe('2 उद्धरण');
    const html = renderToStaticMarkup(<ActivityTicker activity={steps} sourceCount={3} timing={{ total_ms: 53_400 }} />);
    expect(html).toContain('2 searches · 3 citations · 53 s');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('ai-ticker-steps');
  });
});

it('expanded details preserve exact model, requested fallback and first-answer latency', () => {
  const timing = { search_ms:900, reasoning_ms:12000, writing_ms:4000, total_ms:17000, first_answer_ms:3100 };
  const html=renderToStaticMarkup(<ResearchFlow timing={timing} model={{requested:'model/a',served:'model/b'}} effort="low" />);
  expect(html).toContain('model/b'); expect(html).toContain('Requested model'); expect(html).toContain('model/a');
  expect(html).toContain('First answer latency'); expect(html).toContain('3100 ms');
  expect(html).toContain('Reasoning duration'); expect(html).toContain('Not available');
  expect(stepLabel({name:'search_documents',phase:'end'})).not.toContain('0 passages');
});
