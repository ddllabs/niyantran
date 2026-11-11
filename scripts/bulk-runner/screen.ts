// Screening stage (F307, S1): turns a pack reader's records file into screened records (a top-level text_sha256 and a
// review built only from checks that ran and passed) and a list of holds, with a receipt that proves what was screened
// (docs/specs/2026-11-10-screening-stage.md). The checks come from a collection screen (scripts/bulk-runner/screens/).
//
//   deno run -A --config supabase/functions/deno.json scripts/bulk-runner/screen.ts --screen <name>
//     --collection <collection.json> --records <reader output .jsonl> --out <dir outside the repository>
//     [--patches <reader output .jsonl>] [--no-live] [--no-pages]
//
// Holds, logs and the receipt hold names, counts and hashes, never record text.
import { createHash } from 'node:crypto';
import { canonical } from '../../supabase/functions/_shared/suppliedText.ts';
import { isAbsolute, join, normalize, resolve } from 'jsr:@std/path@1';
import { checkCollection, type CollectionFile } from './cli.ts';
import { exists, gitCommonDir, gitState, refuseInCheckout, REPO_ROOT, writeAll } from './pack.ts';
import { psqlLiveReader } from './live.ts';
import type { Rec } from './prepare.ts';
import { SCREENS } from './screens/index.ts';
import {
  type Finding,
  type LiveReader,
  REVIEW_CHECKS,
  type ReviewCheck,
  type Screen,
  type ScreenContext,
} from './screen_types.ts';

const USAGE = 'usage: screen.ts --screen <name> --collection <file> --records <file> --out <dir> [--patches <file>] ' +
  '[--no-live] [--no-pages] [--psql <path>] (see the header of scripts/bulk-runner/screen.ts)';
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_FIELD = 1_000;
const OUT = {
  receipt: 'screen.receipt.json',
  screened: 'screened.jsonl',
  holds: 'holds.jsonl',
};

// ---- arguments and the collection's screen block ----

export interface Command {
  screen: string;
  collection: string;
  records: string;
  out: string;
  patches: string | null;
  noLive: boolean;
  noPages: boolean;
  psql: string;
}

