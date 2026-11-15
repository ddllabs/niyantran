// F305: when a proof fails, keep what it left behind and make the setup scripts refuse to reset the database until
// someone has looked. Nothing here decides why a run failed.
//
//   ~/niyantran-eval-cache/proof-failures/<db>.marker      JSON: the evidence folder, the proof and a reason that is a code, never error text; present
//                                                          while the failure is uninspected. db.sh and
//                                                          regulatory-setup.sh refuse to replace or drop <db> while it exists.
//   ~/niyantran-eval-cache/proof-failures/<db>/<stamp>-*/  the evidence: copied receipts and acceptance reports, the
//                                                          proof's own JSON, and the batch ledger as counts, ids and codes
//                                                          (no document text, title, URL or error text; a failed query is named, with the error's name and code).
//
// Clearing: `regulatory-setup.sh inspected` or `db.sh inspected` (or `markInspected`) once looked at, or `reset --discard-evidence` to destroy
// the database knowing the evidence folder is all that is kept. Both rename the marker; neither deletes evidence.
import { basename } from 'jsr:@std/path@1';

export const failuresRoot = (home: string) => `${home}/niyantran-eval-cache/proof-failures`;
export const markerPath = (home: string, db: string) => `${failuresRoot(home)}/${db}.marker`;
/** 20261115T100000, the format of `date -u +%Y%m%dT%H%M%S` in guard.sh, so a renamed marker looks the same from either side. */
export const stamp = (now: Date) => now.toISOString().replaceAll(/[-:]/g, '').slice(0, 15);
export const evidenceDir = (home: string, db: string, now: Date) => `${failuresRoot(home)}/${db}/${stamp(now)}`;

/**
 * What an error is called in a marker or an evidence file: its name and database code, never its text, because database
 * and file errors quote the values that failed (a URL, a key, a title).
 */
export function errorLabel(e: unknown): string {
  if (!(e instanceof Error)) return 'non-error value';
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? `${e.name} ${code}` : e.name;
}

/**
 * Whether an exception that ended a run keeps evidence: any unexpected error does; a refusal to start does only once the
 * run has written something (a break set up, a baseline taken), because only then is there anything to look at.
 */
export function keepAfterThrow(o: { refusal: boolean; wrote: boolean }): boolean {
  return !o.refusal || o.wrote;
}

const DB_NAME = /^niyantran_ingest_load[a-z0-9_]*_test$/;
const checkDb = (db: string) => {
  if (!DB_NAME.test(db)) throw new Error(`database name ${db} is not a niyantran_ingest_load*_test name`);
};

/**
 * Whether an exit code is a failure worth keeping evidence for: a failed check (1) or an unexpected exception (3). Exit 2
 * is a refusal to start (nothing ran), and with --break a 1 is the break being confirmed, which is the intended result.
 */
export function shouldKeepEvidence(code: number, broken: string | null): boolean {
  if (code === 0 || code === 2) return false;
  return broken ? code === 3 : true;
}

/**
 * The batch ledger, as SQL that returns JSON. Columns are counts, ids, states and reason codes only: no title, URL,
 * text, error message or policy body. Batches are all those of the database (a proof database holds its own few).
 */
export function ledgerQueries(): Record<string, string> {
  const json = (sql: string) => `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`;
  return {
    ingest_batches: json(
      `select id, collection, state, stopped_from, stop_reason, items_planned, chunks_planned, runner_commit, created_at, sealed_at, stopped_at from public.ingest_batches order by created_at`,
    ),
    ingest_batch_items: json(
      `select batch_id, source_key, outcome, reason, chunks, document_id, job_id, requeues, decided_at from public.ingest_batch_items order by batch_id, source_key`,
    ),
    ingest_batch_events: json(`select id, batch_id, event, created_at from public.ingest_batch_events order by id`),
    ingest_batch_acceptance: json(
      `select batch_id, check_name, passed, cardinality(sample) as sample_size, recorded_at from public.ingest_batch_acceptance order by batch_id, check_name`,
    ),
    ingest_jobs: json(
      `select id, document_id, batch_id, status, stage, attempts, error_code, pages_total, created_at, started_at, finished_at from public.ingest_jobs where batch_id is not null order by created_at`,
    ),
    job_counts: json(
      `select batch_id, status, stage, count(*) as n from public.ingest_jobs where batch_id is not null group by 1, 2, 3 order by 1, 2, 3`,
    ),
  };
}

