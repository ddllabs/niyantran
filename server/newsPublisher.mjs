import { load } from 'cheerio';
import { createNewsReader, parseNewsRss, publisherUrl, readNewsSource, NEWS_RSS_URL, NEWS_MAX_BYTES } from './newsRss.mjs';

export const NEWS_FRONT_URL = 'https://nter.news/';
const MAX_CARDS = 24;
const plain = (value, max = 1000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
function document(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > NEWS_MAX_BYTES) throw new Error('Invalid publisher page');
  return load(html);
}

/** Keep the publisher's editorial order, never sort pinned stories by RSS timestamps. */
export function parsePublisherFront(html) {
  const $ = document(html);
  const cards = $('main .nx-card');
  if (!$('main [data-section="top-stories"]').length) throw new Error('Publisher front-page structure changed');
  const rows = [];
  const seen = new Set();
  cards.each((_index, element) => {
    const card = $(element);
    if (rows.length >= MAX_CARDS || card.closest('[hidden],[aria-hidden="true"]').length) return;
    const titleLink = card.find('.nx-card__title a').first();
    const link = publisherUrl(titleLink.attr('href'), true);
    const title = plain(titleLink.text());
    if (!link || !title || seen.has(link)) return;
    seen.add(link);
    rows.push({ id: link, article_id: link, title, link, source_url: link,
      img: publisherUrl(card.find('.nx-card__media img,.nx-card__thumb img').first().attr('src') || ''),
      category: plain(card.find('.nx-card__kicker').text(), 80),
      dek: plain(card.find('.nx-card__dek').text(), 500),
      pub: null, published_at: null, date_source: null, src: 'nter.news', author: '', source: 'nter.news', fallback: false });
  });
  if (cards.length && !rows.length) throw new Error('No valid publisher cards');
  return rows;
}

function originalDate(value, now) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(raw)) return null;
  const date = Date.parse(raw);
  const day = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== raw.slice(0, 10) || date > now + 300000) return null;
  return raw;
}

/** Read only public publication/byline metadata; never return or render article bodies. */
export function parseArticleMetadata(html, link, now = Date.now()) {
  const $ = document(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!$('main h1').length || (canonical && publisherUrl(canonical, true) !== link)) throw new Error('Not the requested article');
  const date = $('main article time[datetime]').first().attr('datetime') || $('meta[property="article:published_time"]').attr('content');
  return { pub: originalDate(date, now), author: plain($('meta[name="author"]').attr('content') || $('main .nx-byline a').first().text(), 160) };
}

async function loadPublisherRows(fetcher, clock) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const [html, rss] = await Promise.all([
      readNewsSource(fetcher, NEWS_FRONT_URL, controller.signal),
      readNewsSource(fetcher, NEWS_RSS_URL, controller.signal).then(xml => parseNewsRss(xml, clock())).catch(() => []),
    ]);
    const rows = parsePublisherFront(html);
    const supplement = new Map(rss.map(row => [row.link, row]));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        const extra = supplement.get(row.link);
        row.img ||= extra?.img || '';
        row.src = extra?.src || row.src;
        row.author = extra?.author || '';
        // Source update times are deliberately not a publication-date fallback.
        try {
          if (controller.signal.aborted) continue;
          const metadata = parseArticleMetadata(await readNewsSource(fetcher, row.link, controller.signal), row.link, clock());
          row.pub = metadata.pub;
          row.published_at = metadata.pub;
          row.date_source = metadata.pub ? row.link : null;
          row.author = metadata.author || row.author;
          row.src = row.author || 'nter.news';
        } catch { /* An unverifiable publication date stays absent. */ }
      }
    }));
    return rows;
  } finally { clearTimeout(timer); controller.abort(); }
}

export function createPublisherReader(options = {}) {
  return createNewsReader({ ...options, loadRows: loadPublisherRows, delivery: 'publisher', sourceUrl: NEWS_FRONT_URL });
}
export const servePublisherNews = createPublisherReader();
