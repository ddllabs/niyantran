// Opaque handles for retrieved passages and rows (streaming spec §B). The
// model cites a handle, never an id: a UUID in the prompt gets imitated into
// the answer. Handles are unbracketed (a bracketed one looks like a `[1]`
// marker and small models copy it into prose), nonce'd so a document cannot
// contain one by accident, stable within a turn and never reused across
// turns. Resolution back to the chunk or row is an exact map lookup.

// Identifier characters cannot adjoin a handle. A preceding colon also rules
// out namespace-prefixed tokens; a following colon is ordinary prose punctuation.
export const HANDLE_RE = /(?<![\p{L}\p{M}\p{N}_:-])ref:[a-z0-9]{6}-\d+(?![\p{L}\p{M}\p{N}_-])/gu;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomNonce(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export interface HandleAssigner {
  readonly nonce: string;
  /** The handle for a key; the same key always gets the same handle within the turn. */
  assign(key: string): string;
  lookup(handle: string): string | undefined;
  /** handle → key, in assignment order. */
  handles(): Record<string, string>;
  size(): number;
}

export function createHandleAssigner(nonce: string = randomNonce()): HandleAssigner {
  if (!/^[a-z0-9]{6}$/.test(nonce)) throw new Error(`handle nonce must be six of [a-z0-9], got "${nonce}"`);
  const byKey = new Map<string, string>();
  const byHandle = new Map<string, string>();
  let n = 0;
  return {
    nonce,
    assign(key) {
      const seen = byKey.get(key);
      if (seen) return seen;
      n += 1;
      const handle = `ref:${nonce}-${n}`;
      byKey.set(key, handle);
      byHandle.set(handle, key);
      return handle;
    },
    lookup(handle) {
      return byHandle.get(handle);
    },
    handles() {
      return Object.fromEntries(byHandle);
    },
    size() {
      return byHandle.size;
    },
  };
}

/** Every handle token in a text, in order, deduplicated. */
export function handlesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(HANDLE_RE)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}