export function parseArgs(argv: string[]): Command {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-live' || k === '--no-pages') {
      if (switches.has(k)) throw new Error(`${k} given twice`);
      switches.add(k);
      continue;
    }
    const v = argv[i + 1];
    if (!['--screen', '--collection', '--records', '--out', '--patches', '--psql'].includes(k ?? '')) {
      throw new Error(`unknown or malformed option ${JSON.stringify(String(k).slice(0, 40))}. ${USAGE}`);
    }
    if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value. ${USAGE}`);
    if (values.has(k)) throw new Error(`${k} given twice`);
    values.set(k, v);
    i++;
  }
  const need = (k: string) => {
    const v = values.get(k);
    if (!v) throw new Error(`${k} is required. ${USAGE}`);
    return v;
  };
  return {
    screen: need('--screen'),
    collection: need('--collection'),
    records: need('--records'),
    out: need('--out'),
    patches: values.get('--patches') ?? null,
    noLive: switches.has('--no-live'),
    noPages: switches.has('--no-pages'),
    psql: values.get('--psql') ?? 'psql',
  };
}

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const text1000 = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_FIELD;

export interface ScreenBlock {
  decisionId: string;
  settings: Rec;
}

/** The collection file's `screen` block: `{ decisionId, settings }`, nothing else. */
export function checkScreenBlock(value: unknown): ScreenBlock {
  const fail = (m: string) => {
    throw new Error(`collection file: screen.${m}`);
  };
  if (!isRec(value)) throw new Error('collection file: screen block is required (an object)');
  for (const k of Object.keys(value)) if (k !== 'decisionId' && k !== 'settings') fail(`${k} is not a known field`);
  if (!text1000(value.decisionId)) fail('decisionId is required (a non-empty string of at most 1,000 characters)');
  if (!isRec(value.settings)) fail('settings is required (an object)');
  return { decisionId: value.decisionId as string, settings: value.settings as Rec };
}

// ---- the screen definition ----

export function validateScreen(screen: Screen): void {
  const fail = (m: string) => {
    throw new Error(`invalid screen: ${m}`);
  };
  if (!screen || typeof screen !== 'object') fail('not an object');
  if (!text1000(screen.collection)) fail('collection is required');
  if (!text1000(screen.mappingVersion)) fail('mappingVersion is required (at most 1,000 characters)');
  if (!Array.isArray(screen.rulesFiles) || screen.rulesFiles.length === 0) fail('rulesFiles is required');
  if (!Array.isArray(screen.checks) || screen.checks.length === 0) fail('checks is required');
  const names = new Set<string>();
  const covered = new Set<string>();
  for (const c of screen.checks) {
    if (!c || typeof c.name !== 'string' || !c.name || c.name === 'screen') {
      fail('a check needs a name other than "screen"');
    }
    if (names.has(c.name)) fail(`check name ${c.name} is used twice`);
    names.add(c.name);
    if (!Array.isArray(c.covers) || c.covers.length === 0 || c.covers.some((x) => !REVIEW_CHECKS.includes(x))) {
      fail(`check ${c.name} must cover one or more of ${REVIEW_CHECKS.join(', ')}`);
    }
    for (const x of c.covers) covered.add(x);
    if ((typeof c.one === 'function') === (typeof c.all === 'function')) {
      fail(`check ${c.name} must implement exactly one of one and all`);
    }
    if (c.needs !== undefined && c.needs !== 'live' && c.needs !== 'pages') fail(`check ${c.name} has a bad needs`);
    if (c.onlyIfClean !== undefined && typeof c.onlyIfClean !== 'boolean') {
      fail(`check ${c.name} has a bad onlyIfClean`);
    }
  }
  if (screen.project !== undefined && typeof screen.project !== 'function') fail('project must be a function');
  const missing = REVIEW_CHECKS.filter((c) => !covered.has(c));
  if (missing.length) fail(`no check covers ${missing.join(', ')}`);
}

/**
 * The rules hash: sha256 of the canonical JSON (keys sorted) of an array holding, for each rule file in order, its
 * path, length and sha256, then `{ settings }`, the collection's screen settings. So a changed rule file, a changed
 * order or changed settings change it, and file boundaries cannot blur. A missing file is an error.
 */
export async function rulesSha256(
  files: string[],
  root: string,
  read: (path: string) => Promise<Uint8Array> = (p) => Deno.readFile(p),
  settings: Rec = {},
): Promise<string> {
  const entries: unknown[] = [];
  for (const f of files) {
    const rel = normalize(f);
    if (!f || isAbsolute(f) || rel === '..' || rel.startsWith('../')) {
      throw new Error(`rules file ${f} is not a path inside the repository`);
    }
    let bytes: Uint8Array;
    try {
      bytes = await read(resolve(root, rel));
    } catch {
      throw new Error(`rules file ${f} cannot be read`);
    }
    entries.push({ path: f, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  entries.push({ settings });
  return sha256(canonical(entries));
}

// ---- running the checks ----

/** What every record of a run shares. `log` is for progress and errors: it goes to stderr, never to holds or receipts. */
export interface SharedOptions {
  decisionId: string;
  rulesSha256: string;
  noLive: boolean;
  noPages: boolean;
  log?: (line: string) => void;
}

export interface RunOptions extends SharedOptions {
  /** review.package_id and review.file_sha256 for every record screened. */
  packageId: string;
  fileSha256: string;
}

/** One reader output: its records and the identity its reviews carry. */
export interface SetInput {
  records: Rec[];
  packageId: string;
  fileSha256: string;
}

export type SetName = 'records' | 'patches';

export interface ScreenHold {
  source_key: string | null;
  reasons: string[];
  findings: Finding[];
}

export interface ScreenResult {
  screened: Rec[];
  holds: ScreenHold[];
}

/** Where outcomes go as they are produced, in input order (records, then patches). */
export interface Emit {
  screened(set: SetName, record: Rec): void | Promise<void>;
  hold(set: SetName, hold: ScreenHold): void | Promise<void>;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Only the error's class: a message could quote the record. */
const errorName = (e: unknown) => (e instanceof Error ? e.name : typeof e);
const own = (check: string, covers: ReviewCheck[], reason: string, detail?: string): Finding => ({
  check,
  covers,
  reason,
  ...(detail ? { detail } : {}),
});

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isRec(a) && isRec(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
};

/**
 * The screen's projection of a passing record: fields added, none changed or removed (checked against a copy taken
 * before the call, so a projection that edits its argument is caught), and none of the two fields the screen sets.
 */
function applyProject(screen: Screen, rec: Rec): { record: Rec } | { error: string } {
  const before = structuredClone(rec);
  let out: unknown;
  try {
    out = screen.project!(rec);
  } catch (e) {
    return { error: errorName(e) };
  }
  if (!isRec(out)) return { error: 'project did not return an object' };
  for (const k of Object.keys(before)) {
    if (!Object.hasOwn(out, k)) return { error: `project removed ${k}` };
    if (!deepEqual(before[k], out[k])) return { error: `project changed ${k}` };
  }
  if (Object.hasOwn(out, 'review') || Object.hasOwn(out, 'text_sha256')) {
    // `before` never has these (a record that carried them was held), so they would be added by the projection.
    return { error: 'project set review or text_sha256' };
  }
  return { record: out };
}

const PROGRESS_EVERY = 250;
const MAX_LOGGED_MESSAGE = 500;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, MAX_LOGGED_MESSAGE);

interface Item {
  set: SetName;
  rec: Rec;
  packageId: string;
  fileSha256: string;
}

/**
 * Runs every check on every record of one or two sets (the pack's records and, when given, the patches), emitting each
 * outcome in order. A record passes only when nothing was found and every check that covers each of the five review
 * checks ran for it; only then is a review built, from those results. A check that throws, or returns something that
 * is not a list of findings, is a finding (`check_error`), never a pass.
 *
 * A main record whose source_key is also a patch's is held `superseded_by_patch_input` whatever the patch's outcome, and
 * is left out of the whole-set checks (its patch stands for the key). Whole-set checks run once over both sets.
 */
export async function screenSets(
  screen: Screen,
  sets: { records: SetInput; patches?: SetInput | null },
  ctx: ScreenContext,
  opts: SharedOptions,
  emit: Emit,
): Promise<void> {
  validateScreen(screen);
  const log = opts.log ?? (() => {});
  if (!text1000(opts.decisionId)) throw new Error('packageId and decisionId are required');
  if (!HEX64.test(opts.rulesSha256)) throw new Error('fileSha256 and rulesSha256 must be sha256 hex');
  const items: Item[] = [];
  for (const set of ['records', 'patches'] as const) {
    const input = set === 'records' ? sets.records : sets.patches;
    if (!input) continue;
    if (!text1000(input.packageId)) throw new Error('packageId and decisionId are required');
    if (!HEX64.test(input.fileSha256)) throw new Error('fileSha256 and rulesSha256 must be sha256 hex');
    for (const rec of input.records) items.push({ set, rec, packageId: input.packageId, fileSha256: input.fileSha256 });
  }
  const n = items.length;
  const recs = items.map((x) => x.rec);
  const found: Finding[][] = items.map(() => []);
  const clean: Array<Set<string>> = items.map(() => new Set());
  const superseded: boolean[] = items.map(() => false);

  // The record itself: an object with a key, a well-formed text, hashes that agree, and no review of its own.
  const keyCount = new Map<string, number>();
  items.forEach((x) => {
    if (isRec(x.rec) && typeof x.rec.source_key === 'string' && x.rec.source_key) {
      const k = `${x.set}\0${x.rec.source_key}`;
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    }
  });
  const patchKeys = new Set<string>();
  for (const x of items) {
    if (x.set === 'patches' && isRec(x.rec) && typeof x.rec.source_key === 'string' && x.rec.source_key) {
      patchKeys.add(x.rec.source_key);
    }
  }
  const hashes: Array<string | null> = items.map(() => null);
  items.forEach((x, i) => {
    const r = x.rec;
    if (!isRec(r)) {
      found[i].push(own('screen', [...REVIEW_CHECKS], 'not_an_object'));
      return;
    }
    if (typeof r.source_key !== 'string' || !r.source_key) {
      found[i].push(own('screen', ['identity'], 'no_source_key'));
    } else if ((keyCount.get(`${x.set}\0${r.source_key}`) ?? 0) > 1) {
      found[i].push(own('screen', ['identity'], 'duplicate_source_key'));
    }
    if (typeof r.text !== 'string' || r.text === '') {
      found[i].push(own('screen', ['completeness'], 'no_text'));
    } else if (!r.text.isWellFormed()) {
      found[i].push(own('screen', ['completeness'], 'text_not_well_formed'));
    } else {
      hashes[i] = sha256(r.text);
      if (r.content_sha256 !== undefined && r.content_sha256 !== hashes[i]) {
        found[i].push(own('screen', ['completeness'], 'content_sha256_mismatch'));
      }
      if (r.text_sha256 !== undefined && r.text_sha256 !== hashes[i]) {
        found[i].push(own('screen', ['completeness'], 'text_sha256_mismatch'));
      }
    }
    if (r.review !== undefined) found[i].push(own('screen', [...REVIEW_CHECKS], 'record_has_review'));
    if (found[i].length === 0) clean[i].add('screen');
    if (x.set === 'records' && typeof r.source_key === 'string' && patchKeys.has(r.source_key)) {
      superseded[i] = true;
      found[i].push(own('patches', ['dedupe'], 'superseded_by_patch_input'));
    }
  });

  // Switched-off checks: the run is incomplete, so nothing is screened.
  const skipped = (c: Screen['checks'][number]) =>
    (c.needs === 'live' && opts.noLive) || (c.needs === 'pages' && opts.noPages);
  items.forEach((_, i) => {
    if (opts.noLive) {
      found[i].push(own('screen', [...REVIEW_CHECKS], 'screen_incomplete', 'live reads were switched off'));
    }
    if (opts.noPages) {
      found[i].push(own('screen', [...REVIEW_CHECKS], 'screen_incomplete', 'the page check was switched off'));
    }
  });

  const valid = recs.map((r) => isRec(r));
  const add = (i: number, c: Screen['checks'][number], out: unknown) => {
    if (!Array.isArray(out) || out.some((f) => !isRec(f) || typeof f.reason !== 'string' || !f.reason)) {
      log(`check ${c.name}: returned something that is not a list of findings`);
      found[i].push(
        own(c.name, c.covers, 'check_error', 'the check returned something that is not a list of findings'),
      );
      return;
    }
    if (out.length === 0) clean[i].add(c.name);
    for (const f of out as Finding[]) {
      found[i].push({
        check: c.name,
        covers: c.covers,
        reason: f.reason,
        ...(typeof f.detail === 'string' && f.detail ? { detail: f.detail } : {}),
      });
    }
  };
  for (const c of screen.checks) {
    if (skipped(c)) continue;
    // A record that already has a finding is held; a check marked onlyIfClean does not run on it, and cannot pass it.
    const eligible = (i: number) => valid[i] && !(c.onlyIfClean && found[i].length > 0);
    const before = found.reduce((t, f) => t + f.length, 0);
    log(`check ${c.name}: start`);
    if (c.one) {
      let done = 0;
      for (let i = 0; i < n; i++) {
        if (!eligible(i)) continue;
        try {
          add(i, c, await c.one(recs[i], ctx));
        } catch (e) {
          log(`check ${c.name}: ${messageOf(e)}`);
          found[i].push(own(c.name, c.covers, 'check_error', errorName(e)));
        }
        if (++done % PROGRESS_EVERY === 0) log(`check ${c.name}: ${done} records`);
      }
    } else {
      // Superseded main records are held already and their patch stands for the key, so they are not offered.
      const offered = items.map((_, i) => i).filter((i) => eligible(i) && !superseded[i]);
      let map: Map<string, Finding[]> | null = null;
      try {
        map = await c.all!(offered.map((i) => recs[i]), ctx);
        if (!(map instanceof Map)) throw new TypeError('not a map');
      } catch (e) {
        log(`check ${c.name}: ${messageOf(e)}`);
        for (const i of offered) found[i].push(own(c.name, c.covers, 'check_error', errorName(e)));
        map = null;
      }
      if (map) {
        const known = new Set(offered.map((i) => (recs[i] as Rec).source_key));
        for (const k of map.keys()) {
          if (!known.has(k)) {
            throw new Error(`check ${c.name} returned findings for a source_key that is not in the set`);
          }
        }
        for (const i of offered) {
          const k = (recs[i] as Rec).source_key;
          add(i, c, typeof k === 'string' && map.has(k) ? map.get(k) : []);
        }
      }
    }
    log(`check ${c.name}: done, ${found.reduce((t, f) => t + f.length, 0) - before} findings`);
  }

  for (let i = 0; i < n; i++) {
    const x = items[i];
    const checks = Object.fromEntries(
      REVIEW_CHECKS.map((rc) => [
        rc,
        found[i].length === 0 && clean[i].has('screen') &&
        screen.checks.filter((c) => c.covers.includes(rc)).every((c) => clean[i].has(c.name)),
      ]),
    ) as Record<ReviewCheck, boolean>;
    let rec = x.rec;
    if (found[i].length === 0 && REVIEW_CHECKS.every((rc) => checks[rc]) && screen.project) {
      const done = applyProject(screen, rec);
      if ('record' in done) rec = done.record;
      else found[i].push(own('project', ['identity'], 'project_failed', done.error));
    }
    if (found[i].length === 0 && REVIEW_CHECKS.every((rc) => checks[rc])) {
      await emit.screened(x.set, {
        ...rec,
        text_sha256: hashes[i],
        review: {
          status: 'eligible',
          text_sha256: hashes[i],
          source_key: rec.source_key,
          rules_sha256: opts.rulesSha256,
          package_id: x.packageId,
          mapping_version: screen.mappingVersion,
          decision_id: opts.decisionId,
          file_sha256: x.fileSha256,
          checks,
        },
      });
    } else {
      await emit.hold(x.set, {
        source_key: isRec(x.rec) && typeof x.rec.source_key === 'string' ? x.rec.source_key : null,
        reasons: [...new Set(found[i].map((f) => f.reason))],
        findings: found[i],
      });
    }
    if ((i + 1) % PROGRESS_EVERY === 0) log(`outcomes: ${i + 1} of ${n} records`);
  }
}

/** The same for one set, returning the outcomes. */
export async function runScreen(
  screen: Screen,
  records: Rec[],
  ctx: ScreenContext,
  opts: RunOptions,
): Promise<ScreenResult> {
  const out = await runScreenSets(
    screen,
    { records: { records, packageId: opts.packageId, fileSha256: opts.fileSha256 } },
    ctx,
    opts,
  );
  return out.records;
}

/** The same for records and patches, returning the outcomes of each. */
export async function runScreenSets(
  screen: Screen,
  sets: { records: SetInput; patches?: SetInput | null },
  ctx: ScreenContext,
  opts: SharedOptions,
): Promise<{ records: ScreenResult; patches: ScreenResult | null }> {
  const records: ScreenResult = { screened: [], holds: [] };
  const patches: ScreenResult | null = sets.patches ? { screened: [], holds: [] } : null;
  const to = (set: SetName) => set === 'records' ? records : patches!;
  await screenSets(screen, sets, ctx, opts, {
    screened: (set, r) => void to(set).screened.push(r),
    hold: (set, h) => void to(set).holds.push(h),
  });
  return { records, patches };
}

// ---- reading the reader's output ----

export interface Input {
  records: Rec[];
  sha256: string;
  receiptSha256: string;
  packageId: string;
  lines: number;
}

/** Streams a JSON-lines file once, hashing the bytes and parsing each line; never holds the file as one string. */
async function* jsonLines(path: string, hash: ReturnType<typeof createHash>): AsyncGenerator<Rec> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const file = await Deno.open(path, { read: true });
  let pending = '';
  let line = 0;
  const parse = (s: string): Rec => {
    line++;
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch {
      throw new Error(`line ${line}: not JSON`);
    }
    if (!isRec(v)) throw new Error(`line ${line}: not a JSON object`);
    return v;
  };
  try {
    for await (const chunk of file.readable) {
      hash.update(chunk);
      pending += decoder.decode(chunk, { stream: true });
      let at = pending.indexOf('\n');
      while (at >= 0) {
        yield parse(pending.slice(0, at));
        pending = pending.slice(at + 1);
        at = pending.indexOf('\n');
      }
    }
    pending += decoder.decode();
  } catch (e) {
    if (e instanceof TypeError) throw new Error('the file is not valid UTF-8');
    throw e;
  }
  if (pending !== '') yield parse(pending);
}

/** The records file, checked against the reader's receipt: its hash and its line count must be the receipt's. */
export async function readInput(path: string, label: string): Promise<Input> {
  const receiptPath = `${path}.receipt.json`;
  let receiptBytes: Uint8Array;
  try {
    receiptBytes = await Deno.readFile(receiptPath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw new Error(
        `${label}: ${receiptPath} could not be read (${e instanceof Error ? e.name : typeof e})`,
      );
    }
    throw new Error(`${label}: ${receiptPath} is missing; the screen reads only the reader's output with its receipt`);
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(new TextDecoder().decode(receiptBytes));
  } catch {
    throw new Error(`${label}: the receipt is not valid JSON`);
  }
  if (!isRec(receipt)) throw new Error(`${label}: the receipt is not an object`);
  if (!HEX64.test(String(receipt.output_sha256))) throw new Error(`${label}: the receipt has no output_sha256`);
  if (!HEX64.test(String(receipt.manifest_sha256)) || !text1000(receipt.pack) || !text1000(receipt.entry)) {
    throw new Error(`${label}: the receipt lacks pack, entry or manifest_sha256`);
  }
  if (!Number.isInteger(receipt.lines_written) || (receipt.lines_written as number) < 1) {
    throw new Error(`${label}: the receipt says no lines were written (an empty run)`);
  }
  const packageId = `${receipt.pack}/${receipt.entry}#${receipt.manifest_sha256}`;
  if (packageId.length > MAX_FIELD) throw new Error(`${label}: the package id is longer than ${MAX_FIELD} characters`);
  const hash = createHash('sha256');
  const records: Rec[] = [];
  try {
    for await (const r of jsonLines(path, hash)) records.push(r);
  } catch (e) {
    throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const actual = hash.digest('hex');
  if (actual !== receipt.output_sha256) {
    throw new Error(`${label}: the file's sha256 is not the receipt's output_sha256; it is not the reader's output`);
  }
  if (records.length !== receipt.lines_written) {
    throw new Error(`${label}: ${records.length} records, the receipt says ${receipt.lines_written}`);
  }
  return {
    records,
    sha256: actual,
    receiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
    packageId,
    lines: records.length,
  };
}

