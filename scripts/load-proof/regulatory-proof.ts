// Regulatory rehearsal (docs/specs/2026-11-12-regulatory-screen.md, "Rehearsal, then NTER" 1, task T6): the first N
// screened Regulatory records through the real runner path on a local disposable database, with only the embedding
// provider faked. The path is the runner's own: `cli.ts split` cuts the screen's output, `cli.ts run` prepares, plans,
// opens, seals, dry-runs and registers through psql as corpus_ingest, the real ingest worker drains the queue through
// PostgREST (driver.ts, the fake embedder), and the automated acceptance reads through a second psql connection. The
// policy is approved by service_role with the values of the spec's table.
//
//   scripts/load-proof/regulatory-setup.sh build            once: the database (see that script)
//   scripts/load-proof/regulatory-setup.sh reset            before every proof: a fresh working database
//   scripts/load-proof/regulatory-proof.sh [--count 100] [--max-chunks 700] [--out DIR] [--break held-key|held-url|no-basis]
//
// It exits 0 only when every check of `evaluate` holds. Admitted = the input minus the records the runner's prepare
// held back; the held set may consist only of over_chunk_limit (designed: prepare.maxChunks is 700, the spec's D6, and
// a few screened records are longer; with --max-chunks 800 nothing may be held). Every record not held is admitted, 0
// refusals, the chunks are in document_chunks_regulatory, no record_document_links row for them, completeness_basis is
// stored on each document as the screen recorded it, and the Bills, question and pre-existing Regulatory rows are
// unchanged (counts and digests, taken before and after). The number held and the range of their chunk counts are
// printed.
//
// Exit codes: 0 every check held; 1 a check failed (or, with --break, the break was confirmed by its reason, below);
// 2 the database or the input was not ready (nothing was run, or a break could not be set up); 3 an unexpected
// exception, or a --break run that failed for a reason other than the intended one.
//
// The proof refuses (exit 2, before anything is written) unless the database it was given is a rehearsal database
// (niyantran_ingest_load_*reg*_test) and the PostgREST container serves that same database.
//
// --break makes one screened record fail on purpose. The proof must then exit 1 with the verdict "BREAK CONFIRMED",
// which it prints only when the intended reason was seen on the target record and an ordinary check failed too. A break
// run that failed for any other reason (a crash, the wrong reason, nothing noticed) exits 3 with "BREAK NOT CONFIRMED".
// Admission-refusal breaks:
//   held-key   a Regulatory document that already holds one record's suggested key is added to the database first;
//              the target must be refused suggested_key_held
//   held-url   a Regulatory document that already holds the file_url of the first record that has one is added first;
//              the target must be refused file_url_held
// Prepare-hold break (it never reaches admission: the shared adapter refuses the record in the runner's prepare step):
//   no-basis   one record loses its completeness_basis, and the part's receipt is rewritten to match; apart from the
//              designed over_chunk_limit holds, the hold set must be exactly that one record, held prepare_failed
//
// Raw output (receipts, acceptance reports, the proof's own JSON) goes under ~/niyantran-eval-cache/reg-next/rehearsal,
// never into the repository. The script prints counts, names and hashes; no record text, title or URL.
import { basename, fromFileUrl, normalize } from 'jsr:@std/path@1';
import { drain, makeHarness } from './driver.ts';
import { CONTAINER, DB, HOME, POSTGREST, psql, psqlJson, sha256Hex, sleep } from './lib.ts';
import { type CliDeps, main } from '../bulk-runner/cli.ts';
import { PsqlAcceptDb } from '../bulk-runner/acceptance.ts';
import { PsqlDb, psqlExec } from '../bulk-runner/psql_db.ts';

export const REGULATORY = { tier: 'national', feature: 'Regulatory Body Watch (RBI SEBI TRAI CCI)' } as const;
export const BASES = ['page_check', 'density_only'] as const;
export const BREAKS = ['held-key', 'held-url', 'no-basis'] as const;
export type Break = typeof BREAKS[number];
const HEX40 = /^[0-9a-f]{40}$/;

// ─── arguments ───────────────────────────────────────────────────────────────

export interface Args {
  count: number;
  /** prepare.maxChunks of the rehearsal's collection file: 700, the spec's D6 (800 is the worker's own limit). */
  maxChunks: number;
  out: string | null;
  screenDir: string;
  collectionFile: string;
  broken: Break | null;
}

export function parseArgs(argv: string[], home: string): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (!k?.startsWith('--') || v === undefined || v.startsWith('--')) throw new Error(`bad argument ${k ?? ''}`);
    if (flags.has(k)) throw new Error(`${k} given twice`);
    flags.set(k, v);
  }
  for (const k of flags.keys()) {
    if (!['--count', '--max-chunks', '--out', '--screen-dir', '--collection-file', '--break'].includes(k)) {
      throw new Error(`unknown option ${k}`);
    }
  }
  const count = flags.get('--count') ?? '100';
  if (!/^[1-9]\d{0,3}$/.test(count)) throw new Error('--count must be a whole number from 1 to 9999');
  const maxChunks = flags.get('--max-chunks') ?? '700';
  if (!/^[1-9]\d{0,3}$/.test(maxChunks) || Number(maxChunks) > 800) {
    throw new Error('--max-chunks must be a whole number from 1 to 800');
  }
  const broken = flags.get('--break') ?? null;
  if (broken !== null && !(BREAKS as readonly string[]).includes(broken)) {
    throw new Error(`--break must be one of ${BREAKS.join(', ')}`);
  }
  const root = `${home}/niyantran-eval-cache/reg-next`;
  return {
    count: Number(count),
    maxChunks: Number(maxChunks),
    out: flags.get('--out') ?? null,
    screenDir: flags.get('--screen-dir') ?? `${root}/full/screen-live-d93325ed`,
    collectionFile: flags.get('--collection-file') ?? `${root}/full/national-regulatory.collection.json`,
    broken: broken as Break | null,
  };
}

