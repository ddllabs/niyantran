// The desk card's brief flow is the website's: read first (never writes), write only when nothing is
// stored, poll while another reader's write is pending, and show nothing but the NTER animation
// until it has played for 2.5 s.
import { act, render } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = [];
let answers = [];
vi.mock('../services/index.js', () => ({
  isSample: false,
  api: {
    recordBrief: vi.fn(async ({ generate }) => {
      calls.push(generate ? 'write' : 'read');
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  },
}));

const { useDeskBrief, readyBrief, clearDeskBriefCache, RECORD_BRIEF_ANIMATION_MS } = await import('./useDeskBrief.js');
const { recordPayloadRow } = await import('../services/live.js');

const module = { feature: 'Bill Passage Probability Index', tier: 'national' };
const READY = { ok: true, state: 'ready', format: 2, brief: 'Lead.', why: 'Why.', watch: '', tags: ['a'], writtenAt: '2026-10-26T10:00:00Z' };

function Probe({ row, signedIn = true, onState }) {
  onState(useDeskBrief({ module, row, signedIn }));
  return null;
}

async function run(row, { signedIn = true, ms = RECORD_BRIEF_ANIMATION_MS + 50 } = {}) {
  const states = [];
  render(<Probe row={row} signedIn={signedIn} onState={(s) => states.push(s.state)} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  return states;
}

beforeEach(() => { vi.useFakeTimers(); calls.length = 0; answers = []; clearDeskBriefCache(); });
afterEach(() => vi.useRealTimers());

describe('useDeskBrief', () => {
  it('reads a stored brief and shows it only after the animation', async () => {
    answers = [READY];
    const states = await run({ id: 1, title: 'A' }, { ms: 1000 });
    expect(calls).toEqual(['read']);
    expect(states.at(-1)).toBe('loading');
    await act(async () => { await vi.advanceTimersByTimeAsync(RECORD_BRIEF_ANIMATION_MS); });
    expect(states.at(-1)).toBe('ready');
  });

  it('writes when nothing is stored, saying so while it writes', async () => {
    answers = [{ ok: true, state: 'missing' }, READY];
    const states = await run({ id: 2, title: 'B' }, { ms: 20 });
    expect(calls).toEqual(['read', 'write']);
    expect(states.at(-1)).toBe('writing');
    // A brief written faster than the animation waits for it to finish.
    await act(async () => { await vi.advanceTimersByTimeAsync(RECORD_BRIEF_ANIMATION_MS); });
    expect(states.at(-1)).toBe('ready');
  });

  it('polls every two seconds while another request writes it', async () => {
    answers = [{ ok: true, state: 'pending' }, { ok: true, state: 'pending' }, READY];
    const states = await run({ id: 3, title: 'C' }, { ms: 6000 });
    expect(calls).toEqual(['read', 'read', 'read']);
    expect(states.at(-1)).toBe('ready');
  });

  it('plays the animation for a signed-out reader, then offers sign-in without asking the server', async () => {
    const states = await run({ id: 4, title: 'D' }, { signedIn: false });
    expect(calls).toEqual([]);
    expect(states[0]).toBe('loading');
    expect(states.at(-1)).toBe('guest');
  });

  it('says the brief is unavailable on 401 and on an error', async () => {
    answers = [Object.assign(new Error('no'), { status: 401 })];
    expect((await run({ id: 5, title: 'E' })).at(-1)).toBe('unavailable');
    answers = [Object.assign(new Error('boom'), { status: 500 })];
    expect((await run({ id: 6, title: 'F' })).at(-1)).toBe('error');
  });

  it('does not ask again for a brief seen this session', async () => {
    answers = [READY];
    await run({ id: 7, title: 'G' });
    await run({ id: 7, title: 'G' });
    expect(calls).toEqual(['read']);
  });
});

describe('readyBrief (the website rules)', () => {
  it('accepts format 2 with a brief and why, and format 1 with a headline and points', () => {
    expect(readyBrief(READY).state).toBe('ready');
    expect(readyBrief({ format: 2, brief: 'x' }).state).toBe('error');
    expect(readyBrief({ format: 1, headline: 'H', points: ['p'] })).toMatchObject({ state: 'ready', format: 1 });
    expect(readyBrief({ points: [] }).state).toBe('error');
  });
});

describe('the record sent for a brief', () => {
  it('is the whole row when it fits, as on the website, so both read the same stored brief', () => {
    const row = { id: 9, title: 'A bill', n: 3, nested: { a: 1 } };
    expect(recordPayloadRow(row)).toBe(row);
  });
  it('is the slimmed entry for a very large row', () => {
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, 'x'.repeat(1000)]));
    const slim = recordPayloadRow({ __private: 1, backup_x: 2, ...big });
    expect(Object.keys(slim)).toHaveLength(40);
    expect(slim.f0).toHaveLength(220);
    expect(slim).not.toHaveProperty('__private');
  });
});

describe('files copied from the website', () => {
  it('still match what was synced (edit the website, then run scripts/sync-website-record.mjs)', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src/shell/website-sync.json'), 'utf8'));
    expect(Object.keys(manifest.files).length).toBeGreaterThan(50);
    for (const [file, hash] of Object.entries(manifest.files)) {
      expect({ file, hash: createHash('sha256').update(readFileSync(join(process.cwd(), file))).digest('hex') }).toEqual({ file, hash });
    }
  });
});
