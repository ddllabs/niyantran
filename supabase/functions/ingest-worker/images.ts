// Images from a Mistral OCR page (spec "The ocr step", 7). Each image's base64 is decoded, typed,
// hashed and turned into a RawOcrImage (no base64) plus an upload to corpus/img/<sha256>.<ext>.
// Caps (TenderBase's limits): images over INGEST.maxImageBytes, or beyond INGEST.maxImagesPerPage on
// one page, are skipped and noted, never stored.
//
// Mistral returns `image_base64` as a data URI (`data:image/jpeg;base64,...`); bare base64 is
// handled too. The type is taken from the bytes' magic numbers; a data-URI type is only accepted
// when the bytes confirm it. Only JPEG, PNG and WebP (the corpus bucket's image types) are kept.

import { imagePath, INGEST, type MistralOcrPage, type RawOcrImage } from './types.ts';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const IMAGE_EXT: Readonly<Record<ImageMime, 'jpeg' | 'png' | 'webp'>> = Object.freeze({
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export interface ImageUpload {
  path: string;
  bytes: Uint8Array;
  contentType: ImageMime;
  sha256: string;
}

export interface ImageCaps {
  maxBytes: number;
  maxPerPage: number;
}

const DEFAULT_CAPS: Readonly<ImageCaps> = Object.freeze({
  maxBytes: INGEST.maxImageBytes,
  maxPerPage: INGEST.maxImagesPerPage,
});

/** The type named by the bytes' magic numbers, or null for anything else. */
export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';
  if (
    b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}

const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),/i;

/** Split a data URI into its declared type and payload; bare base64 has no declared type. */
function splitDataUri(value: string): { declared: string | null; base64: boolean; payload: string } {
  const m = DATA_URI.exec(value);
  if (!m) return { declared: null, base64: true, payload: value };
  const declared = m[1].trim().toLowerCase();
  return {
    declared: declared === 'image/jpg' ? 'image/jpeg' : declared || null,
    base64: /;base64$/i.test(m[2]) || m[2].toLowerCase().split(';').includes('base64'),
    payload: value.slice(m[0].length),
  };
}

/** Decoded length of (whitespace-free) base64, without decoding it. */
function decodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type SourceImage = NonNullable<MistralOcrPage['images']>[number];

function boxOf(img: SourceImage): Pick<RawOcrImage, 'top_left_x' | 'top_left_y' | 'bottom_right_x' | 'bottom_right_y'> {
  const out: Pick<RawOcrImage, 'top_left_x' | 'top_left_y' | 'bottom_right_x' | 'bottom_right_y'> = {};
  if (img.top_left_x !== undefined) out.top_left_x = img.top_left_x;
  if (img.top_left_y !== undefined) out.top_left_y = img.top_left_y;
  if (img.bottom_right_x !== undefined) out.bottom_right_x = img.bottom_right_x;
  if (img.bottom_right_y !== undefined) out.bottom_right_y = img.bottom_right_y;
  return out;
}

/**
 * One page's images → RawOcrImage entries (same order, box fields kept, base64 dropped) and the
 * uploads to perform, one per distinct accepted image.
 */
export async function processPageImages(
  images: MistralOcrPage['images'] | undefined,
  caps: ImageCaps = DEFAULT_CAPS,
): Promise<{ images: RawOcrImage[]; uploads: ImageUpload[] }> {
  const out: RawOcrImage[] = [];
  const uploads = new Map<string, ImageUpload>();
  for (const [position, img] of (images ?? []).entries()) {
    const base = { id: img.id, ...boxOf(img) };
    const skip = (skipped: NonNullable<RawOcrImage['skipped']>, byteSize: number | null = null) =>
      out.push({ ...base, sha256: null, mime: null, byte_size: byteSize, skipped });

    if (position >= caps.maxPerPage) {
      skip('over_page_cap');
      continue;
    }
    const raw = typeof img.image_base64 === 'string' ? img.image_base64 : '';
    const { declared, base64, payload } = splitDataUri(raw.trim());
    const b64 = payload.replace(/\s+/g, '');
    if (!b64) {
      skip('no_data');
      continue;
    }
    if (!base64 || (declared !== null && !(declared in IMAGE_EXT))) {
      skip('unsupported_type');
      continue;
    }
    const size = decodedLength(b64);
    if (size > caps.maxBytes) {
      skip('too_large', size);
      continue;
    }
    const bytes = decodeBase64(b64);
    if (!bytes || bytes.length === 0) {
      skip('no_data');
      continue;
    }
    const mime = sniffMime(bytes);
    if (!mime || (declared !== null && declared !== mime)) {
      skip('unsupported_type', bytes.length);
      continue;
    }
    const sha256 = await sha256Bytes(bytes);
    const path = imagePath(sha256, IMAGE_EXT[mime]);
    if (!uploads.has(path)) uploads.set(path, { path, bytes, contentType: mime, sha256 });
    out.push({ ...base, sha256, mime, byte_size: bytes.length });
  }
  return { images: out, uploads: [...uploads.values()] };
}
