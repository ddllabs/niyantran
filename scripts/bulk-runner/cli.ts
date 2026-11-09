// Bulk runner (F285): the command the developer runs from their own terminal
// (docs/specs/2026-11-08-runner-cli-and-acceptance.md, slice A).
//
//   deno run -A scripts/bulk-runner/cli.ts plan   --collection <file.json> --records <file.jsonl>
//   deno run -A scripts/bulk-runner/cli.ts run    --collection <file.json> --records <file.jsonl> --receipts <dir>
//                                                 [--accept-service <name> | --accepted <manifest sha256,...>]
//                                                 [--psql <path>]
//   deno run -A scripts/bulk-runner/cli.ts status --batch <uuid> [--psql <path>]
//
// `plan` touches no database. `run` and `status` connect through psql as corpus_ingest, from libpq's environment
// (PGHOST, PGPORT, PGDATABASE, PGUSER, PGSSLMODE, and PGPASSWORD or a password file); nothing about the connection is
// an argument or printed. A batch chains to the next only when it is accepted:
//   --accept-service <name>  automated acceptance (bulk spec §5.3) on a sample of each batch, read only, through the
//                            libpq service <name> (pg_service.conf, with its password in a password file): the
//                            developer's own login, not corpus_ingest. Its report is written beside the receipts.
//   --accepted <hashes>      batches the developer accepted by hand.
// With neither, a run stops after its first batch with awaiting_acceptance.
import { dirname, fromFileUrl, isAbsolute, relative, resolve } from 'jsr:@std/path@1';
import type { Db } from './db.ts';
import { plan, type PlanLimits, type PlanResult } from './plan.ts';
import { prepareAll, type PrepareOptions } from './prepare.ts';
import { acceptBatch, type AcceptDb, type AcceptOptions, PsqlAcceptDb } from './acceptance.ts';
import { PsqlDb, psqlExec } from './psql_db.ts';
import { run, type RunInput, type RunResult } from './run.ts';

export const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), '../..');

/** What a collection file holds: the collection's policy settings as the runner needs them. */
export interface CollectionFile {
  collection: string;
  prepare: PrepareOptions;
  limits: PlanLimits;
  allowedRefusals?: string[];
  maxAllowedRefusalShare?: number;
  /** Automated acceptance settings (decided 2026-11-09: sample 50; links required for Bills). */
  acceptance?: AcceptOptions;
}

export type Command =
  | { cmd: 'plan'; collection: string; records: string }
  | {
    cmd: 'run';
    collection: string;
    records: string;
    receipts: string;
    accepted: string[];
    acceptService: string | null;
    psql: string;
  }
  | { cmd: 'status'; batch: string; psql: string };

const USAGE = 'usage: cli.ts plan|run|status (see the header of scripts/bulk-runner/cli.ts)';

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (!k?.startsWith('--') || v === undefined || v.startsWith('--')) throw new Error(`bad argument ${k}. ${USAGE}`);
    if (flags.has(k)) throw new Error(`${k} given twice`);
    flags.set(k, v);
  }
  const need = (k: string) => {
    const v = flags.get(k);
    if (!v) throw new Error(`${k} is required. ${USAGE}`);
    return v;
  };
  const allowed = (ks: string[]) => {
    for (const k of flags.keys()) if (!ks.includes(k)) throw new Error(`unknown option ${k} for ${cmd}`);
  };
  const psql = flags.get('--psql') ?? 'psql';
  switch (cmd) {
    case 'plan':
      allowed(['--collection', '--records']);
      return { cmd, collection: need('--collection'), records: need('--records') };
    case 'run': {
      allowed(['--collection', '--records', '--receipts', '--accepted', '--accept-service', '--psql']);
      const acceptService = flags.get('--accept-service') ?? null;
      if (acceptService !== null && flags.has('--accepted')) {
        throw new Error('give --accept-service or --accepted, not both');
      }
      if (acceptService !== null && !/^[A-Za-z0-9_.-]{1,64}$/.test(acceptService)) {
        throw new Error('bad --accept-service name');
      }
      const accepted = (flags.get('--accepted') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const h of accepted) if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`not a manifest sha256: ${h}`);
      return {
        cmd,
        collection: need('--collection'),
        records: need('--records'),
        receipts: need('--receipts'),
        accepted,
        acceptService,
        psql,
      };
    }
    case 'status':
      allowed(['--batch', '--psql']);
      return { cmd, batch: need('--batch'), psql };
    default:
      throw new Error(USAGE);
  }
}

