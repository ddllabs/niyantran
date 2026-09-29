/**
 * What the desk-row loader must write (open-work F20). desk_rows mirrors the
 * rows each desk module shows; a run compares the module's rows with the stored
 * ones and returns only the new or changed rows to upsert and the keys that
 * disappeared, so an unchanged module writes nothing.
 *
 * Stored rows come back from PostgREST with jsonb keys reordered and timestamps
 * as "+00:00", so values are compared canonically: objects by sorted keys,
 * timestamps by instant.
 */

/** JSON with object keys sorted at every depth, so equal values compare equal. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameInstant(a, b) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b;
}

/**
 * @param {object[]} existing rows stored for one (tier, feature)
 * @param {object[]} incoming rows the module shows now (unique row_key)
 * @param {{ ignoreSnapshot?: boolean }} [options] ignoreSnapshot when the
 *   module's snapshot_at is only the run time, not a date from its data
 * @returns {{ upserts: object[], deleteKeys: string[], unchanged: number }}
 */
export function planDeskRowSync(existing, incoming, { ignoreSnapshot = false } = {}) {
  const stored = new Map(existing.map((r) => [r.row_key, r]));
  const upserts = [];
  let unchanged = 0;
  for (const next of incoming) {
    const prev = stored.get(next.row_key);
    const same = prev
      && canonicalJson(prev.row) === canonicalJson(next.row)
      && (prev.record_text ?? null) === (next.record_text ?? null)
      && (prev.document_key ?? null) === (next.document_key ?? null)
      && (ignoreSnapshot || sameInstant(prev.snapshot_at, next.snapshot_at));
    if (same) unchanged += 1;
    else upserts.push(next);
  }
  const keep = new Set(incoming.map((r) => r.row_key));
  const deleteKeys = existing.map((r) => r.row_key).filter((key) => !keep.has(key));
  return { upserts, deleteKeys, unchanged };
}
