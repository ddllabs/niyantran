/**
 * psql inside the corpus container for the migration rehearsal (scripts/eval-replica/rehearse.mjs).
 *
 * An admin is bound to ONE source and ONE target at construction. The target must be a
 * niyantran_rehearsal_ database (src/lib/rehearsal.js); the source is the replica or another
 * rehearsal database. The only statements sent to the `postgres` database are the few fixed ones
 * below, each inserting the bound names itself, and the only database ever created or dropped is
 * the target. The source is read only as a template: nothing connects to it, and nothing is written
 * to it. Only the niyantran-corpus-test-db container is ever addressed.
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { assertRehearsalDatabase, assertSourceDatabase } from '../../src/lib/rehearsal.js';

export const CONTAINER = 'niyantran-corpus-test-db';

const dockerArgs = (database, extra) => ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-At', ...extra];

function dockerMissing(error) {
  return new Error(`could not run docker (is it on PATH, and are you outside the sandbox?): ${error.message}`);
}

/** One-shot psql, synchronous. Used only before and after the migration, when nothing else is running. */
function runPsql(database, { sql, input, singleTransaction = false }) {
  const args = dockerArgs(database, ['-v', 'ON_ERROR_STOP=1', ...(singleTransaction ? ['--single-transaction', '-f', '-'] : [])]);
  if (sql) args.push('-c', sql);
  const res = spawnSync('docker', args, { input: input ?? '', encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.error) throw dockerMissing(res.error);
  if (res.status !== 0) throw new Error(`psql (${database}) failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

export function makeRehearsalAdmin({ source, target }) {
  assertSourceDatabase(source);
  assertRehearsalDatabase(target);
  if (source === target) throw new Error('the source and the target are the same database');

  const onPostgres = (sql) => runPsql('postgres', { sql });
  const sizes = (database) => Number(onPostgres(`select pg_database_size('${database}')`));
  const exists = (database) => onPostgres(`select 1 from pg_database where datname = '${database}'`) === '1';

  return {
    source,
    target,
    sourceExists: () => exists(source),
    targetExists: () => exists(target),
    sourceBytes: () => sizes(source),
    /** Sessions connected to the source, which `create database ... template` cannot tolerate. */
    sourceConnections: () => {
      const [count, apps] = onPostgres(`select count(*), coalesce(string_agg(distinct coalesce(nullif(application_name, ''), '(unnamed)'), ', '), '') from pg_stat_activity where datname = '${source}'`).split('|');
      return { count: Number(count), applications: apps };
    },
    dataDirectory: () => onPostgres('show data_directory'),
    /** An empty target, for the self-test's small source database. */
    createEmpty: () => void onPostgres(`create database ${target}`),
    /** A whole SQL script on the target, from stdin. */
    script: (text) => runPsql(target, { input: text }),
    /** FILE_COPY avoids writing the whole source through the WAL a second time (PostgreSQL 15 and later). */
    createFromTemplate: () => void onPostgres(`create database ${target} template ${source} strategy file_copy`),
    /** Ends every session on the target (an interrupted rehearsal), which rolls back a running migration. */
    terminateTarget: () => void onPostgres(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${target}'`),
    /** The target is ours alone, so `force` may end any session still on it. */
    dropTarget: () => void onPostgres(`drop database if exists ${target} with (force)`),
    /** psql on the target, synchronous: for statements run while nothing else is. */
    sql: (sql) => runPsql(target, { sql }),
    json: (sql) => JSON.parse(runPsql(target, { sql: `select coalesce(json_agg(t), '[]'::json) from (${sql}) t` })),
    /**
     * The prelude: a SQL script applied to the TARGET only (this method takes no database), in its own
     * transaction when `wrap` is true, otherwise as the file is (it manages its own).
     */
    applyPrelude: (text, { wrap }) => void runPsql(target, { input: text, singleTransaction: wrap }),
    /**
     * Start the migration, reading it from stdin: in psql --single-transaction when `wrap` is true, otherwise
     * as the file is (it has its own begin/commit, or --no-wrap). The caller owns the child.
     */
    spawnMigration: ({ wrap }) => spawn('docker', dockerArgs(target, ['-v', 'ON_ERROR_STOP=1', ...(wrap ? ['--single-transaction'] : []), '-f', '-']), { stdio: ['pipe', 'ignore', 'pipe'] }),
    /** A long-lived psql on the target for the probe and the sampler. */
    openSession: () => new PsqlSession(spawn('docker', dockerArgs(target, []), { stdio: ['pipe', 'pipe', 'pipe'] })),
  };
}

/** Free kilobytes-to-bytes of the filesystem holding `path` inside the container (`df -Pk`). */
export function freeBytes(path) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['exec', CONTAINER, 'df', '-Pk', path], { encoding: 'utf8' }, (error, stdout) => {
      if (error) return reject(dockerMissing(error));
      const row = stdout.trim().split('\n').at(-1).split(/\s+/);
      const kb = Number(row[3]);
      if (!Number.isFinite(kb)) return reject(new Error(`could not read free space from: ${stdout}`));
      return resolve(kb * 1024);
    });
  });
}

/**
 * A persistent psql connection that answers one query at a time. Each query is followed by an
 * `\echo` of a token and psql's own :ERROR flag, so the end of its output and whether it failed are
 * read from stdout, in order, whatever stderr does.
 */
export class PsqlSession {
  constructor(child) {
    this.child = child;
    this.counter = 0;
    this.pending = null;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.resume();
    child.on('error', (e) => this.fail(dockerMissing(e)));
    child.on('close', () => this.fail(new Error('psql session closed')));
    this.exited = new Promise((resolve) => child.on('close', resolve));
  }

  onData(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      const p = this.pending;
      if (!p) continue;
      if (line.startsWith(p.token)) {
        this.pending = null;
        p.resolve({ lines: p.lines, error: line.slice(p.token.length).trim() === 'true', ms: performance.now() - p.started });
      } else p.lines.push(line);
    }
  }

  fail(error) {
    const p = this.pending;
    this.pending = null;
    p?.reject(error);
  }

  /** Resolves { lines, error, ms } when psql has finished the statement (error is true when it failed). */
  query(sql) {
    return new Promise((resolve, reject) => {
      if (this.pending) return reject(new Error('a query is already running on this session'));
      const token = `__done_${++this.counter}__`;
      this.pending = { token, lines: [], resolve, reject, started: performance.now() };
      return this.child.stdin.write(`${sql}\n\\echo ${token} :ERROR\n`);
    });
  }

  async close() {
    this.child.stdin.end();
    await this.exited;
  }
}
