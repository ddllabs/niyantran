import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTextCitation, PUBLISHER_LABEL, PUBLISHER_MAX_CHARS, publisherLine, publisherName } from './citation.js';

const text = (extra = {}) => ({ id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'T', ...extra });
const RBI = 'Reserve Bank of India';

describe('publisherLine (F332)', () => {
  it('writes the label from the constants, in English and in Hindi', () => {
    expect(PUBLISHER_LABEL).toEqual({ en: 'Published by', hi: 'प्रकाशक:' });
    expect(publisherLine(text({ publisher: RBI }), 'en')).toBe(`${PUBLISHER_LABEL.en} ${RBI}`);
    expect(publisherLine(text({ publisher: RBI }), 'en')).toBe('Published by Reserve Bank of India');
    expect(publisherLine(text({ publisher: RBI }), 'hi')).toBe('प्रकाशक: Reserve Bank of India');
    // Any other language, or none, reads English.
    expect(publisherLine(text({ publisher: RBI }))).toBe('Published by Reserve Bank of India');
    expect(publisherLine(text({ publisher: RBI }), 'fr')).toBe('Published by Reserve Bank of India');
  });

  it('is empty for an absent or invalid publisher, and for anything that is not a text citation', () => {
    expect(publisherLine(text(), 'en')).toBe('');
    for (const bad of [undefined, null, '', '   ', 7, true, {}, [], [RBI], 'x'.repeat(PUBLISHER_MAX_CHARS + 1), 'A\nB', 'A‮B', 'A​B', 'A\u0000B', 'A B', 'ref:abc123-1', `${RBI} ref:abc123-1`]) {
      expect(publisherLine(text({ publisher: bad }), 'en'), JSON.stringify(bad)).toBe('');
      expect(publisherName(text({ publisher: bad })), JSON.stringify(bad)).toBe('');
    }
    expect(publisherLine(null, 'en')).toBe('');
    expect(publisherLine(undefined, 'en')).toBe('');
    expect(publisherLine('Reserve Bank of India', 'en')).toBe('');
    // A row citation or a web page is not a text citation: never a publisher.
    expect(publisherLine({ id: 2, kind: 'row', row_key: 'k', publisher: RBI }, 'en')).toBe('');
    expect(publisherLine({ kind: 'web', url: 'https://example.org/', publisher: RBI }, 'en')).toBe('');
    expect(isTextCitation({ kind: 'web', publisher: RBI })).toBe(false);
  });

  it('accepts the longest allowed name', () => {
    expect(PUBLISHER_MAX_CHARS).toBe(80);
    expect(publisherName(text({ publisher: 'x'.repeat(80) }))).toBe('x'.repeat(80));
  });
});

describe('the client and the server agree (F332)', () => {
  // The client test cannot import Deno code, so the server constant is read from the file's text.
  const server = readFileSync(new URL('../../supabase/functions/_shared/publisher.ts', import.meta.url), 'utf8');
  it('PUBLISHER_MAX_CHARS is the server\'s', () => {
    const found = server.match(/export const PUBLISHER_MAX_CHARS = (\d+);/);
    expect(found).not.toBeNull();
    expect(PUBLISHER_MAX_CHARS).toBe(Number(found[1]));
  });
  it('every name the server can emit passes the client check', () => {
    const names = [...server.matchAll(/name: '([^']+)'/g)].map(m => m[1]);
    expect(names).toHaveLength(4);
    for (const name of names) expect(publisherName(text({ publisher: name }))).toBe(name);
  });
  it('the labels are the ones the spec names', () => {
    expect(PUBLISHER_LABEL.en).toBe('Published by');
    expect(PUBLISHER_LABEL.hi).toBe('प्रकाशक:');
  });
});
