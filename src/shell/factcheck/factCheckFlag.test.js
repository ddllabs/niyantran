// F344 T6: the client reads the public app_flags row to decide what to show. The server enforces
// the same rules again; a wrong answer here can only show or hide a button.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {} }));
import { clearFactCheckFlagCache, parseFactCheckFlag, readFactCheckFlag } from './factCheckFlag.js';

const ON = { enabled: true, audience: 'all', credits_per_minute: 500 };

function fakeClient(opts = {}) {
  const { user = { id: 'u1' }, row = { value: ON }, rowError = null, adminError = null } = opts;
  const admin = 'admin' in opts ? opts.admin : true;
  const calls = { select: 0, rpc: [] };
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }) },
    from(table) {
      expect(table).toBe('app_flags');
      return {
        select: () => ({
          eq: (col, key) => {
            expect([col, key]).toEqual(['key', 'livetv_factcheck']);
            return { maybeSingle: async () => { calls.select++; return { data: row, error: rowError }; } };
          },
        }),
      };
    },
    rpc: async (name) => { calls.rpc.push(name); return { data: admin, error: adminError }; },
  };
}

beforeEach(() => clearFactCheckFlagCache());

describe('parseFactCheckFlag', () => {
  it('accepts the documented shape', () => {
    expect(parseFactCheckFlag(ON)).toEqual({ audience: 'all', creditsPerMinute: 500, recheckCredits: null, sharing: null });
    expect(parseFactCheckFlag({ ...ON, audience: 'admin', credits_per_minute: 0.5 })).toEqual({ audience: 'admin', creditsPerMinute: 0.5, recheckCredits: null, sharing: null });
    expect(parseFactCheckFlag({ ...ON, credits_per_minute: 5000 })).toEqual({ audience: 'all', creditsPerMinute: 5000, recheckCredits: null, sharing: null });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'on'],
    ['an array', [ON]],
    ['enabled false', { ...ON, enabled: false }],
    ['enabled the string "true"', { ...ON, enabled: 'true' }],
    ['enabled 1', { ...ON, enabled: 1 }],
    ['enabled missing', { audience: 'all', credits_per_minute: 500 }],
    ['audience staff', { ...ON, audience: 'staff' }],
    ['audience missing', { enabled: true, credits_per_minute: 500 }],
    ['audience Admin (case)', { ...ON, audience: 'Admin' }],
    ['price zero', { ...ON, credits_per_minute: 0 }],
    ['price negative', { ...ON, credits_per_minute: -1 }],
    ['price above 5000', { ...ON, credits_per_minute: 5000.01 }],
    ['price a string', { ...ON, credits_per_minute: '500' }],
    ['price NaN', { ...ON, credits_per_minute: Number.NaN }],
    ['price missing', { enabled: true, audience: 'all' }],
  ])('is off for %s', (_name, value) => {
    expect(parseFactCheckFlag(value)).toBeNull();
  });
});

describe('recheck_credits', () => {
  it.each([
    [100, 100], [0.5, 0.5], [1000, 1000], [1, 1],
    [0, null], [-5, null], [1000.01, null], ['100', null], [null, null], [undefined, null], [Number.NaN, null], [Infinity, null], [true, null],
  ])('%j gives %j', (value, expected) => {
    expect(parseFactCheckFlag({ ...ON, recheck_credits: value }).recheckCredits).toBe(expected);
  });
  it('a price that rounds to zero at four decimals is no price', () => {
    expect(parseFactCheckFlag({ ...ON, recheck_credits: 0.00004 }).recheckCredits).toBeNull();
    expect(parseFactCheckFlag({ ...ON, recheck_credits: 0.0001 }).recheckCredits).toBe(0.0001);
    expect(parseFactCheckFlag({ ...ON, credits_per_minute: 0.00004 })).toBeNull();
    expect(parseFactCheckFlag({ ...ON, credits_per_minute: 0.0001 })).toMatchObject({ creditsPerMinute: 0.0001 });
  });
  it('does not change availability when the price is absent or bad', () => {
    expect(parseFactCheckFlag({ ...ON, recheck_credits: 'x' })).toMatchObject({ audience: 'all', creditsPerMinute: 500 });
  });
  it('a bad session price is still off whatever the re-check price', () => {
    expect(parseFactCheckFlag({ ...ON, credits_per_minute: 0, recheck_credits: 100 })).toBeNull();
  });
  it('the reader returns it, and null when off', async () => {
    const on = fakeClient({ row: { value: { ...ON, recheck_credits: 100 } } });
    expect(await readFactCheckFlag({ client: on })).toEqual({ available: true, creditsPerMinute: 500, recheckCredits: 100, sharing: null, userId: 'u1' });
    clearFactCheckFlagCache();
    const off = fakeClient({ row: { value: { ...ON, enabled: false, recheck_credits: 100 } } });
    expect((await readFactCheckFlag({ client: off })).recheckCredits).toBeNull();
  });
});

