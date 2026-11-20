// B2: the transcript search box, Copy and Download, with real state and effects (hookHarness.js). Confirmations
// go to the view's one shared status node through `say` (announce.jsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const { TranscriptBar, HighlightedText, TRANSCRIPT_TEXT, useTranscriptTools } = await import('./TranscriptTools.jsx');

const lines = [
  { key: 1, time: '00:05', text: 'Good evening' },
  { key: 2, time: '00:12', text: 'The GDP grew' },
  { key: 3, time: '00:20', text: 'विकास दर बढ़ी' },
];
const say = vi.fn();

// A tiny component that uses the hook the way the panel does and returns the bar and the filtered lines.
function Probe({ lines: l, title = 'DD News', date = '2026-11-19', landmark = true }) {
  const tools = useTranscriptTools({ lines: l, title, date, say });
  return { tools, bar: TranscriptBar({ tools, total: l.length, landmark }) };
}
const find = (out, pred) => [...elements(out.bar)].find(pred);
const byFc = (name) => (e) => e.props?.['data-fc'] === name;

beforeEach(() => {
  harness.reset();
  say.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { harness.unmount(); vi.unstubAllGlobals(); });

describe('search', () => {
  it('shows every line with no phrase, and only the matching lines with one', () => {
    let out = harness.render(Probe, { lines });
    expect(out.tools.shown).toHaveLength(3);
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'gdp' } });
    out = harness.render(Probe, { lines });
    expect(out.tools.shown.map((l) => l.key)).toEqual([2]);
    expect(renderToStaticMarkup(<>{find(out, byFc('tsearch-count'))}</>)).toContain('1 of 3 lines');
  });
  it('finds Devanagari text', () => {
    let out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'विकास' } });
    out = harness.render(Probe, { lines });
    expect(out.tools.shown.map((l) => l.key)).toEqual([3]);
  });
  it('says so when no line matches, and clearing brings every line back', () => {
    let out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'zzz' } });
    out = harness.render(Probe, { lines });
    expect(out.tools.shown).toHaveLength(0);
    expect(out.tools.noMatch).toBe(true);
    find(out, byFc('tsearch-clear')).props.onClick();
    out = harness.render(Probe, { lines });
    expect(out.tools.shown).toHaveLength(3);
    expect(out.tools.noMatch).toBe(false);
  });
  it('Escape in the box clears it', () => {
    let out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'gdp' } });
    out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onKeyDown({ key: 'Escape', preventDefault() {} });
    out = harness.render(Probe, { lines });
    expect(out.tools.query).toBe('');
  });
  it('keeps matching while new lines arrive', () => {
    let out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'gdp' } });
    out = harness.render(Probe, { lines: [...lines, { key: 4, time: '00:30', text: 'GDP again' }, { key: 5, time: '00:31', text: 'other' }] });
    expect(out.tools.query).toBe('gdp');
    expect(out.tools.shown.map((l) => l.key)).toEqual([2, 4]);
  });
});

describe('focus (review 7)', () => {
  const typed = () => {
    let out = harness.render(Probe, { lines });
    const input = find(out, (e) => e.type === 'input');
    input.props.onChange({ target: { value: 'gdp' } });
    out = harness.render(Probe, { lines });
    const box = { focus: vi.fn() };
    find(out, (e) => e.type === 'input').props.ref.current = box;
    return { out, box };
  };
  it('Clear, which disappears when pressed, hands focus to the search box', () => {
    const { out, box } = typed();
    find(out, byFc('tsearch-clear')).props.onClick();
    expect(box.focus).toHaveBeenCalledTimes(1);
  });
  it('Escape keeps focus in the search box', () => {
    const { out, box } = typed();
    find(out, (e) => e.type === 'input').props.onKeyDown({ key: 'Escape', preventDefault() {} });
    expect(box.focus).toHaveBeenCalled();
  });
});

