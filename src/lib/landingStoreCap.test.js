import { describe, expect, it } from 'vitest';
import { withStoreCap } from '../../server/landingStoreCap.mjs';
import { STORE_PAGE_ROWS } from '../../server/feedServe.mjs';

// F404 follow-up (2026-11-22): the note is for a table cut at its page, not for one a row filter shortened.

describe('withStoreCap', () => {
  it('does not cap a table the module filter shortened (Cabinet: 93 shown of 98 stored)', () => {
    const summary = { count: 93, limitations: 'Official releases.' };
    const out = withStoreCap(summary, { served: 'store', storeTotal: 98 });
    expect(out).toBe(summary);
    expect(out).not.toHaveProperty('capped');
  });

  it('caps a table that fills its page while the store holds more (500 shown of 740 stored)', () => {
    const out = withStoreCap({ count: 500, limitations: 'News wire.' }, { served: 'store', storeTotal: 740 });
    expect(STORE_PAGE_ROWS).toBe(500);
    expect(out).toMatchObject({ capped: true, storeTotal: 740 });
    expect(out.limitations).toBe('News wire. The table lists the first 500 of 740 stored entries; the count is of those listed.');
  });

  it('leaves a full page alone when the store holds no more', () => {
    const summary = { count: 500 };
    expect(withStoreCap(summary, { served: 'store', storeTotal: 500 })).toBe(summary);
  });

  it('leaves a summary unchanged when it was not served from the store', () => {
    const summary = { count: 500 };
    expect(withStoreCap(summary, { served: 'live', storeTotal: 740 })).toBe(summary);
    expect(withStoreCap(summary, undefined)).toBe(summary);
  });
});
