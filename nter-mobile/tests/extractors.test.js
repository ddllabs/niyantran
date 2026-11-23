import { describe, expect, it } from 'vitest';
import * as docx from 'docx';
import * as XLSX from 'xlsx';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

import {
  extractDocument,
  extractDocx,
  extractSpreadsheet,
  extractCsv,
  extractTxt,
  extractPptx,
  detectDelimiter,
  parseCsvString,
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  estimateTokens,
  formatMarkdownTable,
  normalizeText,
  readZipArchive,
  toUint8Array,
} from '../src/lib/extractors/index.js';
import { resolveDocumentFormat } from '../src/lib/extractors/index.js';
import { getFormatMetadataLabel } from '../src/screens/FileManager.jsx';
import { fileToAttachment } from '../src/lib/files.js';

/**
 * In-memory ZIP builder utility for testing PPTX and ZIP extraction.
 * @param {Array<{ name: string, content: string | Uint8Array }>} files
 * @returns {Uint8Array}
 */
function createTestZip(files) {
  const parts = [];
  const cdParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const dataBuf = Buffer.isBuffer(f.content)
      ? f.content
      : typeof f.content === 'string'
      ? Buffer.from(f.content, 'utf8')
      : Buffer.from(f.content);

    const deflated = zlib.deflateRawSync(dataBuf);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method deflate
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0, 12); // date
    lh.writeUInt32LE(0, 14); // crc
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, deflated);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(deflated.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    cdParts.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + deflated.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const p of cdParts) cdSize += p.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...parts, ...cdParts, eocd]));
}

