// Mirror of supabase/functions/_shared/textNormalise.ts. Both must produce the
// same output for the same input: the reader recomputes a chunk's text hash
// with this file and compares it to the hash the server stored.

export function normalise(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
