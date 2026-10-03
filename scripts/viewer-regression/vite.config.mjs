import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PAGE_LINES } from './fixture-data.mjs';

const root = dirname(fileURLToPath(import.meta.url));
async function loadProfile(path) {
  if (!isAbsolute(path)) throw new Error('VIEWER_PROFILE_PDF must be an absolute local file path');
  const pdf = await readFile(path);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await task.promise;
  const rows = [];
  let offset = 0;
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const text = content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('');
      rows.push({ page_number: number, text, char_from: offset, char_to: offset + text.length,
        width_px: viewport.width, height_px: viewport.height });
      offset += text.length + 1;
      page.cleanup();
    }
  } finally { await task.destroy(); }
  const cited = rows.slice(0, 15).find(row => /[\p{L}\p{N}]/u.test(row.text)) ?? rows[0];
  const from = cited.text.search(/[\p{L}\p{N}]/u);
  const passage = from < 0 ? '' : cited.text.slice(from, from + 250).trimEnd();
  return { pdf, meta: { profile: true, byteSize: pdf.length, pageCount: rows.length, pageRows: rows,
    extractHash: createHash('sha256').update(pdf).digest('hex'), citedPage: cited.page_number, passage,
    // Do not send the local filename or path to the browser or metrics.
    title: 'Local real PDF profile' } };
}
async function createPdf() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of PAGE_LINES) {
    const page = doc.addPage([612, 792]);
    lines.forEach((text, index) => page.drawText(text, { x: 48, y: 744 - index * 22, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

export default defineConfig({
  root,
  envDir: false,
  publicDir: false,
  plugins: [
    {
      name: 'viewer-offline-fixture',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/supabaseClient.js')) return resolve(root, 'offline-client.mjs');
      },
      async configureServer(server) {
        const { pdf, meta } = process.env.VIEWER_PROFILE_PDF
          ? await loadProfile(process.env.VIEWER_PROFILE_PDF)
          : { pdf: await createPdf(), meta: {} };
        server.middlewares.use((req, res, next) => {
          if (req.url === '/fixture-meta.json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ ...meta, byteSize: pdf.length }));
            return;
          }
          if (req.url !== '/fixture.pdf') return next();
          const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
          const from = match ? Number(match[1]) : 0;
          const to = match ? Number(match[2]) : pdf.length - 1;
          if (from > to || to >= pdf.length) { res.statusCode = 416; res.end(); return; }
          res.statusCode = match ? 206 : 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', to - from + 1);
          if (match) res.setHeader('Content-Range', `bytes ${from}-${to}/${pdf.length}`);
          res.end(pdf.subarray(from, to + 1));
        });
      },
    },
    react(),
  ],
  server: { host: '127.0.0.1', port: 5197, strictPort: true, fs: { allow: [resolve(root, '../..')] } },
  build: { outDir: '/private/tmp/niyantran-viewer-fixture-build', emptyOutDir: true },
});
