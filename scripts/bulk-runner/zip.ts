// Bulk runner pack reader (F285, C1): reading a zip over an injected range reader, so a multi-gigabyte pack on Drive
// is never downloaded whole (docs/specs/2026-11-10-pack-reader.md). Pure: no network, no file system. Handles the
// end-of-central-directory record, zip64, and the two methods the packs use (0 stored, 8 deflate).

/** Reads bytes `start` to `endInclusive` of the zip. It must return exactly that many bytes. */
export type ReadRange = (start: number, endInclusive: number) => Promise<Uint8Array>;

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate. */
  method: number;
  compressedSize: number;
  /** Uncompressed size. */
  size: number;
  /** Offset of the entry's local header. */
  offset: number;
  /** CRC-32 of the uncompressed bytes, from the directory. */
  crc32: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** The end record is 22 bytes and may be followed by a comment of up to 65535 bytes. */
const EOCD_SEARCH = 22 + 0xffff;
const MAX_DIRECTORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_CHUNK = 8 * 1024 * 1024;

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** Running CRC-32 (start at 0xffffffff, finish with `(c ^ 0xffffffff) >>> 0`). */
function crcUpdate(c: number, chunk: Uint8Array): number {
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 255] ^ (c >>> 8);
  return c >>> 0;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function safe(n: bigint, what: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`zip ${what} is too large`);
  return Number(n);
}

async function exact(read: ReadRange, start: number, end: number, what: string): Promise<Uint8Array> {
  const b = await read(start, end);
  if (b.length !== end - start + 1) {
    throw new Error(`short read of ${what}: wanted ${end - start + 1} bytes, got ${b.length}`);
  }
  return b;
}

/** The entries of the zip's central directory, read by range from the end of the file. */
export async function readDirectory(zipSize: number, read: ReadRange): Promise<ZipEntry[]> {
  const tailLen = Math.min(zipSize, EOCD_SEARCH);
  const tailStart = zipSize - tailLen;
  const tail = await exact(read, tailStart, zipSize - 1, 'the end of the zip');
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    // A real end record is followed by exactly its comment and nothing else.
    if (tv.getUint32(i, true) === SIG_EOCD && i + 22 + tv.getUint16(i + 20, true) === tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end of central directory record');
  let count = tv.getUint16(eocd + 10, true);
  let dirSize = tv.getUint32(eocd + 12, true);
  let dirOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== SIG_ZIP64_LOCATOR) throw new Error('zip64 locator is missing');
    const z64 = safe(tv.getBigUint64(loc + 8, true), 'zip64 record offset');
    const z = await exact(read, z64, z64 + 55, 'the zip64 end record');
    const zv = view(z);
    if (zv.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new Error('zip64 end record is missing');
    count = safe(zv.getBigUint64(32, true), 'entry count');
    dirSize = safe(zv.getBigUint64(40, true), 'directory size');
    dirOffset = safe(zv.getBigUint64(48, true), 'directory offset');
  }
  if (dirSize > MAX_DIRECTORY_BYTES) throw new Error(`central directory of ${dirSize} bytes is too large`);
  if (dirOffset + dirSize > zipSize) throw new Error('central directory lies outside the file');
  const dir = dirSize === 0
    ? new Uint8Array(0)
    : await exact(read, dirOffset, dirOffset + dirSize - 1, 'the central directory');
  const dv = view(dir);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (entries.length < count) {
    if (p + 46 > dir.length || dv.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error(`central directory ends after ${entries.length} of ${count} entries`);
    }
    const method = dv.getUint16(p + 10, true);
    const crc32 = dv.getUint32(p + 16, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const nameAt = p + 46;
    if (nameAt + nameLen + extraLen + commentLen > dir.length) throw new Error('central directory entry is cut short');
    const name = new TextDecoder().decode(dir.subarray(nameAt, nameAt + nameLen));
    // The zip64 extra field holds, in this order, only the values that were saturated.
    let needSize = size === 0xffffffff;
    let needCompressed = compressedSize === 0xffffffff;
    let needOffset = offset === 0xffffffff;
    const extraEnd = nameAt + nameLen + extraLen;
    for (let q = nameAt + nameLen; q + 4 <= extraEnd;) {
      const id = dv.getUint16(q, true);
      const len = dv.getUint16(q + 2, true);
      if (q + 4 + len > extraEnd) throw new Error(`extra field of ${name} overruns its entry`);
      if (id === 1) {
        let r = q + 4;
        const take = (what: string) => {
          if (r + 8 > q + 4 + len) throw new Error(`zip64 extra field of ${name} is too short for its ${what}`);
          const v = safe(dv.getBigUint64(r, true), what);
          r += 8;
          return v;
        };
        if (needSize) {
          size = take('size');
          needSize = false;
        }
        if (needCompressed) {
          compressedSize = take('compressed size');
          needCompressed = false;
        }
        if (needOffset) {
          offset = take('offset');
          needOffset = false;
        }
      }
      q += 4 + len;
    }
    if (needSize || needCompressed || needOffset) {
      throw new Error(`${name} has a saturated size or offset and no zip64 field to replace it`);
    }
    if (offset + compressedSize > zipSize) throw new Error(`entry ${name} lies outside the zip`);
    entries.push({ name, method, compressedSize, size, offset, crc32 });
    p = nameAt + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * The entry's bytes after decompression (for stored entries, as stored), read in ranges of at most `chunkBytes`, one
 * at a time, as the consumer pulls. The result is exactly `entry.size` bytes or the stream errors.
 */
export function entryStream(entry: ZipEntry, read: ReadRange, chunkBytes = DEFAULT_CHUNK): ReadableStream<Uint8Array> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`zip entry ${entry.name} uses compression method ${entry.method}; only 0 and 8 are supported`);
  }
  if (chunkBytes < 30) throw new Error('chunk size is too small');
  let next = -1;
  let remaining = entry.compressedSize;
  const raw = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next < 0) {
        const h = await exact(read, entry.offset, entry.offset + 29, 'the local header');
        const hv = view(h);
        if (hv.getUint32(0, true) !== SIG_LOCAL) throw new Error(`bad local header for ${entry.name}`);
        next = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      }
      if (remaining > 0) {
        const n = Math.min(chunkBytes, remaining);
        controller.enqueue(await exact(read, next, next + n - 1, `data of ${entry.name}`));
        next += n;
        remaining -= n;
      }
      if (remaining === 0) controller.close();
    },
  }, { highWaterMark: 0 });
  const plain = entry.method === 8
    ? raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : raw;
  let seen = 0;
  let crc = 0xffffffff;
  return plain.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.length;
        if (seen > entry.size) throw new Error(`${entry.name} exceeds the ${entry.size} bytes the directory declares`);
        crc = crcUpdate(crc, chunk);
        controller.enqueue(chunk);
      },
      flush() {
        if (seen !== entry.size) {
          throw new Error(`size of ${entry.name} is ${seen} bytes, the directory says ${entry.size}`);
        }
        if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32) {
          throw new Error(`crc32 of ${entry.name} does not match the directory`);
        }
      },
    }),
  );
}