describe('Copy', () => {
  it('writes the lines with their time marks to the clipboard and tells the shared status node', async () => {
    const out = harness.render(Probe, { lines });
    await find(out, byFc('tcopy')).props.onClick();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[00:05] Good evening\n[00:12] The GDP grew\n[00:20] विकास दर बढ़ी\n');
    expect(say).toHaveBeenCalledWith(TRANSCRIPT_TEXT.copied);
  });
  it('copies the whole transcript even while a search narrows the view', async () => {
    let out = harness.render(Probe, { lines });
    find(out, (e) => e.type === 'input').props.onChange({ target: { value: 'gdp' } });
    out = harness.render(Probe, { lines });
    await find(out, byFc('tcopy')).props.onClick();
    expect(navigator.clipboard.writeText.mock.calls[0][0].split('\n')).toHaveLength(4);
  });
  it('a refused clipboard gives a plain message and does not throw', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    const out = harness.render(Probe, { lines });
    await find(out, byFc('tcopy')).props.onClick();
    expect(say).toHaveBeenCalledWith(TRANSCRIPT_TEXT.copyFailed);
  });
  it('a line holding a new line cannot forge a time-marked line in the copied text', async () => {
    const out = harness.render(Probe, { lines: [{ key: 1, time: '00:05', text: 'a\n[00:59] forged' }] });
    await find(out, byFc('tcopy')).props.onClick();
    expect(navigator.clipboard.writeText.mock.calls[0][0]).toBe('[00:05] a [00:59] forged\n');
  });
});

describe('Download', () => {
  it('saves a .txt with the title, the date and the lines, named from them', () => {
    const a = { click: vi.fn(), remove: vi.fn(), style: {} };
    const Blob = vi.fn(function B(parts) { this.parts = parts; });
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', Blob);
    const out = harness.render(Probe, { lines });
    find(out, byFc('tdownload')).props.onClick();
    expect(a.download).toBe('transcript-DD-News-2026-11-19.txt');
    expect(a.click).toHaveBeenCalled();
    expect(Blob.mock.calls[0][0][0].startsWith('DD News\n2026-11-19\n\n[00:05] Good evening')).toBe(true);
    expect(say).toHaveBeenCalledWith(TRANSCRIPT_TEXT.downloaded);
  });
  it('a browser that cannot make the file gives a plain message', () => {
    vi.stubGlobal('document', undefined);
    const out = harness.render(Probe, { lines });
    find(out, byFc('tdownload')).props.onClick();
    expect(say).toHaveBeenCalledWith(TRANSCRIPT_TEXT.downloadFailed);
  });
});

describe('markup', () => {
  const tools = { query: '', setQuery() {}, shown: lines, noMatch: false, copy() {}, download() {} };
  it('has a labelled search box, two buttons and NO status node of its own', () => {
    const html = renderToStaticMarkup(<TranscriptBar tools={tools} total={3} />);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search the transcript"|<input[^>]*aria-label="Search the transcript"[^>]*type="search"/);
    expect(html).toMatch(/data-fc="tcopy"[^>]*>Copy</);
    expect(html).toMatch(/data-fc="tdownload"[^>]*>Download</);
    expect(html).not.toMatch(/role="status"|aria-live/);
    expect(html).not.toContain('data-fc="tsearch-clear"');
  });
  it('the live transcript is a named search landmark; a part is a plain labelled group (review 11)', () => {
    const live = renderToStaticMarkup(<TranscriptBar tools={tools} total={3} />);
    expect(live).toMatch(/role="search"[^>]*aria-label="Search the transcript"|aria-label="Search the transcript"[^>]*role="search"/);
    const part = renderToStaticMarkup(<TranscriptBar tools={tools} total={3} landmark={false} label="Search this part's transcript" />);
    expect(part).not.toContain('role="search"');
    expect(part).toMatch(/role="group"[^>]*aria-label="Search this part&#x27;s transcript"|aria-label="Search this part&#x27;s transcript"[^>]*role="group"/);
  });
  it('marks the matching text and leaves a line without a match as plain text', () => {
    expect(renderToStaticMarkup(<HighlightedText text="The GDP grew" query="gdp" />)).toBe('The <mark class="fc-mark">GDP</mark> grew');
    expect(renderToStaticMarkup(<HighlightedText text="plain" query="" />)).toBe('plain');
  });
});