describe('sharing keys', () => {
  const SH = { ...ON, share_recorded: true, unlock_credits_per_minute: 100 };
  it('is on only when share_recorded is exactly true and the unlock price is in (0, 1000]', () => {
    expect(parseFactCheckFlag(SH).sharing).toEqual({ unlockCreditsPerMinute: 100 });
    expect(parseFactCheckFlag({ ...SH, unlock_credits_per_minute: 1000 }).sharing).toEqual({ unlockCreditsPerMinute: 1000 });
    expect(parseFactCheckFlag({ ...SH, unlock_credits_per_minute: 0.5 }).sharing).toEqual({ unlockCreditsPerMinute: 0.5 });
  });
  it.each([
    ['share_recorded false', { share_recorded: false }],
    ['share_recorded "true"', { share_recorded: 'true' }],
    ['share_recorded 1', { share_recorded: 1 }],
    ['share_recorded missing', { share_recorded: undefined }],
    ['price 0', { unlock_credits_per_minute: 0 }],
    ['price negative', { unlock_credits_per_minute: -1 }],
    ['price above 1000', { unlock_credits_per_minute: 1000.5 }],
    ['price a string', { unlock_credits_per_minute: '100' }],
    ['price NaN', { unlock_credits_per_minute: Number.NaN }],
    ['price rounds to zero', { unlock_credits_per_minute: 0.00004 }],
    ['price missing', { unlock_credits_per_minute: undefined }],
  ])('is off for %s, and nothing else changes', (_n, over) => {
    const out = parseFactCheckFlag({ ...SH, ...over });
    expect(out.sharing).toBeNull();
    expect(out).toMatchObject({ audience: 'all', creditsPerMinute: 500 });
  });
  it('is never on when the feature itself is off', () => {
    expect(parseFactCheckFlag({ ...SH, enabled: false })).toBeNull();
  });
  it('the reader returns it, and null when off', async () => {
    expect((await readFactCheckFlag({ client: fakeClient({ row: { value: SH } }) })).sharing).toEqual({ unlockCreditsPerMinute: 100 });
    clearFactCheckFlagCache();
    expect((await readFactCheckFlag({ client: fakeClient({ row: { value: { ...SH, enabled: false } } }) })).sharing).toBeNull();
  });
});

describe('readFactCheckFlag', () => {
  it('is available to any signed-in account when the audience is all', async () => {
    const client = fakeClient();
    expect(await readFactCheckFlag({ client })).toEqual({ available: true, creditsPerMinute: 500, recheckCredits: null, sharing: null, userId: 'u1' });
    expect(client.calls.rpc).toEqual([]);
  });

  it('with audience admin, asks is_platform_admin and follows the answer', async () => {
    const yes = fakeClient({ row: { value: { ...ON, audience: 'admin' } }, admin: true });
    expect(await readFactCheckFlag({ client: yes })).toEqual({ available: true, creditsPerMinute: 500, recheckCredits: null, sharing: null, userId: 'u1' });
    expect(yes.calls.rpc).toEqual(['is_platform_admin']);
    clearFactCheckFlagCache();
    const no = fakeClient({ row: { value: { ...ON, audience: 'admin' } }, admin: false });
    expect((await readFactCheckFlag({ client: no })).available).toBe(false);
  });

  it.each([
    ['null', null], ['"true"', 'true'], [1, 1], [undefined, undefined],
  ])('admin check must return exactly true (%s is off)', async (_n, answer) => {
    const client = fakeClient({ row: { value: { ...ON, audience: 'admin' } }, admin: answer });
    expect((await readFactCheckFlag({ client })).available).toBe(false);
  });

  it('is off when the admin check errors', async () => {
    const client = fakeClient({ row: { value: { ...ON, audience: 'admin' } }, admin: true, adminError: { message: 'x' } });
    expect((await readFactCheckFlag({ client })).available).toBe(false);
  });

  it('is off when signed out, without reading the table', async () => {
    const client = fakeClient({ user: null });
    expect(await readFactCheckFlag({ client })).toEqual({ available: false, creditsPerMinute: null, recheckCredits: null, sharing: null, userId: null });
    expect(client.calls.select).toBe(0);
  });

  it('is off when there is no row, a malformed row or a read error', async () => {
    for (const client of [
      fakeClient({ row: null }),
      fakeClient({ row: { value: { enabled: 'yes' } } }),
      fakeClient({ row: null, rowError: { message: 'boom' } }),
      fakeClient({ row: { value: ON }, rowError: { message: 'boom' } }),
    ]) {
      clearFactCheckFlagCache();
      expect((await readFactCheckFlag({ client })).available).toBe(false);
    }
  });

  it('is off when the client throws', async () => {
    const client = { auth: { getSession: async () => { throw new Error('offline'); } } };
    expect((await readFactCheckFlag({ client })).available).toBe(false);
    const client2 = fakeClient();
    client2.from = () => { throw new Error('offline'); };
    clearFactCheckFlagCache();
    expect((await readFactCheckFlag({ client: client2 })).available).toBe(false);
  });

  it('reads once and caches briefly per account; does not cache failures', async () => {
    let t = 1000;
    const client = fakeClient();
    await readFactCheckFlag({ client, now: () => t });
    await readFactCheckFlag({ client, now: () => t + 5000 });
    expect(client.calls.select).toBe(1);
    await readFactCheckFlag({ client, now: () => t + 60001 });
    expect(client.calls.select).toBe(2);

    clearFactCheckFlagCache();
    const failing = fakeClient({ rowError: { message: 'x' } });
    await readFactCheckFlag({ client: failing, now: () => t });
    await readFactCheckFlag({ client: failing, now: () => t + 1 });
    expect(failing.calls.select).toBe(2);
  });

  it('fresh: true bypasses the cache and refreshes it', async () => {
    const client = fakeClient();
    await readFactCheckFlag({ client });
    await readFactCheckFlag({ client, fresh: true });
    expect(client.calls.select).toBe(2);
    await readFactCheckFlag({ client });
    expect(client.calls.select).toBe(2);
  });

  it('does not share the cache between accounts', async () => {
    const a = fakeClient({ user: { id: 'a' } });
    const b = fakeClient({ user: { id: 'b' } });
    await readFactCheckFlag({ client: a });
    expect((await readFactCheckFlag({ client: b })).userId).toBe('b');
    expect(b.calls.select).toBe(1);
  });
});