// ---- the command ----

export interface ScreenDeps {
  screens: Record<string, () => Promise<Screen>>;
  /** The read-only NTER reader for this libpq service and psql program. */
  live: (service: string, psql: string) => LiveReader;
  git: () => Promise<{ commit: string; dirty: boolean }>;
  repoRoot: string;
  commonDir?: () => Promise<string | null>;
  /** Reads a rule file (default: from disk). A seam for tests. */
  readRules?: (path: string) => Promise<Uint8Array>;
  /** Creates a hard link, failing if the target exists (default `Deno.link`). A seam so tests can fail a step. */
  link?: (from: string, to: string) => Promise<void>;
  /** Result lines (stdout). */
  log: (line: string) => void;
  /** Progress and check errors (stderr); check error messages may quote a record, so they never go anywhere else. */
  err?: (line: string) => void;
  now: () => number;
}

const LIVE_SERVICE = 'nter-accept';
const off = () => Promise.reject(new Error('live reads are switched off (--no-live)'));
const switchedOff: LiveReader = { documents: off, identity: off, deskRows: off };

interface Written {
  sha256: string;
  bytes: number;
  lines: number;
}

/** A new file written line by line, hashing as it goes. */
class LineWriter {
  private hash = createHash('sha256');
  private bytes = 0;
  private lines = 0;
  private enc = new TextEncoder();
  private constructor(private file: Deno.FsFile) {}
  static async create(path: string): Promise<LineWriter> {
    return new LineWriter(await Deno.open(path, { write: true, createNew: true }));
  }
  async write(line: string): Promise<void> {
    const b = this.enc.encode(line + '\n');
    this.hash.update(b);
    this.bytes += b.length;
    this.lines++;
    await writeAll(this.file, b);
  }
  close(): Written {
    this.file.close();
    return { sha256: this.hash.digest('hex'), bytes: this.bytes, lines: this.lines };
  }
  abort(): void {
    try {
      this.file.close();
    } catch { /* already closed */ }
  }
}

