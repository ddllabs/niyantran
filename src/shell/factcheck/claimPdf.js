// F387 (Task B): the PDF of a fact-check session. Loaded only when the Download PDF button is pressed (dynamic
// import), so pdf-lib stays out of the main bundle.
//
// Text path: Latin text is real PDF text (Helvetica, searchable). Hindi and every other script that needs shaping
// are NOT drawn as embedded-font text: pdf-lib applies glyph substitution but ignores positioning, and a
// proof with Noto Sans Devanagari put the short-i and long-ii vowel signs (matras) in the wrong place. So a line holding any character
// outside the Latin set is drawn by the browser's canvas 2D text (which shapes correctly) at 2x scale and placed
// as a PNG; the rasteriser is injectable so the layout is testable without a browser. Source links stay clickable
// either way: the URL is always Latin text, and a link annotation covers the whole source entry.
import { PDFDocument, PDFHexString, StandardFonts, rgb } from 'pdf-lib';
import { FILTER_KEYS } from './claimFilter.js';
import { VERDICTS, claimBadge, formatClock, safeSourceUrl } from './factCheckText.js';
import { AUTOMATED_LINE } from './claimExport.js';
import { cleanLine, dateStamp, transcriptFileName } from './transcriptTools.js';

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const RASTER_SCALE = 2;
const YIELD_EVERY = 5; // claims between breaks that let the browser paint, so a 300-claim session does not freeze the tab
const LINK_COLOR = [0.05, 0.27, 0.65];
const INK = [0.1, 0.1, 0.12];
const MUTED = [0.4, 0.4, 0.45];
const VERDICT_INK = { supported: [0.07, 0.4, 0.2], contradicted: [0.7, 0.1, 0.1] };

// What Helvetica (WinAnsi) can draw. Anything else goes through the rasteriser.
const WIN_ANSI = /^[\x20-\x7E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]*$/;

// Characters Helvetica lacks that have a plain Latin stand-in. Applied ONLY when the line is then fully drawable as
// text; a line with any real non-Latin script still goes to the rasteriser untouched. (The curly quotes, dashes,
// ellipsis, bullet, euro and trademark signs are in WinAnsi already and are drawn as they are.)
const LATIN_STAND_IN = { '\u20B9': 'Rs ', '\u2192': '->', '\u2190': '<-', '\u2212': '-', '\u2010': '-', '\u2011': '-' };
const STAND_IN = new RegExp(`[${Object.keys(LATIN_STAND_IN).join('')}]`, 'g');
const latinStandIn = (t) => t.replace(STAND_IN, (c) => LATIN_STAND_IN[c]);

const oneLine = cleanLine;

/**
 * An address safe to write into a PDF object: parentheses and backslashes are percent-encoded (they are the string
 * delimiters of PDF syntax) and anything still outside printable ASCII is refused (new URL().href already encodes
 * non-ASCII, so this only rejects what is not a plain address).
 */
function pdfSafeUri(href) {
  const encoded = String(href).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\\/g, '%5C');
  return /^[\x21-\x7E]+$/.test(encoded) ? encoded : '';
}

/** The same http(s)-only "title + address" pairs the text export lists; the title can not point anywhere else. */
function sourceEntries(result) {
  return (Array.isArray(result?.sources) ? result.sources : []).flatMap((src) => {
    const href = safeSourceUrl(src?.url);
    if (!href) return [];
    const title = oneLine(oneLine(src?.title).replace(/https?:\/\/\S*/gi, ' '));
    return [{ href, title }];
  });
}

export function pdfFileName({ title = '', date = '', timeZone = undefined } = {}) {
  return transcriptFileName({ title, date, prefix: 'NTER-factcheck', timeZone }).replace(/\.txt$/, '.pdf');
}

const graphemes = (s) => (typeof Intl !== 'undefined' && Intl.Segmenter
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
  : Array.from(s));
const wordParts = (s) => (typeof Intl !== 'undefined' && Intl.Segmenter
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(s), (x) => x.segment)
  : s.split(/(\s+)/).filter(Boolean));

/** Greedy wrap of one clean line to `maxWidth`, by words, breaking a word wider than a line by grapheme. */
function wrapText(text, measure, maxWidth) {
  const lines = [];
  let cur = '';
  const push = () => { const t = cur.trimEnd(); if (t) lines.push(t); cur = ''; };
  for (const part of wordParts(text)) {
    if (measure(cur + part) <= maxWidth) { cur += part; continue; }
    if (!/\S/.test(part)) { push(); continue; }
    push();
    if (measure(part) <= maxWidth) { cur = part; continue; }
    for (const g of graphemes(part)) {
      if (cur && measure(cur + g) > maxWidth) push();
      cur += g;
    }
  }
  push();
  return lines.length ? lines : [''];
}

