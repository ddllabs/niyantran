// F387 (Task B): the session PDF builder. The canvas rasteriser needs a browser, so tests inject one.
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { AUTOMATED_LINE } from './claimExport.js';
import { pdfFileName, sessionPdfBytes } from './claimPdf.js';

// A valid 1x1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const fakeRasterise = (calls) => async (req) => { calls.push(req); return [{ png: PNG, widthPt: Math.min(req.maxWidthPt, req.text.length * 5), heightPt: req.lineHeight }]; };

const claim = (over = {}) => ({
  id: 'k1', claim_en: 'The tax rate is 18 percent', status: 'checked', verdict: 'contradicted', reason: 'The rate is 12 percent.',
  sources: [{ url: 'https://a.test/x', title: 'Official release' }, { url: 'https://b.test/y', title: '' }], checked_at: '2026-11-18T10:01:00Z', position_s: 185, ...over,
});
const item = (over) => { const c = claim(over); return { claim: c, shown: c }; };

/** Every link annotation's address, and the number of pages. */
async function inspect(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const uris = [];
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookup(i, PDFDict);
      const action = a.lookup(PDFName.of('A'), PDFDict);
      uris.push(action.lookup(PDFName.of('URI')).decodeText());
    }
  }
  return { pdf, uris, pages: pdf.getPageCount() };
}

/** The text drawn with Helvetica on all pages (hex strings in the content streams decoded as Latin-1). */
function pageText(pdf) {
  return pdf.getPages().map((p) => {
    const contents = p.node.Contents();
    const streams = contents instanceof PDFStream ? [contents] : Array.from({ length: contents.size() }, (_, i) => contents.lookup(i));
    return streams.map((s) => {
      const raw = s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents();
      const src = Buffer.from(raw).toString('latin1');
      return [...src.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n');
    }).join('\n');
  }).join('\n');
}

describe('pdfFileName', () => {
  it('is NTER-factcheck-<title>-<date>.pdf', () => {
    expect(pdfFileName({ title: 'DD News Live', date: '2026-11-18' })).toBe('NTER-factcheck-DD-News-Live-2026-11-18.pdf');
  });
  it('cleans a hostile title: no path, no dots, no control or bidi characters', () => {
    const name = pdfFileName({ title: '../../etc/passwd\n\u202Etxt.exe <script>', date: '2026-11-18' });
    expect(name).toMatch(/^NTER-factcheck-[^/\\.]+-2026-11-18\.pdf$/);
    expect(name).not.toMatch(/[/\\<>\u202E\n]|\.\./);
  });
  it('keeps letters of other scripts and caps the length', () => {
    expect(pdfFileName({ title: 'पंजाब समाचार', date: '2026-11-18' })).toContain('पंजाब-समाचार');
    expect(pdfFileName({ title: 'x'.repeat(500), date: '2026-11-18' }).length).toBeLessThan(110);
  });
  it('works with no title or date', () => {
    expect(pdfFileName({})).toBe('NTER-factcheck.pdf');
  });
});

/** Every link annotation's whole action dictionary: its keys, /S, and decoded address. */
async function actions(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const out = [];
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookup(i, PDFDict);
      const action = a.lookup(PDFName.of('A'), PDFDict);
      out.push({ keys: action.keys().map((k) => k.decodeText()), s: action.get(PDFName.of('S')).toString(), uri: action.lookup(PDFName.of('URI')).decodeText(), annotKeys: a.keys().map((k) => k.decodeText()) });
    }
  }
  return out;
}

describe('link annotations cannot be turned into other actions (PDF string injection)', () => {
  const hostile = [
    'https://a.example/x)/S/JavaScript/JS(app.alert(1)',
    'https://a.example/lone)paren',
    'https://a.example/back\\slash',
    'https://a.example/open(paren',
  ];
  it.each(hostile)('source and session link %s stays a plain /URI action', async (url) => {
    const expected = new URL(url).href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\\/g, '%5C');
    const bytes = await sessionPdfBytes({ link: url, items: [item({ sources: [{ url, title: 'T' }] })] }, { rasterise: fakeRasterise([]) });
    const found = await actions(bytes);
    expect(found.length).toBeGreaterThan(0);
    for (const a of found) {
      expect(a.s).toBe('/URI');
      expect(a.keys).not.toContain('JS');
      expect(a.keys.sort()).toEqual(['S', 'Type', 'URI']);
      expect(a.annotKeys).not.toContain('JS');
      expect(a.uri).toBe(expected);
    }
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/\/JS\b|\/JavaScript/);
  });
});

