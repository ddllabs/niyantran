// Raw text runs of a PDF, per page and per font, for decodeShiftedText (src/lib/documentRepair.js).
// pdfjs-dist is already a dependency (package.json). Nothing here touches the network; the bytes are
// the caller's.
//
// Why the operator list and not getTextContent: a font with no ToUnicode map gives pdf.js glyph IDs, which
// is the input the decode needs, but getTextContent then turns glyph IDs 9 to 13 (which are & ' ( ) * in the
// shifted numbering) into plain spaces, so every bracket of a clause number "(a)" would be lost. The
// operator list keeps each glyph's own code (glyph.unicode equals the character code for such fonts),
// at the cost of tracking the text matrix here to know where each run sits.
//
// Output run: { str, fontName, x, endX, y, size } in page units; y grows upwards. str is the raw code of
// each glyph and no space is invented: a gap is the difference between endX and the next run's x.

const identity = () => [1, 0, 0, 1, 0, 0];

/** A TJ number at or below minus this (thousandths of an em) opens a gap wide enough to be a word space. */
const WORD_GAP_TJ = 150;

/** a x b for PDF row-vector matrices [a b c d e f]: apply a, then b. */
function mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pages: Array<Array<{ str: string, fontName: string, x: number, endX: number, y: number, size: number }>>, fonts: Record<string, { name: string | null, composite: boolean | null }> }>}
 */
export async function extractTextRuns(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { OPS } = pdfjs;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0, useSystemFonts: false }).promise;
  const pages = [];
  const fonts = {};
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const list = await page.getOperatorList(); // also loads the font objects into commonObjs
      const runs = [];
      let ctm = identity();
      let tm = identity();
      let tlm = identity();
      let fontName = null;
      let fontSize = 1;
      let leading = 0;
      let charSpacing = 0;
      let hScale = 1;
      const stack = [];
      const save = () => stack.push({ ctm, fontName, fontSize, leading, charSpacing, hScale });
      const restore = () => {
        const s = stack.pop();
        if (s) ({ ctm, fontName, fontSize, leading, charSpacing, hScale } = s);
      };
      const moveText = (tx, ty) => {
        tlm = mul([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm.slice();
      };
      const fontInfo = () => {
        if (fontName in fonts) return;
        let info = { name: null, composite: null };
        try {
          const font = page.commonObjs.get(fontName);
          info = { name: typeof font?.name === 'string' ? font.name : null, composite: typeof font?.composite === 'boolean' ? font.composite : null };
        } catch {
          // font object not resolved: the verdict then rests on the control codes alone
        }
        fonts[fontName] = info;
      };
      const advance = (dx) => {
        tm = mul([1, 0, 0, 1, dx, 0], tm);
      };
      // One showText/TJ becomes one run per stretch of glyphs. A TJ adjustment of 150 thousandths of an em
      // or more to the right is a word gap (Word writes spaces that way, with no space glyph at all), so the
      // run is cut there and the gap is left for the caller to read from endX and the next x.
      const show = (items) => {
        if (!fontName) return;
        fontInfo();
        let seg = '';
        let segStart = mul(tm, ctm);
        const flush = () => {
          if (seg) {
            const end = mul(tm, ctm);
            runs.push({ str: seg, fontName, x: segStart[4], endX: end[4], y: segStart[5], size: fontSize * Math.hypot(segStart[2], segStart[3]) });
          }
          seg = '';
        };
        for (const g of items) {
          if (typeof g === 'number') {
            const gap = g <= -WORD_GAP_TJ;
            if (gap) flush();
            advance((-g / 1000) * fontSize * hScale);
            if (gap) segStart = mul(tm, ctm);
          } else if (g && typeof g === 'object') {
            seg += g.unicode ?? '';
            advance(((g.width ?? 0) / 1000 * fontSize + charSpacing) * hScale);
          }
        }
        flush();
      };

      for (let i = 0; i < list.fnArray.length; i++) {
        const args = list.argsArray[i];
        switch (list.fnArray[i]) {
          case OPS.save: save(); break;
          case OPS.restore: restore(); break;
          case OPS.transform: ctm = mul(args, ctm); break;
          case OPS.paintFormXObjectBegin: save(); if (Array.isArray(args?.[0])) ctm = mul(args[0], ctm); break;
          case OPS.paintFormXObjectEnd: restore(); break;
          case OPS.beginText: tm = identity(); tlm = identity(); break;
          case OPS.setFont: fontName = args[0]; fontSize = args[1]; break;
          case OPS.setTextMatrix: tm = args.slice(); tlm = args.slice(); break;
          case OPS.moveText: moveText(args[0], args[1]); break;
          case OPS.setLeadingMoveText: leading = -args[1]; moveText(args[0], args[1]); break;
          case OPS.setLeading: leading = args[0]; break;
          case OPS.nextLine: moveText(0, -leading); break;
          case OPS.setCharSpacing: charSpacing = args[0]; break;
          case OPS.setHScale: hScale = args[0] / 100; break;
          case OPS.showText: show(args[0]); break;
          case OPS.nextLineShowText: moveText(0, -leading); show(args[0]); break;
          case OPS.nextLineSetSpacingShowText: moveText(0, -leading); show(args[2]); break;
          default: break;
        }
      }
      pages.push(runs);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return { pages, fonts };
}

/** Page count of a PDF without reading its text (pdf-lib is a dependency; scanned files are fine). */
export async function countPdfPages(bytes) {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}
