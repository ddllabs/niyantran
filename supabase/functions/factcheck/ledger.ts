// The entity ledger: who is speaking and which people, places, organisations and numbers have come up,
// so a later turn can resolve "he" and "this scheme". The function keeps no state: the browser sends the
// ledger with each turn and gets the updated one back. It holds the 30 most recent entries, in at most
// 4 kB, so the cost of a turn stays flat over a session (spec D3).

import { clip } from './claimText.ts';

export const LEDGER_MAX_ENTRIES = 30;
export const LEDGER_MAX_BYTES = 4096;
const NAME_MAX = 100;
const KIND_MAX = 20;
const NOTE_MAX = 300;
const KINDS = new Set(['person', 'org', 'place', 'scheme', 'topic', 'speaker', 'number', 'date', 'other']);

export interface LedgerEntry {
  name: string;
  kind: string;
  note: string;
}
export interface Ledger {
  entries: LedgerEntry[];
}

const bytes = (l: Ledger) => new TextEncoder().encode(JSON.stringify(l)).length;

/** The ledger from a request, or undefined when it is malformed or over 4 kB. null/absent start empty. */
export function ledgerFromInput(input: unknown): Ledger | undefined {
  if (input === null || input === undefined) return { entries: [] };
  if (typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = (input as Record<string, unknown>).entries;
  if (raw === undefined) return { entries: [] };
  if (!Array.isArray(raw) || raw.length > LEDGER_MAX_ENTRIES) return undefined;
  const entries: LedgerEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') return undefined;
    const { name, kind, note } = e as Record<string, unknown>;
    if (typeof name !== 'string' || typeof kind !== 'string' || typeof note !== 'string') return undefined;
    entries.push({ name: clip(name, NAME_MAX), kind: clip(kind, KIND_MAX), note: clip(note, NOTE_MAX) });
  }
  const ledger = { entries };
  return bytes(ledger) <= LEDGER_MAX_BYTES ? ledger : undefined;
}

/**
 * Applies the model's updates: an entry of the same name (any case) is replaced and moves to the recent
 * end. Then the oldest entries go until there are at most 30 and the JSON fits in 4 kB.
 */
export function mergeLedger(ledger: Ledger, updates: unknown[]): Ledger {
  let entries = [...ledger.entries];
  for (const u of updates.slice(0, 20)) {
    if (!u || typeof u !== 'object') continue;
    const { name, kind, note } = u as Record<string, unknown>;
    if (typeof name !== 'string' || typeof note !== 'string') continue;
    const cleanName = clip(name, NAME_MAX);
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    entries = entries.filter((e) => e.name.toLowerCase() !== key);
    const k = typeof kind === 'string' ? clip(kind, KIND_MAX).toLowerCase() : 'other';
    entries.push({ name: cleanName, kind: KINDS.has(k) ? k : 'other', note: clip(note, NOTE_MAX) });
  }
  entries = entries.slice(-LEDGER_MAX_ENTRIES);
  while (entries.length > 0 && bytes({ entries }) > LEDGER_MAX_BYTES) entries.shift();
  return { entries };
}