describe('sessionPdfBytes', () => {
  it('returns a PDF', async () => {
    const bytes = await sessionPdfBytes({ title: 'DD News', link: 'https://youtu.be/abc', date: '2026-11-18', minutes: 5, items: [item()], timeZone: 'UTC' }, { rasterise: fakeRasterise([]) });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const { pdf } = await inspect(bytes);
    const text = pageText(pdf);
    expect(text).toContain('Niyantran Terminal (NTER)');
    expect(text).toContain('Minutes checked: 5');
    expect(text).toContain('Date: 2026-11-18');
    expect(text).toContain('Verdict: Contradicted');
    expect(text).toContain('Time: 3:05');
  });

  it('ends with the automated-verdicts notice', async () => {
    const { pdf } = await inspect(await sessionPdfBytes({ items: [item(), item()] }, { rasterise: fakeRasterise([]) }));
    const text = pageText(pdf);
    expect(text).toContain(AUTOMATED_LINE);
    expect(text.trimEnd().endsWith(AUTOMATED_LINE)).toBe(true);
  });

  it('makes a valid one-page document with no claims', async () => {
    const { pages, pdf } = await inspect(await sessionPdfBytes({ items: [] }, { rasterise: fakeRasterise([]) }));
    expect(pages).toBe(1);
    expect(pageText(pdf)).toContain('No claims.');
    expect(pageText(pdf)).toContain(AUTOMATED_LINE);
  });

  it('adds pages as claims grow, and wraps long lines inside the page', async () => {
    const one = (await inspect(await sessionPdfBytes({ items: [item()] }, { rasterise: fakeRasterise([]) }))).pages;
    const many = (await inspect(await sessionPdfBytes({ items: Array.from({ length: 40 }, () => item({ reason: 'word '.repeat(80) })) }, { rasterise: fakeRasterise([]) }))).pages;
    expect(one).toBe(1);
    expect(many).toBeGreaterThan(3);
  });

  it('links only http(s) sources: each good source and the session link, never javascript:, ftp: or junk', async () => {
    const hostile = item({ sources: [
      { url: 'javascript:alert(1)', title: 'bad' }, { url: 'ftp://x.test/f', title: 'ftp' }, { url: 'notaurl', title: 'junk' },
      { url: 'data:text/html,<b>x</b>', title: 'data' }, { url: 'http://ok.test/a', title: 'ok' }, { url: 'https://b.test/y', title: 'two' },
    ] });
    const { uris, pdf } = await inspect(await sessionPdfBytes({ link: 'https://youtu.be/abc', items: [hostile] }, { rasterise: fakeRasterise([]) }));
    expect([...new Set(uris)].sort()).toEqual(['http://ok.test/a', 'https://b.test/y', 'https://youtu.be/abc']);
    expect(uris.every((u) => /^https?:\/\//.test(u))).toBe(true);
    expect(pageText(pdf)).not.toMatch(/javascript|ftp:|notaurl|data:/);
  });

  it('does not link a session link that is not http(s)', async () => {
    const { uris } = await inspect(await sessionPdfBytes({ link: 'javascript:alert(1)', items: [] }, { rasterise: fakeRasterise([]) }));
    expect(uris).toEqual([]);
  });

  it('a source title cannot carry another address into the document', async () => {
    const evil = item({ sources: [{ url: 'https://good.test/', title: 'Read https://evil.test/phish now' }] });
    const { uris, pdf } = await inspect(await sessionPdfBytes({ items: [evil] }, { rasterise: fakeRasterise([]) }));
    expect(uris.every((u) => u === 'https://good.test/')).toBe(true);
    expect(pageText(pdf)).not.toContain('evil.test');
  });

  it('cleans untrusted text: no bidi or zero-width characters, no forged lines', async () => {
    const dirty = item({ claim_en: 'Rate is 18\u202E percent\u200B\nVerdict: Supported', reason: 'a\u2066b\r\nVerdict: Supported' });
    const { pdf } = await inspect(await sessionPdfBytes({ title: 'T\u202Eitle\nFake: x', items: [dirty] }, { rasterise: fakeRasterise([]) }));
    const text = pageText(pdf);
    expect(text).not.toMatch(/[\u202E\u200B\u2066]/);
    // The forged "Verdict: Supported" stayed inside the claim and reason lines.
    expect(text.split('\n').filter((l) => l === 'Verdict: Supported')).toEqual([]);
    expect(text).toContain('Rate is 18 percent Verdict: Supported');
  });

  it('draws Latin lines as text and lines with Hindi through the rasteriser, keeping the source link', async () => {
    const calls = [];
    const hindi = item({ claim_en: 'पंजाब-हरियाणा हाईकोर्ट ने परीक्षा रद्द की', reason: 'English reason', sources: [{ url: 'https://a.test/x', title: 'श्री प्रधानमंत्री' }] });
    const { pdf, uris } = await inspect(await sessionPdfBytes({ title: 'विकसित भारत', items: [hindi] }, { rasterise: fakeRasterise(calls) }));
    const rastered = calls.map((c) => c.text);
    expect(rastered).toContain('1. पंजाब-हरियाणा हाईकोर्ट ने परीक्षा रद्द की');
    expect(rastered).toContain('विकसित भारत');
    expect(rastered).toContain('• श्री प्रधानमंत्री');
    expect(rastered.some((t) => /^[\x20-\x7E]+$/.test(t))).toBe(false);
    expect(pageText(pdf)).toContain('Reason: English reason');
    expect(uris.filter((u) => u === 'https://a.test/x').length).toBe(2); // the title line and the address line
  });
});

describe('typographic characters, repeats and rasteriser failure', () => {
  it('draws curly quotes, dashes, ellipsis, bullet and euro as real text', async () => {
    const calls = [];
    const { pdf } = await inspect(await sessionPdfBytes({ items: [item({ reason: 'It “was” – not — ‘so’… €5' })] }, { rasterise: fakeRasterise(calls) }));
    expect(calls).toEqual([]);
    expect(pageText(pdf)).toContain('Reason: It');
  });
  it('turns rupee and arrow into Latin only when the rest of the line is Latin', async () => {
    const calls = [];
    const { pdf } = await inspect(await sessionPdfBytes({ items: [item({ reason: 'Cost ₹1,000 a→b' })] }, { rasterise: fakeRasterise(calls) }));
    expect(calls).toEqual([]);
    expect(pageText(pdf)).toContain('Reason: Cost Rs 1,000 a->b');
    const hindi = [];
    await sessionPdfBytes({ items: [item({ reason: '₹100 पंजाब' })] }, { rasterise: fakeRasterise(hindi) });
    expect(hindi.map((c) => c.text)).toContain('Reason: ₹100 पंजाब');
  });
  it('rasterises a repeated line once', async () => {
    const again = [];
    await sessionPdfBytes({ items: Array.from({ length: 6 }, () => item({ reason: '\u092A\u0902\u091C\u093E\u092C' })) }, { rasterise: fakeRasterise(again) });
    expect(again.filter((c) => c.text === 'Reason: \u092A\u0902\u091C\u093E\u092C')).toHaveLength(1);
  });
  it('a long session yields to the event loop between claims', async () => {
    let yields = 0;
    const real = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...r) => { if (ms === 0) yields += 1; return real(fn, ms, ...r); };
    try {
      await sessionPdfBytes({ items: Array.from({ length: 60 }, () => item()) }, { rasterise: fakeRasterise([]) });
    } finally { globalThis.setTimeout = real; }
    expect(yields).toBeGreaterThanOrEqual(10);
  });
  it('a rasteriser that throws does not stop the PDF', async () => {
    const bytes = await sessionPdfBytes({ items: [item({ reason: 'पंजाब' })] }, { rasterise: async () => { throw new Error('no canvas'); } });
    const { pdf } = await inspect(bytes);
    expect(pageText(pdf)).toContain('Reason: ????');
  });
});