/** Checks a parsed collection file has what prepare, plan and run need, without guessing defaults. */
export function checkCollection(value: unknown): CollectionFile {
  const c = value as CollectionFile;
  const fail = (m: string) => {
    throw new Error(`collection file: ${m}`);
  };
  if (!c || typeof c !== 'object') fail('not an object');
  if (typeof c.collection !== 'string' || !c.collection) fail('collection is required');
  if (!c.prepare || !Number.isInteger(c.prepare.maxChunks) || c.prepare.maxChunks < 1) {
    fail('prepare.maxChunks is required');
  }
  const l = c.limits;
  if (!l) fail('limits is required');
  for (const k of ['usdPerMTokens', 'budgetUsd', 'chunkCeiling', 'diskUsedBytes', 'diskStopBytes'] as const) {
    if (typeof l[k] !== 'number' || !Number.isFinite(l[k]) || l[k] < 0) fail(`limits.${k} is required`);
  }
  if (!Array.isArray(l.partitioned)) fail('limits.partitioned is required');
  if (!l.chunksNow || typeof l.chunksNow !== 'object') fail('limits.chunksNow is required');
  if (c.acceptance !== undefined) {
    const a = c.acceptance;
    if (!Number.isInteger(a.sample) || a.sample < 1 || a.sample > 1000) fail('acceptance.sample must be 1 to 1000');
    if (typeof a.requireLinks !== 'boolean') fail('acceptance.requireLinks is required');
  }
  if (c.allowedRefusals !== undefined && typeof c.maxAllowedRefusalShare !== 'number') {
    fail('maxAllowedRefusalShare is required with allowedRefusals');
  }
  return c;
}

/** Receipts never land inside the repository (they name documents and spend). */
export function checkReceiptsDir(dir: string, repoRoot = REPO_ROOT): string {
  const abs = resolve(dir);
  const rel = relative(repoRoot, abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`receipts must go outside the repository, not ${abs}`);
  }
  return abs;
}

export function parseRecords(text: string): unknown[] {
  const out: unknown[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch {
      throw new Error(`records line ${i + 1} is not JSON`);
    }
  });
  if (out.length === 0) throw new Error('the records file holds no records');
  return out;
}

