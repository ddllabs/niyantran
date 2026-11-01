import { describe, expect, it } from 'vitest';
import { REPLICA_DATABASE as COPY_REPLICA_DATABASE } from '../../scripts/eval-replica/copy.mjs';
import {
  REHEARSAL_PREFIX,
  REPLICA_DATABASE,
  assertEvalDatabase,
  assertRehearsalDatabase,
  assertSourceDatabase,
  checkDiskSpace,
  defaultRehearsalName,
  formatBytes,
  formatMs,
  isRehearsalDatabase,
  parsePhaseNotice,
  parseRehearseArgs,
  renderRehearsalReport,
  sanitiseErrors,
  summarisePeak,
  summarisePhases,
  summariseProbe,
} from './rehearsal.js';

describe('database name guards', () => {
  it('keeps the replica name equal to the loader\'s', () => {
    expect(REPLICA_DATABASE).toBe(COPY_REPLICA_DATABASE);
  });

  it('accepts only niyantran_rehearsal_ names made of lower-case letters, digits and underscores', () => {
    expect(isRehearsalDatabase('niyantran_rehearsal_a')).toBe(true);
    expect(isRehearsalDatabase('niyantran_rehearsal_20261101_153012')).toBe(true);
    expect(isRehearsalDatabase('niyantran_rehearsal_src_small')).toBe(true);
    for (const bad of [
      'niyantran_rehearsal_', // empty suffix
      'niyantran_retrieval_replica',
      'postgres',
      'template1',
      'Niyantran_rehearsal_x',
      'niyantran_rehearsal_X',
      'niyantran_rehearsal_a-b',
      'niyantran_rehearsal_a b',
      'niyantran_rehearsal_a;drop database postgres',
      'niyantran_rehearsal_a"',
      "niyantran_rehearsal_a'",
      ' niyantran_rehearsal_a',
      'xniyantran_rehearsal_a',
      `${REHEARSAL_PREFIX}${'a'.repeat(44)}`, // 64 characters: over the identifier limit
      '', null, undefined, 42,
    ]) {
      expect(isRehearsalDatabase(bad), String(bad)).toBe(false);
    }
    expect(isRehearsalDatabase(`${REHEARSAL_PREFIX}${'a'.repeat(43)}`)).toBe(true); // exactly 63
  });

  it('assertRehearsalDatabase refuses the replica and everything else that is not a rehearsal name', () => {
    expect(() => assertRehearsalDatabase('niyantran_rehearsal_ok')).not.toThrow();
    expect(() => assertRehearsalDatabase(REPLICA_DATABASE)).toThrow(/niyantran_rehearsal_/);
    expect(() => assertRehearsalDatabase('postgres')).toThrow(/refusing/);
  });

  it('eval and source databases are the replica or a rehearsal database, nothing else', () => {
    for (const assert of [assertEvalDatabase, assertSourceDatabase]) {
      expect(() => assert(REPLICA_DATABASE)).not.toThrow();
      expect(() => assert('niyantran_rehearsal_x')).not.toThrow();
      expect(() => assert('postgres')).toThrow(/refusing/);
      expect(() => assert('niyantran_replica_copy_test')).toThrow(/refusing/);
      expect(() => assert('niyantran_retrieval_replica2')).toThrow(/refusing/);
    }
  });

  it('builds a valid default name from the date, in UTC', () => {
    const name = defaultRehearsalName(new Date('2026-11-01T15:30:12.345Z'));
    expect(name).toBe('niyantran_rehearsal_20261101_153012');
    expect(isRehearsalDatabase(name)).toBe(true);
  });
});

