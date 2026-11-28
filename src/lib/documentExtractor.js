/**
 * Multi-Format Document Ingestion Specialist: DOCX, CSV, and TXT/Markdown.
 *
 * Client and Node ESM twin of supabase/functions/_shared/documentExtractor.ts.
 */

import { XMLParser } from 'fast-xml-parser';
import { normalise, sha256Hex } from './textNormalise.js';

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

async function inflateRaw(buffer) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(buffer);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const res = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        res.set(c, offset);
        offset += c.length;
      }
      return res;
    } catch (_) {
      // Fallback
    }
  }

  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateRawSync(buffer));
}

export async function extractZipEntry(buffer, targetPath) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdCount = view.getUint16(eocdOffset + 8, true);
    let pos = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) break;
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);

      const entryName = new TextDecoder('utf-8').decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      if (entryName === targetPath || entryName === targetPath.replace(/^\//, '')) {
        const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
        const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
        const compressedData = bytes.subarray(dataStart, dataStart + compSize);
        if (method === 0) {
          return new TextDecoder('utf-8').decode(compressedData);
        } else if (method === 8) {
          const decompressed = await inflateRaw(compressedData);
          return new TextDecoder('utf-8').decode(decompressed);
        }
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  let pos = 0;
  while (pos < bytes.length - 30) {
    if (view.getUint32(pos, true) !== 0x04034b50) break;
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const entryName = new TextDecoder('utf-8').decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    if (entryName === targetPath || entryName === targetPath.replace(/^\//, '')) {
      const compressedData = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        return new TextDecoder('utf-8').decode(compressedData);
      } else if (method === 8) {
        const decompressed = await inflateRaw(compressedData);
        return new TextDecoder('utf-8').decode(decompressed);
      }
    }
    pos = dataStart + compSize;
  }
  return null;
}

function extractTextFromXmlNode(node) {
  let text = '';
  if (!node) return text;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const child of node) text += extractTextFromXmlNode(child);
    return text;
  }
  for (const key of Object.keys(node)) {
    if (key === ':@' || key === '#text') continue;
    if (key === 'w:t') {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item['#text']) text += item['#text'];
          else if (typeof item === 'string') text += item;
        }
      } else if (typeof val === 'string') {
        text += val;
      }
    } else if (key === 'w:tab') {
      text += '\t';
    } else if (key === 'w:br') {
      text += '\n';
    } else {
      text += extractTextFromXmlNode(node[key]);
    }
  }
  return text;
}

function getDocxHeadingLevel(pNode) {
  if (!pNode || !Array.isArray(pNode)) return null;
  for (const child of pNode) {
    if (child['w:pPr'] && Array.isArray(child['w:pPr'])) {
      for (const prChild of child['w:pPr']) {
        if (prChild['w:pStyle']) {
          const attrs = prChild[':@'];
          if (attrs) {
            const val = attrs['@_w:val'] || attrs['w:val'];
            if (val) {
              const match = /heading\s*([1-6])/i.exec(val);
              if (match) return parseInt(match[1], 10);
              if (/^title$/i.test(val)) return 1;
              if (/^subtitle$/i.test(val)) return 2;
            }
          }
        }
      }
    }
  }
  return null;
}

export function formatMarkdownTable(rows) {
  if (!rows || rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizedRows = rows.map((r) => {
    const row = [...r];
    while (row.length < colCount) row.push('');
    return row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim());
  });
  const header = normalizedRows[0];
  const headerLine = '| ' + header.join(' | ') + ' |';
  const sepLine = '| ' + header.map(() => '---').join(' | ') + ' |';
  const dataLines = normalizedRows.slice(1).map((r) => '| ' + r.join(' | ') + ' |');
  return [headerLine, sepLine, ...dataLines].join('\n');
}