// ─── the pass rule ───────────────────────────────────────────────────────────

/** What the database held for one group of rows: counts and a digest of their content. */
export interface Snap {
  docs: number;
  chunks: number;
  links: number;
  digest: string;
}

export interface Held {
  key: string | null;
  reason: string;
  /** over_chunk_limit: how many chunks the text makes, when the runner said. */
  chunks: number | null;
}

export interface Facts {
  /** Records the proof took from the screen, and the basis the screen recorded on each (source_key to basis). */
  expected: number;
  basis: Record<string, string>;
  /** prepare.maxChunks of the run. At 800 (the worker's own limit) nothing may be held. */
  maxChunks: number;
  /** The runner's exit code and the stop it reported, if any. */
  exitCode: number;
  stop: string | null;
  /** An exception the runner raised (as opposed to a stop it reported), if any. */
  runnerError: string | null;
  /** The failure that ended the worker loop, if any. */
  workerError: string | null;
  /** The batch's ledger. */
  ledger: { items: number; admitted: number; existing: number; refused: number; planned: number };
  refusedReasons: Record<string, number>;
  /** Records the runner's prepare or plan held back (never sent). */
  holds: Held[];
  /** What a dry run foresaw and the runner reported as a disagreement, by reason (a stop before anything is sent). */
  precheckReasons: Record<string, number>;
  docs: { present: number; indexed: number; inDesk: number };
  chunks: { stored: number; plannedByLedger: number; inRegulatoryPartition: number };
  links: { forNew: number; before: number; after: number };
  /** source_key to the completeness_basis stored in metadata (null when absent). */
  stored: Record<string, string | null>;
  before: { bills: Snap; pq: Snap; regulatory: Snap; deskRows: string };
  after: { bills: Snap; pq: Snap; regulatory: Snap; deskRows: string };
  acceptance: Array<{ sampled: number; ok: boolean; failures: number }>;
  /** acceptance.sample of the collection file the run used. */
  acceptanceSample: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The reasons of a hold set, counted. */
export function heldByReason(holds: Held[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const h of holds) o[h.reason] = (o[h.reason] ?? 0) + 1;
  return o;
}

/** The smallest and largest chunk count the holds report, and how many reported none. */
export function heldChunkRange(holds: Held[]): { min: number; max: number; unreported: number } | null {
  const known = holds.flatMap((h) => h.chunks === null ? [] : [h.chunks]);
  if (holds.length === 0) return null;
  return {
    min: known.length ? Math.min(...known) : 0,
    max: known.length ? Math.max(...known) : 0,
    unreported: holds.length - known.length,
  };
}

/** The pass rule. Pure: every verdict is a function of the facts. */
export function evaluate(f: Facts): Check[] {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail = '') => out.push({ name, ok, detail });
  const keys = Object.keys(f.basis);
  const heldKeys = new Set(f.holds.flatMap((h) => h.key === null ? [] : [h.key]));
  const admittedKeys = keys.filter((k) => !heldKeys.has(k));
  const admitted = f.expected - f.holds.length;
  add(
    'the input is the expected number of screened records, each with a completeness basis the screen recorded',
    keys.length === f.expected && keys.every((k) => HEX40.test(k) && (BASES as readonly string[]).includes(f.basis[k])),
    `${keys.length} of ${f.expected}`,
  );
  add(
    'the runner finished: exit 0, no stop',
    f.exitCode === 0 && f.stop === null && f.runnerError === null,
    `exit ${f.exitCode}, stop ${f.stop}${f.runnerError ? `, threw ${f.runnerError}` : ''}`,
  );
  add(
    'the worker loop did not fail',
    f.workerError === null,
    f.workerError ?? 'no failure',
  );
  const range = heldChunkRange(f.holds);
  add(
    f.maxChunks >= 800
      ? 'the runner held none of them back in prepare or plan (maxChunks 800)'
      : `the runner held back only records over the ${f.maxChunks}-chunk limit, each a record of the input`,
    f.holds.every((h) =>
      h.reason === 'over_chunk_limit' && h.key !== null && h.key in f.basis &&
      (h.chunks === null || h.chunks > f.maxChunks)
    ) && heldKeys.size === f.holds.length && (f.maxChunks < 800 || f.holds.length === 0),
    `${f.holds.length} held ${JSON.stringify(heldByReason(f.holds))}` +
      (range
        ? `, chunk counts ${range.min} to ${range.max}${range.unreported ? ` (${range.unreported} not reported)` : ''}`
        : ''),
  );
  add(
    'every record not held is admitted, none planned or existing',
    f.ledger.admitted === admitted && f.ledger.items === admitted && f.ledger.planned === 0 &&
      f.ledger.existing === 0 && f.docs.present === admitted,
    `${f.ledger.admitted} admitted of ${admitted} (${f.expected} input, ${f.holds.length} held), ` +
      `${f.ledger.planned} planned, ${f.ledger.existing} existing, ${f.docs.present} documents`,
  );
  const reasons = { ...f.refusedReasons };
  for (const [k, n] of Object.entries(f.precheckReasons)) reasons[`precheck:${k}`] = n;
  add(
    '0 refusals',
    f.ledger.refused === 0 && Object.keys(reasons).length === 0,
    `${f.ledger.refused} refused ${JSON.stringify(reasons)}`,
  );
  add(
    'every admitted document is in the Regulatory desk and indexed',
    f.docs.inDesk === admitted && f.docs.indexed === admitted,
    `${f.docs.inDesk} in the desk, ${f.docs.indexed} indexed`,
  );
  add(
    'the chunks landed in document_chunks_regulatory, as many as the ledger planned',
    f.chunks.stored > 0 && f.chunks.inRegulatoryPartition === f.chunks.stored &&
      f.chunks.stored === f.chunks.plannedByLedger,
    `${f.chunks.stored} stored, ${f.chunks.inRegulatoryPartition} in the partition, ${f.chunks.plannedByLedger} planned`,
  );
  add(
    'no record_document_links row for them, and the table is unchanged',
    f.links.forNew === 0 && f.links.before === f.links.after,
    `${f.links.forNew} for the new documents, table ${f.links.before} to ${f.links.after}`,
  );
  const storedKeys = Object.keys(f.stored);
  const wrong = admittedKeys.filter((k) => f.stored[k] !== f.basis[k]);
  add(
    'completeness_basis is stored on each admitted document as the screen recorded it, and on no held record',
    wrong.length === 0 && storedKeys.length === admittedKeys.length && storedKeys.every((k) => !heldKeys.has(k)),
    `${admittedKeys.length - wrong.length} of ${admitted} match`,
  );
  for (const k of ['bills', 'pq', 'regulatory'] as const) {
    const label = { bills: 'Bills', pq: 'Parliamentary Question', regulatory: 'pre-existing Regulatory' }[k];
    add(
      `the ${label} documents, chunks and links are unchanged (counts and digest), and there were some`,
      f.before[k].docs > 0 && f.before[k].chunks > 0 && same(f.before[k], f.after[k]),
      `${f.before[k].docs} documents, ${f.before[k].chunks} chunks, ${f.before[k].links} links before; ` +
        `${f.after[k].docs}, ${f.after[k].chunks}, ${f.after[k].links} after` +
        (same(f.before[k], f.after[k]) ? '' : '; the digest or a count differs'),
    );
  }
  add('the listing rows are unchanged', f.before.deskRows === f.after.deskRows, f.after.deskRows.slice(0, 12));
  const want = Math.min(f.acceptanceSample, admitted);
  add(
    'automated acceptance passed on a full sample',
    f.acceptance.length >= 1 && f.acceptance.every((a) => a.ok && a.failures === 0 && a.sampled === want),
    JSON.stringify(f.acceptance),
  );
  return out;
}

