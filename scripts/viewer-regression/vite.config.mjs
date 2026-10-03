import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PAGE_LINES } from './fixture-data.mjs';

const root = dirname(fileURLToPath(import.meta.url));
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
        const pdf = await createPdf();
        server.middlewares.use((req, res, next) => {
          if (req.url === '/fixture-meta.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ byteSize: pdf.length }));
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
