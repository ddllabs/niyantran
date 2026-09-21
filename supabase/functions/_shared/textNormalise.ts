// The one normalisation used by chunk hashes, text hashes and the reader's
// staleness check. Mirrored byte for byte by src/lib/textNormalise.js; the
// parity fixture src/lib/__fixtures__/normalise.json is read by both tests.
// RAG spec §B and §H.

export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
