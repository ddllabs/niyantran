// GET helpers for nter.pro's public /api routes. On a phone, Capacitor's native HTTP (enabled in
// capacitor.config.json) carries these requests, so the website needs no CORS change. In a
// browser the app calls its own /api, which the Vite dev server proxies and a host rewrites to
// www.nter.pro (vercel.json), because nter.pro's API sends no CORS headers.
import { API_BASE, WEB_API_BASE } from './config.js';
import { isNative } from './platform.js';

const base = () => (isNative() ? API_BASE : WEB_API_BASE);

export class HttpError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function apiGet(path, params = {}, { signal, timeoutMs = 20000, token } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const url = `${base()}${path}${qs.toString() ? `?${qs}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) throw new HttpError(res.status, body?.error || `Request failed (${res.status})`, body);
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
