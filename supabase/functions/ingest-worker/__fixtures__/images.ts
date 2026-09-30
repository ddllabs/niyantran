// Synthetic image fixtures for the ingest-worker tests. Generated here, never downloaded.
// PNG_1X1 is a complete 1x1 PNG, 70 bytes (signature, IHDR, IDAT, IEND; chunk CRCs checked). The JPEG, WebP and GIF values carry only the
// format's magic bytes plus padding: enough for type sniffing, not renderable images.

export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** `size` bytes starting with `magic`, the rest zero. */
export function withMagic(magic: number[], size: number): Uint8Array {
  const out = new Uint8Array(Math.max(size, magic.length));
  out.set(magic);
  return out;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  webp: [...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WEBPVP8 ')],
  gif: ascii('GIF89a'),
} as const;

export const JPEG_BASE64 = toBase64(withMagic([...MAGIC.jpeg], 32));
export const WEBP_BASE64 = toBase64(withMagic([...MAGIC.webp], 32));
export const GIF_BASE64 = toBase64(withMagic([...MAGIC.gif], 32));

export const dataUri = (mime: string, b64: string) => `data:${mime};base64,${b64}`;
