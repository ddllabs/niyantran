// Row encoding for the local retrieval replica loader (scripts/eval-replica/load.mjs). Pure
// functions: the loader does the reading, the psql call and the logging.
//
// The encoding is PostgreSQL COPY *text* format, not CSV. The first replica load (2026-11-01)
// piped quoted CSV to `psql \copy ... from stdin` and stopped after 34,500 chunks with
// "unterminated CSV quoted field ... line 414". In text format a value's backslash, newline,
// carriage return and tab are escaped, so no data line can ever be the end-of-data marker `\.`,
// and a value cannot contain a raw line break to confuse the stream. The rules are in
// https://www.postgresql.org/docs/current/sql-copy.html ("Text Format").
//
// NUL: PostgreSQL text and jsonb cannot hold U+0000, so a NUL in a row read from NTER means a
// bug upstream, not data to keep. The encoder fails loudly with the row's id and the column
// name (never the content) instead of stripping it and loading a changed value.

/** An error that names the row and column, never the content. */
export class ReplicaCopyError extends Error {
  constructor(message, { rowId = null, column = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReplicaCopyError';
    this.rowId = rowId;
    this.column = column;
  }
}

const COPY_NULL = '\\N';
const ESCAPES = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Throws a reason (no content) when a string cannot be stored by PostgreSQL as written. */
function checkString(s) {
  if (s.includes('\u0000')) throw new ReplicaCopyError('contains a NUL character, which PostgreSQL text cannot hold');
  if (LONE_SURROGATE.test(s)) throw new ReplicaCopyError('contains an unpaired surrogate, which cannot be written as UTF-8');
}

/** The same check for every string and object key inside a JSON value. */
function checkJson(v) {
  if (typeof v === 'string') checkString(v);
  else if (Array.isArray(v)) v.forEach(checkJson);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      checkString(k);
      checkJson(x);
    }
  }
}

const escapeCopy = (s) => s.replace(/[\\\n\r\t]/g, (ch) => ESCAPES[ch]);

