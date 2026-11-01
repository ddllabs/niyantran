/**
 * The pure parts of the migration rehearsal (scripts/eval-replica/rehearse.mjs): which databases the
 * tooling may touch, argument parsing, phase-marker parsing, the disk check, probe and size
 * summaries, and the Markdown summary. Nothing here reads the clock, the environment or a database,
 * so every rule is unit-tested (rehearsal.test.js).
 */
import { percentile } from './retrievalEval.js';

/** The frozen baseline copy. It is only ever a template (source) or an eval target, never written. */
export const REPLICA_DATABASE = 'niyantran_retrieval_replica';
/** The only databases the rehearsal creates or drops. */
export const REHEARSAL_PREFIX = 'niyantran_rehearsal_';
const MAX_IDENTIFIER = 63;
const REHEARSAL_NAME = new RegExp(`^${REHEARSAL_PREFIX}[a-z0-9_]{1,${MAX_IDENTIFIER - REHEARSAL_PREFIX.length}}$`);

export function isRehearsalDatabase(name) {
  return typeof name === 'string' && REHEARSAL_NAME.test(name);
}

/** A database the rehearsal may create or drop. */
export function assertRehearsalDatabase(name) {
  if (!isRehearsalDatabase(name)) {
    throw new Error(`refusing database ${JSON.stringify(name)}: a rehearsal database is ${REHEARSAL_PREFIX} followed by 1-${MAX_IDENTIFIER - REHEARSAL_PREFIX.length} lower-case letters, digits or underscores`);
  }
  return name;
}

/** A database the retrieval eval may read: the replica, or a rehearsal copy of it. */
export function assertEvalDatabase(name) {
  if (name !== REPLICA_DATABASE && !isRehearsalDatabase(name)) {
    throw new Error(`refusing database ${JSON.stringify(name)}: the eval reads only ${REPLICA_DATABASE} or a ${REHEARSAL_PREFIX} database`);
  }
  return name;
}

/** A database a rehearsal may copy from (read only): the replica, or a rehearsal database. */
export function assertSourceDatabase(name) {
  if (name !== REPLICA_DATABASE && !isRehearsalDatabase(name)) {
    throw new Error(`refusing source database ${JSON.stringify(name)}: a rehearsal copies only ${REPLICA_DATABASE} or a ${REHEARSAL_PREFIX} database`);
  }
  return name;
}

const pad = (n) => String(n).padStart(2, '0');