/** Browser rasteriser: wraps `text` to `maxWidthPt` and returns one PNG per line, drawn by canvas 2D text. */
async function canvasRasterise({ text, size, maxWidthPt, bold, color, lineHeight }) {
  const px = size * RASTER_SCALE;
  const font = `${bold ? '700 ' : ''}${px}px "Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", "Nirmala UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif`;
  const make = (w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  };
  const probe = make(8, 8).getContext('2d');
  probe.font = font;
  // Limit: when the browser cannot draw the text at all (measureText gives 0 for a non-empty string, e.g. no font for
  // the script) there is no way to tell here; the width is then estimated and the line is drawn as-is (blank or boxes
  // at worst). No font is downloaded. It never throws for that; real failures are caught by the caller.
  const measure = (s) => {
    const w = probe.measureText(s).width / RASTER_SCALE;
    return w > 0 || !s ? w : s.length * size * 0.55;
  };
  const out = [];
  for (const line of wrapText(text, measure, maxWidthPt)) {
    const widthPt = Math.max(1, Math.ceil(measure(line)) + 2);
    const canvas = make(Math.ceil(widthPt * RASTER_SCALE), Math.ceil(lineHeight * RASTER_SCALE));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = `rgb(${color.map((c) => Math.round(c * 255)).join(',')})`;
    ctx.textBaseline = 'middle';
    ctx.fillText(line, 0, canvas.height / 2);
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise((res) => canvas.toBlob(res, 'image/png'));
    out.push({ png: new Uint8Array(await blob.arrayBuffer()), widthPt, heightPt: lineHeight });
  }
  return out;
}

/**
 * The bytes of the session PDF. `items` are { claim, shown } as sessionExportText takes them. `options.rasterise`
 * ({ text, size, maxWidthPt, bold, color, lineHeight }) -> [{ png, widthPt, heightPt }] replaces the canvas
 * rasteriser (tests).
 */
