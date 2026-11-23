// PDF and Word files made on the phone (no server): pdf-lib with the Inter typeface for PDF,
// docx for Word. On a phone the file is saved to the app's cache and handed to the share sheet;
// in a browser it downloads.
import { isNative } from './platform.js';
import { rowFields, rowLink } from '../services/shape.js';
import interRegularUrl from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import interBoldUrl from '@fontsource/inter/files/inter-latin-600-normal.woff?url';

const slug = (s) => String(s || 'nter-document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'nter-document';

function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export async function saveFile(name, bytes, mime) {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache, recursive: true });
    await Share.share({ title: name, files: [written.uri], dialogTitle: 'Save or send' });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// HTML blocks (Studio's markup) → paragraphs of runs: [{ runs: [{text, bold, italic}], bullet }]
export function htmlToParas(html) {
  if (typeof DOMParser === 'undefined') return [{ runs: [{ text: String(html || '').replace(/<[^>]+>/g, '') }] }];
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const paras = [];
  let cur = null;
  const start = (bullet = null) => { cur = { runs: [], bullet }; paras.push(cur); };
  const walk = (node, style, listTag) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.textContent.replace(/\s+/g, ' ');
        if (!t.trim() && !cur) continue;
        if (!cur) start();
        cur.runs.push({ text: t, ...style });
      } else if (n.nodeType === 1) {
        const tag = n.tagName;
        if (tag === 'P' || tag === 'DIV') { start(); walk(n, style, listTag); cur = null; }
        else if (tag === 'BR') start();
        else if (tag === 'UL' || tag === 'OL') { walk(n, style, tag); cur = null; }
        else if (tag === 'LI') { start(listTag === 'OL' ? 'number' : 'bullet'); walk(n, style, listTag); cur = null; }
        else if (tag === 'B' || tag === 'STRONG') walk(n, { ...style, bold: true }, listTag);
        else if (tag === 'I' || tag === 'EM') walk(n, { ...style, italic: true }, listTag);
        else if (tag === 'MARK') walk(n, { ...style, mark: n.className || 'mk' }, listTag);
        else walk(n, style, listTag);
      }
    }
  };
  walk(doc.body.firstChild, {}, null);
  return paras.filter((p) => p.runs.some((r) => r.text.trim()));
}

// ---------- PDF ----------
const SUBS = { '₹': 'Rs.', '→': '->', '←': '<-', '✦': '*', '✳': '*', '★': '*', '✓': 'v', '×': 'x', '≈': '~', '·': '·' };
async function pdfKit() {
  const [{ PDFDocument, rgb }, fontkit] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit').then((m) => m.default || m)]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [reg, bold] = await Promise.all([interRegularUrl, interBoldUrl].map((u) => fetch(u).then((r) => r.arrayBuffer())));
  const font = await doc.embedFont(reg, { subset: true });
  const fontB = await doc.embedFont(bold, { subset: true });
  const have = new Set(font.getCharacterSet());
  const clean = (s) => [...String(s ?? '')].map((ch) => (have.has(ch.codePointAt(0)) ? ch : (SUBS[ch] ?? (/\s/.test(ch) ? ' ' : '?')))).join('');
  return { doc, font, fontB, rgb, clean };
}

class Writer {
  constructor(kit) {
    Object.assign(this, kit);
    this.W = 595.28; this.H = 841.89; this.M = 54; this.y = 0; this.page = null;
    this.ink = kit.rgb(0.075, 0.075, 0.075); this.muted = kit.rgb(0.43, 0.4, 0.37); this.accent = kit.rgb(0.004, 0.18, 0.63); this.purple = kit.rgb(0.31, 0.11, 0.56);
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([this.W, this.H]);
    this.y = this.H - this.M;
    this.page.drawRectangle({ x: 0, y: this.H - 5, width: this.W, height: 5, color: this.accent });
  }
  ensure(h) { if (this.y - h < this.M) this.newPage(); }
  // Wraps runs of mixed weight into lines inside the margins.
  runs(runs, { size = 10.5, lead = 1.45, indent = 0, color } = {}) {
    const maxW = this.W - this.M * 2 - indent;
    const words = [];
    for (const r of runs) for (const w of this.clean(r.text).split(/(\s+)/)) if (w) words.push({ w, bold: r.bold, mark: r.mark });
    let line = []; let width = 0;
    const flush = () => {
      if (!line.length) return;
      this.ensure(size * lead);
      let x = this.M + indent;
      for (const part of line) {
        const f = part.bold ? this.fontB : this.font;
        const c = part.mark ? (part.mark.includes('non') ? this.rgb(0.78, 0.07, 0.13) : part.mark.includes('txt') ? this.rgb(0.6, 0.39, 0.06) : this.accent) : (color || this.ink);
        this.page.drawText(part.w, { x, y: this.y - size, size, font: f, color: c });
        x += f.widthOfTextAtSize(part.w, size);
      }
      this.y -= size * lead;
      line = []; width = 0;
    };
    for (const part of words) {
      const f = part.bold ? this.fontB : this.font;
      const pw = f.widthOfTextAtSize(part.w, size);
      if (width + pw > maxW && line.length && part.w.trim()) { flush(); if (!part.w.trim()) continue; }
      if (!line.length && !part.w.trim()) continue;
      line.push(part); width += pw;
    }
    flush();
  }
  text(t, opts) { this.runs([{ text: t, bold: opts?.bold }], opts); }
  gap(h = 6) { this.y -= h; }
  label(t) { this.gap(6); this.ensure(14); this.page.drawText(this.clean(t.toUpperCase()), { x: this.M, y: this.y - 8, size: 7.5, font: this.fontB, color: this.purple }); this.y -= 14; }
  paras(paras) {
    for (const p of paras) {
      if (p.bullet) this.runs([{ text: '•  ' }, ...p.runs], { indent: 4 });
      else this.runs(p.runs);
      this.gap(3);
    }
  }
}

