// F305: a failed proof keeps its evidence and the database is not reset until someone has looked at it.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  errorLabel,
  evidenceDir,
  keepAfterThrow,
  keepEvidence,
  ledgerQueries,
  markerPath,
  markInspected,
  pendingFailure,
  pendingFailureMessage,
  shouldKeepEvidence,
  stamp,
} from './evidence.ts';

const DB = 'niyantran_ingest_load_reg_test';
const none = () => Promise.resolve('[]');

// A temporary folder of its own (lp.sh test allows writing $TMPDIR for this).
async function withHome(f: (home: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'evidence-test-' });
  // keepEvidence takes the folder that holds niyantran-eval-cache, so give it a home of its own.
  const home = `${dir}/h`;
  await Deno.mkdir(home);
  try {
    await f(home);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test('only a real failure keeps evidence: not a pass, not a confirmed break, not a refusal to start', () => {
  assertEquals(shouldKeepEvidence(0, null), false);
  assertEquals(shouldKeepEvidence(1, null), true);
  assertEquals(shouldKeepEvidence(3, null), true);
  assertEquals(shouldKeepEvidence(2, null), false);
  assertEquals(shouldKeepEvidence(1, 'held-key'), false);
  assertEquals(shouldKeepEvidence(3, 'held-key'), true);
});

// Exactly the columns each ledger query may select. A new column is a decision: add it here only after checking it
// cannot hold document text, a title, a URL, an error message or a policy body.
const ALLOWED: Record<string, { from: string; columns: string[] }> = {
  ingest_batches: {
    from: 'ingest_batches',
    columns: [
      'id', 'collection', 'state', 'stopped_from', 'stop_reason', 'items_planned', 'chunks_planned', 'runner_commit',
      'created_at', 'sealed_at', 'stopped_at',
    ],
  },
  ingest_batch_items: {
    from: 'ingest_batch_items',
    columns: ['batch_id', 'source_key', 'outcome', 'reason', 'chunks', 'document_id', 'job_id', 'requeues', 'decided_at'],
  },
  ingest_batch_events: { from: 'ingest_batch_events', columns: ['id', 'batch_id', 'event', 'created_at'] },
  ingest_batch_acceptance: {
    from: 'ingest_batch_acceptance',
    columns: ['batch_id', 'check_name', 'passed', 'cardinality(sample) as sample_size', 'recorded_at'],
  },
  ingest_jobs: {
    from: 'ingest_jobs',
    columns: [
      'id', 'document_id', 'batch_id', 'status', 'stage', 'attempts', 'error_code', 'pages_total', 'created_at',
      'started_at', 'finished_at',
    ],
  },
  job_counts: { from: 'ingest_jobs', columns: ['batch_id', 'status', 'stage', 'count(*) as n'] },
};

/** The items of the innermost select list of a ledger query, split at top-level commas. */
export function selectedColumns(sql: string): { from: string; columns: string[] } {
  const m = /select (.+?) from public\.(\w+)/s.exec(sql.slice(sql.indexOf('from (') + 6));
  if (!m) throw new Error(`cannot read the select list of ${sql}`);
  const cols: string[] = [];
  let depth = 0, cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cols.push(cur.trim());
  return { from: m[2], columns: cols };
}

Deno.test('each ledger query selects exactly its allowed columns: nothing added, nothing dropped', () => {
  const queries = ledgerQueries();
  assertEquals(Object.keys(queries).sort(), Object.keys(ALLOWED).sort());
  for (const [name, sql] of Object.entries(queries)) {
    assertEquals(selectedColumns(sql), ALLOWED[name], name);
  }
});

Deno.test('the column reader sees a column added to a query (so the allowlist test can fail)', () => {
  const sql = ledgerQueries().ingest_jobs.replace('error_code,', 'error_code, last_error_message,');
  assertEquals(selectedColumns(sql).columns.includes('last_error_message'), true);
  assert(selectedColumns(sql).columns.length === ALLOWED.ingest_jobs.columns.length + 1);
});

Deno.test('the evidence stamp is the one the shell scripts use: 20261115T100000', () => {
  assertEquals(stamp(new Date('2026-11-15T10:00:00.123Z')), '20261115T100000');
  assert(evidenceDir('/h', DB, new Date('2026-11-15T10:00:00Z')).endsWith(`/${DB}/20261115T100000`));
});

Deno.test('an error is recorded by its name and code, never its text', () => {
  const e = Object.assign(new Error('duplicate key value violates unique constraint "x" Key (file_url)=(https://a.example/b.pdf)'), {
    name: 'PostgresError',
    code: '23505',
  });
  assertEquals(errorLabel(e), 'PostgresError 23505');
  assertEquals(errorLabel(new TypeError('secret text')), 'TypeError');
  assertEquals(errorLabel('free text with a url https://x'), 'non-error value');
});

Deno.test('a thrown error keeps evidence once writes began, and a refusal to start does not', () => {
  assertEquals(keepAfterThrow({ refusal: true, wrote: false }), false);
  assertEquals(keepAfterThrow({ refusal: true, wrote: true }), true);
  assertEquals(keepAfterThrow({ refusal: false, wrote: false }), true);
  assertEquals(keepAfterThrow({ refusal: false, wrote: true }), true);
});

Deno.test('a database with an uninspected failure is refused, naming the right command; another is not', async () => {
  await withHome(async (home) => {
    assertEquals(await pendingFailureMessage(home, DB), null);
    await keepEvidence({ home, db: DB, proof: 'p', reason: 'r', files: {}, query: none });
    const m = await pendingFailureMessage(home, DB);
    assert(m && m.includes('not been inspected') && m.includes('regulatory-setup.sh inspected'), String(m));
    const other = 'niyantran_ingest_load_bulk_test';
    await keepEvidence({ home, db: other, proof: 'p', reason: 'r', files: {}, query: none });
    const o = await pendingFailureMessage(home, other);
    assert(o && o.includes(`LOAD_PROOF_DB=${other}`) && o.includes('db.sh inspected'), String(o));
    assertEquals(await pendingFailureMessage(home, 'niyantran_ingest_load_zzz_reg_test'), null);
  });
});

Deno.test('a failure writes the copied files, the ledger and a marker, and reports the folder', async () => {
  await withHome(async (home) => {
    const src = `${home}/run/receipts`;
    await Deno.mkdir(src, { recursive: true });
    await Deno.writeTextFile(`${src}/acceptance-1.json`, '{"ok":false}');
    const seen: string[] = [];
    const now = new Date('2026-11-15T10:00:00Z');
    const folder = await keepEvidence({
      home,
      db: DB,
      proof: 'regulatory-proof',
      reason: 'probe_not_first',
      now,
      copy: { receipts: src },
      files: { 'proof.json': '{"verdict":"FAIL"}' },
      query: (sql) => {
        seen.push(sql);
        return Promise.resolve('[{"n":1}]');
      },
    });
    assert(folder.startsWith(evidenceDir(home, DB, now)));
    assertEquals(await Deno.readTextFile(`${folder}/receipts/acceptance-1.json`), '{"ok":false}');
    assertEquals(await Deno.readTextFile(`${folder}/proof.json`), '{"verdict":"FAIL"}');
    assert(seen.length >= 4);
    assertEquals(await Deno.readTextFile(`${folder}/ledger-ingest_batches.json`), '[{"n":1}]');
    const marker = JSON.parse(await Deno.readTextFile(markerPath(home, DB)));
    assertEquals(marker.folder, folder);
    assertEquals(marker.reason, 'probe_not_first');
    assertEquals((await pendingFailure(home, DB))?.folder, folder);
  });
});

Deno.test('a ledger that cannot be read does not lose the rest of the evidence', async () => {
  await withHome(async (home) => {
    const folder = await keepEvidence({
      home,
      db: DB,
      proof: 'bulk-proof',
      reason: 'drain_timeout',
      files: { 'receipt.json': '{}' },
      query: () => Promise.reject(new Error('database "x" does not exist')),
    });
    assertEquals(await Deno.readTextFile(`${folder}/receipt.json`), '{}');
    const le = await Deno.readTextFile(`${folder}/ledger-error.txt`);
    assert(le.includes('ingest_batches: Error'), le);
    assert(!le.includes('does not exist') && !le.includes('"x"'), le);
    assert(await pendingFailure(home, DB));
  });
});

Deno.test('a folder that cannot be copied is recorded by error name only', async () => {
  await withHome(async (home) => {
    const folder = await keepEvidence({
      home,
      db: DB,
      proof: 'p',
      reason: 'r',
      copy: { receipts: `${home}/no-such-folder-with-a-secret-name` },
      query: none,
    });
    const t = await Deno.readTextFile(`${folder}/copy-error-receipts.txt`);
    assert(t.includes('NotFound') && !t.includes('secret-name'), t);
  });
});

Deno.test('a second failure never overwrites the first folder, and the marker names the latest', async () => {
  await withHome(async (home) => {
    const o = { home, db: DB, proof: 'p', reason: 'r', now: new Date('2026-11-15T10:00:00Z'), query: none };
    const a = await keepEvidence({ ...o, files: { 'x.json': '1' } });
    const b = await keepEvidence({ ...o, files: { 'x.json': '2' } });
    assert(a !== b);
    assertEquals(await Deno.readTextFile(`${a}/x.json`), '1');
    assertEquals((await pendingFailure(home, DB))?.folder, b);
  });
});

Deno.test('inspecting clears the marker and keeps the evidence; another database is unaffected', async () => {
  await withHome(async (home) => {
    const folder = await keepEvidence({ home, db: DB, proof: 'p', reason: 'r', files: { x: '1' }, query: none });
    assertEquals(await pendingFailure(home, 'niyantran_ingest_load_other_reg_test'), null);
    await markInspected(home, DB, new Date('2026-11-15T11:00:00Z'));
    assertEquals(await pendingFailure(home, DB), null);
    assertEquals(await Deno.readTextFile(`${folder}/x`), '1');
    await assertRejects(() => markInspected(home, DB, new Date()), Error, 'no uninspected');
  });
});

Deno.test('a database name that could escape the folder is refused', async () => {
  await withHome(async (home) => {
    await assertRejects(
      () => keepEvidence({ home, db: '../x', proof: 'p', reason: 'r', files: {}, query: none }),
      Error,
      'database name',
    );
  });
});