export async function extractDocx(input) {
  const xmlString = typeof input === 'string' && input.includes('<w:document')
    ? input
    : await extractZipEntry(input, 'word/document.xml');

  if (!xmlString) {
    throw new Error('Invalid DOCX file: word/document.xml not found');
  }

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: false,
  });

  const parsed = parser.parse(xmlString);
  let body = null;
  for (const root of parsed) {
    if (root['w:document']) {
      for (const docChild of root['w:document']) {
        if (docChild['w:body']) {
          body = docChild['w:body'];
          break;
        }
      }
    }
  }

  const elements = [];
  const headingHierarchy = [];
  let fullText = '';
  let headingCount = 0;
  let paragraphCount = 0;
  let tableCount = 0;

  for (const item of (body || [])) {
    if (item['w:p']) {
      const pNode = item['w:p'];
      const text = extractTextFromXmlNode(pNode).trim();
      if (!text) continue;
      const headingLevel = getDocxHeadingLevel(pNode);
      if (headingLevel !== null) {
        headingCount++;
        while (headingHierarchy.length >= headingLevel) {
          headingHierarchy.pop();
        }
        headingHierarchy.push(text);
        const formattedHeading = '#'.repeat(headingLevel) + ' ' + text;
        const charFrom = fullText.length;
        fullText += (fullText ? '\n\n' : '') + formattedHeading;
        const charTo = fullText.length;
        elements.push({
          type: 'heading',
          level: headingLevel,
          text,
          formatted: formattedHeading,
          hierarchy: [...headingHierarchy],
          heading: text,
          charFrom,
          charTo,
        });
      } else {
        paragraphCount++;
        const charFrom = fullText.length;
        fullText += (fullText ? '\n\n' : '') + text;
        const charTo = fullText.length;
        elements.push({
          type: 'paragraph',
          text,
          formatted: text,
          hierarchy: [...headingHierarchy],
          heading: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
          charFrom,
          charTo,
        });
      }
    } else if (item['w:tbl']) {
      tableCount++;
      const tblNode = item['w:tbl'];
      const rows = [];
      for (const rowItem of tblNode) {
        if (rowItem['w:tr']) {
          const cells = [];
          for (const cellItem of rowItem['w:tr']) {
            if (cellItem['w:tc']) {
              const cellText = extractTextFromXmlNode(cellItem['w:tc']).trim().replace(/\r?\n/g, ' ');
              cells.push(cellText);
            }
          }
          if (cells.length) rows.push(cells);
        }
      }
      if (rows.length) {
        const formattedTable = formatMarkdownTable(rows);
        const charFrom = fullText.length;
        fullText += (fullText ? '\n\n' : '') + formattedTable;
        const charTo = fullText.length;
        elements.push({
          type: 'table',
          rows,
          formatted: formattedTable,
          hierarchy: [...headingHierarchy],
          heading: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
          charFrom,
          charTo,
        });
      }
    }
  }

  return {
    text: fullText,
    elements,
    metadata: {
      format: 'docx',
      headingCount,
      paragraphCount,
      tableCount,
    },
  };
}

export async function chunkDocx(extractedOrInput, options = {}) {
  const extracted = (extractedOrInput && extractedOrInput.elements)
    ? extractedOrInput
    : await extractDocx(extractedOrInput);

  const targetChars = options.targetChars ?? 1000;
  const tableAtomicMax = options.tableAtomicMax ?? 1500;
  const chunks = [];
  let currentGroup = [];
  let currentChars = 0;
  let currentHeadingHierarchy = [];
  let currentHeading = null;
  let currentHeadingLevel = null;

  async function flushCurrentGroup() {
    if (currentGroup.length === 0) return;
    const content = currentGroup.map((e) => e.formatted).join('\n\n');
    const charFrom = currentGroup[0].charFrom;
    const charTo = currentGroup[currentGroup.length - 1].charTo;
    const types = new Set(currentGroup.map((e) => e.type));
    const contentType = types.size === 1 ? [...types][0] : 'mixed';

    chunks.push({
      content,
      charFrom,
      charTo,
      chunkIndex: chunks.length,
      chunkHash: await sha256Hex(normalise(content)),
      tokenEstimate: estimateTokens(content),
      metadata: {
        format: 'docx',
        headingHierarchy: [...currentHeadingHierarchy],
        currentHeading,
        headingLevel: currentHeadingLevel,
        contentType,
        elementCount: currentGroup.length,
      },
    });

    currentGroup = [];
    currentChars = 0;
  }

  for (const el of extracted.elements) {
    if (el.type === 'heading') {
      if (currentGroup.length > 0) {
        await flushCurrentGroup();
      }
      currentHeadingHierarchy = [...el.hierarchy];
      currentHeading = el.text;
      currentHeadingLevel = el.level;
      currentGroup.push(el);
      currentChars = el.formatted.length;
      continue;
    }

    if (el.type === 'table') {
      if (el.formatted.length > tableAtomicMax) {
        if (currentGroup.length > 0) await flushCurrentGroup();
        const rows = el.rows || [];
        const headerRow = rows[0] || [];
        const dataRows = rows.slice(1);
        const rowsPerChunk = Math.max(1, Math.floor(targetChars / Math.max(1, el.formatted.length / rows.length)));
        for (let r = 0; r < dataRows.length; r += rowsPerChunk) {
          const sliceRows = [headerRow, ...dataRows.slice(r, r + rowsPerChunk)];
          const tableSlice = formatMarkdownTable(sliceRows);
          chunks.push({
            content: tableSlice,
            charFrom: el.charFrom,
            charTo: el.charTo,
            chunkIndex: chunks.length,
            chunkHash: await sha256Hex(normalise(tableSlice)),
            tokenEstimate: estimateTokens(tableSlice),
            metadata: {
              format: 'docx',
              headingHierarchy: [...el.hierarchy],
              currentHeading: el.heading,
              contentType: 'table',
              rowRange: { from: r + 1, to: Math.min(r + rowsPerChunk, dataRows.length) },
              totalRows: dataRows.length,
            },
          });
        }
        continue;
      }
    }

    const nextChars = currentChars + (currentChars > 0 ? 2 : 0) + el.formatted.length;
    if (nextChars > targetChars && currentGroup.length > 0) {
      await flushCurrentGroup();
    }

    currentGroup.push(el);
    currentChars += (currentChars > 0 ? 2 : 0) + el.formatted.length;
    if (el.heading) {
      currentHeading = el.heading;
      currentHeadingHierarchy = [...el.hierarchy];
    }
  }

  if (currentGroup.length > 0) {
    await flushCurrentGroup();
  }

  return chunks;
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const sample = lines.slice(0, 5);
  const candidates = [',', '\t', ';'];
  const scores = { ',': 0, '\t': 0, ';': 0 };

  for (const line of sample) {
    let inQuotes = false;
    const lineCounts = { ',': 0, '\t': 0, ';': 0 };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c === ',' || c === '\t' || c === ';')) {
        lineCounts[c]++;
      }
    }
    for (const c of candidates) {
      if (lineCounts[c] > 0) scores[c] += lineCounts[c];
    }
  }

  let best = ',';
  let maxScore = -1;
  for (const c of candidates) {
    if (scores[c] > maxScore) {
      maxScore = scores[c];
      best = c;
    }
  }
  return best;
}

