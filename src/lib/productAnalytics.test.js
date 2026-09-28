// Wave-1 follow-ups 1 and 2 (docs/specs/2026-09-28-wave-1-follow-ups.md):
// events carry the session's bearer so the server can record user_id, no
// email leaves or stays on the device, and an event the server rejects is
// dropped instead of retried on every page load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ token: 'access-token-1' }));
vi.mock('./supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.token ? { access_token: auth.token } : null }, error: null }),
    },
  },
}));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

const QUEUE_KEY = 'niyAnalyticsQueue';
let calls;

function respondWith(status) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: status < 400 }), { status });
  }));
}

async function load() {
  vi.resetModules();
  return import('./productAnalytics.js');
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const queue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  sessionStorage.setItem('niyantranUser', JSON.stringify({ email: 'reader@example.test' }));
  auth.token = 'access-token-1';
});
afterEach(() => vi.unstubAllGlobals());

describe('trackProductEvent', () => {
  it('sends the session bearer and no email', async () => {
    respondWith(200);
    const { trackProductEvent } = await load();
    trackProductEvent('desk_open', { tab: 'national' });
    await settle(); await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe('Bearer access-token-1');
    expect(calls[0].body).toMatchObject({ name: 'desk_open', props: { tab: 'national' } });
    expect(JSON.stringify(calls[0].body)).not.toContain('reader@example.test');
    expect(calls[0].body).not.toHaveProperty('userEmail');
  });

  it('sends no Authorization header when signed out', async () => {
    auth.token = null;
    respondWith(200);
    const { trackProductEvent } = await load();
    trackProductEvent('desk_open');
    await settle(); await settle();
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('drops an event the server rejects', async () => {
    respondWith(400);
    const { trackProductEvent } = await load();
    trackProductEvent('Bad Name!');
    await settle(); await settle();
    expect(queue()).toEqual([]);
  });

  it('keeps an event when the server is unavailable, without the email', async () => {
    respondWith(503);
    const { trackProductEvent } = await load();
    trackProductEvent('desk_open');
    await settle(); await settle();
    expect(queue()).toHaveLength(1);
    expect(JSON.stringify(queue())).not.toContain('reader@example.test');
  });
});

describe('flushAnalyticsQueue', () => {
  it('strips the email older builds queued, and drops what the server rejects', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { name: 'desk_open', props: {}, sessionId: 's-1', userEmail: 'reader@example.test', at: '2026-09-27T00:00:00Z' },
    ]));
    respondWith(200);
    const { flushAnalyticsQueue } = await load();
    await flushAnalyticsQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).not.toHaveProperty('userEmail');
    expect(queue()).toEqual([]);

    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ name: 'Bad Name!', props: {}, at: 'x' }]));
    respondWith(400);
    await flushAnalyticsQueue();
    expect(queue()).toEqual([]);

    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ name: 'desk_open', props: {}, at: 'x' }]));
    respondWith(429);
    await flushAnalyticsQueue();
    expect(queue()).toHaveLength(1);
  });
});