export async function sessionPdfBytes({ title = '', link = '', date = '', minutes = null, items = [], note = '', timeZone = undefined } = {}, options = {}) {
  const rasterise = options.rasterise || canvasRasterise;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const name = oneLine(title);
  doc.setTitle(name ? `Fact-check: ${name}` : 'Fact-check');
  doc.setCreator('Niyantran Terminal');
  doc.setProducer('Niyantran Terminal');
  doc.setCreationDate(new Date());

  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const textW = PAGE.w - MARGIN * 2;
  const newPage = () => { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - MARGIN; };
  const ensure = (h) => { if (y - h < MARGIN) newPage(); };

  const rasterCache = new Map();

  /** Draws one clean line of text wrapped inside the column; returns the rectangles it used (for links). */
  const block = async (text, { size = 10, isBold = false, color = INK, indent = 0, gap = 3 } = {}) => {
    const lineHeight = size * 1.45;
    const x = MARGIN + indent;
    const width = textW - indent;
    const rects = [];
    const place = (h) => { ensure(h); y -= h; return y; };
    const drawable = WIN_ANSI.test(text) ? text : latinStandIn(text);
    if (WIN_ANSI.test(drawable)) {
      const font = isBold ? bold : regular;
      for (const line of wrapText(drawable, (s) => font.widthOfTextAtSize(s, size), width)) {
        const bottom = place(lineHeight);
        page.drawText(line, { x, y: bottom + (lineHeight - size) / 2 + size * 0.15, size, font, color: rgb(...color) });
        rects.push({ page, x, y: bottom, w: font.widthOfTextAtSize(line, size), h: lineHeight });
      }
    } else {
      // The same line (text and style) repeats often (headings, "Verdict: ..."), so it is rasterised and embedded once.
      const key = JSON.stringify([text, size, width, isBold, color, lineHeight]);
      let images = rasterCache.get(key);
      if (!images) {
        try {
          images = [];
          for (const img of await rasterise({ text, size, maxWidthPt: width, bold: isBold, color, lineHeight })) {
            images.push({ ...img, embedded: await doc.embedPng(img.png) });
          }
        } catch {
          images = null; // the browser could not draw it: fall back to Helvetica with '?' for what it lacks
        }
        rasterCache.set(key, images);
      }
      if (images) {
        for (const img of images) {
          const bottom = place(img.heightPt);
          page.drawImage(img.embedded, { x, y: bottom, width: img.widthPt, height: img.heightPt });
          rects.push({ page, x, y: bottom, w: img.widthPt, h: img.heightPt });
        }
      } else {
        const font = isBold ? bold : regular;
        const plain = Array.from(text, (ch) => (WIN_ANSI.test(ch) ? ch : '?')).join('');
        for (const line of wrapText(plain, (s2) => font.widthOfTextAtSize(s2, size), width)) {
          const bottom = place(lineHeight);
          page.drawText(line, { x, y: bottom + (lineHeight - size) / 2 + size * 0.15, size, font, color: rgb(...color) });
          rects.push({ page, x, y: bottom, w: font.widthOfTextAtSize(line, size), h: lineHeight });
        }
      }
    }
    y -= gap;
    return rects;
  };

  const addLink = ({ page: p, x, y: ry, w, h }, href) => {
    const uri = pdfSafeUri(href);
    if (!uri) return;
    // PDFHexString over the plain ASCII bytes (not fromText, which would add a UTF-16 byte-order mark to the address): no raw string syntax is ever written (PDFString writes its value unescaped).
    const annot = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x, ry, x + w, ry + h], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFHexString.of(Array.from(uri, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')) },
    }));
    p.node.addAnnot(annot);
  };

  // Header.
  await block('Niyantran Terminal (NTER)', { size: 17, isBold: true, gap: 0 });
  await block('Fact-check session', { size: 11, color: MUTED, gap: 4 });
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.w - MARGIN, y }, thickness: 0.75, color: rgb(0.75, 0.75, 0.78) });
  y -= 12;

  if (name) await block(name, { size: 13, isBold: true, gap: 4 });
  const rawLink = oneLine(link);
  const linkHref = safeSourceUrl(rawLink);
  if (rawLink) {
    await block('Link', { size: 8.5, color: MUTED, gap: 0 });
    const rects = await block(linkHref || rawLink, { size: 9.5, color: linkHref ? LINK_COLOR : INK });
    if (linkHref) rects.forEach((r) => addLink(r, linkHref));
  }
  const day = dateStamp(date, timeZone);
  if (day) await block(`Date: ${day}`);
  if (typeof minutes === 'number' && Number.isFinite(minutes)) await block(`Minutes checked: ${minutes}`);
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0]));
  let other = 0;
  for (const { claim, shown } of items) {
    const key = claimBadge(shown || claim).key;
    if (Object.hasOwn(counts, key)) counts[key] += 1; else other += 1;
  }
  const byVerdict = FILTER_KEYS.map((k) => `${VERDICTS[k].label} ${counts[k]}`).join(', ');
  await block(items.length ? `Claims: ${items.length} (${byVerdict}${other ? `; other ${other}` : ''})` : 'Claims: 0');
  const cut = oneLine(note);
  if (cut) await block(cut, { color: MUTED });
  y -= 8;

  if (!items.length) await block('No claims.', { gap: 6 });
  for (let i = 0; i < items.length; i += 1) {
    const { claim, shown } = items[i];
    const result = shown || claim;
    const badge = claimBadge(result);
    ensure(70);
    if (i > 0 && i % YIELD_EVERY === 0) await new Promise((r) => { setTimeout(r, 0); });
    await block(`${i + 1}. ${oneLine(claim?.claim_en)}`, { size: 11, isBold: true, gap: 2 });
    if (typeof claim?.position_s === 'number') await block(`Time: ${formatClock(claim.position_s)}`, { indent: 14, color: MUTED, gap: 1 });
    await block(`Verdict: ${badge.label}`, { indent: 14, isBold: true, color: VERDICT_INK[badge.key] || INK, gap: 1 });
    const reason = oneLine(result?.reason);
    if (reason) await block(`Reason: ${reason}`, { indent: 14, gap: 1 });
    const sources = sourceEntries(result);
    if (sources.length) {
      await block('Sources:', { indent: 14, gap: 1 });
      for (const { href, title } of sources) {
        const rects = [];
        if (title) rects.push(...await block(`\u2022 ${title}`, { indent: 26, gap: 0 }));
        rects.push(...await block(title ? href : `\u2022 ${href}`, { indent: title ? 34 : 26, size: 9, color: LINK_COLOR, gap: 2 }));
        rects.forEach((r) => addLink(r, href));
      }
    }
    const when = dateStamp(result?.checked_at, timeZone);
    if (when) await block(`Checked: ${when}`, { indent: 14, color: MUTED, gap: 1 });
    y -= 8;
  }

  ensure(30);
  y -= 4;
  await block(AUTOMATED_LINE, { size: 9.5, isBold: true, color: MUTED });
  return doc.save();
}