/** What a break run saw on its target record. */
export interface BreakSeen {
  /** source_key to the reason the record was refused (a ledger refusal, or one the dry run foresaw). */
  refused: Record<string, string>;
  holds: Held[];
}

/** The reason each break must produce on its target record. */
export const BREAK_REASON: Record<Break, string> = {
  'held-key': 'suggested_key_held',
  'held-url': 'file_url_held',
  'no-basis': 'prepare_failed',
};

/**
 * Whether the intended reason was seen on the target record. A break is proved by its reason, not by a failure.
 * no-basis is a prepare-hold break: apart from the designed over_chunk_limit holds, the hold set is exactly one
 * prepare_failed, on the target.
 */
export function breakSeen(broken: Break, target: string, seen: BreakSeen): Check {
  const name = `the break ${broken} was seen as ${BREAK_REASON[broken]} on the target record`;
  if (broken === 'no-basis') {
    const others = seen.holds.filter((h) => h.reason !== 'over_chunk_limit');
    const ok = others.length === 1 && others[0].reason === 'prepare_failed' && others[0].key === target;
    return { name, ok, detail: `holds other than over_chunk_limit: ${JSON.stringify(heldByReason(others))}` };
  }
  const got = seen.refused[target] ?? null;
  return { name, ok: got === BREAK_REASON[broken], detail: `target refused: ${got ?? 'not refused'}` };
}

/** The verdict of a break run: confirmed (exit 1) only when the reason was seen, nothing crashed and an ordinary check failed. */
export function breakVerdict(
  broken: Break,
  o: { seen: Check; checks: Check[]; crashed: string | null },
): { confirmed: boolean; line: string } {
  const noticed = o.checks.some((c) => !c.ok);
  if (o.crashed) return { confirmed: false, line: `VERDICT BREAK NOT CONFIRMED (break ${broken}): ${o.crashed}` };
  if (!o.seen.ok) {
    return {
      confirmed: false,
      line: `VERDICT BREAK NOT CONFIRMED (break ${broken}): the intended reason was not seen`,
    };
  }
  if (!noticed) {
    return { confirmed: false, line: `VERDICT BREAK NOT CONFIRMED (break ${broken}): no ordinary check failed` };
  }
  return {
    confirmed: true,
    line: `VERDICT BREAK CONFIRMED (break ${broken}): ${BREAK_REASON[broken]} seen on the target record`,
  };
}

// ─── the input ───────────────────────────────────────────────────────────────

/** Part lines with `completeness_basis` removed from line `index` (0-based); every other line is kept byte for byte. */
export function stripBasis(partText: string, index: number): string {
  const lines = partText.split('\n');
  const at = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim()).map(([, i]) => i)[index];
  if (at === undefined) throw new Error(`the part has no line ${index}`);
  const r = JSON.parse(lines[at]) as Record<string, unknown>;
  if (!('completeness_basis' in r)) throw new Error('the record has no completeness_basis to remove');
  delete r.completeness_basis;
  lines[at] = JSON.stringify(r);
  return lines.join('\n');
}

/** The receipt `cli.ts split` writes for a part: its own hash and count, and the source it was cut from. */
export async function partReceipt(body: string, source: Record<string, unknown>): Promise<string> {
  const lines = body.split('\n').filter((l) => l.trim()).length;
  return JSON.stringify({ output_sha256: await sha256Hex(body), lines_written: lines, source }, null, 2) + '\n';
}

/** source_key to completeness_basis, from a part's text. */
export function basisOf(partText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of partText.split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as { source_key?: unknown; completeness_basis?: unknown };
    out[String(r.source_key)] = String(r.completeness_basis);
  }
  return out;
}