export function parseCsvString(rawText, explicitDelimiter) {
  const text = rawText.replace(/^\uFEFF/, '');
  const delimiter = explicitDelimiter || detectDelimiter(text);
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return { delimiter, rows };
}

export function extractCsv(input, options = {}) {
  const text = typeof input === 'string'
    ? input
    : new TextDecoder('utf-8').decode(input instanceof Uint8Array ? input : new Uint8Array(input));

  const { delimiter, rows } = parseCsvString(text, options.delimiter);
  const headers = rows.length > 0 ? rows[0] : [];
  const dataRows = rows.slice(1);
  const formattedText = formatMarkdownTable(rows);

  return {
    delimiter,
    headers,
    rows: dataRows,
    totalRows: dataRows.length,
    totalColumns: headers.length,
    formattedText,
  };
}

export async function chunkCsv(extractedOrInput, options = {}) {
  const extracted = (extractedOrInput && extractedOrInput.headers)
    ? extractedOrInput
    : extractCsv(extractedOrInput, options);

  const targetChars = options.targetChars ?? 1000;
  const headers = extracted.headers;
  const rows = extracted.rows;
  const totalRows = extracted.totalRows;

  if (rows.length === 0) {
    if (headers.length === 0) return [];
    const content = formatMarkdownTable([headers]);
    return [{
      content,
      charFrom: 0,
      charTo: content.length,
      chunkIndex: 0,
      chunkHash: await sha256Hex(normalise(content)),
      tokenEstimate: estimateTokens(content),
      metadata: {
        format: 'csv',
        delimiter: extracted.delimiter,
        header: headers,
        rowRange: { from: 0, to: 0 },
        totalRows: 0,
        totalColumns: extracted.totalColumns,
        contentType: 'table',
      },
    }];
  }

  const chunks = [];
  let currentRows = [];
  let startRowIndex = 1;
  let charPos = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const candidateRows = [headers, ...currentRows, row];
    const candidateTable = formatMarkdownTable(candidateRows);

    if (candidateTable.length > targetChars && currentRows.length > 0) {
      const chunkTable = formatMarkdownTable([headers, ...currentRows]);
      const endRowIndex = startRowIndex + currentRows.length - 1;
      const charFrom = charPos;
      const charTo = charPos + chunkTable.length;
      charPos = charTo + 2;

      chunks.push({
        content: chunkTable,
        charFrom,
        charTo,
        chunkIndex: chunks.length,
        chunkHash: await sha256Hex(normalise(chunkTable)),
        tokenEstimate: estimateTokens(chunkTable),
        metadata: {
          format: 'csv',
          delimiter: extracted.delimiter,
          header: headers,
          rowRange: { from: startRowIndex, to: endRowIndex },
          totalRows,
          totalColumns: extracted.totalColumns,
          contentType: 'table',
        },
      });

      currentRows = [row];
      startRowIndex = i + 1;
    } else {
      currentRows.push(row);
    }
  }

  if (currentRows.length > 0) {
    const chunkTable = formatMarkdownTable([headers, ...currentRows]);
    const endRowIndex = startRowIndex + currentRows.length - 1;
    const charFrom = charPos;
    const charTo = charPos + chunkTable.length;

    chunks.push({
      content: chunkTable,
      charFrom,
      charTo,
      chunkIndex: chunks.length,
      chunkHash: await sha256Hex(normalise(chunkTable)),
      tokenEstimate: estimateTokens(chunkTable),
      metadata: {
        format: 'csv',
        delimiter: extracted.delimiter,
        header: headers,
        rowRange: { from: startRowIndex, to: endRowIndex },
        totalRows,
        totalColumns: extracted.totalColumns,
        contentType: 'table',
      },
    });
  }

  return chunks;
}