async function copyTree(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const e of Deno.readDir(from)) {
    if (e.isDirectory) await copyTree(`${from}/${e.name}`, `${to}/${e.name}`);
    else if (e.isFile) await Deno.copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
  }
}

export interface Marker {
  folder: string;
  proof: string;
  reason: string;
  db: string;
  at: string;
}

/**
 * Writes the evidence of a failed run and the marker, and returns the evidence folder. A ledger that cannot be read is
 * recorded in ledger-error.txt; the rest is still kept. A second failure gets its own folder and the marker names it.
 */
export async function keepEvidence(o: {
  home: string;
  db: string;
  proof: string;
  reason: string;
  now?: Date;
  /** name -> a folder to copy in as that name. */
  copy?: Record<string, string>;
  /** name -> text to write as that file. */
  files?: Record<string, string>;
  /** Runs one ledger query and returns its JSON text. */
  query: (sql: string) => Promise<string>;
}): Promise<string> {
  checkDb(o.db);
  const now = o.now ?? new Date();
  const base = evidenceDir(o.home, o.db, now);
  let folder = base;
  for (let i = 1;; i++) {
    try {
      await Deno.mkdir(base.slice(0, base.lastIndexOf('/')), { recursive: true });
      await Deno.mkdir(folder);
      break;
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      folder = `${base}-${i}`;
    }
  }
  for (const [name, src] of Object.entries(o.copy ?? {})) {
    try {
      await copyTree(src, `${folder}/${basename(name)}`);
    } catch (e) {
      await Deno.writeTextFile(`${folder}/copy-error-${basename(name)}.txt`, `${errorLabel(e)}\n`);
    }
  }
  for (const [name, text] of Object.entries(o.files ?? {})) await Deno.writeTextFile(`${folder}/${basename(name)}`, text);
  const failures: string[] = [];
  for (const [name, sql] of Object.entries(ledgerQueries())) {
    try {
      await Deno.writeTextFile(`${folder}/ledger-${name}.json`, await o.query(sql));
    } catch (e) {
      failures.push(`${name}: ${errorLabel(e)}`);
    }
  }
  if (failures.length) await Deno.writeTextFile(`${folder}/ledger-error.txt`, failures.join('\n') + '\n');
  const marker: Marker = { folder, proof: o.proof, reason: o.reason, db: o.db, at: now.toISOString() };
  await Deno.mkdir(failuresRoot(o.home), { recursive: true });
  await Deno.writeTextFile(markerPath(o.home, o.db), JSON.stringify(marker, null, 2) + '\n');
  return folder;
}

/** The uninspected failure of a database, or null. */
export async function pendingFailure(home: string, db: string): Promise<Marker | null> {
  checkDb(db);
  try {
    return JSON.parse(await Deno.readTextFile(markerPath(home, db))) as Marker;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/**
 * Why a proof may not run on `db`: a failure on it has not been inspected, or null. The message names the command that
 * clears it for this database (regulatory-setup.sh only accepts names containing `reg`).
 */
export async function pendingFailureMessage(home: string, db: string): Promise<string | null> {
  const m = await pendingFailure(home, db);
  if (!m) return null;
  const clear = db.includes('reg')
    ? 'scripts/load-proof/regulatory-setup.sh inspected'
    : `LOAD_PROOF_DB=${db} scripts/load-proof/db.sh inspected`;
  return `a proof failed on ${db} (${m.proof}) and the failure has not been inspected; evidence in ${m.folder}. ` +
    `Look at it, then run ${clear}`;
}

/** The failure has been looked at: the marker is renamed, the evidence stays. */
export async function markInspected(home: string, db: string, now: Date): Promise<void> {
  if (!(await pendingFailure(home, db))) throw new Error(`no uninspected failure for ${db}`);
  await Deno.rename(markerPath(home, db), `${markerPath(home, db)}.inspected-${stamp(now)}`);
}
