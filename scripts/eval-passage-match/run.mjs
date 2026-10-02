/**
 * Passage matcher evaluation (docs/specs/2026-10-02-viewer-continuous.md, "Acceptance evidence").
 * LOCAL ONLY; reads files, writes a report, touches no database.
 *
 * Every chunk of the given documents is cut at page boundaries, each piece is read from the stored
 * page text with the chunk's offsets (as the viewer does), and located with `locatePassage` in that
 * page's PDF text layer (pdf.js text content, as the viewer's text layer renders it).
 *
 *   node scripts/eval-passage-match/run.mjs <dir>
 *
 * <dir> holds pages.json (`supabase db query --output-format json` of document_pages: document_id,
 * page_number, char_from, char_to, text), chunks.json ([{document_id, chunk_index, char_from,
 * char_to}]) and one PDF per document named in docs.json ({"<document_id>": "<file>.pdf"}).
 */
import fs from 'node:fs';
import path from 'node:path';
import { layerWords, locatePassage, passageWords } from '../../src/ai/page-viewer/passageMatch.js';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/eval-passage-match/run.mjs <dir>');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const pagesFile = read('pages.json');
const pages = Array.isArray(pagesFile) ? pagesFile : pagesFile.rows;
const chunks = read('chunks.json');
const docs = read('docs.json');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const layers = new Map();
async function layerOf(documentId, pageNumber) {
  const key = `${documentId}:${pageNumber}`;
  if (!layers.has(key)) {
    if (!layers.has(documentId)) {
      const data = new Uint8Array(fs.readFileSync(path.join(dir, docs[documentId])));
      layers.set(documentId, await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise);
    }
    const page = await layers.get(documentId).getPage(pageNumber);
    const content = await page.getTextContent();
    layers.set(key, layerWords(content.items.filter(i => typeof i.str === 'string')));
  }
  return layers.get(key);
}

const results = [];
for (const chunk of chunks) {
  for (const page of pages.filter(p => p.document_id === chunk.document_id && p.char_to > chunk.char_from && p.char_from < chunk.char_to)) {
    const from = Math.max(chunk.char_from, page.char_from) - page.char_from;
    const to = Math.min(chunk.char_to, page.char_to) - page.char_from;
    const passage = passageWords(page.text.slice(from, to));
    if (passage.length < 3) continue;
    const layer = await layerOf(chunk.document_id, page.page_number);
    const found = layer.length ? locatePassage(passage, layer) : null;
    results.push({
      document: chunk.document_id.slice(0, 8),
      chunk: chunk.chunk_index,
      page: page.page_number,
      words: passage.length,
      textLayer: layer.length > 0,
      exact: Boolean(found),
      coverage: found ? Number(found.coverage.toFixed(3)) : null,
      head: passage.slice(0, 8).map(w => w.word).join(' '),
    });
  }
}

const withLayer = results.filter(r => r.textLayer);
const exact = withLayer.filter(r => r.exact);
const byDoc = {};
for (const r of withLayer) {
  byDoc[r.document] ??= { pieces: 0, exact: 0 };
  byDoc[r.document].pieces += 1;
  if (r.exact) byDoc[r.document].exact += 1;
}
const report = {
  pieces: results.length,
  piecesWithTextLayer: withLayer.length,
  exact: exact.length,
  exactShare: withLayer.length ? Number((exact.length / withLayer.length).toFixed(3)) : null,
  byDocument: byDoc,
  misses: withLayer.filter(r => !r.exact),
};
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...report, results }, null, 1));
console.log(JSON.stringify(report, null, 1));
