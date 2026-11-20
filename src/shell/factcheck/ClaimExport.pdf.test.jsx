// The "Download PDF" button: the builder is loaded only when pressed, the file is a PDF Blob, the button is busy
// meanwhile, and a failure is said plainly. Real state through hookHarness.js; the dynamic import is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elements, harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const builder = vi.hoisted(() => ({ sessionPdfBytes: vi.fn(), pdfFileName: vi.fn(() => 'NTER-factcheck-test.pdf') }));
vi.mock('./claimPdf.js', () => builder);
const { PdfButton, CLAIM_EXPORT_TEXT } = await import('./ClaimExport.jsx');

const args = { title: 'Evening news', link: 'https://www.youtube.com/watch?v=abcdefghijk', date: '2026-11-18', minutes: 5, items: [{ claim: { id: '1' }, shown: {} }], note: '', timeZone: 'UTC' };
const button = (props = {}) => {
  const out = harness.render(PdfButton, { build: () => args, say: () => {}, ...props });
  return [...elements(out)].find((e) => e.type === 'button');
};

let anchor; let created; let revoked;
beforeEach(() => {
  harness.reset(); vi.clearAllMocks(); vi.useFakeTimers();
  builder.sessionPdfBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  anchor = { click: vi.fn(), remove: vi.fn(), style: {} };
  created = []; revoked = [];
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
  vi.stubGlobal('URL', { createObjectURL: (b) => { created.push(b); return 'blob:pdf'; }, revokeObjectURL: (u) => revoked.push(u) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PdfButton', () => {
  it('is a labelled export-style button, keyed by dataKey, and disabled with no claims', () => {
    const b = button();
    expect(b.props.children).toBe('Download PDF');
    expect(b.props.className).toBe('ltv-action-btn fc-btn');
    expect(b.props['data-fc']).toBe('pdf');
    expect(b.props.disabled).toBe(false);
    harness.reset();
    expect(button({ dataKey: 'pst' }).props['data-pst']).toBe('pdf');
    harness.reset();
    expect(button({ disabled: true }).props.disabled).toBe(true);
  });

  it('builds with the data it was given, saves an application/pdf Blob under the file name, frees the URL, announces', async () => {
    const say = vi.fn();
    await button({ say }).props.onClick();
    expect(builder.sessionPdfBytes).toHaveBeenCalledWith(args);
    expect(builder.pdfFileName).toHaveBeenCalledWith({ title: 'Evening news', date: '2026-11-18', timeZone: 'UTC' });
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/pdf');
    expect(anchor.download).toBe('NTER-factcheck-test.pdf');
    expect(anchor.href).toBe('blob:pdf');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29000);
    expect(revoked).toEqual([]); // a slow save dialog still needs the address
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(['blob:pdf']);
    expect(say).toHaveBeenCalledWith(CLAIM_EXPORT_TEXT.pdfDone);
    expect(CLAIM_EXPORT_TEXT.pdfDone).toBe('PDF downloaded.');
  });

  it('stays focusable while busy: aria-disabled, never the disabled attribute, and a second press does nothing', async () => {
    let finish;
    const save = vi.fn(() => new Promise((r) => { finish = r; }));
    const pending = button({ save }).props.onClick();
    const busy = button({ save });
    expect(busy.props.disabled).toBe(false);
    expect(busy.props['aria-disabled']).toBe('true');
    expect(busy.props['aria-busy']).toBe('true');
    await busy.props.onClick();
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(button({ save }).props['aria-disabled']).toBeUndefined();
    harness.reset();
    expect(button({ disabled: true }).props.disabled).toBe(true);
  });

  it('is aria-busy while the file is made, then free again', async () => {
    let finish;
    builder.sessionPdfBytes.mockReturnValue(new Promise((r) => { finish = r; }));
    const first = button();
    const pending = first.props.onClick();
    const busy = button();
    expect(busy.props['aria-busy']).toBe('true');
    finish(new Uint8Array([1]));
    await pending;
    const done = button();
    expect(done.props.disabled).toBe(false);
    expect(done.props['aria-busy']).toBeUndefined();
  });

  it('says it plainly when the builder fails, does not throw, and does not save anything', async () => {
    builder.sessionPdfBytes.mockRejectedValue(new Error('canvas'));
    const say = vi.fn();
    await expect(button({ say }).props.onClick()).resolves.toBeUndefined();
    expect(say).toHaveBeenCalledWith('Could not make the PDF. Try again.');
    expect(created).toHaveLength(0);
    expect(button().props.disabled).toBe(false);
  });

  it('a failing data build is a failure message too', async () => {
    const say = vi.fn();
    await button({ say, build: () => { throw new Error('x'); } }).props.onClick();
    expect(say).toHaveBeenCalledWith(CLAIM_EXPORT_TEXT.pdfFailed);
  });
});
