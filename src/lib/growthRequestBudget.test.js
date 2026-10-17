import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERIES = ['NY.GDP.MKTP.KD.ZG', 'FP.CPI.TOTL.ZG', 'SL.UEM.TOTL.ZS'];
const body = (id) => [{ pages: 1, total: 2 }, [
  { country: { value: 'India' }, value: id === SERIES[0] ? 7 : 4, date: '2024' },
  { country: { value: 'France' }, value: id === SERIES[0] ? 1 : null, date: '2024' },
]];
let loadGrowth, refreshDue, records, calls, active, maxActive, warn, info;

function network(scenario = () => ({})) {
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const id = String(input).split('/indicator/')[1]?.split('?')[0] || 'holder';
    const attempt = calls.filter(c => c.id === id).length + 1;
    calls.push({ id, attempt, at: Date.now() });
    active++; maxActive = Math.max(maxActive, active);
    try {
      const plan = scenario(id, attempt);
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(init.signal.reason || new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { init.signal?.removeEventListener('abort', abort); resolve(); }, plan.stall ? 100_000 : plan.ms ?? 10);
        if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
      });
      if (plan.transport) throw new TypeError('untrusted transport URL and raw detail');
      if (plan.bodyStall || plan.bodyFailure) return new Response(new ReadableStream({
        start(controller) {
          const timer = setTimeout(() => {
            init.signal?.removeEventListener('abort', abort);
            controller.error(new TypeError('untrusted body transport detail'));
          }, plan.bodyStall ? 100_000 : 10);
          const abort = () => { clearTimeout(timer); controller.error(new TypeError('body aborted')); };
          init.signal?.addEventListener('abort', abort, { once: true });
        },
      }));
      return new Response(plan.invalid ? '{bad json' : JSON.stringify(plan.shape ?? body(id)), { status: plan.http ?? 200 });
    } finally { active--; }
  }));
}

