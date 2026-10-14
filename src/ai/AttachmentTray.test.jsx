// F178 (F171 review): a file chip says, in visible text, why it was not sent and what was cut, so a
// touch reader (no hover) sees it. Hindi where the language is Hindi.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AttachmentTray from './AttachmentTray.jsx';

const render = (attachments, lang = 'en') => renderToStaticMarkup(<AttachmentTray attachments={attachments} indexedKeys={new Set()} locked={false} onRemove={() => {}} lang={lang} />);
const notSent = { id: 'f1', kind: 'file', title: 'scan.pdf', error: 'No readable text (the PDF looks scanned), so it was not sent.' };
const cut = { id: 'f2', kind: 'file', title: 'long.txt', text: 'x', note: 'The AI reads the first 12,000 characters.' };

describe('AttachmentTray file messages (F178)', () => {
  it('shows the reason a file was not sent as visible text, beside the Not sent badge', () => {
    const html = render([notSent]);
    expect(html).toContain('Not sent');
    expect(html).toMatch(/<small[^>]*role="note"[^>]*>No readable text \(the PDF looks scanned\), so it was not sent\.<\/small>/);
  });

  it('shows a note on a file that was sent', () => {
    const html = render([cut]);
    expect(html).toMatch(/<small[^>]*role="note"[^>]*>The AI reads the first 12,000 characters\.<\/small>/);
    expect(html).not.toContain('Not sent');
  });

  it('ties the message to the Remove button, and says it once', () => {
    const html = render([notSent]);
    const id = /<small id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button[^>]*aria-describedby="${id}"`));
    expect(html.split('so it was not sent').length - 1).toBe(1);
  });

  it('translates a note joined from several sentences, each on its own', () => {
    const joined = { id: 'f5', kind: 'file', title: 'big.xlsx', text: 'x', note: 'Only the first 6 of 7 sheets are read. The AI reads the first 12,000 characters.' };
    const html = render([joined], 'hi');
    expect(html).toContain('कुल 7 शीट में से केवल पहली 6 पढ़ी गई हैं। AI पहले 12,000 अक्षर पढ़ता है।');
    expect(html).not.toMatch(/sheets are read|characters\./);
  });

  it('shows no message line for a chip with neither an error nor a note', () => {
    expect(render([{ id: 'f3', kind: 'file', title: 'ok.txt', text: 'hello' }])).not.toContain('<small');
  });

  it('shows Hindi text when the language is Hindi, and unknown messages as given', () => {
    const html = render([notSent], 'hi');
    expect(html).toContain('नहीं भेजा');
    expect(html).not.toContain('so it was not sent');
    expect(html).toMatch(/<small[^>]*>[^<]*[ऀ-ॿ][^<]*<\/small>/);
    expect(render([{ id: 'f4', kind: 'file', title: 'x', error: 'A message nobody translated.' }], 'hi')).toContain('A message nobody translated.');
  });

  it('keeps the title tooltip and the other chips as they were', () => {
    const html = render([{ id: 'd1', kind: 'document', title: 'Data Bill' }]);
    expect(html).toContain('Document');
    expect(html).not.toContain('<small');
  });
});
