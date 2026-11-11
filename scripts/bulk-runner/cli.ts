// Bulk runner (F285): the command the developer runs from their own terminal
// (docs/specs/2026-11-08-runner-cli-and-acceptance.md, slice A).
//
//   deno run -A scripts/bulk-runner/cli.ts plan   --collection <file.json> --records <file.jsonl>
//   deno run -A scripts/bulk-runner/cli.ts run    --collection <file.json> --records <file.jsonl> --receipts <dir>
//                                                 [--accept-service <name> | --accepted <manifest sha256,...>]
//                                                 [--psql <path>]
//   deno run -A scripts/bulk-runner/cli.ts split  --records <file.jsonl> --lines <n> --out <dir>
//   deno run -A scripts/bulk-runner/cli.ts status --batch <uuid> [--psql <path>]
//
// `split` verifies the records file against its receipt, then writes part-NNN.jsonl files of at most n records, each
// with a receipt (`<part>.receipt.json`) that `plan` and `run` accept; --out must be outside every checkout.
// `plan` touches no database. `run` and `status` connect through psql as corpus_ingest, from libpq's environment
// (PGHOST, PGPORT, PGDATABASE, PGUSER, PGSSLMODE, and PGPASSWORD or a password file); nothing about the connection is
// an argument or printed. A batch chains to the next only when it is accepted:
//   --accept-service <name>  automated acceptance (bulk spec §5.3) on a sample of each batch, read only, through the
//                            libpq service <name> (pg_service.conf, with its password in a password file): the
//                            developer's own login, not corpus_ingest. Its report is written beside the receipts.
//   --accepted <hashes>      batches the developer accepted by hand.
// With neither, a run stops after its first batch with awaiting_acceptance.
import { createHash } from 'node:crypto';
import { basename, dirname, fromFileUrl, join, resolve } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import type { Db } from './db.ts';
import { plan, type PlanLimits, type PlanResult } from './plan.ts';
import { prepareAll, type PrepareOptions } from './prepare.ts';
import { acceptBatch, type AcceptDb, type AcceptOptions, PsqlAcceptDb } from './acceptance.ts';
import { PsqlDb, psqlExec } from './psql_db.ts';
import { gitCommonDir, refuseInCheckout } from './pack.ts';
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
  | { cmd: 'split'; records: string; lines: number; out: string }
  | { cmd: 'status'; batch: string; psql: string };

