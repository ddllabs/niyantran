import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decodeEntities } from '../src/lib/curatedNews.js';

export const NEWS_RSS_URL = 'https://nter.news/feed.xml';
export const NEWS_TTL_MS = 5 * 60_000;
export const NEWS_STALE_MS = 24 * 60 * 60_000;
export const NEWS_MAX_BYTES = 2 * 1024 * 1024;
const RETRY_MS = 30_000;
const MAX_ROWS = 40;

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  isArray: name => ['item', 'category', 'media:content', 'enclosure'].includes(name),
});

function text(value, max = 1000) {
  const raw = value && typeof value === 'object' ? value['#text'] : value;
  return decodeEntities(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function publisherUrl(raw, article = false) {
  try {
    const url = new URL(decodeEntities(raw), 'https://nter.news');
    if (url.protocol !== 'https:' || !['nter.news', 'www.nter.news'].includes(url.hostname)
      || url.username || url.password || url.port) return '';
    if (article && !url.pathname.startsWith('/articles/')) return '';
    if (!article && !url.pathname.startsWith('/assets/')) return '';
    url.hash = '';
    url.search = '';
    url.hostname = 'nter.news';
    return url.href;
  } catch { return ''; }
}

/** Only public article metadata/excerpts. No content:encoded body or HTML reaches a card. */
export function parseNewsRss(xml, now = Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > NEWS_MAX_BYTES
    || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid news feed');
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel || typeof channel !== 'object') throw new Error('Missing news channel');
  const items = channel.item || [];
  const seen = new Set();
  const rows = [];
  for (const item of items.slice(0, 200)) {
    const title = text(item.title);
    const link = publisherUrl(item.link, true);
    const published = Date.parse(text(item.pubDate));
    if (!title || !link || !Number.isFinite(published) || published > now + 5 * 60_000 || seen.has(link)) continue;
    seen.add(link);
    const pub = new Date(published).toISOString();
    const image = [...(item['media:content'] || []), ...(item.enclosure || [])]
      .map(media => publisherUrl(media?.['@_url'] || '')).find(Boolean) || '';
    const category = text(item.category?.[0], 80);
    const author = text(item['dc:creator'] || item.author, 160);
    rows.push({ id: link, article_id: link, title, link, source_url: link, pub,
      published_at: pub, img: image, src: author || 'nter.news', author, category,
      dek: text(item.description, 500), source: 'nter.news', fallback: false });
  }
  rows.sort((a, b) => Date.parse(b.pub) - Date.parse(a.pub));
  // A channel with items but no valid articles is a source failure, not a confirmed empty feed.
  if (items.length && !rows.length) throw new Error('No valid news articles');
  return rows.slice(0, MAX_ROWS);
}

async function readFeed(fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(NEWS_RSS_URL, {
      signal: controller.signal, redirect: 'error',
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'NterPro-News/1.0' },
    });
    if (!response.ok || Number(response.headers.get('content-length')) > NEWS_MAX_BYTES) throw new Error('News source unavailable');
    if (!response.body) throw new Error('Missing news response');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > NEWS_MAX_BYTES) throw new Error('News feed too large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timer); }
}

/** Per-instance cache only. Cold starts may have no last-good response; no database is used. */
export function createNewsReader({ fetcher = (...args) => fetch(...args), clock = () => Date.now() } = {}) {
  let snapshot = null;
  let inflight = null;
  let failedAt = null;
  return async function read({ limit = 12, fresh = false } = {}) {
    const now = clock();
    const expired = !snapshot || now - snapshot.checkedAt >= NEWS_TTL_MS;
    if ((fresh || expired) && (failedAt === null || now - failedAt >= RETRY_MS)) {
      if (!inflight) {
        inflight = (async () => {
          try {
            const rows = parseNewsRss(await readFeed(fetcher), clock());
            snapshot = { rows, checkedAt: clock() };
            failedAt = null;
          } catch {
            failedAt = clock();
          } finally { inflight = null; }
        })();
      }
      await inflight;
    }
    const checkedAge = snapshot ? Math.max(0, clock() - snapshot.checkedAt) : Infinity;
    const available = Boolean(snapshot && checkedAge <= NEWS_STALE_MS);
    const stale = !available || failedAt !== null || checkedAge >= NEWS_TTL_MS;
    const count = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(limit)))) : 12;
    const rows = available ? snapshot.rows.slice(0, count).map(row => ({ ...row, fallback: stale })) : [];
    const updated = rows[0]?.pub || null;
    return {
      ok: Boolean(available), delivery: 'rss', source: 'nter.news', source_url: NEWS_RSS_URL,
      rows, updated, as_of: updated, checked_at: available ? new Date(snapshot.checkedAt).toISOString() : null,
      ageH: updated ? Math.max(0, (clock() - Date.parse(updated)) / 3600000) : null,
      archive: stale, stale, waiting: !rows.length, cached: available && checkedAge > 0,
      retry_after: failedAt === null ? null : 30,
      note: stale ? (rows.length ? 'News could not be refreshed. Showing previously fetched stories.' : 'nter.news stories are temporarily unavailable.')
        : rows.length ? 'Published stories from nter.news.' : 'No published stories in the current nter.news feed.',
    };
  };
}

export const serveRssNews = createNewsReader();
