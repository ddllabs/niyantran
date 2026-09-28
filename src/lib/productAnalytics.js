/**
 * Lightweight product analytics (A-19).
 * Posts to /api/analytics/event; queues in localStorage while the endpoint is
 * unreachable. The session's bearer lets the server record user_id; no email
 * is sent or kept on the device.
 */
import { supabase } from './supabaseClient.js';

const QUEUE_KEY = 'niyAnalyticsQueue';
const SESSION_KEY = 'niyAnalyticsSession';

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s-${Date.now().toString(36)}`;
  }
}

// Older builds queued the signed-in email with each event; drop it on read.
function withoutEmail(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const { userEmail: _email, ...rest } = evt;
  return rest;
}

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(withoutEmail).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* ignore */
  }
}

async function bearer() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** A 4xx other than 408/429 is the event's fault: retrying cannot succeed. */
function rejected(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// Resolves 'sent' or 'rejected'; throws while the endpoint is unreachable.
async function postOne(evt) {
  const res = await fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await bearer()) },
    body: JSON.stringify(withoutEmail(evt)),
  });
  if (res.ok) return 'sent';
  if (rejected(res.status)) return 'rejected';
  throw new Error(`HTTP ${res.status}`);
}

export async function flushAnalyticsQueue() {
  const q = readQueue();
  if (!q.length) return;
  const remain = [];
  for (const evt of q) {
    try {
      await postOne(evt);
    } catch {
      remain.push(evt);
    }
  }
  writeQueue(remain);
}

/**
 * @param {string} name  e.g. persona_selected | tour_done | ai_export | desk_open
 * @param {Record<string, unknown>} [props]
 */
export function trackProductEvent(name, props = {}) {
  const evt = {
    name: String(name || '').slice(0, 120),
    props: props && typeof props === 'object' ? props : {},
    sessionId: sessionId(),
    at: new Date().toISOString(),
  };
  if (!evt.name) return;

  postOne(evt)
    .then(() => flushAnalyticsQueue())
    .catch(() => {
      const q = readQueue();
      q.push(evt);
      writeQueue(q);
    });
}

// Best-effort flush on load (dev server up).
if (typeof window !== 'undefined') {
  setTimeout(() => {
    flushAnalyticsQueue().catch(() => {});
  }, 1500);
}
