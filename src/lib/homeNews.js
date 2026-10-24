/** News freshness is independent of market/conflict refresh preferences. */
export const NEWS_CACHE_MS = 5 * 60_000;
export const NEWS_POLL_MS = 60_000;
const MAX_SAVED_AGE_MS = 24 * 60 * 60_000;

export function savedHomeNews(body, now = Date.now()) {
  if (body?.delivery !== 'rss' || !Array.isArray(body.rows)) return null;
  const checked = Date.parse(body.checked_at);
  if (!Number.isFinite(checked) || now - checked > MAX_SAVED_AGE_MS || checked > now + 60_000) return null;
  const stale = Boolean(body.stale || body.archive || now - checked >= NEWS_CACHE_MS);
  return { ...body, stale, archive: stale, ageH: body.updated ? Math.max(0, (now - Date.parse(body.updated)) / 3600000) : null };
}

export function newsPublication(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
}

export function newsCheckLabel(body, now = Date.now()) {
  const checked = Date.parse(body?.checked_at);
  if (!Number.isFinite(checked)) return 'waiting for stories';
  const minutes = Math.max(0, Math.floor((now - checked) / 60_000));
  const when = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
  const stale = body.stale || body.archive || now - checked >= NEWS_CACHE_MS;
  return `${stale ? 'previously fetched' : 'checked'} · ${when}`;
}