async function run(scenario, holders = 0) {
  network(scenario);
  const queue = Array.from({ length: holders }, (_, i) => ({ tier: 'geopolitics', feature: `holder-${i}`, variant: '', kind: 'reference' }));
  queue.push({ tier: 'geopolitics', feature: 'Growth Indicators', variant: '', kind: 'reference' });
  const rpc = async (name, args) => {
    if (name === 'feed_claim_due') return queue.splice(0, args.p_limit).map(c => ({ ...c, lease_token: 'test-only' }));
    if (name === 'feed_record') { records.push(args.p); return { status: args.p.status, items: args.p.items?.length || 0 }; }
    throw new Error('unexpected RPC');
  };
  const promise = refreshDue({ rpc, concurrency: holders + 1, runs: [], load: async params => {
    if (params.get('feature').startsWith('holder')) {
      await fetch('https://api.worldbank.org/holder');
      return { ok: true, rows: [{ title: 'holder' }], source: { adapter: 'live' } };
    }
    return { ...(await loadGrowth()), source: { adapter: 'live' } };
  } });
  await vi.advanceTimersByTimeAsync(55_000);
  await promise;
  return records.find(r => r.feature === 'Growth Indicators');
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
  ({ loadGrowth } = await import('../../server/resourcesApi.mjs'));
  ({ refreshDue } = await import('../../server/feedStore.mjs'));
  records = []; calls = []; active = 0; maxActive = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Growth request budgets through the actual refresh host gate', () => {
  it('preserves healthy rows, missing values, country ordering and source links', async () => {
    const record = await run(() => ({}));
    expect(record.status).toBe('ok');
    expect(record.items.map(i => i.row)).toEqual([
      { title: 'India', country: 'India', year: '2024', gdp_growth: '7.0', inflation: '4.0', unemployment: '4.0', source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG' },
      { title: 'France', country: 'France', year: '2024', gdp_growth: '1.0', inflation: '—', unemployment: '—', source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG' },
    ]);
    expect(maxActive).toBe(1);
    expect(info).toHaveBeenCalledTimes(3);
  });

  it.each(SERIES)('recovers a stalled %s attempt before the worker limit', async stalled => {
    const record = await run((id, attempt) => ({ stall: id === stalled && attempt === 1 }));
    expect(record.status).toBe('ok');
    expect(record.ms).toBeLessThan(20_000);
    expect(calls.filter(c => c.id === stalled)).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith('[growth-source]', expect.objectContaining({ series: stalled, attempt: 1, code: 'timeout' }));
  });

  it('stops after two stalled attempts and never submits partial or empty replacement rows', async () => {
    const record = await run(() => ({ stall: true }));
    expect(record.status).toBe('failed');
    expect(record.ms).toBeLessThan(18_100);
    expect(record.items).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(active).toBe(0);
  });

  it('clips cumulative slow retries to 18 seconds, keeping the previous store', async () => {
    const record = await run((_id, attempt) => ({ ms: 5000, http: attempt === 1 ? 503 : 200 }));
    expect(record.status).toBe('failed');
    expect(record.ms).toBeLessThan(18_100);
    expect(record.items).toBeUndefined();
    expect(calls.some(c => c.id === SERIES[2])).toBe(false);
    expect(warn.mock.calls.some(([, data]) => data.code === 'budget')).toBe(true);
  });

  it.each([500, 502, 503, 504])('retries HTTP %s once within the shared budget', async http => {
    const record = await run((id, attempt) => ({ http: id === SERIES[1] && attempt === 1 ? http : 200 }));
    expect(record.status).toBe('ok');
    expect(calls.filter(c => c.id === SERIES[1])).toHaveLength(2);
  });

  it.each([400, 403, 404, 429, 501])('does not retry permanent/refused HTTP %s', async http => {
    const record = await run(() => ({ http }));
    expect(record.status).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(record.items).toBeUndefined();
  });

  it.each([{ invalid: true }, { shape: [{ message: 'untrusted payload' }] }, { shape: [{ pages: 2, total: 40 }, []] }])('refuses invalid responses without retry: %j', async plan => {
    const record = await run(() => plan);
    expect(record.status).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('[growth-source]', expect.objectContaining({ code: 'invalid' }));
  });

  it.each(['bodyStall', 'bodyFailure'])('bounds body download and recovers %s before submitting complete rows', async failure => {
    const record = await run((id, attempt) => ({ [failure]: id === SERIES[1] && attempt === 1 }));
    expect(record.status).toBe('ok');
    expect(record.ms).toBeLessThan(20_000);
    expect(calls.filter(c => c.id === SERIES[1])).toHaveLength(2);
  });

  it('uses the same bounded retry outside refresh and caches only a complete result', async () => {
    network((id, attempt) => ({ http: id === SERIES[1] && attempt === 1 ? 503 : 200 }));
    const promise = loadGrowth().then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(18_000);
    const result = await promise;
    expect(result.error).toBeUndefined();
    const first = result.value;
    expect(first.rows).toHaveLength(2);
    expect(calls.filter(c => c.id === SERIES[1])).toHaveLength(2);
    expect(maxActive).toBe(1);
    const total = calls.length;
    expect(await loadGrowth()).toBe(first);
    expect(calls).toHaveLength(total);
  });

  it('cancels a refused HTTP response body before retrying outside the gate', async () => {
    const cancelled = vi.fn();
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async input => {
      if (first) {
        first = false;
        return new Response(new ReadableStream({ cancel: cancelled }), { status: 503 });
      }
      const id = String(input).split('/indicator/')[1].split('?')[0];
      return new Response(JSON.stringify(body(id)));
    }));
    const promise = loadGrowth();
    await vi.advanceTimersByTimeAsync(18_000);
    expect((await promise).rows).toHaveLength(2);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('does not retry a host already closed by another module', async () => {
    const record = await run(id => ({ http: id === 'holder' ? 429 : 200 }), 1);
    expect(record.status).toBe('failed');
    expect(calls.filter(c => SERIES.includes(c.id))).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[growth-source]', expect.objectContaining({ code: 'http', httpStatus: 429 }));
  });

  it('retries a transport error without exposing raw diagnostics', async () => {
    const record = await run((id, attempt) => ({ transport: id === SERIES[0] && attempt === 1 }));
    expect(record.status).toBe('ok');
    expect(JSON.stringify([...warn.mock.calls, ...info.mock.calls])).not.toMatch(/untrusted|URL|raw detail|https:/);
  });

  it('excludes 38 seconds queued behind two other modules from the request budget', async () => {
    const record = await run(id => ({ ms: id === 'holder' ? 19_000 : 1000 }), 2);
    expect(record.status).toBe('ok');
    expect(record.ms).toBeGreaterThan(38_000);
    expect(maxActive).toBe(1);
  });

  it('cancels queued work at the hard run end without retry or source requests', async () => {
    const record = await run(id => ({ ms: id === 'holder' ? 19_000 : 10 }), 3);
    expect(record.status).toBe('timeout');
    expect(calls.filter(c => SERIES.includes(c.id))).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[growth-source]', expect.objectContaining({ code: 'cancelled' }));
    expect(active).toBe(0);
  });
});
