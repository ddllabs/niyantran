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

// Handles the model damaged on its way into the prose.
//
// A real turn (message f85ae628, two searches, 98k prompt tokens) cited
// `[wtwo35-9, wtwo35-10]`: the model dropped the `ref:` prefix, bracketed the
// handles and grouped them with a comma. Nothing in the ladder could see that.
// HANDLE_RE needs the literal `ref:`, recoverHandleCitations matches issued
// keys exactly, and stripInventedMarkers needs a colon inside the bracket and
// no whitespace, so the tokens resolved to nothing, resolved no sources and
// reached the reader verbatim. Every single-search turn that hour cited
// cleanly; the only two-search turn did this.
//
// The prefix is what makes a handle unforgeable by a document, so restoring it
// is only safe for a nonce this turn actually issued. That is what noncesOf
// establishes: the nonce is six random characters minted per turn, so corpus
// text cannot carry it by accident, and the text being repaired is the model's
// own output rather than retrieved material.

/** The distinct nonces among issued handles. Anything malformed is ignored. */
export function noncesOf(handles: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const handle of handles) {
    const m = /^ref:([a-z0-9]{6})-\d+$/.exec(String(handle ?? ''));
    if (m) out.add(m[1]);
  }
  return [...out];
}

/** Nonces that are safe to build a pattern from; the six-character shape is enforced. */
function usable(nonces: Iterable<string>): string[] {
  return [...new Set([...nonces])].filter((n) => /^[a-z0-9]{6}$/.test(n));
}

/**
 * Put `ref:` back on a bare `<nonce>-<n>` token so the rest of the ladder can
 * see it. An intact handle is untouched: the lookbehind rules out a preceding
 * colon, so the nonce inside `ref:wtwo35-9` never matches on its own.
 */
export function restoreHandlePrefixes(text: string, nonces: Iterable<string>): string {
  const list = usable(nonces);
  const out = String(text ?? '');
  if (!list.length) return out;
  const re = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_:-])(?:${list.join('|')})-\\d+(?![\\p{L}\\p{M}\\p{N}_-])`,
    'gu',
  );
  return out.replace(re, (m) => `ref:${m}`);
}

/**
 * Remove handle tokens that survived recovery, with or without their prefix.
 *
 * A token still present here named nothing the turn retrieved, so it has no
 * bubble behind it and is not prose. Bracketed groups go whole - `[a, b]`
 * leaves no stray brackets - and the spacing left behind is tidied the way
 * stripInventedMarkers tidies it. Text with no residual handle is returned byte
 * for byte, because the repair pass compares against this output.
 */
export function stripResidualHandles(text: string, nonces: Iterable<string>): string {
  const list = usable(nonces);
  const out = String(text ?? '');
  if (!list.length) return out;
  const token = `(?:ref:)?(?:${list.join('|')})-\\d+`;
  const group = new RegExp(`\\[\\s*${token}(?:\\s*,\\s*${token})*\\s*\\](?!\\()`, 'gu');
  // The same boundaries HANDLE_RE uses, colon included: `ref:` is part of the
  // token, so excluding a preceding colon rules out matching the tail of a
  // longer identifier rather than the handle itself.
  const bare = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_:-])${token}(?![\\p{L}\\p{M}\\p{N}_-])`, 'gu');
  if (!group.test(out) && !bare.test(out)) return out;
  return out
    .replace(group, '')
    .replace(bare, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}
