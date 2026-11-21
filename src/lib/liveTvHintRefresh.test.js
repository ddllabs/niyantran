// F381: the maintainer script that refreshes the live-video hints. Offline: the lookup is injected.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { YOUTUBE_SOURCES } from '../../server/liveTvApi.mjs';
import { applyHintUpdates, main, planHintRefresh } from '../../scripts/refresh-livetv-hints.mjs';

const NEW1 = 'NEWVIDEO001';
const a = { id: 'a', liveHintVideoId: 'OLDVIDEO001' };
const b = { id: 'b', liveHintVideoId: 'OLDVIDEO002' };
const c = { id: 'c', liveHintVideoId: 'OLDVIDEO003' };
const d = { id: 'd', liveHintVideoId: 'OLDVIDEO004' };
const e = { id: 'e', liveHintVideoId: 'OLDVIDEO005' };
const nohint = { id: 'f' };
const live = (videoId, embeddable = true) => ({ ok: true, dataOrigin: 'youtube-api', liveVideo: { videoId, embeddable } });

describe('planHintRefresh', () => {
  it('sorts each channel and skips channels without a hint', async () => {
    const answers = {
      a: live(NEW1),
      b: live('OLDVIDEO002'),
      c: { ok: true, dataOrigin: 'youtube-api', liveVideo: null },
      d: { ok: true, dataOrigin: 'fallback', reason: 'quota', liveVideo: null },
      e: live('NEWVIDEO002', false),
    };
    const lookup = vi.fn(async (ch) => answers[ch.id]);
    const out = await planHintRefresh([a, b, c, d, e, nohint], lookup);
    expect(lookup).toHaveBeenCalledTimes(5);
    expect(out.map((r) => [r.id, r.status])).toEqual([['a', 'changed'], ['b', 'same'], ['c', 'not-live'], ['d', 'unknown'], ['e', 'not-embeddable']]);
    expect(out[0].next).toBe(NEW1);
  });
  it('keeps the hint when the lookup throws', async () => {
    const out = await planHintRefresh([a], async () => { throw Object.assign(new Error('boom'), { kind: 'timeout' }); });
    expect(out[0]).toMatchObject({ status: 'unknown', detail: 'timeout' });
  });
});

describe('applyHintUpdates', () => {
  const src = "  { id: 'a', name: 'A', liveHintVideoId: 'OLDVIDEO001' },\n  { id: 'b', name: 'B', liveHintVideoId: 'OLDVIDEO002' },\n";
  it('replaces only the changed channel', () => {
    const out = applyHintUpdates(src, [{ id: 'a', old: 'OLDVIDEO001', next: NEW1, status: 'changed' }, { id: 'b', old: 'OLDVIDEO002', next: 'XXXXXXXXXXX', status: 'same' }]);
    expect(out).toContain(`{ id: 'a', name: 'A', liveHintVideoId: '${NEW1}' }`);
    expect(out).toContain("liveHintVideoId: 'OLDVIDEO002'");
  });
  it('refuses when the channel line is missing', () => {
    expect(() => applyHintUpdates(src, [{ id: 'zz', old: 'OLDVIDEO001', next: NEW1, status: 'changed' }])).toThrow(/expected one line/);
  });
});

describe('main', () => {
  const real = YOUTUBE_SOURCES.find((x) => x.liveHintVideoId);
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hints-'));
    const file = join(dir, 'channels.mjs');
    writeFileSync(file, `  { id: '${real.id}', liveHintVideoId: '${real.liveHintVideoId}' },\n`);
    return file;
  };
  const lookup = async () => live(NEW1);
  it('does nothing without a key and without an injected lookup', async () => {
    const log = vi.fn();
    expect(await main({ argv: [], env: {}, log })).toBe(1);
  });
  it('dry run writes nothing', async () => {
    const file = setup();
    const log = vi.fn();
    await main({ argv: ['--only', real.id], env: {}, lookup, log, file });
    expect(readFileSync(file, 'utf8')).toContain(real.liveHintVideoId);
    expect(log.mock.calls.flat().join('\n')).toContain('Dry run');
  });
  it('--write rewrites the hint', async () => {
    const file = setup();
    await main({ argv: ['--write', '--only', real.id], env: {}, lookup, log: vi.fn(), file });
    expect(readFileSync(file, 'utf8')).toContain(`liveHintVideoId: '${NEW1}'`);
  });
  it('never prints the key', async () => {
    const log = vi.fn();
    await main({ argv: ['--only', real.id], env: { YOUTUBE_API_KEY: 'SECRETKEY123' }, lookup, log, file: setup() });
    expect(log.mock.calls.flat().join('\n')).not.toContain('SECRETKEY123');
  });
});

describe('main, a hint that lives outside the channel file', () => {
  it('reports it as kept and writes nothing, without throwing', async () => {
    const original = YOUTUBE_SOURCES.find((x) => x.id === 'ndtv-24x7');
    expect(original.liveHintVideoId).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'hints-'));
    const file = join(dir, 'channels.mjs');
    const text = "  { id: 'other', liveHintVideoId: 'OLDVIDEO009' },\n";
    writeFileSync(file, text);
    const log = vi.fn();
    expect(await main({ argv: ['--write', '--only', 'ndtv-24x7'], env: {}, lookup: async () => live(NEW1), log, file })).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(text);
    const out = log.mock.calls.flat().join('\n');
    expect(out).toContain('kept: hint lives in liveTvApi.mjs');
    expect(out).toContain('Nothing to write');
  });
});