const USAGE = 'usage: cli.ts plan|run|split|status (see the header of scripts/bulk-runner/cli.ts)';

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
    case 'split': {
      allowed(['--records', '--lines', '--out']);
      const n = need('--lines');
      if (!/^[1-9]\d{0,8}$/.test(n)) throw new Error('--lines must be a positive integer');
      return { cmd, records: need('--records'), lines: Number(n), out: need('--out') };
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

/**
 * Receipts never land inside any checkout of the repository (they name documents and spend): this checkout, the main
 * one when run from a worktree, or any directory with a `.git` entry. The same guard as the pack reader's.
 */
export function checkReceiptsDir(
  dir: string,
  deps: { repoRoot: string; commonDir?: () => Promise<string | null> } = {
    repoRoot: REPO_ROOT,
    commonDir: gitCommonDir,
  },
): Promise<string> {
  return refuseInCheckout(dir, 'receipts', deps);
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

/**
 * The largest records file `plan` and `run` read: they hold the bytes, the decoded string and every parsed record at
 * once, roughly three times the file. 256 MiB is far below V8's string limit (about 512 MiB of characters) and keeps
 * that near 1 GiB; a bigger file is cut with `split` and its parts planned and run one by one (F308).
 */
export const MAX_RECORDS_BYTES = 256 * 1024 * 1024;

export interface CliDeps {
  readText: (path: string) => Promise<string>;
  /** A file's raw bytes: the records file is hashed as it is on disk, then decoded strictly (F321). */
  readBytes: (path: string) => Promise<Uint8Array>;
  /** A file's size in bytes (the check before `plan` and `run` read a records file whole). */
  fileSize: (path: string) => Promise<number>;
  /** A file's raw bytes in chunks of any size, in order: `split` reads the records file this way, never whole (F308). */
  readChunks: (path: string) => AsyncIterable<Uint8Array>;
  /** The largest part `split` writes, in bytes; MAX_RECORDS_BYTES unless a test sets a smaller one. */
  maxPartBytes?: number;
  /** The names in a directory; empty when it does not exist. */
  listDir: (dir: string) => Promise<string[]>;
  makeDir: (dir: string) => Promise<void>;
  /** The repository's git common directory (default: asked of git). */
  commonDir?: () => Promise<string | null>;
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

/** A records file that its receipt does not vouch for. `code` is one of the ReceiptCode values; it leads the message. */
export type ReceiptCode = 'receipt_missing' | 'receipt_unreadable' | 'receipt_mismatch';
export class ReceiptError extends Error {
  constructor(readonly code: ReceiptCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ReceiptError';
  }
}

/** The screen's output name (screen.ts OUT): a file with this name is the screen's, and only its receipt vouches for it. */
const SCREENED = 'screened.jsonl';
const SCREEN_RECEIPT = 'screen.receipt.json';
const HEX64 = /^[0-9a-f]{64}$/;

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The only name `split` gives a part: a `source` makes a receipt a part's only beside a file with this name. */
const PART_NAME = /^part-\d+\.jsonl$/;

/**
 * A split part's `source` (written by `split` below): the verified file it was cut from and the lines it covers,
 * which cannot be fewer than the records the part holds.
 */
function wellFormedSource(v: unknown, lines: number): boolean {
  return isRec(v) && isText(v.records) && HEX64.test(String(v.sha256)) && isCount(v.from_line) &&
    isCount(v.to_line) && v.from_line <= v.to_line && lines <= v.to_line - v.from_line + 1;
}

/**
 * Reads the receipt that belongs to a records file and returns the sha256 and record count it attests for that file
 * (F309, F321). A file named screened.jsonl is the screen's output, vouched for by `screen.receipt.json` beside it
 * (`outputs.screened.sha256` and `.lines`); any other file is vouched for by `<records>.receipt.json`
 * (`output_sha256` and `lines_written`), which is either a split part's (the file is named part-NNN.jsonl and it has a well-formed `source`) or the pack
 * reader's (it names `pack`, `entry` and `manifest_sha256`, as screen.ts readInput requires). The kinds never stand
 * in for each other: the rule is by name, so it is the stricter one. Receipts are not signed: these checks catch
 * a wrong or careless receipt, not a forged one.
 */
async function receiptFor(
  records: string,
  readText: CliDeps['readText'],
): Promise<{ path: string; sha256: string; lines: number }> {
  const screened = basename(records) === SCREENED;
  const path = screened ? join(dirname(records), SCREEN_RECEIPT) : `${records}.receipt.json`;
  let text: string;
  try {
    text = await readText(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new ReceiptError(
        'receipt_missing',
        `${path} is missing; the runner loads only ${
          screened ? "the screen's output with its receipt" : "the pack reader's output with its receipt"
        }`,
      );
    }
    throw new ReceiptError(
      'receipt_unreadable',
      `${path} could not be read (${e instanceof Error ? e.name : typeof e})`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReceiptError('receipt_unreadable', `${path} is not valid JSON`);
  }
  const unreadable = (what: string) => new ReceiptError('receipt_unreadable', `${path} has no ${what}`);
  if (!isRec(value)) throw unreadable('fields');
  if (screened) {
    const s = isRec(value.outputs) && isRec(value.outputs.screened) ? value.outputs.screened : {};
    if (typeof s.sha256 !== 'string' || !HEX64.test(s.sha256)) throw unreadable('outputs.screened.sha256');
    // 0 is what the screen writes when it passed nothing; the empty file is then refused as holding no records.
    if (s.lines !== 0 && !isCount(s.lines)) throw unreadable('outputs.screened.lines (a whole number)');
    return { path, sha256: s.sha256, lines: s.lines };
  }
  if (typeof value.output_sha256 !== 'string' || !HEX64.test(value.output_sha256)) throw unreadable('output_sha256');
  if (!isCount(value.lines_written)) throw unreadable('lines_written (a positive integer)');
  if (
    !(PART_NAME.test(basename(records)) && wellFormedSource(value.source, value.lines_written)) &&
    !(isText(value.pack) && isText(value.entry) && HEX64.test(String(value.manifest_sha256)))
  ) {
    throw unreadable('pack, entry and manifest_sha256 (a reader receipt), or the source of a part-NNN.jsonl file');
  }
  return { path, sha256: value.output_sha256, lines: value.lines_written };
}

const sha256Bytes = async (b: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice()))].map((x) => x.toString(16).padStart(2, '0'))
    .join('');

/**
 * The records file, read once as bytes, hashed as it is on disk and checked against its receipt: the hash, then the
 * count of records the runner parses. The bytes must be UTF-8 with no byte-order mark. Returns the text and its records.
 */
export async function readRecordsText(
  records: string,
  deps: Pick<CliDeps, 'readText' | 'readBytes'>,
): Promise<{ text: string; records: unknown[] }> {
  const bytes = await deps.readBytes(records);
  const receipt = await receiptFor(records, deps.readText);
  if ((await sha256Bytes(bytes)) !== receipt.sha256) {
    throw new ReceiptError(
      'receipt_mismatch',
      `${records} is not the file ${receipt.path} describes (its sha256 differs from the receipt's)`,
    );
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${records} starts with a byte-order mark; the records file must be plain UTF-8`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${records} is not valid UTF-8`);
  }
  const parsed = parseRecords(text);
  if (parsed.length !== receipt.lines) {
    throw new ReceiptError(
      'receipt_mismatch',
      `${records} holds ${parsed.length} records, the receipt in ${receipt.path} says ${receipt.lines}`,
    );
  }
  return { text, records: parsed };
}

/** What one pass over a records file found. `fault` is the first thing wrong with the bytes, in the order readRecordsText checks. */
interface Scan {
  sha256: string;
  records: number;
  fault: Error | null;
}

/**
 * One pass over a records file in chunks, holding no more than a chunk and one line (F308). It hashes the raw bytes,
 * decodes them as UTF-8 with a fatal decoder (a chunk may end inside a character) and finds the lines `parseRecords`
 * finds: split on "\n", blank lines dropped, the rest handed to `onRecord` with their 1-based line numbers. With
 * `validate` each record line must be JSON. A problem stops the decoding but not the hashing, so the hash is still
 * known and the faults can be reported in readRecordsText's order: byte-order mark, UTF-8, JSON. The byte-order mark
 * is looked for in the first three bytes themselves, before any decoding. Only a decoding error is a UTF-8 fault: an
 * error from `onRecord` is the caller's and is thrown as it is.
 */
async function scanRecords(
  records: string,
  readChunks: CliDeps['readChunks'],
  validate: boolean,
  onRecord?: (line: string, no: number) => Promise<void>,
): Promise<Scan> {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let fault: Error | null = null;
  let jsonFault: Error | null = null;
  let broken = false;
  const head: number[] = [];
  // The text since the last newline, in pieces: joined only when its line ends, so a long line is not copied per chunk.
  const pending: string[] = [];
  let lineNo = 0;
  let count = 0;
  const line = async (text: string) => {
    lineNo++;
    if (!text.trim()) return;
    count++;
    if (validate && !jsonFault) {
      try {
        JSON.parse(text);
      } catch {
        jsonFault = new Error(`records line ${lineNo} is not JSON`);
      }
    }
    await onRecord?.(text, lineNo);
  };
  const feed = async (decoded: string) => {
    const pieces = decoded.split('\n');
    for (let i = 0; i < pieces.length - 1; i++) {
      pending.push(pieces[i]);
      const text = pending.join('');
      pending.length = 0;
      await line(text);
    }
    pending.push(pieces[pieces.length - 1]);
  };
  const decode = (chunk?: Uint8Array): string | null => {
    try {
      return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    } catch {
      fault = new Error(`${records} is not valid UTF-8`);
      broken = true;
      return null;
    }
  };
  for await (const chunk of readChunks(records)) {
    hash.update(chunk);
    if (broken) continue;
    if (head.length < 3) {
      for (let i = 0; i < chunk.length && head.length < 3; i++) head.push(chunk[i]);
      if (head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
        fault = new Error(`${records} starts with a byte-order mark; the records file must be plain UTF-8`);
        broken = true;
        continue;
      }
    }
    const decoded = decode(chunk);
    if (decoded !== null) await feed(decoded);
  }
  if (!broken) {
    const decoded = decode();
    if (decoded !== null) await feed(decoded);
  }
  if (!broken) await line(pending.join(''));
  if (!fault && validate) {
    fault = jsonFault ?? (count === 0 ? new Error('the records file holds no records') : null);
  }
  return { sha256: hash.digest('hex'), records: count, fault };
}

/** The receipt's verdict on a scan, with the errors and their order that readRecordsText gives. */
function checkScan(records: string, receipt: { path: string; sha256: string; lines: number }, scan: Scan): void {
  if (scan.sha256 !== receipt.sha256) {
    throw new ReceiptError(
      'receipt_mismatch',
      `${records} is not the file ${receipt.path} describes (its sha256 differs from the receipt's)`,
    );
  }
  if (scan.fault) throw scan.fault;
  if (scan.records !== receipt.lines) {
    throw new ReceiptError(
      'receipt_mismatch',
      `${records} holds ${scan.records} records, the receipt in ${receipt.path} says ${receipt.lines}`,
    );
  }
}

async function prepared(c: { collection: string; records: string }, deps: CliDeps) {
  const coll = checkCollection(JSON.parse(await deps.readText(c.collection)));
  const size = await deps.fileSize(c.records);
  if (size > MAX_RECORDS_BYTES) {
    throw new Error(
      `${c.records} is ${size} bytes, over the ${MAX_RECORDS_BYTES}-byte limit plan and run read whole; ` +
        'cut it into parts with split and plan or run each part',
    );
  }
  const { records } = await readRecordsText(c.records, deps);
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

/**
 * Splits a verified records file into part-NNN.jsonl files of at most `lines` records (blank lines dropped, each record
 * line kept byte for byte), each with a receipt the runner accepts. No timestamps: the same input and size give the
 * same bytes. from_line and to_line are the input's own line numbers (1-based).
 */
async function split(c: Extract<Command, { cmd: 'split' }>, deps: CliDeps): Promise<number> {
  // Two passes over the file, each in chunks: the first checks it against its receipt and counts the records, so no
  // part or receipt exists unless the file is vouched for; the second cuts the parts. A second read costs time, not
  // memory, and buffering the parts instead would hold the file in memory, which is what this avoids (F308).
  await deps.fileSize(c.records); // a records file that is missing is reported before its receipt
  const receipt = await receiptFor(c.records, deps.readText);
  // A part is held in memory while it is cut, and plan and run read it whole: none may pass their limit.
  const maxPart = deps.maxPartBytes ?? MAX_RECORDS_BYTES;
  const encoder = new TextEncoder();
  let partNo = 0;
  let inPart = 0;
  let partBytes = 0;
  let tooBig: Error | null = null;
  const checked = await scanRecords(c.records, deps.readChunks, true, (line) => {
    if (inPart === c.lines) {
      partNo++;
      inPart = 0;
      partBytes = 0;
    }
    inPart++;
    partBytes += encoder.encode(line).length + 1;
    if (partBytes > maxPart) {
      tooBig ??= new Error(
        `part-${String(partNo).padStart(3, '0')}.jsonl would be over ${maxPart} bytes, the most plan and run read; ` +
          'use a smaller --lines',
      );
    }
    return Promise.resolve();
  });
  checkScan(c.records, receipt, checked);
  if (tooBig) throw tooBig;
  const out = await refuseInCheckout(c.out, '--out', {
    repoRoot: REPO_ROOT,
    commonDir: deps.commonDir ?? gitCommonDir,
  });
  const held = (await deps.listDir(out)).filter((n) => /^part-\d+\.jsonl(\.receipt\.json)?$/.test(n));
  if (held.length > 0) throw new Error(`${out} already holds part files (${held[0]}); choose a new --out`);
  const parts = Math.ceil(checked.records / c.lines);
  if (parts > 999) throw new Error(`${parts} parts; use a larger --lines (at most 999 parts)`);
  await deps.makeDir(out);
  let slice: { line: string; no: number }[] = [];
  let k = 0;
  const receipts: { path: string; body: string }[] = [];
  const flush = async () => {
    const body = slice.map((r) => r.line + '\n').join('');
    const path = `${out}/part-${String(k++).padStart(3, '0')}.jsonl`;
    const part = {
      output_sha256: await sha256Hex(body),
      lines_written: slice.length,
      source: {
        records: c.records,
        sha256: checked.sha256,
        from_line: slice[0].no,
        to_line: slice[slice.length - 1].no,
      },
    };
    slice = [];
    // The part now, its receipt only after the whole file has been read again and is still the one checked: a stop,
    // or a file that changed, leaves parts with no receipt, which plan and run refuse.
    receipts.push({ path: `${path}.receipt.json`, body: JSON.stringify(part, null, 2) + '\n' });
    await deps.writeText(path, body);
  };
  const cut = await scanRecords(c.records, deps.readChunks, false, async (line, no) => {
    slice.push({ line, no });
    if (slice.length === c.lines) await flush();
  });
  if (slice.length > 0) await flush();
  // The file was the one checked, or the parts just written are not from it.
  if (cut.sha256 !== checked.sha256) {
    throw new ReceiptError(
      'receipt_mismatch',
      `${c.records} changed while it was being split; the parts under ${out} have no receipt and cannot be ` +
        'loaded; split again into a new --out',
    );
  }
  if (cut.fault) throw cut.fault;
  for (const r of receipts) await deps.writeText(r.path, r.body);
  deps.log(`${checked.records} records in ${parts} parts under ${out}`);
  return 0;
}

/** Runs one command; returns the process exit code. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const c = parseArgs(argv);
  if (c.cmd === 'split') return split(c, deps);
  if (c.cmd === 'status') {
    const db = deps.db(c.psql);
    await db.session({ lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 });
    deps.log(JSON.stringify(await db.status(c.batch), null, 2));
    return 0;
  }
  const { coll, records, prep, p } = await prepared(c, deps);
  for (const l of describePlan(p, prep.holds.length, records.length)) deps.log(l);
  if (c.cmd === 'plan') return p.ok ? 0 : 1;

  const dir = await checkReceiptsDir(c.receipts, { repoRoot: REPO_ROOT, commonDir: deps.commonDir ?? gitCommonDir });
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

async function* readFileChunks(path: string): AsyncGenerator<Uint8Array> {
  // The stream closes the file when it ends or when the reader stops early.
  yield* (await Deno.open(path, { read: true })).readable;
}

if (import.meta.main) {
  try {
    Deno.exit(
      await main(Deno.args, {
        readText: (p) => Deno.readTextFile(p),
        readBytes: (p) => Deno.readFile(p),
        fileSize: async (p) => (await Deno.stat(p)).size,
        readChunks: readFileChunks,
        writeText: (p, b) => Deno.writeTextFile(p, b, { createNew: true }),
        git: gitState,
        db: (psql) => new PsqlDb(psqlExec([psql])),
        acceptDb: (psql, service) => new PsqlAcceptDb(psqlExec([psql], '', serviceEnv(service))),
        listDir: async (dir) => {
          try {
            return (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name);
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) return [];
            throw e;
          }
        },
        makeDir: (dir) => Deno.mkdir(dir, { recursive: true }),
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
