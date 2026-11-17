// F344 T6 review: the controller driven with the REAL session state machine, a fake client and a
// fake capture. These are the paths where money and the user's trust are at stake: leaving while
// sharing or starting, the price changing, closing the modal mid-session.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => 't', functionsUrl: () => 'https://x.test/factcheck' }));
import { FactCheckError } from '../../lib/factcheck/client.js';
import { createFactCheckSession } from '../../lib/factcheck/session.js';
import { createFactCheckController } from './factCheckController.js';
import { confirmStart } from './factCheckText.js';

const ON = { available: true, creditsPerMinute: 500, userId: 'u1' };
const PARAMS = { videoId: 'vid1', channelId: 'ch1', videoKind: 'live', startPositionS: null, seed: { channel: 'WION', title: '' } };
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function flow({ startGate = null, captureGate = null, start = null } = {}) {
  const client = {
    start: vi.fn(async (body) => {
      if (startGate) await startGate.promise;
      if (start) return start(body);
      return { session_id: 's1', credits_per_minute: 500, credits_held: 2500 };
    }),
    extract: vi.fn(async () => ({ claims: [], ledger: null })),
    check: vi.fn(),
    stop: vi.fn(async () => ({ minutes_used: 1, credits_charged: 500, balance: 9500 })),
  };
  const capStop = vi.fn(async () => {});
  const capture = vi.fn(async () => {
    if (captureGate) await captureGate.promise;
    return { stop: capStop };
  });
  const credits = { available: () => 10000, refresh: vi.fn(async () => {}), subscribe: () => () => {} };
  const changes = [];
  const controller = createFactCheckController({
    createSession: (h) => createFactCheckSession({
      client, capture, transcriber: { transcribe: async () => ({ text: 'hi', secondsLeft: 250 }) }, extractGapMs: 0, ...h,
    }),
    readFlag: async () => ON, supported: () => true, credits, onChange: (v) => changes.push(v),
  });
  return { client, capture, capStop, credits, controller, changes, view: () => changes.at(-1) };
}

async function ready(f) {
  await f.controller.load();
  f.controller.setTarget('ch1|live|vid1');
  f.controller.choose();
  await settle();
}

describe('leaving while sharing', () => {
  it('a new target during sharing cancels with no server call and no charge', async () => {
    const gate = defer();
    const f = flow({ captureGate: gate });
    await ready(f);
    void f.controller.start(PARAMS, 5, 500);
    await settle();
    expect(f.view().session.status).toBe('sharing');
    f.controller.setTarget('ch2|live|vid2');
    expect(f.view().session.status).toBe('idle');
    gate.resolve();
    await settle();
    expect(f.client.start).not.toHaveBeenCalled();
    expect(f.client.stop).not.toHaveBeenCalled();
    expect(f.capStop).toHaveBeenCalledTimes(1);
    expect(f.view().session.final).toBeNull();
  });

  it('closing the modal during sharing is the same', async () => {
    const gate = defer();
    const f = flow({ captureGate: gate });
    await ready(f);
    void f.controller.start(PARAMS, 5, 500);
    await settle();
    await f.controller.close();
    gate.resolve();
    await settle();
    expect(f.client.start).not.toHaveBeenCalled();
    expect(f.client.stop).not.toHaveBeenCalled();
  });
});

describe('leaving while starting', () => {
  it('defers the stop until the server answers, then shows the charge', async () => {
    const gate = defer();
    const f = flow({ startGate: gate });
    await ready(f);
    void f.controller.start(PARAMS, 5, 500);
    await settle();
    expect(f.view().session.status).toBe('starting');
    f.controller.setTarget('ch2|live|vid2');
    await settle();
    expect(f.client.stop).not.toHaveBeenCalled();
    expect(f.view().session.status).toBe('starting');
    gate.resolve();
    await settle(12);
    expect(f.client.stop).toHaveBeenCalledTimes(1);
    expect(f.view().session).toMatchObject({
      status: 'ended', endReason: 'channel_change', final: { minutes_used: 1, credits_charged: 500, balance: 9500 },
    });
    expect(f.credits.refresh).toHaveBeenCalled();
  });
});

