/**
 * Common extraction contracts, types, and utilities for NTER Mobile document extractors.
 */

// ─── Contracts ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExtractionWarning
 * @property {string} code - Warning code (e.g. 'TRUNCATED', 'EMPTY_CONTENT', 'CORRUPT_ARCHIVE')
 * @property {string} message - Human-readable explanation of warning
 * @property {'info' | 'warning' | 'error'} severity - Severity classification
 */

/**
 * @typedef {Object} ExtractedSection
 * @property {string} id - Unique identifier for the section
 * @property {string | null} title - Section title, slide title, or sheet name
 * @property {number | null} level - Heading level (1-6) or slide/sheet index
 * @property {'heading' | 'paragraph' | 'table' | 'sheet' | 'slide' | 'list_item' | 'text'} type - Content type
 * @property {string} text - Plain text representation
 * @property {string} [formatted] - Formatted representation (e.g. markdown table)
 * @property {string[]} hierarchy - Heading hierarchy stack
 * @property {Record<string, any>} [metadata] - Optional format-specific metadata
 */

/**
 * @typedef {Object} ExtractedDocument
 * @property {string} text - Consolidated text or markdown representation
 * @property {ExtractedSection[]} sections - Structural sections of the document
 * @property {Record<string, any>} metadata - Document metadata (format, counts, token estimates)
 * @property {ExtractionWarning[]} warnings - Non-fatal warnings encountered during extraction
 */

/**
 * Creates an ExtractedDocument object.
 * @param {Partial<ExtractedDocument>} data
 * @returns {ExtractedDocument}
 */