/** The one tier and feature the records name; a run over several, or none, is refused (a pack entry is one collection). */
function deskOf(sets: Rec[][]): { tier: string; feature: string } {
  const pairs = new Set<string>();
  for (const set of sets) {
    for (const r of set) {
      pairs.add(
        isRec(r) && typeof r.desk_tier === 'string' && typeof r.desk_feature === 'string'
          ? JSON.stringify([r.desk_tier, r.desk_feature])
          : 'none',
      );
    }
  }
  if (pairs.size !== 1 || pairs.has('none')) {
    throw new Error('the records must all name one desk_tier and desk_feature; the live database check needs them');
  }
  const [tier, feature] = JSON.parse([...pairs][0]) as [string, string];
  return { tier, feature };
}

interface Counts {
  out: number;
  held: number;
  byReason: Record<string, number>;
}

export async function main(argv: string[], deps: ScreenDeps): Promise<number> {
  const c = parseArgs(argv);
  const err = deps.err ?? (() => {});
  const startedAt = new Date(deps.now()).toISOString();
  const collectionBytes = await Deno.readFile(c.collection);
  const coll: CollectionFile & { screen?: unknown } = checkCollection(
    JSON.parse(new TextDecoder().decode(collectionBytes)),
  );
  const block = checkScreenBlock((coll as { screen?: unknown }).screen);
  if (!Object.hasOwn(deps.screens, c.screen)) {
    throw new Error(
      `unknown screen ${JSON.stringify(c.screen.slice(0, 60))}; known: ${
        Object.keys(deps.screens).join(', ') || '(none)'
      }`,
    );
  }
  const screen = await deps.screens[c.screen]();
  validateScreen(screen);
  if (screen.collection !== coll.collection) {
    throw new Error(`the screen is for ${screen.collection}, the collection file is ${coll.collection}`);
  }
  const outDir = await refuseInCheckout(c.out, '--out', deps);
  for (const name of Object.values(OUT)) {
    if (await exists(join(outDir, name))) throw new Error(`${join(outDir, name)} already exists; choose a new --out`);
  }
  const rules = await rulesSha256(screen.rulesFiles, deps.repoRoot, deps.readRules, block.settings);
  const { commit, dirty } = await deps.git();

  const inputs = { records: await readInput(c.records, 'records') };
  const patchInput = c.patches ? await readInput(c.patches, 'patches') : null;
  deps.log(`read ${inputs.records.lines} records${patchInput ? ` and ${patchInput.lines} patches` : ''}`);

  const hasNeeds = (n: 'live' | 'pages') => screen.checks.some((x) => x.needs === n);
  const live = c.noLive ? switchedOff : deps.live(LIVE_SERVICE, c.psql);
  // Which database this is, before anything is judged against it: an empty or wrong one would pass every "not live".
  let liveIdentity: Record<string, unknown> | null = null;
  if (!c.noLive && hasNeeds('live')) {
    const desk = deskOf([inputs.records.records, ...(patchInput ? [patchInput.records] : [])]);
    const id = await live.identity(desk);
    const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
    if (!text1000(id?.database) || !text1000(id?.server) || !count(id?.documents) || !count(id?.deskRows)) {
      throw new Error('the live reader gave no usable database identity');
    }
    if (id.documents === 0 || id.deskRows === 0) {
      throw new Error(
        `database ${id.database} (${id.server}) holds ${id.documents} documents and ${id.deskRows} listing rows for ` +
          `${desk.tier} / ${desk.feature}; this is not the database to screen against, so nothing was written`,
      );
    }
    liveIdentity = {
      database: id.database,
      server: id.server,
      tier: desk.tier,
      feature: desk.feature,
      documents: id.documents,
      desk_rows: id.deskRows,
    };
    deps.log(`live database ${id.database} (${id.server}): ${id.documents} documents, ${id.deskRows} listing rows`);
  }
  const ctx: ScreenContext = { live, settings: block.settings };

  // Publication: outputs are written as they are produced, to temporary files; then the receipt, then each output, all
  // created exclusively by hard link. The receipt goes first: a stop between steps leaves an orphan receipt, never an
  // output without one.
  const tag = crypto.randomUUID().slice(0, 8);
  const tmp = (name: string) => join(outDir, `${name}.part-${tag}`);
  const link = deps.link ?? ((from: string, to: string) => Deno.link(from, to));
  const temps: string[] = [];
  const created: string[] = [];
  const writers: LineWriter[] = [];
  try {
    await Deno.mkdir(outDir, { recursive: true });
    const open = async (name: string) => {
      temps.push(tmp(name));
      const w = await LineWriter.create(tmp(name));
      writers.push(w);
      return w;
    };
    // One screened file: the screened main records, then the screened patches. A patch is the complete corrected
    // record under its original's source_key (the original is held), so it is an ordinary record to the runner.
    const screenedOut = await open(OUT.screened);
    const patchKeys: string[] = [];
    const holdsOut = await open(OUT.holds);
    const counts: Record<SetName, Counts> = {
      records: { out: 0, held: 0, byReason: {} },
      patches: { out: 0, held: 0, byReason: {} },
    };
    await screenSets(
      screen,
      {
        records: {
          records: inputs.records.records,
          packageId: inputs.records.packageId,
          fileSha256: inputs.records.sha256,
        },
        patches: patchInput
          ? { records: patchInput.records, packageId: patchInput.packageId, fileSha256: patchInput.sha256 }
          : null,
      },
      ctx,
      { decisionId: block.decisionId, rulesSha256: rules, noLive: c.noLive, noPages: c.noPages, log: err },
      {
        screened: async (set, r) => {
          counts[set].out++;
          if (set === 'patches') patchKeys.push(String(r.source_key));
          await screenedOut.write(JSON.stringify(r));
        },
        hold: async (set, h) => {
          counts[set].held++;
          for (const reason of h.reasons) counts[set].byReason[reason] = (counts[set].byReason[reason] ?? 0) + 1;
          await holdsOut.write(
            JSON.stringify({ source_key: h.source_key, set, reasons: h.reasons, findings: h.findings }),
          );
        },
      },
    );
    const written = new Map<string, Written>();
    written.set(OUT.screened, screenedOut.close());
    written.set(OUT.holds, holdsOut.close());
    const out = (name: string) => written.get(name) ?? null;
    const part = (input: Input, k: Counts) => ({
      receipt_sha256: input.receiptSha256,
      output_sha256: input.sha256,
      package_id: input.packageId,
      records_in: input.lines,
      records_out: k.out,
      held: k.held,
      held_by_reason: k.byReason,
    });
    // What a check kept while it ran: its numeric counters and, as `scans`, source keys; nothing else (no text, no URL).
    const checksStats: Record<string, Record<string, number | string[]>> = {};
    for (const x of screen.checks) {
      const st = (x as { stats?: unknown }).stats;
      if (!isRec(st)) continue;
      const kept: Record<string, number | string[]> = {};
      for (const [k, v] of Object.entries(st)) {
        if (typeof v === 'number' && Number.isFinite(v)) kept[k] = v;
        else if (k === 'scans' && Array.isArray(v)) kept[k] = v.map(String);
      }
      checksStats[x.name] = kept;
    }
    const receipt = {
      collection: coll.collection,
      collection_file_sha256: createHash('sha256').update(collectionBytes).digest('hex'),
      screen: c.screen,
      mapping_version: screen.mappingVersion,
      decision_id: block.decisionId,
      rules_sha256: rules,
      rules_files: screen.rulesFiles,
      records: part(inputs.records, counts.records),
      patches: patchInput ? part(patchInput, counts.patches) : null,
      // Screened records that came from the patches input (they are in screened.jsonl after the main ones): the count
      // and the sha256 of their source_keys, sorted and newline-joined. No text.
      screened_from_patches: counts.patches.out,
      screened_from_patches_keys_sha256: sha256([...patchKeys].sort().join('\n')),
      live_identity: liveIdentity,
      live_reads_ran: !c.noLive && hasNeeds('live'),
      page_check_ran: !c.noPages && hasNeeds('pages'),
      complete: !c.noLive && !c.noPages,
      checks_stats: checksStats,
      outputs: {
        screened: out(OUT.screened),
        holds: out(OUT.holds),
      },
      screen_commit: commit,
      screen_dirty: dirty,
      started_at: startedAt,
      finished_at: new Date(deps.now()).toISOString(),
    };
    temps.push(tmp(OUT.receipt));
    await Deno.writeTextFile(tmp(OUT.receipt), JSON.stringify(receipt, null, 2) + '\n', { createNew: true });
    const names = [OUT.receipt, OUT.screened, OUT.holds];
    for (const name of names) {
      await link(tmp(name), join(outDir, name));
      created.push(join(outDir, name));
      await Deno.remove(tmp(name));
    }
    deps.log(
      `records ${inputs.records.lines}: screened ${counts.records.out}, held ${counts.records.held}` +
        (patchInput
          ? `; patches ${patchInput.lines}: screened ${counts.patches.out}, held ${counts.patches.held}`
          : ''),
    );
    deps.log(`wrote ${created.join(', ')}`);
    return 0;
  } catch (e) {
    for (const w of writers) w.abort();
    for (const p of [...temps, ...created]) await Deno.remove(p).catch(() => {});
    throw e;
  }
}

if (import.meta.main) {
  try {
    Deno.exit(
      await main(Deno.args, {
        screens: SCREENS,
        live: (service, psql) => psqlLiveReader(service, psql),
        git: gitState,
        repoRoot: REPO_ROOT,
        commonDir: gitCommonDir,
        log: (l) => console.log(l),
        err: (l) => console.error(l),
        now: () => Date.now(),
      }),
    );
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