/** The rehearsal's collection file: the supervisor's copy with values for a rehearsal (spec, "Policy, collection file"). */
export function rehearsalCollection(
  original: Record<string, unknown>,
  o: { decisionId: string; diskUsedBytes: number; maxChunks: number },
): Record<string, unknown> {
  const limits = original.limits as Record<string, unknown>;
  const prepare = original.prepare as Record<string, unknown>;
  const screen = original.screen as Record<string, unknown>;
  const partitioned = new Set([...(limits.partitioned as string[]), REGULATORY.feature]);
  return {
    ...original,
    prepare: { ...prepare, maxChunks: o.maxChunks },
    limits: {
      ...limits,
      budgetUsd: 5,
      chunkCeiling: 200_000,
      diskUsedBytes: o.diskUsedBytes,
      diskStopBytes: 20_000_000_000,
      partitioned: [...partitioned],
      chunksNow: {},
    },
    // The collection file's own sample size; only requireLinks is set (Regulatory has no listing links).
    acceptance: { ...(original.acceptance as Record<string, unknown>), requireLinks: false },
    screen: { ...screen, decisionId: o.decisionId },
  };
}

/** The spec's policy for the collection (admitted desk, licence class, density numbers, thresholds). */
export function policyFor(collection: string, decisionId: string): Record<string, unknown> {
  return {
    collection,
    admitted: [{ desk_tier: REGULATORY.tier, desk_feature: REGULATORY.feature, adapter: 'national_search_only' }],
    licence_classes: ['govt_material_confirm_counsel'],
    min_chars_per_page: 600,
    min_pages_for_density: 5,
    require_page_count: true,
    budget_usd: 5,
    chunk_ceiling: 200_000,
    stop_thresholds: { refusal_share: 0.05, failure_rate: 0.05, uncertain_max: 5, min_decided: 400 },
    decision_id: decisionId,
    approver: 'Regulatory Rehearsal Harness',
    evidence_sha256: 'e'.repeat(64),
  };
}

// ─── the run ─────────────────────────────────────────────────────────────────

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const keyArray = (keys: string[]) => `array(select jsonb_array_elements_text($lp$${JSON.stringify(keys)}$lp$::jsonb))`;
const n = async (sql: string) => Number(await psql(sql));

/** Rows of one desk other than `except`, with a digest of everything a load could change in them. */
async function snap(feature: string, except: string[]): Promise<Snap> {
  const d = `(select * from public.documents where desk_feature = ${q(feature)} and source_key <> all(${
    keyArray(except)
  })) d`;
  const r = await psqlJson<Snap[]>(
    `select
       (select count(*) from ${d})::int as docs,
       (select count(*) from public.document_chunks c join ${d} on d.id = c.document_id)::int as chunks,
       (select count(*) from public.record_document_links l join ${d} on d.id = l.document_id)::int as links,
       md5(
         coalesce((select string_agg(d.id::text || '|' || d.source_key || '|' || d.content_sha256 || '|' ||
                   coalesce(d.indexed_at::text, '') || '|' || d.updated_at::text || '|' || md5(d.metadata::text) || '|' ||
                   coalesce(d.file_url, ''), ',' order by d.id) from ${d}), '') ||
         coalesce((select string_agg(c.id::text || ':' || c.chunk_hash || ':' || coalesce(c.embed_hash, '') || ':' ||
                   (c.embedding is not null)::text, ',' order by c.id)
                     from public.document_chunks c join ${d} on d.id = c.document_id), '') ||
         coalesce((select string_agg(l.row_key || '|' || l.document_id::text || '|' || l.fingerprint, ',' order by l.row_key, l.document_id)
                     from public.record_document_links l join ${d} on d.id = l.document_id), '')
       ) as digest`,
  );
  return r[0];
}

const deskRowsDigest = () =>
  psql(
    `select md5(coalesce(string_agg(tier || '|' || feature || '|' || row_key || '|' || row::text || '|' || coalesce(document_key, ''), ',' order by tier, feature, row_key), '')) from public.desk_rows`,
  );

const DOCKER_PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB];

async function gitState(repo: string): Promise<{ commit: string; dirty: boolean }> {
  const git = async (...args: string[]) => {
    const out = await new Deno.Command('git', { args: ['-C', repo, ...args], stdout: 'piped' }).output();
    if (out.code !== 0) throw new Error(`git ${args[0]} failed`);
    return new TextDecoder().decode(out.stdout).trim();
  };
  return {
    commit: await git('rev-parse', 'HEAD'),
    dirty: (await git('status', '--porcelain', '--', 'scripts/bulk-runner', 'supabase/functions/_shared')) !== '',
  };
}