export function createExtractedDocument(data = {}) {
  const text = String(data.text || '');
  return {
    text,
    sections: Array.isArray(data.sections) ? data.sections : [],
    metadata: {
      format: data.metadata?.format || 'unknown',
      tokenEstimate: data.metadata?.tokenEstimate ?? estimateTokens(text),
      ...(data.metadata || {}),
    },
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

/**
 * Creates an ExtractedSection object.
 * @param {Partial<ExtractedSection>} data
 * @returns {ExtractedSection}
 */
export function createExtractedSection(data = {}) {
  return {
    id: data.id || `sec_${Math.random().toString(36).slice(2, 9)}`,
    title: data.title ?? null,
    level: data.level ?? null,
    type: data.type || 'paragraph',
    text: String(data.text || ''),
    formatted: data.formatted || String(data.text || ''),
    hierarchy: Array.isArray(data.hierarchy) ? [...data.hierarchy] : [],
    metadata: data.metadata || {},
  };
}

/**
 * Creates an ExtractionWarning object.
 * @param {string} code
 * @param {string} message
 * @param {'info' | 'warning' | 'error'} [severity='warning']
 * @returns {ExtractionWarning}
 */
export function createExtractionWarning(code, message, severity = 'warning') {
  return { code, message, severity };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Estimates token count from text length (approx 4 chars/token).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

/**
 * Normalizes text: strips UTF-8 BOM, normalizes Unicode, unifies newlines.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Formats a 2D array of rows into a clean Markdown table.
 * @param {string[][]} rows
 * @returns {string}
 */
export function formatMarkdownTable(rows) {
  if (!rows || rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  if (colCount === 0) return '';

  const normalizedRows = rows.map((r) => {
    const row = Array.isArray(r) ? [...r] : [];
    while (row.length < colCount) row.push('');
    return row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim());
  });

  const header = normalizedRows[0];
  const headerLine = '| ' + header.join(' | ') + ' |';
  const sepLine = '| ' + header.map(() => '---').join(' | ') + ' |';
  const dataLines = normalizedRows.slice(1).map((r) => '| ' + r.join(' | ') + ' |');
  return [headerLine, sepLine, ...dataLines].join('\n');
}

/**
 * Converts various input types (File, Blob, ArrayBuffer, Uint8Array, Buffer, string) to Uint8Array.
 * Uses ArrayBuffer.isView for cross-realm compatibility (e.g. Node Buffers in jsdom).
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @returns {Promise<Uint8Array>}
 */
export async function toUint8Array(input) {
  if (!input) return new Uint8Array(0);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
    return new Uint8Array(input);
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const ab = await input.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof input === 'string') {
    return new TextEncoder().encode(input);
  }
  return new Uint8Array(0);
}

/**
 * Inflates raw DEFLATE bytes using DecompressionStream or Node zlib fallback.
 * @param {Uint8Array} buffer
 * @returns {Promise<Uint8Array>}
 */
export async function inflateRawBytes(buffer) {
  const DecompStream = typeof DecompressionStream !== 'undefined'
    ? DecompressionStream
    : typeof globalThis !== 'undefined' && globalThis.DecompressionStream
    ? globalThis.DecompressionStream
    : null;

  if (DecompStream) {
    try {
      const ds = new DecompStream('deflate-raw');
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
    } catch {
      // DecompressionStream failed, fallback to node:zlib
    }
  }

  try {
    const zlib = await import('node:zlib');
    return new Uint8Array(zlib.inflateRawSync(buffer));
  } catch (err) {
    throw new Error(`DEFLATE decompression not supported in this runtime: ${err.message}`);
  }
}

/**
 * In-memory ZIP archive reader.
 * Inspects Central Directory headers and reads entries without external dependencies.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {Promise<{
 *   getFileNames: () => string[],
 *   hasEntry: (path: string) => boolean,
 *   readEntryBytes: (path: string) => Promise<Uint8Array | null>,
 *   readEntryText: (path: string) => Promise<string | null>,
 *   findEntries: (matcher: RegExp | ((name: string) => boolean)) => Array<{ name: string }>,
 * }>}
 */
export async function readZipArchive(input) {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /** @type {Map<string, { method: number, compSize: number, uncompSize: number, localHeaderOffset: number }>} */
  const entries = new Map();

  // Search backwards for End of Central Directory signature (0x06054b50)
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  const utf8Decoder = new TextDecoder('utf-8');

  if (eocdOffset !== -1) {
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdCount = view.getUint16(eocdOffset + 8, true);
    let pos = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) break;
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const uncompSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);

      const entryName = utf8Decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.set(entryName, { method, compSize, uncompSize, localHeaderOffset });
      if (entryName.startsWith('/')) {
        entries.set(entryName.slice(1), { method, compSize, uncompSize, localHeaderOffset });
      }

      pos += 46 + nameLen + extraLen + commentLen;
    }
  } else {
    // Fallback: sequential scan of local file headers (0x04034b50)
    let pos = 0;
    while (pos < bytes.length - 30) {
      if (view.getUint32(pos, true) !== 0x04034b50) break;
      const method = view.getUint16(pos + 8, true);
      const compSize = view.getUint32(pos + 18, true);
      const uncompSize = view.getUint32(pos + 22, true);
      const nameLen = view.getUint16(pos + 26, true);
      const extraLen = view.getUint16(pos + 28, true);
      const entryName = utf8Decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
      entries.set(entryName, { method, compSize, uncompSize, localHeaderOffset: pos });
      if (entryName.startsWith('/')) {
        entries.set(entryName.slice(1), { method, compSize, uncompSize, localHeaderOffset: pos });
      }
      pos += 30 + nameLen + extraLen + compSize;
    }
  }

  async function decompressEntry(info) {
    const { method, compSize, localHeaderOffset } = info;
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const compressedData = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      return compressedData;
    } else if (method === 8) {
      return inflateRawBytes(compressedData);
    }
    throw new Error(`Unsupported ZIP compression method: ${method}`);
  }

  return {
    getFileNames: () => Array.from(entries.keys()),
    hasEntry: (path) => entries.has(path) || entries.has(path.replace(/^\//, '')),
    readEntryBytes: async (path) => {
      const info = entries.get(path) || entries.get(path.replace(/^\//, ''));
      if (!info) return null;
      return decompressEntry(info);
    },
    readEntryText: async (path) => {
      const info = entries.get(path) || entries.get(path.replace(/^\//, ''));
      if (!info) return null;
      const uncompressed = await decompressEntry(info);
      return utf8Decoder.decode(uncompressed);
    },
    findEntries: (matcher) => {
      const results = [];
      for (const name of entries.keys()) {
        const matches = typeof matcher === 'function' ? matcher(name) : matcher.test(name);
        if (matches) {
          results.push({ name });
        }
      }
      return results;
    },
  };
}