async function makePdf({ title, subtitle, blocks, stamps, notEst }) {
  const kit = await pdfKit();
  const w = new Writer(kit);
  w.page.drawText('nter.pro', { x: w.M, y: w.y - 9, size: 9, font: kit.fontB, color: w.accent });
  w.y -= 22;
  w.text(title, { size: 17, bold: true, lead: 1.25 });
  if (subtitle) { w.gap(2); w.text(subtitle, { size: 9, color: w.muted }); }
  w.gap(8);
  for (const b of blocks) {
    if (b.lab) w.label(b.lab);
    w.paras(htmlToParas(b.html));
  }
  if (stamps) { w.label('Stamps'); w.text(stamps, { size: 8.5, color: w.muted }); }
  if (notEst) { w.label('Not established'); w.text(notEst, { size: 8.5, color: w.muted }); }
  w.gap(10);
  w.text(`Made with nter.pro · ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · formatted, not filed: check before you sign.`, { size: 7.5, color: w.muted });
  kit.doc.setTitle(kit.clean(title)); kit.doc.setCreator('nter.pro mobile'); kit.doc.setProducer('nter.pro');
  return kit.doc.save();
}

// ---------- Word ----------
async function makeDocx({ title, subtitle, blocks, stamps, notEst }) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] })];
  if (subtitle) children.push(new Paragraph({ children: [new TextRun({ text: subtitle, color: '6D675F', size: 18 })] }));
  const label = (t) => new Paragraph({ spacing: { before: 240, after: 60 }, children: [new TextRun({ text: t.toUpperCase(), bold: true, color: '4F1D90', size: 16 })] });
  for (const b of blocks) {
    if (b.lab) children.push(label(b.lab));
    for (const p of htmlToParas(b.html)) {
      children.push(new Paragraph({
        ...(p.bullet ? { bullet: { level: 0 } } : {}),
        children: p.runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, ...(r.mark ? { highlight: r.mark.includes('non') ? 'red' : r.mark.includes('ok') ? 'green' : 'yellow' } : {}) })),
      }));
    }
  }
  if (stamps) { children.push(label('Stamps')); children.push(new Paragraph({ children: [new TextRun({ text: stamps, size: 18, color: '6D675F' })] })); }
  if (notEst) { children.push(label('Not established')); children.push(new Paragraph({ children: [new TextRun({ text: notEst, size: 18, color: '6D675F' })] })); }
  const doc = new Document({ creator: 'nter.pro', title, styles: { default: { document: { run: { font: 'Inter', size: 21 } } } }, sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportDocument({ title, subtitle, blocks, text, format = 'PDF', stamps, notEst }) {
  const name = slug(title);
  if (format === 'DOCX') return saveFile(`${name}.docx`, await makeDocx({ title, subtitle, blocks, stamps, notEst }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if (format === 'PDF' || format === 'TRADE') return saveFile(`${name}.pdf`, await makePdf({ title, subtitle, blocks, stamps, notEst }), 'application/pdf');
  // Formats without a builder on the phone travel as text.
  return saveFile(`${name}.txt`, new TextEncoder().encode(`${title}\n\n${text || ''}`), 'text/plain');
}

export async function exportRecordPdf({ module, row, title, brief }) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fields = rowFields(row).map((f) => `<p><b>${esc(f.label)}:</b> ${esc(f.value)}</p>`).join('');
  const blocks = [{ lab: 'Record', html: fields }];
  if (brief?.lead) blocks.push({ lab: 'AI brief', html: `<p>${esc(brief.lead)}</p>${brief.why ? `<p><b>Why it matters:</b> ${esc(brief.why)}</p>` : ''}${brief.watch ? `<p><b>Watch for:</b> ${esc(brief.watch)}</p>` : ''}` });
  const link = rowLink(row);
  return exportDocument({ title, subtitle: `${module.title} · ${module.deskName || module.desk} desk${link ? ` · ${link}` : ''}`, blocks, format: 'PDF' });
}