export function extractTxt(input) {
  const text = typeof input === 'string'
    ? input.replace(/^\uFEFF/, '')
    : new TextDecoder('utf-8').decode(input instanceof Uint8Array ? input : new Uint8Array(input)).replace(/^\uFEFF/, '');

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = [];
  let currentSection = null;
  let pos = 0;

  const rawBlocks = normalized.split(/\n\s*\n+/);
  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const blockStart = normalized.indexOf(block, pos);
    const charFrom = blockStart !== -1 ? blockStart : pos;
    const charTo = charFrom + block.length;
    pos = charTo;

    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(trimmed);
    if (headingMatch && trimmed.startsWith('#')) {
      currentSection = headingMatch[1].trim();
    }

    paragraphs.push({
      text: trimmed,
      section: currentSection,
      charFrom,
      charTo,
    });
  }

  return {
    text: normalized,
    paragraphs,
  };
}

export async function chunkTxt(extractedOrInput, options = {}) {
  const extracted = (extractedOrInput && extractedOrInput.paragraphs)
    ? extractedOrInput
    : extractTxt(extractedOrInput);

  const targetChars = options.targetChars ?? 1000;
  const maxChars = options.maxChars ?? 2000;
  const chunks = [];
  let currentParagraphs = [];
  let currentChars = 0;

  async function flushCurrent() {
    if (currentParagraphs.length === 0) return;
    const content = currentParagraphs.map((p) => p.text).join('\n\n');
    const charFrom = currentParagraphs[0].charFrom;
    const charTo = currentParagraphs[currentParagraphs.length - 1].charTo;
    const section = currentParagraphs[0].section ?? null;

    chunks.push({
      content,
      charFrom,
      charTo,
      chunkIndex: chunks.length,
      chunkHash: await sha256Hex(normalise(content)),
      tokenEstimate: estimateTokens(content),
      metadata: {
        format: 'txt',
        section,
        paragraphCount: currentParagraphs.length,
        contentType: content.includes('# ') ? 'markdown' : 'text',
      },
    });

    currentParagraphs = [];
    currentChars = 0;
  }

  for (const p of extracted.paragraphs) {
    if (p.text.length > maxChars) {
      if (currentParagraphs.length > 0) await flushCurrent();
      const sentenceBoundary = /(?<=[.!?।])\s+/g;
      let start = 0;
      let sentenceBuffer = '';
      for (const m of p.text.matchAll(sentenceBoundary)) {
        const sentence = p.text.slice(start, m.index + m[0].length);
        if (sentenceBuffer.length + sentence.length > targetChars && sentenceBuffer.length > 0) {
          chunks.push({
            content: sentenceBuffer.trim(),
            charFrom: p.charFrom + start - sentenceBuffer.length,
            charTo: p.charFrom + start,
            chunkIndex: chunks.length,
            chunkHash: await sha256Hex(normalise(sentenceBuffer.trim())),
            tokenEstimate: estimateTokens(sentenceBuffer.trim()),
            metadata: {
              format: 'txt',
              section: p.section,
              paragraphCount: 1,
              contentType: 'text',
            },
          });
          sentenceBuffer = '';
        }
        sentenceBuffer += sentence;
        start = m.index + m[0].length;
      }
      const remainder = p.text.slice(start);
      if (sentenceBuffer || remainder) {
        const finalContent = (sentenceBuffer + remainder).trim();
        chunks.push({
          content: finalContent,
          charFrom: p.charFrom + start,
          charTo: p.charTo,
          chunkIndex: chunks.length,
          chunkHash: await sha256Hex(normalise(finalContent)),
          tokenEstimate: estimateTokens(finalContent),
          metadata: {
            format: 'txt',
            section: p.section,
            paragraphCount: 1,
            contentType: 'text',
          },
        });
      }
      continue;
    }

    const nextChars = currentChars + (currentChars > 0 ? 2 : 0) + p.text.length;
    if (nextChars > targetChars && currentParagraphs.length > 0) {
      await flushCurrent();
    }

    currentParagraphs.push(p);
    currentChars += (currentChars > 0 ? 2 : 0) + p.text.length;
  }

  if (currentParagraphs.length > 0) {
    await flushCurrent();
  }

  return chunks;
}