function arrayLiteral(a) {
  return `{${a.map((e) => {
    if (e === null || e === undefined) return 'NULL';
    if (Array.isArray(e)) return arrayLiteral(e);
    if (typeof e === 'string') {
      checkString(e);
      return `"${e.replace(/[\\"]/g, '\\$&')}"`;
    }
    if (typeof e === 'number' || typeof e === 'boolean') return String(e);
    throw new ReplicaCopyError('array element is not a string, number, boolean, null or array');
  }).join(',')}}`;
}

/**
 * One value as a COPY text field.
 *
 * kind: 'text' (default; string, number or boolean), 'json' (any JSON value, written as JSON),
 * 'array' (a JS array, written as a PostgreSQL array literal such as {"a","b"}), or 'vector'
 * (pgvector's text form "[0.1,0.2]", or an array of finite numbers).
 */
export function encodeValue(value, kind = 'text') {
  if (value === null || value === undefined) return COPY_NULL;
  if (kind === 'json') {
    checkJson(value);
    return escapeCopy(JSON.stringify(value));
  }
  if (kind === 'array') {
    if (!Array.isArray(value)) throw new ReplicaCopyError('expected an array for an array column');
    return escapeCopy(arrayLiteral(value));
  }
  if (kind === 'vector') {
    if (Array.isArray(value)) {
      if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new ReplicaCopyError('vector holds a value that is not a finite number');
      return `[${value.join(',')}]`;
    }
    if (typeof value !== 'string' || !/^\[[-+0-9.eE,]*\]$/.test(value)) throw new ReplicaCopyError('expected a vector as "[…]" text or an array of numbers');
    return value;
  }
  if (kind !== 'text') throw new ReplicaCopyError(`unknown column kind ${kind}`);
  if (typeof value === 'string') {
    checkString(value);
    return escapeCopy(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  throw new ReplicaCopyError('expected text, a number or a boolean; declare the column as json for objects');
}

/** Columns are names, or { name, kind }. */
export const normaliseColumns = (columns) => columns.map((c) => (typeof c === 'string' ? { name: c, kind: 'text' } : { kind: 'text', ...c }));

/** One row as a tab-separated COPY line (no trailing newline). Errors carry the row's id. */
export function encodeRow(row, columns, { idColumn = 'id' } = {}) {
  return normaliseColumns(columns).map(({ name, kind }) => {
    try {
      return encodeValue(row[name], kind);
    } catch (e) {
      if (!(e instanceof ReplicaCopyError)) throw e;
      const rowId = row[idColumn] ?? null;
      throw new ReplicaCopyError(`row ${rowId ?? '(no id)'}, column ${name}: ${e.message}`, { rowId, column: name, cause: e });
    }
  }).join('\t');
}

/** Rows as COPY text: one line per row, each ending in a newline. */
export function encodeRows(rows, columns, options) {
  return rows.map((r) => `${encodeRow(r, columns, options)}\n`).join('');
}

const SUMMARY_LIMIT = 200;

/**
 * What of a psql failure may reach a log: the ERROR line, with quoted values redacted, cut to a
 * fixed length. psql's CONTEXT and DETAIL lines quote the offending row, so they are dropped.
 */
export function psqlErrorSummary(stderr) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => l.startsWith('ERROR:')) ?? lines[0] ?? 'no error text';
  return line.replace(/"[^"]*"/g, '"…"').slice(0, SUMMARY_LIMIT);
}

const FOREIGN_KEY = /violates foreign key constraint/;

/**
 * True when PostgreSQL rejected the data, not the connection: a COPY failure at a data line, or a
 * foreign-key violation (checked at the end of the statement, so it has no COPY line context; bisecting
 * the batch still finds the row).
 */
export const isRowError = (stderr) => /^CONTEXT:\s+COPY\s/m.test(String(stderr)) || FOREIGN_KEY.test(String(stderr));

/** What to do about a row error that has a known cause, or null. */
export function psqlErrorHint(stderr) {
  if (FOREIGN_KEY.test(String(stderr))) {
    return 'the row refers to a document that is not in the replica; the document was probably indexed on NTER after the documents were copied. Run again with --resume, which re-reads the documents.';
  }
  return null;
}

/**
 * Copy a batch with `copy(rows)` (one atomic COPY). If PostgreSQL rejects it for a reason in the
 * data (error.rowError), halve it and retry until the one row it rejects is found, then throw
 * ReplicaCopyError naming that row's id. Rows before it stay copied. Any other failure (the
 * container is down, say) is thrown at once, unsplit.
 */
export async function copyWithBisect(rows, copy, { idColumn = 'id' } = {}) {
  if (!rows.length) return;
  try {
    await copy(rows);
  } catch (e) {
    if (!e.rowError) throw e;
    if (rows.length === 1) {
      const rowId = rows[0][idColumn] ?? null;
      throw new ReplicaCopyError(`row ${rowId ?? '(no id)'} was rejected by PostgreSQL: ${e.message}${e.hint ? ` (${e.hint})` : ''}`, { rowId, cause: e });
    }
    const mid = rows.length >> 1;
    await copyWithBisect(rows.slice(0, mid), copy, { idColumn });
    await copyWithBisect(rows.slice(mid), copy, { idColumn });
  }
}

const fmt = (n) => (n === null || n === undefined ? 'unknown' : Number(n).toLocaleString('en-US'));

/**
 * Compare the row counts NTER reported for each copied table with the replica's own. A null
 * source count (the request failed) is 'unknown' and never a match.
 */
export function compareCounts(source, replica) {
  const tables = Object.keys(replica).map((table) => {
    const s = source[table] ?? null;
    const r = replica[table];
    const status = s === null ? 'unknown' : r === s ? 'equal' : r < s ? 'replica_short' : 'replica_extra';
    return { table, source: s, replica: r, status };
  });
  return { match: tables.every((t) => t.status === 'equal'), tables };
}

/** One line per table with both counts, then a WARNING for each that differs. `mode` is 'full' or 'resumed'. */
export function countReportLines(comparison, { mode }) {
  const lines = comparison.tables.map((t) => `  ${t.table}: NTER ${fmt(t.source)}, replica ${fmt(t.replica)}`);
  if (mode === 'resumed') lines.push('  load mode: resumed (chunks added on NTER with an id below the largest copied are missed)');
  for (const t of comparison.tables) {
    if (t.status === 'unknown') lines.push(`WARNING: ${t.table} on NTER could not be counted, so the replica's ${fmt(t.replica)} rows cannot be confirmed complete.`);
    else if (t.status === 'replica_short') lines.push(`WARNING: ${t.table}: the replica is ${fmt(t.source - t.replica)} rows short of NTER (${fmt(t.replica)} of ${fmt(t.source)}).`);
    else if (t.status === 'replica_extra') lines.push(`WARNING: ${t.table}: the replica holds ${fmt(t.replica - t.source)} more rows than NTER (${fmt(t.replica)} against ${fmt(t.source)}).`);
  }
  if (!comparison.match) {
    lines.push(mode === 'resumed'
      ? 'WARNING: counts differ and this load was resumed; run a full load (--fresh) if the baseline needs an exact snapshot. NTER may also have changed during a long load.'
      : 'WARNING: counts differ. NTER may have changed during a long load; re-run when it is quiet, or record the difference with any figures taken from this replica.');
  }
  return lines;
}
