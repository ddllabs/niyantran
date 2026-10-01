import { describe, expect, it, vi } from 'vitest';
import { STORED_COPY_NOTICES, openStoredCopy } from './storedCopy.js';

const SIGNED = 'https://nter.supabase.co/storage/v1/object/sign/corpus/files/abc.pdf?token=SECRET';

function fakeTab() {
  return { opener: 'parent', closed: false, location: { href: 'about:blank' }, close: vi.fn(function close() { this.closed = true; }) };
}

describe('openStoredCopy', () => {
  it('opens a blank tab synchronously, before asking for the part, then points it at the signed URL', async () => {
    const tab = fakeTab();
    const order = [];
    const open = vi.fn(() => { order.push('open'); return tab; });
    const documentFile = { partFor: vi.fn(async () => { order.push('partFor'); return { url: SIGNED, partIndex: 1 }; }) };

    const pending = openStoredCopy({ open, documentFile, documentId: 'd1', page: 7 });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(order).toEqual(['open', 'partFor']);
    expect(tab.opener).toBeNull();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(documentFile.partFor).toHaveBeenCalledWith('d1', 7);
    expect(tab.location.href).toBe(SIGNED);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the tab and returns a fixed notice when the part cannot be signed', async () => {
    const tab = fakeTab();
    const failure = new Error(`fetch ${SIGNED} failed`);
    const documentFile = { partFor: vi.fn(async () => { throw failure; }) };
    const result = await openStoredCopy({ open: () => tab, documentFile, documentId: 'd1', page: 2 });
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, notice: STORED_COPY_NOTICES.failed });
    expect(JSON.stringify(result)).not.toContain('http');
    expect(tab.location.href).toBe('about:blank');
  });

  it('closes the tab when pointing it at the URL throws', async () => {
    const tab = fakeTab();
    tab.location = { set href(_value) { throw new Error(`blocked ${SIGNED}`); } };
    const result = await openStoredCopy({ open: () => tab, documentFile: { partFor: async () => ({ url: SIGNED }) }, documentId: 'd1', page: 2 });
    expect(tab.close).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('says so, without signing anything, when the browser blocks the tab', async () => {
    const documentFile = { partFor: vi.fn() };
    const result = await openStoredCopy({ open: () => null, documentFile, documentId: 'd1', page: 2 });
    expect(result).toEqual({ ok: false, notice: STORED_COPY_NOTICES.blocked });
    expect(documentFile.partFor).not.toHaveBeenCalled();
  });

  it('treats a throwing window.open as blocked', async () => {
    const result = await openStoredCopy({ open: () => { throw new Error('nope'); }, documentFile: { partFor: vi.fn() }, documentId: 'd1', page: 2 });
    expect(result).toEqual({ ok: false, notice: STORED_COPY_NOTICES.blocked });
  });

  it('a tab that refuses to close is harmless', async () => {
    const tab = fakeTab();
    tab.close = vi.fn(() => { throw new Error('already closed'); });
    const result = await openStoredCopy({ open: () => tab, documentFile: { partFor: async () => { throw new Error('x'); } }, documentId: 'd1', page: 2 });
    expect(result.ok).toBe(false);
  });
});