describe('after the end', () => {
  it('the old results are cleared by the next target change', async () => {
    const f = flow();
    await ready(f);
    await f.controller.start(PARAMS, 5, 500);
    await settle();
    expect(f.view().session.status).toBe('running');
    await f.controller.stop();
    expect(f.view().session.status).toBe('ended');
    f.controller.setTarget('ch2|live|vid2');
    expect(f.view().session.status).toBe('idle');
  });
});

describe('a muted start', () => {
  it('unmutes first, then starts at the displayed price', async () => {
    const f = flow();
    await ready(f);
    const order = [];
    const onUnmute = vi.fn(() => order.push('unmute'));
    const onConfirm = (minutes, price) => { order.push('confirm'); return f.controller.start(PARAMS, minutes, price); };
    confirmStart({ isMuted: true, onUnmute, onConfirm }, 10, f.view().flag.creditsPerMinute);
    await settle();
    expect(order).toEqual(['unmute', 'confirm']);
    expect(f.client.start).toHaveBeenCalledWith(expect.objectContaining({ minutes: 10, expected_credits_per_minute: 500 }));
    await f.controller.stop();
  });
});

describe('the price changes', () => {
  it('a refused start returns to the choose step at the fresh price, with no stop call', async () => {
    const f = flow({ start: () => { throw new FactCheckError(409, 'price_changed', { creditsPerMinute: 700 }); } });
    await ready(f);
    await f.controller.start(PARAMS, 5, 500);
    await settle(10);
    expect(f.view().session.status).toBe('choosing');
    expect(f.view().flag.creditsPerMinute).toBe(700);
    expect(f.view().priceNotice).toMatch(/The price changed to 700 credits a minute/);
    expect(f.client.stop).not.toHaveBeenCalled();
    expect(f.capStop).toHaveBeenCalledTimes(1);
  });

  it('a start answered at a different price is stopped at once', async () => {
    const f = flow({ start: () => ({ session_id: 's1', credits_per_minute: 700, credits_held: 3500 }) });
    await ready(f);
    await f.controller.start(PARAMS, 5, 500);
    await settle(12);
    expect(f.client.stop).toHaveBeenCalledTimes(1);
    expect(f.view().session.status).toBe('error');
    expect(f.view().session.error).toMatchObject({ reason: 'price_changed', creditsPerMinute: 700 });
    expect(f.view().session.final).toMatchObject({ credits_charged: 500 });
  });

  it('a start that gets no answer asks the credits store to refresh', async () => {
    const f = flow({ start: () => { throw new FactCheckError(0, 'network'); } });
    await ready(f);
    f.credits.refresh.mockClear();
    await f.controller.start(PARAMS, 5, 500);
    await settle(10);
    expect(f.view().session.error).toMatchObject({ source: 'start', status: 0 });
    expect(f.credits.refresh).toHaveBeenCalled();
  });
});

describe('closing the modal mid-session', () => {
  it('stops the session and keeps the summary for when it reopens', async () => {
    const f = flow();
    await ready(f);
    await f.controller.start(PARAMS, 5, 500);
    await settle();
    await f.controller.close();
    expect(f.client.stop).toHaveBeenCalledTimes(1);
    expect(f.view().session).toMatchObject({ status: 'ended', endReason: 'modal_close', final: { credits_charged: 500 } });
    await f.controller.load();
    expect(f.view().session.status).toBe('ended');
    expect(f.view().flag.available).toBe(true);
  });

  it('keeps a stop warning when the stop could not be confirmed', async () => {
    const f = flow();
    f.client.stop.mockRejectedValue(new FactCheckError(500, 'server_error'));
    await ready(f);
    await f.controller.start(PARAMS, 5, 500);
    await settle();
    await f.controller.close();
    expect(f.view().session.status).toBe('error');
    expect(f.view().session.error).toMatchObject({ source: 'stop' });
  });
});