/** niyantran_rehearsal_YYYYMMDD_HHMMSS in UTC. */
export function defaultRehearsalName(date) {
  const d = date;
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${REHEARSAL_PREFIX}${day}_${time}`;
}

/** Arguments of rehearse.mjs. Throws on anything unknown, so a typo cannot run a different rehearsal. */
export function parseRehearseArgs(argv, now = new Date()) {
  const out = { migration: null, name: null, source: REPLICA_DATABASE, keep: false, fresh: false, out: 'eval/retrieval/results', sampleMs: 3000, probeMs: 250 };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  const interval = (i, flag, min, max) => {
    const raw = value(i, flag);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be a whole number of milliseconds from ${min} to ${max}, got ${raw}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--migration') out.migration = value(++i, a);
    else if (a === '--name') out.name = value(++i, a);
    else if (a === '--source') out.source = value(++i, a);
    else if (a === '--out') out.out = value(++i, a);
    else if (a === '--sample-ms') out.sampleMs = interval(++i, a, 100, 60_000);
    else if (a === '--probe-ms') out.probeMs = interval(++i, a, 50, 10_000);
    else if (a === '--keep') out.keep = true;
    else if (a === '--fresh') out.fresh = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.migration) throw new Error('--migration <path> is required');
  out.name ??= defaultRehearsalName(now);
  assertRehearsalDatabase(out.name);
  assertSourceDatabase(out.source);
  if (out.name === out.source) throw new Error('--name and --source are the same database');
  return out;
}

/**
 * One line of psql's stderr as a phase marker, or null. A migration marks its phases with
 *   raise notice 'phase: <name> start';   raise notice 'phase: <name> end';
 * (`done` also ends a phase), and a bare `phase: <name>` is a point in time. psql may prefix the
 * notice with `psql:<file>:<line>: `, which is ignored. `atMs` is when the line arrived, relative to
 * the migration's start; the caller stamps it as the notice is read.
 */
export function parsePhaseNotice(line, atMs) {
  const m = /^(?:psql:\S*:\s*)?NOTICE:\s+phase:\s*(.+?)\s*$/.exec(line ?? '');
  if (!m) return null;
  const tail = /^(.*?)\s+(start|end|done)$/.exec(m[1]);
  if (!tail) return { name: m[1], event: 'mark', atMs };
  return { name: tail[1].trim(), event: tail[2] === 'start' ? 'start' : 'end', atMs };
}

/** Pair start/end markers into timed phases; keep bare markers as marks with the gap since the previous marker. */
export function summarisePhases(markers, totalMs) {
  const sorted = [...markers].sort((a, b) => a.atMs - b.atMs);
  const phases = [];
  const marks = [];
  const warnings = [];
  const open = new Map();
  let previous = 0;
  for (const m of sorted) {
    if (m.event === 'start') {
      if (!open.has(m.name)) open.set(m.name, []);
      open.get(m.name).push(m.atMs);
    } else if (m.event === 'end') {
      const stack = open.get(m.name);
      if (!stack?.length) warnings.push(`phase "${m.name}" ended without a start`);
      else {
        const startMs = stack.pop();
        phases.push({ name: m.name, startMs, endMs: m.atMs, durationMs: m.atMs - startMs, complete: true });
      }
    } else {
      marks.push({ name: m.name, atMs: m.atMs, sincePreviousMs: m.atMs - previous });
    }
    previous = m.atMs;
  }
  for (const [name, stack] of open) {
    for (const startMs of stack) {
      warnings.push(`phase "${name}" never ended`);
      phases.push({ name, startMs, endMs: totalMs, durationMs: totalMs - startMs, complete: false });
    }
  }
  phases.sort((a, b) => a.startMs - b.startMs);
  return { phases, marks, warnings };
}

/** The rehearsal copies the source and the migration roughly doubles it again: demand twice the source size free. */
export function checkDiskSpace({ sourceBytes, freeBytes }) {
  if (!(sourceBytes > 0) || !Number.isFinite(freeBytes) || freeBytes < 0) {
    return { ok: false, requiredBytes: null, message: `cannot check disk space: source ${sourceBytes} bytes, free ${freeBytes} bytes` };
  }
  const requiredBytes = 2 * sourceBytes;
  if (freeBytes < requiredBytes) {
    return { ok: false, requiredBytes, message: `not enough free disk: ${formatBytes(freeBytes)} free, but a rehearsal needs at least twice the source size (${formatBytes(sourceBytes)} x 2 = ${formatBytes(requiredBytes)})` };
  }
  return { ok: true, requiredBytes, message: `${formatBytes(freeBytes)} free, ${formatBytes(requiredBytes)} required` };
}

/** Samples `{ atMs, waitMs, error? }` of the reader probe. Failed probes are counted, not timed. */
export function summariseProbe(samples) {
  const errors = samples.filter((s) => s.error).length;
  const ok = samples.filter((s) => !s.error);
  if (!ok.length) return { count: 0, errors, maxMs: null, maxAtMs: null, p50Ms: null, p95Ms: null, over1sCount: 0 };
  const longest = ok.reduce((a, b) => (b.waitMs > a.waitMs ? b : a));
  const waits = ok.map((s) => s.waitMs);
  return {
    count: ok.length,
    errors,
    maxMs: longest.waitMs,
    maxAtMs: longest.atMs,
    p50Ms: percentile(waits, 50),
    p95Ms: percentile(waits, 95),
    over1sCount: ok.filter((s) => s.waitMs > 1000).length,
  };
}

/** Samples `{ atMs, databaseBytes, walBytes?, freeBytes? }` taken while the migration ran. */
export function summarisePeak(samples) {
  if (!samples.length) return { samples: 0, peakDatabaseBytes: null, peakDatabaseAtMs: null, startWalBytes: null, peakWalBytes: null, peakCombinedBytes: null, minFreeBytes: null };
  const top = samples.reduce((a, b) => (b.databaseBytes > a.databaseBytes ? b : a));
  const wal = samples.map((s) => s.walBytes).filter((v) => Number.isFinite(v));
  const free = samples.map((s) => s.freeBytes).filter((v) => Number.isFinite(v));
  return {
    samples: samples.length,
    peakDatabaseBytes: top.databaseBytes,
    peakDatabaseAtMs: top.atMs,
    startWalBytes: Number.isFinite(samples[0].walBytes) ? samples[0].walBytes : null,
    peakWalBytes: wal.length ? Math.max(...wal) : null,
    peakCombinedBytes: Math.max(...samples.map((s) => s.databaseBytes + (Number.isFinite(s.walBytes) ? s.walBytes : 0))),
    minFreeBytes: free.length ? Math.min(...free) : null,
  };
}

const ERROR_LINE = /^(?:psql:\S*:\s*)?(?:ERROR|FATAL):/;
const MAX_ERROR_CHARS = 300;

/**
 * The ERROR lines of psql's stderr, capped in length. DETAIL, CONTEXT and statement text are dropped:
 * they can quote row values, and the report must hold no chunk content.
 */
export function sanitiseErrors(stderr) {
  return String(stderr ?? '')
    .split('\n')
    .filter((l) => ERROR_LINE.test(l))
    .map((l) => (l.length > MAX_ERROR_CHARS ? `${l.slice(0, MAX_ERROR_CHARS - 1)}…` : l));
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return 'n/a';
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const digits = u === 0 ? 0 : u >= 3 ? 2 : 1;
  return `${n < 0 ? '-' : ''}${v.toFixed(digits)} ${units[u]}`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * The short Markdown summary of a rehearsal result (the JSON written beside it). It holds database
 * names, sizes, timings and counts, never chunk content.
 */
export function renderRehearsalReport(r) {
  const m = r.migrationRun;
  const pk = r.sizes.peak;
  const out = [
    '# Migration rehearsal',
    '',
    `- Ran at: ${r.ranAt}`,
    `- Migration: ${r.migration.file} (${r.migration.bytes} bytes, sha256 ${r.migration.sha256})`,
    `- Source database: ${r.source.database} (${formatBytes(r.source.sizeBytes)})`,
    `- Rehearsal database: ${r.target.database} (${r.target.kept ? 'kept' : 'dropped at the end'})`,
    `- Free disk before the copy: ${formatBytes(r.disk.freeBytes)} (required ${formatBytes(r.disk.requiredBytes)})`,
    '',
    '## Timings',
    '',
    `- Copy of the source (create database ... template): ${formatMs(r.copy.ms)}`,
    `- Migration: ${m.ok ? 'ok' : 'FAILED'}, ${formatMs(m.ms)}, in one transaction`,
  ];
  for (const e of m.error ?? []) out.push(`  - ${e}`);
  for (const p of r.phases.phases) out.push(`  - phase ${p.name}: ${formatMs(p.durationMs)}${p.complete ? '' : ' (never ended)'}`);
  for (const k of r.phases.marks) out.push(`  - mark ${k.name} at ${formatMs(k.atMs)} (${formatMs(k.sincePreviousMs)} after the previous marker)`);
  for (const w of r.phases.warnings) out.push(`  - warning: ${w}`);
  if (!r.phases.phases.length && !r.phases.marks.length) out.push('  - no `NOTICE:  phase: ...` markers were printed, so no per-phase timings');
  out.push(`- Analyze (documents, document_chunks): ${r.analyze ? formatMs(r.analyze.ms) : 'skipped'}`);
  out.push('', '## Size', '');
  out.push(`- Database before: ${formatBytes(r.sizes.before.databaseBytes)}`);
  out.push(`- Database after: ${formatBytes(r.sizes.after.databaseBytes)}`);
  out.push(`- Peak database size: ${formatBytes(pk.peakDatabaseBytes)}${pk.peakDatabaseAtMs == null ? '' : ` at ${formatMs(pk.peakDatabaseAtMs)} into the migration`} (${pk.samples} samples)`);
  out.push(`- Peak database size growth over the start: ${formatBytes(pk.peakDatabaseBytes - r.sizes.before.databaseBytes)}`);
  out.push(`- WAL directory (cluster-wide, includes recycled segments): ${formatBytes(pk.startWalBytes)} at the start, ${formatBytes(pk.peakWalBytes)} at the peak; peak database plus WAL ${formatBytes(pk.peakCombinedBytes)}`);
  out.push(`- Lowest free disk during the migration: ${formatBytes(pk.minFreeBytes)}`);
  out.push(`- Disk used at the worst point: ${formatBytes(r.disk.freeBytes - pk.minFreeBytes)} (free before the copy minus the lowest free, so it includes the copy)`);
  const tables = (rels) => rels.filter((x) => x.kind === 'r').reduce((sum, x) => sum + x.totalBytes, 0);
  out.push(`- Tables (heap and indexes) before ${formatBytes(tables(r.sizes.before.relations))}, after ${formatBytes(tables(r.sizes.after.relations))}`);
  out.push('', '| Relation | Kind | Total before | Total after |', '| --- | --- | --- | --- |');
  const before = new Map(r.sizes.before.relations.map((x) => [x.name, x]));
  const after = new Map(r.sizes.after.relations.map((x) => [x.name, x]));
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(name);
    const a = after.get(name);
    out.push(`| ${name} | ${(a ?? b).kind} | ${b ? formatBytes(b.totalBytes) : '—'} | ${a ? formatBytes(a.totalBytes) : '—'} |`);
  }
  const rc = r.rowCounts;
  out.push('', '## Row counts', '');
  out.push(`Row counts: ${rc.equal ? 'equal before and after' : 'DIFFER'} (documents ${rc.before.documents} -> ${rc.after.documents}, document_chunks ${rc.before.document_chunks} -> ${rc.after.document_chunks})`);
  const p = r.readerProbe;
  out.push('', '## Readers during the migration', '');
  out.push(`A second connection ran a trivial select on document_chunks every probe interval: ${p.count} probes, ${p.errors} failed.`);
  out.push(`- Longest reader wait: ${formatMs(p.maxMs)}${p.maxAtMs == null ? '' : ` (began ${formatMs(p.maxAtMs)} into the migration)`}`);
  out.push(`- p50 ${formatMs(p.p50Ms)}, p95 ${formatMs(p.p95Ms)}, probes over 1 s: ${p.over1sCount}`);
  out.push('', 'Probes go through one persistent psql session, so the p50 is the floor (pipe and query) and the maximum is the figure to read.');
  return `${out.join('\n')}\n`;
}
