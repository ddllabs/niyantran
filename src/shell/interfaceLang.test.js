// F192: while the interface is in Hindi the document says so, so screen readers read it as Hindi,
// and leaving the shell (sign-out) puts back whatever the page had before.
import { describe, expect, it } from 'vitest';
import { applyInterfaceLang } from './interfaceLang.js';

describe('applyInterfaceLang', () => {
  it('sets the document language to Hindi and restores the previous one', () => {
    const root = { lang: 'en' };
    const restore = applyInterfaceLang(root, 'hi');
    expect(root.lang).toBe('hi');
    restore();
    expect(root.lang).toBe('en');
  });
  it('switching back to English sets en', () => {
    const root = { lang: 'hi' };
    applyInterfaceLang(root, 'en');
    expect(root.lang).toBe('en');
  });
});
