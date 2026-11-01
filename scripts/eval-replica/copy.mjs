/**
 * psql inside the corpus container, and the COPY into it, for the replica loader
 * (scripts/eval-replica/load.mjs). Row encoding lives in src/lib/replicaCopy.js.
 *
 * A copier is bound to ONE database, and only three exist: the replica, and one throwaway database
 * for each of the two self-tests. Anything else is refused, as is the container: only
 * niyantran-corpus-test-db is ever addressed. The 'postgres' database is reachable only through
 * createDatabase, dropDatabase and databaseExists, which insert the bound name themselves; no
 * caller can send it SQL of its own.
 */
import { spawnSync } from 'node:child_process';
import { copyWithBisect, encodeRows, isRowError, normaliseColumns, psqlErrorHint, psqlErrorSummary } from '../../src/lib/replicaCopy.js';

export const CONTAINER = 'niyantran-corpus-test-db';
export const REPLICA_DATABASE = 'niyantran_retrieval_replica';
export const COPY_TEST_DATABASE = 'niyantran_replica_copy_test';
export const LOADER_TEST_DATABASE = 'niyantran_replica_loader_test';
const ALLOWED = new Set([REPLICA_DATABASE, COPY_TEST_DATABASE, LOADER_TEST_DATABASE]);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function makeCopier({ database = REPLICA_DATABASE } = {}) {
  if (!ALLOWED.has(database)) throw new Error(`refusing to touch database ${database}`);

  /** Run psql; returns { status, stdout, stderr }. Only the bound database, or postgres for the three calls below. */
  function run(target, sql, input) {
    if (target !== database && target !== 'postgres') throw new Error(`refusing to touch database ${target}`);
    const args = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', target, '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
    if (sql) args.push('-c', sql);
    const res = spawnSync('docker', args, { input: input ?? '', encoding: 'utf8', maxBuffer: 1 << 30 });
    if (res.error) throw new Error(`could not run docker (is it on PATH, and are you outside the sandbox?): ${res.error.message}`);
    return res;
  }

  /** psql with the whole failure text on error (DDL and queries: it holds no row content). */
  function psql(target, sql, { input } = {}) {
    const res = run(target, sql, input);
    if (res.status !== 0) throw new Error(`psql (${target}) failed: ${res.stderr || res.stdout}`);
    return res.stdout.trim();
  }

  /** One atomic COPY of a ready payload. Errors carry only the summarised ERROR line. */
  function copyRaw(table, columnNames, payload, options = 'format text') {
    if (!IDENTIFIER.test(table) || !columnNames.every((c) => IDENTIFIER.test(c))) throw new Error('bad table or column name');
    const res = run(database, `\\copy public.${table} (${columnNames.join(', ')}) from stdin with (${options})`, payload);
    if (res.status !== 0) {
      throw Object.assign(new Error(psqlErrorSummary(res.stderr || res.stdout)), { rowError: isRowError(res.stderr), hint: psqlErrorHint(res.stderr) });
    }
  }

  /**
   * Copy rows in COPY text format. An unencodable row (a NUL, say) throws before anything is
   * sent, naming the row's id. A row PostgreSQL rejects is found by halving the batch and
   * throws ReplicaCopyError naming its id; the rows before it stay copied.
   */
  async function copyInto(table, columns, rows, { idColumn = 'id' } = {}) {
    if (!rows.length) return;
    const cols = normaliseColumns(columns);
    encodeRows(rows, cols, { idColumn });
    await copyWithBisect(rows, (batch) => copyRaw(table, cols.map((c) => c.name), encodeRows(batch, cols, { idColumn })), { idColumn });
  }

  return {
    database,
    psql: (sql, opts) => psql(database, sql, opts),
    createDatabase: () => void psql('postgres', `create database ${database}`),
    dropDatabase: () => void psql('postgres', `drop database if exists ${database}`),
    databaseExists: () => psql('postgres', `select 1 from pg_database where datname = '${database}'`) === '1',
    copyRaw,
    copyInto,
  };
}