describe('Multi-Format Document Extractors Suite', () => {
  // ─── 1. Common Contracts & Utilities ────────────────────────────────────────
  describe('common.js contracts and utilities', () => {
    it('creates standardized document, section, and warning contracts', () => {
      const doc = createExtractedDocument({
        text: 'Sample document text',
        metadata: { format: 'txt' },
      });
      expect(doc.text).toBe('Sample document text');
      expect(doc.metadata.format).toBe('txt');
      expect(doc.metadata.tokenEstimate).toBe(estimateTokens('Sample document text'));
      expect(Array.isArray(doc.sections)).toBe(true);
      expect(Array.isArray(doc.warnings)).toBe(true);

      const sec = createExtractedSection({
        id: 'sec_1',
        title: 'Overview',
        level: 1,
        type: 'heading',
        text: 'Overview text',
        hierarchy: ['Document', 'Overview'],
      });
      expect(sec.id).toBe('sec_1');
      expect(sec.title).toBe('Overview');
      expect(sec.level).toBe(1);
      expect(sec.type).toBe('heading');
      expect(sec.hierarchy).toEqual(['Document', 'Overview']);

      const warn = createExtractionWarning('MALFORMED_HEADER', 'Header missing column 2', 'warning');
      expect(warn.code).toBe('MALFORMED_HEADER');
      expect(warn.severity).toBe('warning');
    });

    it('normalizes text and strips BOM', () => {
      const textWithBom = '\uFEFFLine 1\r\nLine 2\rLine 3';
      const clean = normalizeText(textWithBom);
      expect(clean).toBe('Line 1\nLine 2\nLine 3');
      expect(clean.charCodeAt(0)).not.toBe(0xfeff);
    });

    it('formats 2D arrays into clean Markdown tables', () => {
      const rows = [
        ['Item', 'Qty', 'Price'],
        ['Apples', '10', 'INR 150'],
        ['Oranges | Sweet', '5', 'INR 90'],
      ];
      const table = formatMarkdownTable(rows);
      expect(table).toContain('| Item | Qty | Price |');
      expect(table).toContain('| --- | --- | --- |');
      expect(table).toContain('Oranges \\| Sweet');
    });

    it('decompresses zip entries correctly', async () => {
      const zipBytes = createTestZip([
        { name: 'hello.txt', content: 'Hello from inside ZIP archive!' },
        { name: 'sub/data.json', content: '{"status":"ok"}' },
      ]);

      const archive = await readZipArchive(zipBytes);
      expect(archive.hasEntry('hello.txt')).toBe(true);
      expect(archive.hasEntry('sub/data.json')).toBe(true);
      expect(archive.hasEntry('missing.txt')).toBe(false);

      const helloContent = await archive.readEntryText('hello.txt');
      expect(helloContent).toBe('Hello from inside ZIP archive!');

      const jsonContent = await archive.readEntryText('sub/data.json');
      expect(JSON.parse(jsonContent)).toEqual({ status: 'ok' });
    });
  });

  // ─── 2. DOCX Extractor ──────────────────────────────────────────────────────
  describe('docxExtractor.js', () => {
    it('extracts structured headings, paragraphs, and tables from DOCX XML', async () => {
      const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
            <w:r><w:t>1. Executive Summary</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:t>This is the first paragraph describing the executive mandate.</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
            <w:r><w:t>1.1 Regulatory Scope</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:t>Regulatory scope encompasses carbon credits and emission targets.</w:t></w:r>
          </w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Facility</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>Capacity</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Plant Alpha</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>500 MW</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>`;

      const result = await extractDocx(docxXml);
      expect(result.metadata.format).toBe('docx');
      expect(result.metadata.headingCount).toBe(2);
      expect(result.metadata.paragraphCount).toBe(2);
      expect(result.metadata.tableCount).toBe(1);

      // Verify headings
      const h1 = result.sections.find((s) => s.type === 'heading' && s.level === 1);
      expect(h1).toBeDefined();
      expect(h1.title).toBe('1. Executive Summary');
      expect(h1.hierarchy).toEqual(['1. Executive Summary']);

      const h2 = result.sections.find((s) => s.type === 'heading' && s.level === 2);
      expect(h2).toBeDefined();
      expect(h2.title).toBe('1.1 Regulatory Scope');
      expect(h2.hierarchy).toEqual(['1. Executive Summary', '1.1 Regulatory Scope']);

      // Verify table
      const tbl = result.sections.find((s) => s.type === 'table');
      expect(tbl).toBeDefined();
      expect(tbl.text).toContain('| Facility | Capacity |');
      expect(tbl.text).toContain('| Plant Alpha | 500 MW |');
    });

    it('extracts real binary DOCX files generated with docx library', async () => {
      const doc = new docx.Document({
        sections: [
          {
            properties: {},
            children: [
              new docx.Paragraph({
                text: '1. Introduction to Mobile Subsystem',
                heading: docx.HeadingLevel.HEADING_1,
              }),
              new docx.Paragraph({
                text: 'The NTER mobile subsystem provides client-side document processing.',
              }),
              new docx.Table({
                rows: [
                  new docx.TableRow({
                    children: [
                      new docx.TableCell({ children: [new docx.Paragraph('Metric')] }),
                      new docx.TableCell({ children: [new docx.Paragraph('Target')] }),
                    ],
                  }),
                  new docx.TableRow({
                    children: [
                      new docx.TableCell({ children: [new docx.Paragraph('Latency')] }),
                      new docx.TableCell({ children: [new docx.Paragraph('< 100ms')] }),
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      });

      const buffer = await docx.Packer.toBuffer(doc);
      const result = await extractDocx(buffer, { fileName: 'Architecture.docx' });

      expect(result.metadata.format).toBe('docx');
      expect(result.metadata.headingCount).toBeGreaterThanOrEqual(1);
      expect(result.metadata.paragraphCount).toBeGreaterThanOrEqual(1);
      expect(result.metadata.tableCount).toBeGreaterThanOrEqual(1);
      expect(result.text).toContain('Introduction to Mobile Subsystem');
      expect(result.text).toContain('client-side document processing');
      expect(result.text).toContain('| Metric | Target |');
    });

    it('returns empty warnings when given empty input', async () => {
      const res = await extractDocx(new Uint8Array(0));
      expect(res.text).toBe('');
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings[0].code).toBe('EMPTY_INPUT');
    });
  });

  // ─── 3. Spreadsheet Extractor (CSV & XLSX) ──────────────────────────────────
  describe('spreadsheetExtractor.js', () => {
    it('detects delimiters accurately for CSV, TSV, and semicolon files', () => {
      expect(detectDelimiter('Name,Age,Role\nAlice,30,Lawyer\nBob,35,Judge')).toBe(',');
      expect(detectDelimiter('ID\tTitle\tCourt\n1\tPetition\tHigh Court\n2\tAppeal\tSupreme Court')).toBe('\t');
      expect(detectDelimiter('City;State;Population\nMumbai;MH;21000000\nDelhi;DL;19000000')).toBe(';');
      expect(detectDelimiter('Col1|Col2|Col3\nVal1|Val2|Val3\nVal4|Val5|Val6')).toBe('|');
    });

    it('parses CSV respecting RFC 4180 quotes, escaped quotes, and newlines', () => {
      const csv = `ID,Headline,Notes\n101,"Contract, General","Approved by ""Board"" on Monday"\n102,"Multi\nLine\nTitle","Standard clause"`;
      const { delimiter, rows } = parseCsvString(csv);

      expect(delimiter).toBe(',');
      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual(['ID', 'Headline', 'Notes']);
      expect(rows[1]).toEqual(['101', 'Contract, General', 'Approved by "Board" on Monday']);
      expect(rows[2][1]).toBe('Multi\nLine\nTitle');
    });

    it('extracts CSV into structured document with worksheet summary', async () => {
      const csv = `State,Clean_Energy_MW,Target_Year\nMaharashtra,12400,2026\nGujarat,14500,2026\nRajasthan,18900,2027`;
      const result = await extractCsv(csv, { fileName: 'Clean_Energy.csv' });

      expect(result.metadata.format).toBe('csv');
      expect(result.metadata.sheetCount).toBe(1);
      expect(result.metadata.totalRows).toBe(3);
      expect(result.metadata.totalColumns).toBe(3);
      expect(result.metadata.worksheets[0].headers).toEqual(['State', 'Clean_Energy_MW', 'Target_Year']);
      expect(result.text).toContain('| State | Clean_Energy_MW | Target_Year |');
      expect(result.text).toContain('| Maharashtra | 12400 | 2026 |');
    });

    it('extracts multi-sheet XLSX workbooks generated via SheetJS', async () => {
      const wb = XLSX.utils.book_new();
      const ws1Data = [
        ['Desk', 'Active Cases', 'Pending Review'],
        ['Commercial', 45, 12],
        ['Arbitration', 28, 6],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      XLSX.utils.book_append_sheet(wb, ws1, 'Litigation');

      const ws2Data = [
        ['Year', 'Capex', 'Opex'],
        ['2025', 'INR 450 Cr', 'INR 120 Cr'],
        ['2026', 'INR 580 Cr', 'INR 140 Cr'],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      XLSX.utils.book_append_sheet(wb, ws2, 'Finance');

      const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const result = await extractSpreadsheet(xlsxBuffer, { fileName: 'Court_Operations.xlsx' });

      expect(result.metadata.format).toBe('xlsx');
      expect(result.metadata.sheetCount).toBe(2);
      expect(result.metadata.totalRows).toBe(4);
      expect(result.metadata.worksheets[0].sheetName).toBe('Litigation');
      expect(result.metadata.worksheets[1].sheetName).toBe('Finance');
      expect(result.text).toContain('## Worksheet: Litigation');
      expect(result.text).toContain('## Worksheet: Finance');
      expect(result.sections.length).toBe(2);
    });

    it('extracts real PRD workbook fixture from repository', async () => {
      const fixturePath = path.resolve(
        process.cwd(),
        '../supabase/functions/ingest-worker/__fixtures__/GTPL_KCBPL_Unified_Intelligence_Platform_PRD_v2.xlsx'
      );
      if (fs.existsSync(fixturePath)) {
        const bytes = fs.readFileSync(fixturePath);
        const result = await extractSpreadsheet(bytes, { fileName: 'PRD.xlsx' });

        expect(result.metadata.format).toBe('xlsx');
        expect(result.metadata.sheetCount).toBeGreaterThan(0);
        expect(result.metadata.totalRows).toBeGreaterThan(0);
        expect(result.sections.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── 4. TXT Extractor ───────────────────────────────────────────────────────
  describe('txtExtractor.js', () => {
    it('extracts paragraphs, headings, and character statistics from text', async () => {
      const raw = `\uFEFF# Niyantran Terminal Architecture

The terminal architecture is built on a modular client-side workbench.
This workbench facilitates offline ingestion.

## Section 1: Data Contracts

All extractors conform to unified ExtractedDocument contracts.
Every section retains heading context and hierarchy.

## Section 2: Mobile Adaptation

Capacitor bridges provide native storage and filesystem access.`;

      const result = await extractTxt(raw, { fileName: 'Architecture.md' });

      expect(result.metadata.format).toBe('txt');
      expect(result.metadata.title).toBe('Niyantran Terminal Architecture');
      expect(result.metadata.headingCount).toBe(3);
      expect(result.metadata.paragraphCount).toBe(3);
      expect(result.metadata.wordCount).toBeGreaterThan(30);
      expect(result.text).not.toContain('\uFEFF');

      const sec2 = result.sections.find((s) => s.title === 'Section 2: Mobile Adaptation');
      expect(sec2).toBeDefined();
      expect(sec2.level).toBe(2);
      expect(sec2.hierarchy).toEqual(['Niyantran Terminal Architecture', 'Section 2: Mobile Adaptation']);
    });

    it('handles empty text gracefully with warning', async () => {
      const result = await extractTxt('');
      expect(result.text).toBe('');
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].code).toBe('EMPTY_TEXT');
    });
  });

  // ─── 5. PPTX Extractor ──────────────────────────────────────────────────────
  describe('pptxExtractor.js', () => {
    it('extracts slides, titles, bullet hierarchies, tables, and notes from PPTX archive', async () => {
      const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <!-- Title shape -->
            <p:sp>
              <p:nvSpPr>
                <p:nvPr>
                  <p:ph type="title"/>
                </p:nvPr>
              </p:nvSpPr>
              <p:txBody>
                <a:p>
                  <a:r><a:t>Quarterly Strategy Review</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
            <!-- Body shape with bullet hierarchy -->
            <p:sp>
              <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
              <p:txBody>
                <a:p>
                  <a:pPr lvl="0"/>
                  <a:r><a:t>Expand renewable portfolio to 4.5GW</a:t></a:r>
                </a:p>
                <a:p>
                  <a:pPr lvl="1"/>
                  <a:r><a:t>Solar capacity: 3.0GW across western grid</a:t></a:r>
                </a:p>
                <a:p>
                  <a:pPr lvl="1"/>
                  <a:r><a:t>Wind capacity: 1.5GW coastal corridors</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`;

      const notes1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:p><a:r><a:t>Opening remarks: Highlight western grid synchronization milestones.</a:t></a:r></a:p>
      </p:notes>`;

      const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
              <p:txBody>
                <a:p><a:r><a:t>Execution Timeline &amp; Capex</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
            <p:graphicFrame>
              <a:tbl>
                <a:tr>
                  <a:tc><a:txBody><a:p><a:r><a:t>Phase</a:t></a:r></a:p></a:txBody></a:tc>
                  <a:tc><a:txBody><a:p><a:r><a:t>Target Date</a:t></a:r></a:p></a:txBody></a:tc>
                </a:tr>
                <a:tr>
                  <a:tc><a:txBody><a:p><a:r><a:t>Phase 1</a:t></a:r></a:p></a:txBody></a:tc>
                  <a:tc><a:txBody><a:p><a:r><a:t>Q2 2026</a:t></a:r></a:p></a:txBody></a:tc>
                </a:tr>
              </a:tbl>
            </p:graphicFrame>
          </p:spTree>
        </p:cSld>
      </p:sld>`;

      const pptxZip = createTestZip([
        { name: 'ppt/slides/slide1.xml', content: slide1Xml },
        { name: 'ppt/notesSlides/notesSlide1.xml', content: notes1Xml },
        { name: 'ppt/slides/slide2.xml', content: slide2Xml },
      ]);

      const result = await extractPptx(pptxZip, { fileName: 'Strategy_Deck.pptx' });

      expect(result.metadata.format).toBe('pptx');
      expect(result.metadata.slideCount).toBe(2);
      expect(result.metadata.title).toBe('Quarterly Strategy Review');

      // Slide 1 checks
      const slide1 = result.sections.find((s) => s.metadata?.slideNumber === 1);
      expect(slide1).toBeDefined();
      expect(slide1.title).toBe('Quarterly Strategy Review');
      expect(slide1.metadata.bullets.length).toBe(3);
      expect(slide1.metadata.bullets[0]).toEqual({ text: 'Expand renewable portfolio to 4.5GW', level: 0 });
      expect(slide1.metadata.bullets[1]).toEqual({ text: 'Solar capacity: 3.0GW across western grid', level: 1 });
      expect(slide1.metadata.notes).toContain('Opening remarks: Highlight western grid synchronization milestones.');

      // Slide 2 checks
      const slide2 = result.sections.find((s) => s.metadata?.slideNumber === 2);
      expect(slide2).toBeDefined();
      expect(slide2.title).toBe('Execution Timeline & Capex');
      expect(slide2.text).toContain('| Phase | Target Date |');
      expect(slide2.text).toContain('| Phase 1 | Q2 2026 |');
    });

    it('returns empty warnings for PPTX with no slides', async () => {
      const emptyZip = createTestZip([{ name: 'ppt/presentation.xml', content: '<presentation/>' }]);
      const result = await extractPptx(emptyZip);
      expect(result.metadata.slideCount).toBe(0);
      expect(result.warnings.some((w) => w.code === 'NO_SLIDES')).toBe(true);
    });
  });

  // ─── 6. Unified Extraction Entry Point ──────────────────────────────────────
  describe('index.js (extractDocument & resolveDocumentFormat)', () => {
    it('resolves formats accurately based on extension and mime type', () => {
      expect(resolveDocumentFormat(null, { fileName: 'petition.docx' })).toBe('docx');
      expect(resolveDocumentFormat(null, { fileName: 'data.xlsx' })).toBe('xlsx');
      expect(resolveDocumentFormat(null, { fileName: 'records.csv' })).toBe('csv');
      expect(resolveDocumentFormat(null, { fileName: 'slides.pptx' })).toBe('pptx');
      expect(resolveDocumentFormat(null, { fileName: 'notes.txt' })).toBe('txt');
      expect(resolveDocumentFormat(null, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('docx');
      expect(resolveDocumentFormat(null, { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('pptx');
      expect(resolveDocumentFormat(null, { mimeType: 'text/csv' })).toBe('csv');
    });

    it('dispatches extractDocument to correct extractors automatically', async () => {
      // DOCX dispatch
      const docxXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Docx</w:t></w:r></w:p></w:body></w:document>`;
      const docxRes = await extractDocument(docxXml, { fileName: 'test.docx' });
      expect(docxRes.metadata.format).toBe('docx');
      expect(docxRes.text).toContain('Hello Docx');

      // CSV dispatch
      const csvRes = await extractDocument('ColA,ColB\n1,2', { fileName: 'test.csv' });
      expect(csvRes.metadata.format).toBe('csv');
      expect(csvRes.metadata.totalRows).toBe(1);

      // TXT dispatch
      const txtRes = await extractDocument('# Header\nBody text', { fileName: 'test.txt' });
      expect(txtRes.metadata.format).toBe('txt');
      expect(txtRes.text).toContain('Body text');
    });
  });

  // ─── 7. FileManager and files.js Integration ────────────────────────────────
  describe('Integration with FileManager and files.js', () => {
    it('generates accurate format-aware metadata labels', () => {
      expect(getFormatMetadataLabel({ page_count: 24 })).toBe('24 pages');
      expect(getFormatMetadataLabel({ page_count: 1 })).toBe('1 page');
      expect(getFormatMetadataLabel({ worksheet_count: 4 })).toBe('4 worksheets');
      expect(getFormatMetadataLabel({ worksheet_count: 1 })).toBe('1 worksheet');
      expect(getFormatMetadataLabel({ slide_count: 12 })).toBe('12 slides');
      expect(getFormatMetadataLabel({ slide_count: 1 })).toBe('1 slide');
      expect(getFormatMetadataLabel({ row_count: 85 })).toBe('85 rows');
      expect(getFormatMetadataLabel({ section_count: 6 })).toBe('6 sections');
      expect(getFormatMetadataLabel({})).toBeNull();
    });

    it('fileToAttachment extracts multi-format files with format notes', async () => {
      // Test text file
      const txtBlob = new Blob(['Line 1 of affidavit\nLine 2 of affidavit'], { type: 'text/plain' });
      txtBlob.name = 'Affidavit.txt';
      const txtAtt = await fileToAttachment(txtBlob);
      expect(txtAtt.kind).toBe('file');
      expect(txtAtt.title).toBe('Affidavit.txt');
      expect(txtAtt.text).toContain('Line 1 of affidavit');

      // Test CSV file
      const csvBlob = new Blob(['Quarter,Amount\nQ1,500\nQ2,600'], { type: 'text/csv' });
      csvBlob.name = 'Financials.csv';
      const csvAtt = await fileToAttachment(csvBlob);
      expect(csvAtt.kind).toBe('file');
      expect(csvAtt.title).toBe('Financials.csv');
      expect(csvAtt.note).toBe('2 rows');
      expect(csvAtt.text).toContain('| Quarter | Amount |');
    });
  });
});