export interface CliDeps {
  readText: (path: string) => Promise<string>;
  writeText: (path: string, body: string) => Promise<void>;
  /** The commit, and whether the runner's code has uncommitted changes. */
  git: () => Promise<{ commit: string; dirty: boolean }>;
  db: (psql: string) => Db;
  /** The read-only acceptance connection, through a libpq service. */
  acceptDb: (psql: string, service: string) => AcceptDb;
  log: (line: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

async function prepared(c: { collection: string; records: string }, deps: CliDeps) {
  const coll = checkCollection(JSON.parse(await deps.readText(c.collection)));
  const records = parseRecords(await deps.readText(c.records));
  const prep = await prepareAll(records, coll.prepare);
  const p: PlanResult = await plan(prep.requests, coll.limits);
  return { coll, records, prep, p };
}

function describePlan(p: PlanResult, holds: number, records: number): string[] {
  if (!p.ok) return [`plan refused: ${p.stop}: ${p.detail}`];
  const lines = [`records ${records}, held ${holds + p.holds.length}, batches ${p.batches.length}`];
  for (const b of p.batches) {
    lines.push(
      `  batch ${b.manifest_sha256}: ${b.items_planned} documents, ${b.chunks_planned} chunks, ` +
        `about US$${b.est_cost_usd.toFixed(2)}`,
    );
  }
  return lines;
}

/** Until acceptance is automated (slice B): a batch is accepted only when the developer listed its manifest hash. */
export const acceptFrom = (accepted: readonly string[]) => ({ manifest_sha256 }: { manifest_sha256: string }) =>
  Promise.resolve(accepted.includes(manifest_sha256));

/**
 * Automated acceptance (step 10): the batch passes only when every sampled check does. Its report is written beside the
 * receipts before the answer is given; a report that cannot be written is no acceptance.
 */
export const automated =
  (db: AcceptDb, opt: AcceptOptions, dir: string, deps: Pick<CliDeps, 'writeText' | 'log'>) =>
  async ({ batch_id, manifest_sha256 }: { batch_id: string | null; manifest_sha256: string }): Promise<boolean> => {
    if (!batch_id) return false;
    const report = await acceptBatch(db, batch_id, opt);
    await deps.writeText(`${dir}/acceptance-${manifest_sha256.slice(0, 16)}.json`, JSON.stringify(report, null, 2));
    deps.log(
      `  acceptance ${manifest_sha256.slice(0, 16)}: ${
        report.ok ? 'passed' : `failed, ${report.failures.length} of ${report.sampled}`
      }`,
    );
    return report.ok;
  };

/** Runs one command; returns the process exit code. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const c = parseArgs(argv);
  if (c.cmd === 'status') {
    const db = deps.db(c.psql);
    await db.session({ lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 });
    deps.log(JSON.stringify(await db.status(c.batch), null, 2));
    return 0;
  }
  const { coll, records, prep, p } = await prepared(c, deps);
  for (const l of describePlan(p, prep.holds.length, records.length)) deps.log(l);
  if (c.cmd === 'plan') return p.ok ? 0 : 1;

  const dir = checkReceiptsDir(c.receipts);
  if (c.acceptService && !coll.acceptance) {
    throw new Error('--accept-service needs an acceptance block in the collection file');
  }
  const { commit, dirty } = await deps.git();
  if (dirty) throw new Error('the runner has uncommitted changes; a receipt must name the code that ran');
  const input: RunInput = {
    collection: coll.collection,
    plan: p,
    holds: prep.holds,
    controlCodesRemoved: prep.controlCodesRemoved,
    runnerCommit: commit,
    allowedRefusals: coll.allowedRefusals,
    maxAllowedRefusalShare: coll.maxAllowedRefusalShare,
  };
  const runId = `${new Date(deps.now()).toISOString().replaceAll(':', '')}-${crypto.randomUUID().slice(0, 8)}`;
  const result: RunResult = await run(input, {
    db: deps.db(c.psql),
    clock: deps.now,
    sleep: deps.sleep,
    writeReceipt: (name, body) => deps.writeText(`${dir}/${name}`, body),
    runId,
    accept: c.acceptService
      ? automated(deps.acceptDb(c.psql, c.acceptService), coll.acceptance!, dir, deps)
      : acceptFrom(c.accepted),
  });
  deps.log(`run ${runId}: ${result.completed ? 'completed' : `stopped: ${result.stop?.reason}`}`);
  if (result.stop?.detail) deps.log(`  ${result.stop.detail}`);
  for (const r of result.receipts) deps.log(`  receipt ${dir}/${r}`);
  const all = p.ok ? p.batches.length : 0;
  if (result.completed && result.accepted.length < all) {
    deps.log(`  ${all - result.accepted.length} of ${all} batches not accepted`);
    if (c.acceptService) return 1; // automated acceptance said no: that is a failure, not a pause
  }
  return result.completed || result.stop?.reason === 'awaiting_acceptance' ? 0 : 1;
}

/**
 * The environment for the acceptance connection: the caller's, without libpq's connection variables (they name the
 * corpus_ingest login), plus PGSERVICE, so only the named service decides where and as whom it connects.
 */
export function serviceEnv(
  service: string,
  base: Record<string, string> = Deno.env.toObject(),
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (!/^PG[A-Z_]*$/.test(k) || k === 'PGSERVICEFILE' || k === 'PGPASSFILE') env[k] = v;
  }
  env.PGSERVICE = service;
  return env;
}

const RUNNER_PATHS = ['scripts/bulk-runner', 'supabase/functions/_shared'];

async function gitState(): Promise<{ commit: string; dirty: boolean }> {
  const git = async (...args: string[]) => {
    const out = await new Deno.Command('git', { args: ['-C', REPO_ROOT, ...args], stdout: 'piped' }).output();
    if (out.code !== 0) throw new Error(`git ${args[0]} failed`);
    return new TextDecoder().decode(out.stdout).trim();
  };
  return {
    commit: await git('rev-parse', 'HEAD'),
    dirty: (await git('status', '--porcelain', '--', ...RUNNER_PATHS)) !== '',
  };
}

if (import.meta.main) {
  try {
    Deno.exit(
      await main(Deno.args, {
        readText: (p) => Deno.readTextFile(p),
        writeText: (p, b) => Deno.writeTextFile(p, b, { createNew: true }),
        git: gitState,
        db: (psql) => new PsqlDb(psqlExec([psql])),
        acceptDb: (psql, service) => new PsqlAcceptDb(psqlExec([psql], '', serviceEnv(service))),
        log: (l) => console.log(l),
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }),
    );
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