describe('parseRehearseArgs', () => {
  const now = new Date('2026-11-01T15:30:12Z');

  it('requires --migration and fills the defaults', () => {
    expect(() => parseRehearseArgs([], now)).toThrow(/--migration/);
    const a = parseRehearseArgs(['--migration', 'm.sql'], now);
    expect(a).toMatchObject({
      migration: 'm.sql',
      name: 'niyantran_rehearsal_20261101_153012',
      source: REPLICA_DATABASE,
      keep: false,
      fresh: false,
      out: 'eval/retrieval/results',
      sampleMs: 3000,
      probeMs: 250,
    });
  });

  it('reads every option', () => {
    const a = parseRehearseArgs(['--migration', 'm.sql', '--name', 'niyantran_rehearsal_x', '--keep', '--fresh', '--source', 'niyantran_rehearsal_src', '--out', 'o', '--sample-ms', '500', '--probe-ms', '100'], now);
    expect(a).toMatchObject({ name: 'niyantran_rehearsal_x', keep: true, fresh: true, source: 'niyantran_rehearsal_src', out: 'o', sampleMs: 500, probeMs: 100 });
  });

  it('refuses a target that is not a rehearsal name, including the replica itself', () => {
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--name', REPLICA_DATABASE], now)).toThrow(/niyantran_rehearsal_/);
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--name', 'postgres'], now)).toThrow(/refusing/);
  });

  it('refuses a source that is neither the replica nor a rehearsal database', () => {
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--source', 'postgres'], now)).toThrow(/refusing/);
  });

  it('refuses a target equal to the source', () => {
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--name', 'niyantran_rehearsal_x', '--source', 'niyantran_rehearsal_x'], now)).toThrow(/same/);
  });

  it('refuses unknown options, missing values and out-of-range intervals', () => {
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--drop'], now)).toThrow(/unknown argument/);
    expect(() => parseRehearseArgs(['--migration'], now)).toThrow(/needs a value/);
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--name'], now)).toThrow(/needs a value/);
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--sample-ms', '5'], now)).toThrow(/--sample-ms/);
    expect(() => parseRehearseArgs(['--migration', 'm.sql', '--probe-ms', 'x'], now)).toThrow(/--probe-ms/);
  });
});

describe('phase notices', () => {
  it('parses start, end and mark notices, with or without psql\'s file prefix', () => {
    expect(parsePhaseNotice('NOTICE:  phase: copy start', 1200)).toEqual({ name: 'copy', event: 'start', atMs: 1200 });
    expect(parsePhaseNotice('psql:<stdin>:41: NOTICE:  phase: copy end', 5)).toEqual({ name: 'copy', event: 'end', atMs: 5 });
    expect(parsePhaseNotice('psql:<stdin>:41: NOTICE:  phase: build hnsw done', 5)).toEqual({ name: 'build hnsw', event: 'end', atMs: 5 });
    expect(parsePhaseNotice('NOTICE:  phase: swap', 7)).toEqual({ name: 'swap', event: 'mark', atMs: 7 });
    expect(parsePhaseNotice('NOTICE:  phase:   facets   start  ', 7)).toEqual({ name: 'facets', event: 'start', atMs: 7 });
  });

  it('ignores other output', () => {
    expect(parsePhaseNotice('NOTICE:  table "x" does not exist, skipping', 1)).toBeNull();
    expect(parsePhaseNotice('ERROR:  phase: copy start', 1)).toBeNull();
    expect(parsePhaseNotice('phase: copy start', 1)).toBeNull();
    expect(parsePhaseNotice('', 1)).toBeNull();
  });

  it('pairs start and end into timed phases and lists marks in order', () => {
    const markers = [
      { name: 'copy', event: 'start', atMs: 100 },
      { name: 'indexes', event: 'start', atMs: 4100 },
      { name: 'copy', event: 'end', atMs: 4000 },
      { name: 'indexes', event: 'end', atMs: 9100 },
      { name: 'swap', event: 'mark', atMs: 9200 },
    ];
    const s = summarisePhases(markers, 9500);
    expect(s.phases).toEqual([
      { name: 'copy', startMs: 100, endMs: 4000, durationMs: 3900, complete: true },
      { name: 'indexes', startMs: 4100, endMs: 9100, durationMs: 5000, complete: true },
    ]);
    expect(s.marks).toEqual([{ name: 'swap', atMs: 9200, sincePreviousMs: 100 }]);
    expect(s.warnings).toEqual([]);
  });

  it('closes a phase that never ended at the total and warns; warns about an end without a start', () => {
    const s = summarisePhases([{ name: 'copy', event: 'start', atMs: 100 }, { name: 'orphan', event: 'end', atMs: 200 }], 1000);
    expect(s.phases).toEqual([{ name: 'copy', startMs: 100, endMs: 1000, durationMs: 900, complete: false }]);
    expect(s.warnings.join(' ')).toMatch(/copy.*never ended/);
    expect(s.warnings.join(' ')).toMatch(/orphan.*without a start/);
  });

  it('reports no phases when the migration printed none', () => {
    expect(summarisePhases([], 1000)).toEqual({ phases: [], marks: [], warnings: [] });
  });

  it('pairs repeated phases of the same name in order', () => {
    const s = summarisePhases([
      { name: 'batch', event: 'start', atMs: 0 }, { name: 'batch', event: 'end', atMs: 10 },
      { name: 'batch', event: 'start', atMs: 20 }, { name: 'batch', event: 'end', atMs: 50 },
    ], 60);
    expect(s.phases.map((p) => p.durationMs)).toEqual([10, 30]);
  });
});

