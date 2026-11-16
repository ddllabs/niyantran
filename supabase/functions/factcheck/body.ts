// Reads a request body up to a byte limit, so an oversized body is refused before it is parsed.

import { HttpError } from '../_shared/http.ts';

export const MAX_JSON_BYTES = 96 * 1024;
/** 600 kB of audio plus the multipart framing. */
export const MAX_MULTIPART_BYTES = 600_000 + 16_384;

export async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > max) throw new HttpError(413, 'Request is too large.');
  if (!req.body) throw new HttpError(400, 'Empty request.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
