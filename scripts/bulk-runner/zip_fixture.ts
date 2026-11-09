// Test fixture for the pack reader (not a test file): builds zips in memory, with stored and deflated entries, real
// CRC-32s, an optional zip64 directory, and a few deliberate corruptions. It computes CRC-32 on its own, apart from
// zip.ts, so the reader is not checked against itself.

export const enc = new TextEncoder();
export const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
export const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
export const u64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
export const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
export async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of s) parts.push(c);
  return cat(...parts);
}
export const through = (data: Uint8Array, format: 'gzip' | 'deflate-raw') =>
  collect(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream(format)));
export const gzip = (text: string | Uint8Array) => through(typeof text === 'string' ? enc.encode(text) : text, 'gzip');
export const hex = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) =>
    x.toString(16).padStart(2, '0')
  )
    .join('');

/** Deterministic bytes (xorshift32), so a test that needs incompressible data is repeatable. */
export function seededBytes(n: number, seed = 12345): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 255;
  }
  return out;
}

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface Spec {
  name: string;
  data: Uint8Array;
  method: 0 | 8;
}
export interface ZipOptions {
  /** Sizes and offsets live in zip64 extra fields; the end record is saturated and a zip64 record and locator follow. */
  zip64?: boolean;
  comment?: string;
  /** With zip64: `none` leaves the extra field out, `short` makes it too short for the values it must hold. */
  zip64Extra?: 'normal' | 'none' | 'short' | 'overrun';
  /** Writes this CRC-32 in every header instead of the real one. */
  crc?: number;
  /** Writes this compressed size in every central directory entry. */
  centralCompressedSize?: number;
  /** Leaves the zip64 locator out although the end record is saturated. */
  noLocator?: boolean;
}

export async function buildZip(specs: Spec[], opt: ZipOptions = {}): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const s of specs) {
    const body = s.method === 8 ? await through(s.data, 'deflate-raw') : s.data;
    const name = enc.encode(s.name);
    const crc = opt.crc ?? crc32(s.data);
    const localExtra = new Uint8Array(7).fill(9); // the reader must use the local lengths, not the directory's
    const local = cat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(s.method),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(body.length),
      u32(s.data.length),
      u16(name.length),
      u16(localExtra.length),
      name,
      localExtra,
      body,
    );
    const mode = opt.zip64Extra ?? 'normal';
    const extra = !opt.zip64 || mode === 'none'
      ? new Uint8Array(0)
      : mode === 'short'
      ? cat(u16(1), u16(8), u64(s.data.length))
      : mode === 'overrun'
      ? cat(u16(1), u16(100), u64(s.data.length), u64(body.length), u64(off)) // declares more than the entry holds
      : cat(u16(1), u16(24), u64(s.data.length), u64(body.length), u64(off));
    const big = 0xffffffff;
    const csize = opt.centralCompressedSize ?? body.length;
    central.push(cat(
      u32(0x02014b50),
      u16(45),
      u16(45),
      u16(0),
      u16(s.method),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(opt.zip64 ? big : csize),
      u32(opt.zip64 ? big : s.data.length),
      u16(name.length),
      u16(extra.length),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(opt.zip64 ? big : off),
      name,
      extra,
    ));
    parts.push(local);
    off += local.length;
  }
  const dir = cat(...central);
  const comment = enc.encode(opt.comment ?? '');
  const tail: Uint8Array[] = [];
  if (opt.zip64) {
    tail.push(cat(
      u32(0x06064b50),
      u64(44),
      u16(45),
      u16(45),
      u32(0),
      u32(0),
      u64(specs.length),
      u64(specs.length),
      u64(dir.length),
      u64(off),
    ));
    if (!opt.noLocator) tail.push(cat(u32(0x07064b50), u32(0), u64(off + dir.length), u32(1)));
  }
  tail.push(cat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(opt.zip64 ? 0xffff : specs.length),
    u16(opt.zip64 ? 0xffff : specs.length),
    u32(opt.zip64 ? 0xffffffff : dir.length),
    u32(opt.zip64 ? 0xffffffff : off),
    u16(comment.length),
    comment,
  ));
  return cat(...parts, dir, ...tail);
}
