import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import MessageActions, { answerForCopy, copyAnswer } from './MessageActions.jsx';

it('copies references with source titles and safe original URLs', () => {
  const m = { content: 'Evidence [1] [2]', sources: [
    { id: 1, title: 'Bill', file_url: 'https://example.org/bill.pdf' },
    { id: 2, title: 'Record', file_url: 'javascript:alert(1)' },
  ] };
  expect(answerForCopy(m)).toBe('Evidence [1] [2]\n\nSources\n[1] Bill — https://example.org/bill.pdf\n[2] Record');
});
it('reports clipboard rejection rather than success', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('private details'));
  expect(await copyAnswer({ content: 'Answer' }, { writeText })).toBe(false);
  expect(await copyAnswer({ content: 'Answer' }, null)).toBe(false);
  expect(await copyAnswer({ content: 'Answer' }, { writeText: vi.fn().mockResolvedValue() })).toBe(true);
});
it('uses the message time and does not fabricate missing timestamps', () => {
  const html = renderToStaticMarkup(<MessageActions m={{ role: 'assistant', content: 'Answer', at: 1791000000000 }} />);
  expect(html).toContain('dateTime="2026-10-03T');
  expect(html).toContain('Copy');
  expect(renderToStaticMarkup(<MessageActions m={{ role: 'user', content: 'Q' }} />)).not.toContain('<time');
  expect(renderToStaticMarkup(<MessageActions m={{ role: 'user', content: 'Q' }} />)).toContain('Copy message');
});

it('keeps copy icon-only with a named button and tooltip',()=>{
  const html=renderToStaticMarkup(<MessageActions m={{role:'assistant',content:'Answer'}} />);
  expect(html).toContain('aria-label="Copy answer"');
  expect(html).toContain('title="Copy answer"');
  expect(html).not.toMatch(/>Copy<|>Copy<\//);
});

it('copies user text without adding attachment/source metadata',()=>{
  expect(answerForCopy({role:'user',content:'Question?',sources:[{id:1,title:'Attached bill'}]})).toBe('Question?');
});

// F332: the copied reference line names the publisher, after the page and before the URL.
it('copies the publisher after the page and before the URL, in English and in Hindi', () => {
  const m = { content: 'Evidence [1]', sources: [
    { id: 1, kind: 'text', chunk_id: 'c1', title: 'Circular on KYC', page_number: 4, publisher: 'Reserve Bank of India', file_url: 'https://rbidocs.rbi.org.in/x.pdf' },
  ] };
  expect(answerForCopy(m)).toBe('Evidence [1]\n\nSources\n[1] Circular on KYC · p. 4 · Published by Reserve Bank of India — https://rbidocs.rbi.org.in/x.pdf');
  expect(answerForCopy(m, true)).toBe('Evidence [1]\n\nस्रोत\n[1] Circular on KYC · पृ. 4 · प्रकाशक: Reserve Bank of India — https://rbidocs.rbi.org.in/x.pdf');
  const noPageNoUrl = { content: 'A', sources: [{ id: 1, kind: 'text', chunk_id: 'c1', title: 'Direction', publisher: 'Competition Commission of India' }] };
  expect(answerForCopy(noPageNoUrl)).toBe('A\n\nSources\n[1] Direction · Published by Competition Commission of India');
});

it('a source without a publisher, or with an invalid one, copies as before', () => {
  const plain = { content: 'Evidence [1]', sources: [{ id: 1, kind: 'text', chunk_id: 'c1', title: 'Bill', page_number: 2, file_url: 'https://example.org/bill.pdf' }] };
  expect(answerForCopy(plain)).toBe('Evidence [1]\n\nSources\n[1] Bill · p. 2 — https://example.org/bill.pdf');
  for (const bad of ['', '  ', 7, {}, 'x'.repeat(81), 'A\nB', 'ref:abc123-1']) {
    expect(answerForCopy({ content: 'E', sources: [{ id: 1, kind: 'text', chunk_id: 'c1', title: 'Bill', publisher: bad }] }), JSON.stringify(bad)).toBe('E\n\nSources\n[1] Bill');
  }
  // A row or a web page is not a text citation.
  expect(answerForCopy({ content: 'E', sources: [{ id: 1, kind: 'row', row_key: 'k', title: 'Record', publisher: 'Reserve Bank of India' }] })).toBe('E\n\nSources\n[1] Record');
});