describe('checkDiskSpace', () => {
  it('requires at least twice the source size free', () => {
    expect(checkDiskSpace({ sourceBytes: 100, freeBytes: 200 })).toMatchObject({ ok: true, requiredBytes: 200 });
    const bad = checkDiskSpace({ sourceBytes: 100, freeBytes: 199 });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/twice/);
    expect(bad.message).toContain(formatBytes(199));
  });

  it('refuses when the figures are unusable instead of passing', () => {
    expect(checkDiskSpace({ sourceBytes: 100, freeBytes: NaN }).ok).toBe(false);
    expect(checkDiskSpace({ sourceBytes: 0, freeBytes: 1e12 }).ok).toBe(false);
  });
});

describe('summariseProbe', () => {
  it('finds the longest wait, where it began, and the percentiles', () => {
    const samples = [
      { atMs: 0, waitMs: 2 }, { atMs: 250, waitMs: 3 }, { atMs: 500, waitMs: 1900 }, { atMs: 2500, waitMs: 4 }, { atMs: 2750, waitMs: 2 },
    ];
    expect(summariseProbe(samples)).toEqual({ count: 5, errors: 0, maxMs: 1900, maxAtMs: 500, p50Ms: 3, p95Ms: 1900, over1sCount: 1 });
  });

  it('counts failed probes apart from waits', () => {
    const s = summariseProbe([{ atMs: 0, waitMs: 2 }, { atMs: 1, waitMs: 3, error: true }]);
    expect(s).toMatchObject({ count: 1, errors: 1, maxMs: 2 });
  });

  it('is empty-safe', () => {
    expect(summariseProbe([])).toEqual({ count: 0, errors: 0, maxMs: null, maxAtMs: null, p50Ms: null, p95Ms: null, over1sCount: 0 });
  });
});

describe('summarisePeak', () => {
  it('takes the peak database size, the peak WAL, the lowest free space and the largest combined figure', () => {
    const p = summarisePeak([
      { atMs: 0, databaseBytes: 100, walBytes: 10, freeBytes: 1000 },
      { atMs: 3000, databaseBytes: 250, walBytes: 50, freeBytes: 700 },
      { atMs: 6000, databaseBytes: 180, walBytes: 400, freeBytes: 300 },
    ]);
    expect(p).toEqual({ samples: 3, peakDatabaseBytes: 250, peakDatabaseAtMs: 3000, startWalBytes: 10, peakWalBytes: 400, peakCombinedBytes: 580, minFreeBytes: 300 });
  });

  it('tolerates samples without WAL or free-space figures', () => {
    const p = summarisePeak([{ atMs: 0, databaseBytes: 100 }, { atMs: 1, databaseBytes: 120, walBytes: null, freeBytes: null }]);
    expect(p).toMatchObject({ peakDatabaseBytes: 120, startWalBytes: null, peakWalBytes: null, minFreeBytes: null });
  });

  it('is empty-safe', () => {
    expect(summarisePeak([])).toMatchObject({ samples: 0, peakDatabaseBytes: null });
  });
});

describe('sanitiseErrors', () => {
  it('keeps only ERROR lines, drops DETAIL, CONTEXT and statements, and caps their length', () => {
    const stderr = [
      'psql:<stdin>:12: ERROR:  duplicate key value violates unique constraint "x"',
      'DETAIL:  Key (document_id, chunk_hash)=(abc, def) already exists.',
      'CONTEXT:  SQL statement "insert into t select content from document_chunks"',
      'psql:<stdin>:13: ERROR:  ' + 'x'.repeat(1000),
      'NOTICE:  phase: copy start',
    ].join('\n');
    const lines = sanitiseErrors(stderr);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/duplicate key/);
    expect(lines.join('\n')).not.toMatch(/DETAIL|CONTEXT|insert into|Key \(/);
    expect(lines[1].length).toBeLessThanOrEqual(300);
  });

  it('returns nothing for clean output', () => {
    expect(sanitiseErrors('NOTICE:  phase: copy start\n')).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats bytes and durations for people', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(5197 * 1024 * 1024)).toBe('5.08 GiB');
    expect(formatBytes(null)).toBe('n/a');
    expect(formatMs(450)).toBe('450 ms');
    expect(formatMs(12_345)).toBe('12.3 s');
    expect(formatMs(125_000)).toBe('2 min 5 s');
    expect(formatMs(null)).toBe('n/a');
  });
});