function cliDeps(repo: string, log: (l: string) => void): CliDeps {
  return {
    readText: (p) => Deno.readTextFile(p),
    readBytes: (p) => Deno.readFile(p),
    fileSize: async (p) => (await Deno.stat(p)).size,
    readChunks: async function* (p) {
      yield* (await Deno.open(p, { read: true })).readable;
    },
    writeText: (p, b) => Deno.writeTextFile(p, b, { createNew: true }),
    git: () => gitState(repo),
    // The load copy has no login for corpus_ingest: a local superuser sets the role, as bulk-proof.ts does.
    db: () => new PsqlDb(psqlExec(DOCKER_PSQL, 'set role corpus_ingest;')),
    // The developer's own read-only login on NTER; here the same superuser, in read-only transactions.
    acceptDb: () => new PsqlAcceptDb(psqlExec(DOCKER_PSQL)),
    listDir: async (dir) => {
      try {
        return (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return [];
        throw e;
      }
    },
    makeDir: (dir) => Deno.mkdir(dir, { recursive: true }),
    log,
    now: () => Date.now(),
    sleep: async (ms) => {
      await sleep(ms);
    },
  };
}

export class NotReady extends Error {}

/** A database this proof may write to: a rehearsal database made by regulatory-setup.sh, never the load copy. */
export const REHEARSAL_DB = /^niyantran_ingest_load_[a-z0-9_]*reg[a-z0-9_]*_test$/;

/** The database name in a PostgREST connection URI (the path, without a query), or null. Nothing else of the URI is kept. */
export function databaseOfUri(uri: string): string | null {
  const m = /^postgres(?:ql)?:\/\/[^/?#]*\/([^/?#]+)(?:[?#].*)?$/.exec(uri);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The folder the wrapper may write to, and so the only place --out may name. */
export const outRoot = (home: string) => `${home}/niyantran-eval-cache/reg-next/rehearsal`;

/** Whether --out lies inside the rehearsal folder, after dots in the path are resolved. */
export function outAllowed(out: string, home: string): boolean {
  const root = outRoot(home);
  const n = normalize(out);
  return n.startsWith('/') && (n === root || n.startsWith(`${root}/`));
}

/** Refuses, before anything is written, a database that is not a rehearsal one or that PostgREST does not serve. */
async function requireRehearsalDatabase(db: string): Promise<void> {
  if (!REHEARSAL_DB.test(db)) {
    throw new NotReady(
      `database ${db} is not a rehearsal database (niyantran_ingest_load_*reg*_test); set LOAD_PROOF_DB or use regulatory-proof.sh`,
    );
  }
  const r = await new Deno.Command('docker', {
    args: ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', POSTGREST],
    env: { PATH: `${HOME}/.docker/bin:${Deno.env.get('PATH') ?? ''}` },
    stdout: 'piped',
    stderr: 'null',
  }).output();
  if (r.code !== 0) {
    throw new NotReady(`PostgREST container ${POSTGREST} is not present; run regulatory-setup.sh reset`);
  }
  const line = new TextDecoder().decode(r.stdout).split('\n').find((l) => l.startsWith('PGRST_DB_URI='));
  const served = line ? databaseOfUri(line.slice('PGRST_DB_URI='.length)) : null;
  if (served !== db) {
    throw new NotReady(
      `PostgREST serves ${served ?? '(an unreadable database)'}, not ${db}; run regulatory-setup.sh reset`,
    );
  }
}

export interface WorkerRun<T> {
  result: T | null;
  /** What the body threw, if it did. */
  bodyError: string | null;
  /** What ended the worker loop, if it failed. */
  workerError: string | null;
}

const message = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/**
 * Runs `body` with a background worker loop beside it. A failure of the loop is caught (never an unhandled rejection):
 * it is recorded and the body is abandoned, since nothing would drain the queue it waits for. Whatever happens, the
 * loop is told to stop, awaited, and `restore` then runs in a finally of its own.
 */
export async function withWorkers<T>(o: {
  setup: () => Promise<void>;
  start: (running: () => boolean) => Promise<void>;
  restore: () => Promise<void>;
  body: () => Promise<T>;
}): Promise<WorkerRun<T>> {
  let running = true;
  let workerError: string | null = null;
  let background: Promise<void> = Promise.resolve();
  let outcome: { result: T | null; bodyError: string | null };
  try {
    await o.setup();
    let down: () => void = () => {};
    const workerDown = new Promise<'down'>((resolve) => (down = () => resolve('down')));
    background = o.start(() => running).then(() => {}, (e) => {
      workerError = message(e);
      running = false;
      down();
    });
    const body = o.body().then((result) => ({ result, bodyError: null as string | null }), (e) => ({
      result: null as T | null,
      bodyError: message(e),
    }));
    // The body is abandoned if the loop dies; its own rejection is already handled above.
    const first = await Promise.race([body, workerDown]);
    outcome = first === 'down' ? { result: null, bodyError: null } : first;
  } finally {
    running = false;
    try {
      await background;
    } finally {
      await o.restore();
    }
  }
  return { ...outcome, workerError };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
}

async function fileSha(path: string): Promise<string> {
  return await sha256Hex(await Deno.readTextFile(path));
}

export async function proof(args: Args, repo: string): Promise<number> {
  const started = Date.now();
  const stamp = new Date(started).toISOString().replaceAll(/[:.]/g, '').slice(0, 17);
  const tag = crypto.randomUUID().slice(0, 8);
  const root = outRoot(HOME);
  const out = args.out ?? `${root}/${stamp}-${tag}${args.broken ? `-break-${args.broken}` : ''}`;
  const say = (l: string) => console.log(l);
  // Before anything is written, here or in the database: the right database, and a folder the wrapper may write to.
  await requireRehearsalDatabase(DB);
  if (!outAllowed(out, HOME)) {
    throw new NotReady(
      '--out must be under ~/niyantran-eval-cache/reg-next/rehearsal, the only folder the wrapper may write',
    );
  }
  await Deno.mkdir(`${out}/receipts`, { recursive: true });
  say(`proof on database ${DB}${args.broken ? `, BREAK ${args.broken}` : ''}; output ${out}`);

  // 1. The screen's output, vouched for by its receipt, and its first N records cut as the runner cuts them.
  const screened = `${args.screenDir}/screened.jsonl`;
  const screenReceipt = await readJson(`${args.screenDir}/screen.receipt.json`);
  const screenOut = (screenReceipt.outputs as { screened: { sha256: string; lines: number } }).screened;
  if (screenReceipt.complete !== true || screenReceipt.screen !== 'national-regulatory') {
    throw new NotReady('the screen receipt is not a complete national-regulatory screen');
  }
  if (screenOut.lines < args.count) {
    throw new NotReady(`the screen passed ${screenOut.lines} records, fewer than ${args.count}`);
  }
  say(
    `screen receipt: commit ${String(screenReceipt.screen_commit).slice(0, 8)}, rules ${
      String(screenReceipt.rules_sha256).slice(0, 12)
    }, ${screenOut.lines} screened records, sha256 ${screenOut.sha256.slice(0, 12)}`,
  );
  const deps = cliDeps(repo, say);
  const parts = `${root}/parts-${args.count}`;
  if (!(await deps.listDir(parts)).includes('part-000.jsonl.receipt.json')) {
    say(`cutting the first ${args.count} screened records into ${parts}`);
    const rc = await main(['split', '--records', screened, '--lines', String(args.count), '--out', parts], deps);
    if (rc !== 0) throw new NotReady(`split exited ${rc}`);
  }
  let part = `${parts}/part-000.jsonl`;
  const partReceiptPath = `${part}.receipt.json`;
  const original = await Deno.readTextFile(part);
  const source = (await readJson(partReceiptPath)).source as Record<string, unknown>;
  if (source.sha256 !== screenOut.sha256) throw new NotReady('the part was not cut from this screen output');
  const basis = basisOf(original);
  const keys = Object.keys(basis);
  if (keys.length !== args.count) throw new NotReady(`the part holds ${keys.length} records, not ${args.count}`);
  say(
    `part-000: ${keys.length} records, sha256 ${(await sha256Hex(original)).slice(0, 12)}, keys digest ${
      (await sha256Hex(keys.join(','))).slice(0, 12)
    }, bases ${JSON.stringify(countBy(Object.values(basis)))}`,
  );

  // 2. A fresh database: nothing of this input, no batch of the collection, and rows of each desk to compare.
  const collection = String((await readJson(args.collectionFile)).collection);
  const present = await n(`select count(*) from public.documents where source_key = any(${keyArray(keys)})`);
  const batches = await n(`select count(*) from public.ingest_batches where collection = ${q(collection)}`);
  if (present > 0 || batches > 0) {
    throw new NotReady(
      `the database is not fresh (${present} of these documents, ${batches} batches); run regulatory-setup.sh reset`,
    );
  }
  const admitsRegulatory = await psql(
    `select public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":${
      JSON.stringify(REGULATORY.feature)
    }}'::jsonb)`,
  );
  if (admitsRegulatory !== 'national_search_only') {
    throw new NotReady('the database lacks 20261113090000_national_search_only');
  }

  // 3. The break, if asked.
  // A failure to set a break up is a failure of the setup, not of the thing proved.
  const setup = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      throw new NotReady(`cannot set up break ${args.broken}: ${message(e)}`);
    }
  };
  let target = keys[Math.min(7, keys.length - 1)];
  if (args.broken === 'held-key') {
    const key = setup(() => parseSuggestedKey(original, target));
    await psql(
      `insert into public.documents(source_key, title, content_sha256, ocr_text, metadata, desk_tier, desk_feature)
       values ('rehearsal-decoy-' || ${q(tag)}, 'Rehearsal decoy', encode(sha256(convert_to(${
        q(`decoy-${tag}`)
      }, 'UTF8')), 'hex'),
               '', jsonb_build_object('document_key_suggested', ${q(key)}::text), ${q(REGULATORY.tier)}, ${
        q(REGULATORY.feature)
      })`,
    );
    say(
      `break held-key: a document now holds the suggested key of record ${keys.indexOf(target)} (${
        target.slice(0, 8)
      })`,
    );
  }
  if (args.broken === 'held-url') {
    const withUrl = setup(() => keys.find((k) => parseField(original, k, 'file_url') !== null));
    if (!withUrl) throw new NotReady('no record of the part has a file_url');
    target = withUrl;
    await psql(
      `insert into public.documents(source_key, title, content_sha256, ocr_text, metadata, file_url, desk_tier, desk_feature)
       values ('rehearsal-decoy-' || ${q(tag)}, 'Rehearsal decoy', encode(sha256(convert_to(${
        q(`decoy-${tag}`)
      }, 'UTF8')), 'hex'),
               '', '{}'::jsonb, ${q(setup(() => parseField(original, target, 'file_url')) as string)}, ${
        q(REGULATORY.tier)
      }, ${q(REGULATORY.feature)})`,
    );
    say(`break held-url: a document now holds the file_url of record ${keys.indexOf(target)} (${target.slice(0, 8)})`);
  }
  if (args.broken === 'no-basis') {
    const body = setup(() => stripBasis(original, Math.min(7, keys.length - 1)));
    part = `${out}/records/part-000.jsonl`;
    await Deno.mkdir(`${out}/records`, { recursive: true });
    await Deno.writeTextFile(part, body, { createNew: true });
    await Deno.writeTextFile(`${part}.receipt.json`, await partReceipt(body, source), { createNew: true });
    say(`break no-basis: record ${Math.min(7, keys.length - 1)} of ${basename(part)} has no completeness_basis`);
  }

  // 4. Baselines, then the collection file, the policy and the worker settings.
  await psql(
    'analyze public.documents; analyze public.document_chunks; analyze public.desk_rows; analyze public.record_document_links',
  );
  const newKeys = keys;
  const before = {
    bills: await snap('Bill Passage Probability Index', newKeys),
    pq: await snap('Parliamentary Question Database', newKeys),
    regulatory: await snap(REGULATORY.feature, newKeys),
    deskRows: await deskRowsDigest(),
  };
  const linksBefore = await n('select count(*) from public.record_document_links');
  say(`before: ${JSON.stringify({ bills: before.bills, pq: before.pq, regulatory: before.regulatory })}`);

  const decisionId = `rehearsal-${tag}`;
  const collectionFile = `${out}/collection.json`;
  const coll = rehearsalCollection(await readJson(args.collectionFile), {
    decisionId,
    diskUsedBytes: await n('select pg_database_size(current_database())'),
    maxChunks: args.maxChunks,
  });
  await Deno.writeTextFile(collectionFile, JSON.stringify(coll, null, 2) + '\n', { createNew: true });
  say(`collection file ${collectionFile}, sha256 ${(await fileSha(collectionFile)).slice(0, 12)}`);

  const h = await makeHarness();
  const priorSettings = await psql("select claim_batch || ',' || max_running from public.ingest_settings");
  let exitCode = 1;
  let stop: string | null = 'not run';
  let runnerError: string | null = null;
  let workerError: string | null = null;
  try {
    const { error } = await h.svc.rpc('ingest_policy_approve', { p: policyFor(collection, decisionId) });
    if (error) throw new NotReady(`policy approval failed: ${error.message.slice(0, 200)}`);
    say(`policy approved for ${collection}`);

    const run = await withWorkers({
      setup: async () => {
        await psql('update public.ingest_settings set claim_batch = 8, max_running = 16');
      },
      // 5. The worker runs beside the runner, as on a deployment.
      start: async (running) => {
        while (running()) {
          await drain(h, {
            concurrency: 4,
            pending: () => n(`select count(*) from public.ingest_jobs where status in ('queued','running')`),
            shouldStop: () => (running() ? null : 'proof finished'),
          });
          await sleep(300);
        }
      },
      // Always runs, whatever the worker loop or the runner did.
      restore: async () => {
        const [cb, mr] = priorSettings.split(',');
        await psql(
          `update public.ingest_settings set claim_batch = ${Number(cb) || 1}, max_running = ${Number(mr) || 2}`,
        );
      },
      // 6. The runner, as the developer runs it, with automated acceptance.
      body: () => {
        say('running the runner');
        return main(
          [
            'run',
            '--collection',
            collectionFile,
            '--records',
            part,
            '--receipts',
            `${out}/receipts`,
            '--accept-service',
            'rehearsal-local',
          ],
          deps,
        );
      },
    });
    workerError = run.workerError;
    if (run.workerError) {
      stop = 'worker loop failed';
    } else if (run.bodyError !== null) {
      runnerError = run.bodyError;
      stop = `runner threw: ${run.bodyError}`;
    } else {
      exitCode = run.result as number;
      stop = null;
    }
  } finally {
    h.close();
  }

  // 7. What the database and the receipts say.
  const receiptNames = (await deps.listDir(`${out}/receipts`)).sort();
  let runReceipt: Record<string, unknown> | null = null;
  for (const name of receiptNames) {
    if (name.startsWith('receipt-')) runReceipt = await readJson(`${out}/receipts/${name}`);
  }
  const runStop = (runReceipt?.stop as { reason?: string } | null | undefined)?.reason ?? null;
  const precheckReasons: Record<string, number> = {};
  const precheckItems = (runReceipt?.disagreements as Array<{ source_key: string | null; got: string }> | undefined) ??
    [];
  for (const d of precheckItems) {
    const why = d.got.replace(/^refused\s+/, '');
    precheckReasons[why] = (precheckReasons[why] ?? 0) + 1;
  }
  const holds: Held[] =
    ((runReceipt?.holds as Array<{ source_key: string | null; reason: string; chunks?: number }>) ?? [])
      .map((x) => ({ key: x.source_key, reason: x.reason, chunks: typeof x.chunks === 'number' ? x.chunks : null }));
  if (runStop && stop === null) stop = runStop;
  const acceptance: Facts['acceptance'] = [];
  for (const name of receiptNames) {
    if (!name.startsWith('acceptance-')) continue;
    const r = await readJson(`${out}/receipts/${name}`) as { sampled: number; ok: boolean; failures: unknown[] };
    acceptance.push({ sampled: r.sampled, ok: r.ok, failures: r.failures.length });
  }
  await psql('analyze public.documents; analyze public.document_chunks; analyze public.record_document_links');

  const batchIdSql = `(select id from public.ingest_batches where collection = ${
    q(collection)
  } order by created_at desc limit 1)`;
  const ledgerRows = await psqlJson<Array<{ outcome: string; reason: string | null; n: number; chunks: number }>>(
    `select outcome, reason, count(*)::int as n, coalesce(sum(chunks), 0)::int as chunks
       from public.ingest_batch_items where batch_id = ${batchIdSql} group by 1, 2`,
  );
  const refusedItems = await psqlJson<Array<{ source_key: string; reason: string | null }>>(
    `select source_key, reason from public.ingest_batch_items where batch_id = ${batchIdSql} and outcome = 'refused'`,
  );
  const outcomeCount = (o: string) => ledgerRows.filter((r) => r.outcome === o).reduce((s, r) => s + r.n, 0);
  const refusedReasons: Record<string, number> = {};
  for (const r of ledgerRows) if (r.outcome === 'refused') refusedReasons[r.reason ?? 'none'] = r.n;
  const docRows = await psqlJson<
    Array<{ source_key: string; basis: string | null; indexed: boolean; in_desk: boolean }>
  >(
    `select source_key, metadata->>'completeness_basis' as basis, indexed_at is not null as indexed,
            (desk_tier = ${q(REGULATORY.tier)} and desk_feature = ${q(REGULATORY.feature)}) as in_desk
       from public.documents where source_key = any(${keyArray(keys)})`,
  );
  const newDocs = `(select id from public.documents where source_key = any(${keyArray(keys)}))`;
  const chunkRows = await psqlJson<Array<{ stored: number; partition: number }>>(
    `select count(*)::int as stored, count(*) filter (where tableoid::regclass::text = 'document_chunks_regulatory')::int as partition
       from public.document_chunks where document_id in ${newDocs}`,
  );
  const facts: Facts = {
    expected: args.count,
    basis,
    maxChunks: args.maxChunks,
    exitCode,
    stop,
    runnerError,
    workerError,
    ledger: {
      items: ledgerRows.reduce((s, r) => s + r.n, 0),
      admitted: outcomeCount('admitted'),
      existing: outcomeCount('existing'),
      refused: outcomeCount('refused'),
      planned: outcomeCount('planned'),
    },
    refusedReasons,
    holds,
    precheckReasons,
    docs: {
      present: docRows.length,
      indexed: docRows.filter((r) => r.indexed).length,
      inDesk: docRows.filter((r) => r.in_desk).length,
    },
    chunks: {
      stored: chunkRows[0].stored,
      plannedByLedger: ledgerRows.filter((r) => r.outcome === 'admitted').reduce((s, r) => s + r.chunks, 0),
      inRegulatoryPartition: chunkRows[0].partition,
    },
    links: {
      forNew: await n(`select count(*) from public.record_document_links where document_id in ${newDocs}`),
      before: linksBefore,
      after: await n('select count(*) from public.record_document_links'),
    },
    stored: Object.fromEntries(docRows.map((r) => [r.source_key, r.basis])),
    before,
    after: {
      bills: await snap('Bill Passage Probability Index', newKeys),
      pq: await snap('Parliamentary Question Database', newKeys),
      regulatory: await snap(REGULATORY.feature, newKeys),
      deskRows: await deskRowsDigest(),
    },
    acceptance,
    acceptanceSample: Number((coll.acceptance as { sample: number }).sample),
  };

  const checks = evaluate(facts);
  say('');
  say(
    `held by prepare: ${holds.length} of ${args.count} ${JSON.stringify(heldByReason(holds))}` +
      (holds.length ? `, chunk counts ${heldChunkRange(holds)!.min} to ${heldChunkRange(holds)!.max}` : '') +
      `; admitted: ${args.count - holds.length}`,
  );
  for (const c of checks) say(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  -- ${c.detail}` : ''}`);
  const failed = checks.filter((c) => !c.ok).length;
  say(
    `\n${checks.length - failed} of ${checks.length} checks passed in ${Math.round((Date.now() - started) / 1000)} s`,
  );
  let verdictLine: string;
  let code: number;
  let verdict: string;
  let breakCheck: Check | null = null;
  if (args.broken) {
    const refused: Record<string, string> = {};
    for (const r of refusedItems) refused[r.source_key] = r.reason ?? 'none';
    for (const d of precheckItems) if (d.source_key) refused[d.source_key] = d.got.replace(/^refused\s+/, '');
    say(`break ${args.broken}: refusal reasons seen ${JSON.stringify({ ...refusedReasons, ...precheckReasons })}`);
    breakCheck = breakSeen(args.broken, target, { refused, holds });
    say(`  ${breakCheck.ok ? 'PASS' : 'FAIL'}  ${breakCheck.name}  -- ${breakCheck.detail}`);
    const crashed = runnerError
      ? `the runner threw: ${runnerError}`
      : workerError
      ? `the worker loop failed: ${workerError}`
      : null;
    const v = breakVerdict(args.broken, { seen: breakCheck, checks, crashed });
    verdictLine = v.line;
    verdict = v.confirmed ? 'BREAK CONFIRMED' : 'BREAK NOT CONFIRMED';
    code = v.confirmed ? 1 : 3;
  } else {
    verdict = failed === 0 ? 'PASS' : 'FAIL';
    verdictLine = `VERDICT ${verdict}`;
    code = failed === 0 ? 0 : 1;
  }
  say(`${verdictLine} (exit ${code})`);
  const { basis: _basis, stored: _stored, ...rest } = facts;
  await Deno.writeTextFile(
    `${out}/proof.json`,
    JSON.stringify(
      {
        verdict,
        exit: code,
        broken: args.broken,
        break_check: breakCheck,
        database: DB,
        keys_digest: await sha256Hex(keys.join(',')),
        checks,
        facts: rest,
      },
      null,
      2,
    ) + '\n',
    { createNew: true },
  );
  return code;
}

/** A string field of one record of a part, or null when the record has none. */
export function parseField(partText: string, sourceKey: string, field: string): string | null {
  for (const l of partText.split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as Record<string, unknown>;
    if (r.source_key === sourceKey) return typeof r[field] === 'string' ? r[field] as string : null;
  }
  throw new Error('no such record in the part');
}

/** The suggested key of one record of a part. */
function parseSuggestedKey(partText: string, sourceKey: string): string {
  const key = parseField(partText, sourceKey, 'document_key_suggested');
  if (key === null) throw new Error('the record has no suggested key');
  return key;
}

function countBy(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}

export const USAGE =
  `usage: regulatory-proof.sh [--count 100] [--max-chunks 700] [--out DIR] [--break held-key|held-url|no-basis]
       regulatory-proof.sh test

Run regulatory-setup.sh reset before every proof.
exit 0  every check held
exit 1  a check failed; with --break: the break was CONFIRMED by its intended reason on the target record
exit 2  not ready (wrong database, no PostgREST for it, bad input or arguments, --out outside the rehearsal folder,
        a break that could not be set up); nothing was run
exit 3  an unexpected exception; with --break: the run failed for a reason other than the intended one (BREAK NOT CONFIRMED)
--break held-key   admission refusal: the target must be refused suggested_key_held
--break held-url   admission refusal: the target must be refused file_url_held
--break no-basis   prepare-hold break (never reaches admission): the only hold besides over_chunk_limit is one prepare_failed`;

if (import.meta.main) {
  if (Deno.args.includes('--help') || Deno.args.includes('-h')) {
    console.log(USAGE);
    Deno.exit(0);
  }
  try {
    const args = parseArgs(Deno.args, HOME);
    const repo = fromFileUrl(new URL('../..', import.meta.url)).replace(/\/$/, '');
    Deno.exit(await proof(args, repo));
  } catch (e) {
    const notReady = e instanceof NotReady ||
      (e instanceof Error && /^(bad argument|unknown option|--)/.test(e.message));
    console.error(`${notReady ? 'not ready' : 'unexpected error'}: ${message(e)}`);
    Deno.exit(notReady ? 2 : 3);
  }
}
