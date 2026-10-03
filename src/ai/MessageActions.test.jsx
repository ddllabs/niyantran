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
  expect(renderToStaticMarkup(<MessageActions m={{ role: 'user', content: 'Q' }} />)).not.toContain('Copy');
});

it('keeps copy icon-only with a named button and tooltip',()=>{
  const html=renderToStaticMarkup(<MessageActions m={{role:'assistant',content:'Answer'}} />);
  expect(html).toContain('aria-label="Copy answer"');
  expect(html).toContain('title="Copy answer"');
  expect(html).not.toMatch(/>Copy<|>Copy<\//);
});