describe('renderRehearsalReport', () => {
  const result = {
    ranAt: '2026-11-01T15:30:12.000Z',
    migration: { file: '20261101120000_x.sql', sha256: 'abc123', bytes: 4096 },
    source: { database: REPLICA_DATABASE, sizeBytes: 5 * 1024 ** 3 },
    target: { database: 'niyantran_rehearsal_x', kept: false },
    disk: { freeBytes: 900 * 1024 ** 3, requiredBytes: 10 * 1024 ** 3 },
    copy: { ms: 40_000 },
    migrationRun: { ok: true, ms: 95_000, error: [] },
    phases: { phases: [{ name: 'copy', startMs: 0, endMs: 60_000, durationMs: 60_000, complete: true }], marks: [{ name: 'swap', atMs: 90_000, sincePreviousMs: 30_000 }], warnings: [] },
    sizes: {
      before: { databaseBytes: 5 * 1024 ** 3, relations: [{ name: 'document_chunks', kind: 'r', totalBytes: 5000, tableBytes: 400, indexBytes: 4600 }] },
      after: { databaseBytes: 10 * 1024 ** 3, relations: [{ name: 'document_chunks', kind: 'p', totalBytes: 0, tableBytes: 0, indexBytes: 0 }] },
      peak: { samples: 30, peakDatabaseBytes: 11 * 1024 ** 3, peakDatabaseAtMs: 80_000, startWalBytes: 1024 ** 3, peakWalBytes: 2 * 1024 ** 3, peakCombinedBytes: 12 * 1024 ** 3, minFreeBytes: 800 * 1024 ** 3 },
    },
    rowCounts: { before: { documents: 10, document_chunks: 100 }, after: { documents: 10, document_chunks: 100 }, equal: true },
    readerProbe: { count: 400, errors: 0, maxMs: 2100, maxAtMs: 88_000, p50Ms: 3, p95Ms: 6, over1sCount: 1 },
    analyze: { ms: 3000 },
  };

  it('states the databases, the migration, the timings, the peak and the longest reader wait', () => {
    const md = renderRehearsalReport(result);
    expect(md).toContain(REPLICA_DATABASE);
    expect(md).toContain('niyantran_rehearsal_x');
    expect(md).toContain('20261101120000_x.sql');
    expect(md).toContain('abc123');
    expect(md).toMatch(/Migration: ok, 1 min 35 s/);
    expect(md).toMatch(/copy.*1 min 0 s|copy.*60\.0 s|copy.*1 min/);
    expect(md).toMatch(/swap/);
    expect(md).toMatch(/Peak database size: 11\.00 GiB/);
    expect(md).toMatch(/Longest reader wait: 2\.1 s/);
    expect(md).toMatch(/Disk used at the worst point: 100\.00 GiB/); // 900 GiB free before the copy, 800 GiB at the lowest
    expect(md).toMatch(/growth over the start: 6\.00 GiB/); // 11 GiB peak, 5 GiB before
    expect(md).toMatch(/Tables \(heap and indexes\) before 4\.9 KiB, after 0 B/);
    expect(md).toMatch(/Row counts: equal/);
    expect(md).toMatch(/dropped/);
  });

  it('shows a failed migration and a count mismatch plainly', () => {
    const md = renderRehearsalReport({
      ...result,
      migrationRun: { ok: false, ms: 1000, error: ['ERROR:  boom'] },
      rowCounts: { ...result.rowCounts, equal: false, after: { documents: 10, document_chunks: 99 } },
      target: { database: 'niyantran_rehearsal_x', kept: true },
    });
    expect(md).toMatch(/Migration: FAILED/);
    expect(md).toContain('ERROR:  boom');
    expect(md).toMatch(/Row counts: DIFFER/);
    expect(md).toMatch(/kept/);
  });
});
