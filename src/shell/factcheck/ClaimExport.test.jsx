// B1: the Copy button of a claim card and the Export button of a session. Confirmations go to the view's one
// shared status node (announce.jsx) through the `say` prop; the buttons carry no status node of their own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { elements } from '../hookHarness.js';
import { CopyClaimButton, ExportButton, CLAIM_EXPORT_TEXT } from './ClaimExport.jsx';

const find = (out, pred) => [...elements(out)].find(pred);
const press = (out) => find(out, (e) => e.type === 'button').props.onClick();

beforeEach(() => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('CopyClaimButton', () => {
  it('puts the block on the clipboard and tells the shared status node', async () => {
    const say = vi.fn();
    await press(CopyClaimButton({ text: () => 'the block', say }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('the block');
    expect(say).toHaveBeenCalledWith(CLAIM_EXPORT_TEXT.copied);
  });
  it('every press tells it again, so a repeated identical message can be announced again', async () => {
    const say = vi.fn();
    const el = CopyClaimButton({ text: () => 'x', say });
    await press(el);
    await press(el);
    expect(say).toHaveBeenCalledTimes(2);
  });
  it('a refused clipboard, none at all, or a throw gives a plain message and does not throw', async () => {
    const say = vi.fn();
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    await press(CopyClaimButton({ text: () => 'x', say }));
    vi.stubGlobal('navigator', {});
    await press(CopyClaimButton({ text: () => 'x', say }));
    await press(CopyClaimButton({ text: () => { throw new Error('build'); }, say }));
    expect(say.mock.calls.map((c) => c[0])).toEqual([CLAIM_EXPORT_TEXT.copyFailed, CLAIM_EXPORT_TEXT.copyFailed, CLAIM_EXPORT_TEXT.copyFailed]);
  });
  it('without a shared node (say not given) pressing is harmless', async () => {
    await expect(press(CopyClaimButton({ text: () => 'x' }))).resolves.not.toThrow();
  });
  it('markup: a labelled button and no status node of its own', () => {
    const html = renderToStaticMarkup(<CopyClaimButton text={() => 'x'} label="Copy this claim" />);
    expect(html).toContain('data-fc="copy-claim"');
    expect(html).toContain('aria-label="Copy this claim"');
    expect(html).not.toMatch(/role="status"|role="alert"|aria-live/);
  });
});

describe('ExportButton', () => {
  const env = () => {
    const a = { click: vi.fn(), remove: vi.fn(), style: {} };
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', vi.fn(function B(parts) { this.parts = parts; }));
    return a;
  };
  it('saves the built text under the given name and tells the shared node', () => {
    const a = env();
    const say = vi.fn();
    const el = ExportButton({ build: () => ({ name: 'fact-check.txt', text: 'body' }), say });
    expect(find(el, (e) => e.type === 'button').props['data-fc']).toBe('export');
    press(el);
    expect(a.download).toBe('fact-check.txt');
    expect(say).toHaveBeenCalledWith(CLAIM_EXPORT_TEXT.exported);
  });
  it('uses data-pst when asked, and a browser that cannot make the file gives a plain message', () => {
    vi.stubGlobal('document', undefined);
    const say = vi.fn();
    const el = ExportButton({ build: () => ({ name: 'x.txt', text: 'y' }), dataKey: 'pst', say });
    expect(find(el, (e) => e.type === 'button').props['data-pst']).toBe('export');
    press(el);
    expect(say).toHaveBeenCalledWith(CLAIM_EXPORT_TEXT.exportFailed);
  });
  it('markup: no status node of its own', () => {
    expect(renderToStaticMarkup(<ExportButton build={() => ({ name: 'a', text: 'b' })} />)).not.toMatch(/role="status"|aria-live/);
  });
});
