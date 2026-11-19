// B1: the Copy button of a claim card and the Export button of a session, with real state (hookHarness.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const { CopyClaimButton, ExportButton, CLAIM_EXPORT_TEXT } = await import('./ClaimExport.jsx');

const find = (out, pred) => [...elements(out)].find(pred);
const click = (out) => find(out, (e) => e.type === 'button').props.onClick();
const noteOf = (out) => find(out, (e) => e.props?.role === 'status').props.children;

beforeEach(() => {
  harness.reset();
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { harness.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('CopyClaimButton', () => {
  const props = { text: () => 'the block', label: 'Copy' };
  it('puts the block on the clipboard and announces it once, then clears the message', async () => {
    let out = harness.render(CopyClaimButton, props);
    click(out);
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('the block');
    out = harness.render(CopyClaimButton, props);
    expect(noteOf(out)).toBe(CLAIM_EXPORT_TEXT.copied);
    await vi.advanceTimersByTimeAsync(5000);
    out = harness.render(CopyClaimButton, props);
    expect(noteOf(out)).toBe('');
  });
  it('a refused clipboard or none at all shows a plain message and does not throw', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    let out = harness.render(CopyClaimButton, props);
    click(out);
    await vi.advanceTimersByTimeAsync(0);
    out = harness.render(CopyClaimButton, props);
    expect(noteOf(out)).toBe(CLAIM_EXPORT_TEXT.copyFailed);
    harness.reset();
    vi.stubGlobal('navigator', {});
    out = harness.render(CopyClaimButton, props);
    click(out);
    await vi.advanceTimersByTimeAsync(0);
    out = harness.render(CopyClaimButton, props);
    expect(noteOf(out)).toBe(CLAIM_EXPORT_TEXT.copyFailed);
  });
  it('markup: a labelled button with a polite status region', () => {
    const html = renderToStaticMarkup(<CopyClaimButton text={() => 'x'} label="Copy this claim" />);
    expect(html).toMatch(/<button[^>]*data-fc="copy-claim"[^>]*>Copy<\/button>|<button[^>]*>Copy<\/button>/);
    expect(html).toContain('aria-label="Copy this claim"');
    expect(html).toContain('role="status"');
  });
});

describe('ExportButton', () => {
  it('saves the built text under the given name and says so', () => {
    const a = { click: vi.fn(), remove: vi.fn(), style: {} };
    const Blob = vi.fn(function B(parts) { this.parts = parts; });
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', Blob);
    const props = { build: () => ({ name: 'fact-check.txt', text: 'body' }), dataKey: 'fc' };
    let out = harness.render(ExportButton, props);
    expect(find(out, (e) => e.type === 'button').props['data-fc']).toBe('export');
    click(out);
    expect(a.download).toBe('fact-check.txt');
    expect(Blob.mock.calls[0][0]).toEqual(['body']);
    out = harness.render(ExportButton, props);
    expect(noteOf(out)).toBe(CLAIM_EXPORT_TEXT.exported);
  });
  it('uses data-pst when asked, and a browser that cannot make the file shows a plain message', () => {
    vi.stubGlobal('document', undefined);
    const props = { build: () => ({ name: 'x.txt', text: 'y' }), dataKey: 'pst' };
    let out = harness.render(ExportButton, props);
    expect(find(out, (e) => e.type === 'button').props['data-pst']).toBe('export');
    click(out);
    out = harness.render(ExportButton, props);
    expect(noteOf(out)).toBe(CLAIM_EXPORT_TEXT.exportFailed);
  });
});
