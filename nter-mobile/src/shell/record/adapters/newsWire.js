import { dateLabel, plural, presentRows, sourceLinks } from './common.js';
import { parseFeedDate } from './feedDate.js';
import { plainText, text } from './feedText.js';

/**
 * Geopolitics News Wire → record panel (F121). A wire item is a news report, not a verified
 * record: the headline is what an outlet reported, never a fact the platform vouches for.
 *
 * Rows come in three shapes: the BBC World RSS wire (server/featureFeed.mjs, `parseRssOrXml` +
 * `outlet`, with a plain-text `summary`); the Google News topic search used when BBC fails or is thin
 * (F188: a `news.google.com` redirect link, an RFC 822 date, a `summary` that may be empty, and
 * `publisher` when the item names one, but no `outlet` or `domain`); and GDELT DOC 2.0 article rows
 * (`domain`, `language`, `sourcecountry`, `seendate`), which are no longer fetched (F169 T4, F176) but
 * may still be stored. `sourcecountry` is the publisher's
 * country, not where a story happened, so the panel draws no map. Article text is untrusted
 * third-party data: it is passed through as plain strings (the renderer escapes them), never as
 * markup, a link or an instruction. The feed carries no fetch time, so the only as-of date is the
 * one the item carries.
 */
const NOT_ON_RECORD = 'Not on record';

const GDELT = 'gdelt';
const RSS = 'rss';
const GOOGLE = 'google';

/** Feed dates are read strictly by the shared reader (feedDate.js, F127). */
const parsePublished = (value) => parseFeedDate(value);

/** "12 Oct 2026" in India time for the item's own date (GDELT seendate first, then date), or ''. */
function publishedLabel(row) {
  for (const candidate of [row.seendate, row.date]) {
    const at = parsePublished(candidate);
    if (at) return dateLabel(at.toISOString());
  }
  return '';
}

/** True for the Google News redirect host: it is Google's address for a story, not the publisher's website. */
const isGoogleNewsHost = (host) => /(^|\.)news\.google\.com$/i.test(host);

/**
 * Which feed made the row: its own fields. A stored GDELT article carries domain, seendate or the
 * reporting-search label. A BBC row always carries `outlet` (rssTagged), so `outlet` decides first. A
 * Google News search row (F188) carries a news.google.com link and/or a `publisher`, and usually a
 * summary too, so it is told apart before the summary-only RSS fallback.
 */
function feedKind(row) {
  if (text(row.domain) || text(row.seendate) || text(row.reporting_search)) return GDELT;
  if (text(row.outlet)) return RSS;
  if (text(row.publisher) || isGoogleNewsHost(linkHost(urlOf(row)))) return GOOGLE;
  if (text(row.summary)) return RSS;
  return null;
}

const publisherOf = (row) => plainText(row?.domain) || plainText(row?.outlet) || plainText(row?.publisher);
const publisherKey = (row) => publisherOf(row).toLowerCase().replace(/^www\./, '');
const urlOf = (row) => text(row?.source_url) || text(row?.url);

/** The same story: the same object, the same link, or (when neither has a link) the same headline and date. */
function sameStory(a, b) {
  if (a === b) return true;
  const ua = urlOf(a);
  const ub = urlOf(b);
  if (ua || ub) return ua === ub;
  const title = text(a?.title);
  return Boolean(title) && title === text(b?.title) && text(a?.date) === text(b?.date);
}

/** The host of an https article link, or '' (an http, relative or malformed link is neither shown nor opened). */
function linkHost(url) {
  const u = text(url);
  if (!/^https:\/\//i.test(u)) return '';
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

/** "Last 3 days" from the envelope's coverage.through ("3d"); '' when it states no whole number of days. */
function windowOf(feed) {
  const m = /^(\d+)d$/i.exec(text(feed?.coverage?.through));
  const days = m ? Number(m[1]) : 0;
  return days > 0 ? `Last ${plural(days, 'day')}` : '';
}

// F165: the reader sees what the feed is, not its protocol or product name.
const FEED_NAME = { [GDELT]: 'News search', [RSS]: 'BBC World feed', [GOOGLE]: 'Google News search' };
const SOURCE = { [GDELT]: 'News search (not an official dataset)', [RSS]: 'BBC World feed', [GOOGLE]: 'Google News search (not an official dataset)' };
const NOTE = {
  [GDELT]: 'A news report fetched live from a reporting search, not a verified record. The headline is what an outlet reported, not established fact. The date is when the news search first saw the article. Nothing here says where the story took place.',
  [RSS]: "A news report fetched live from the BBC World news feed, not a verified record. The headline and summary are what the outlet reported, not established fact. The date is the feed's publication date. Nothing here says where the story took place.",
  [GOOGLE]: "A news report fetched live from a Google News search, not a verified record. The headline and summary are what the publisher reported, not established fact. The date is the search result's publication date. Nothing here says where the story took place.",
  none: 'A news report fetched live, not a verified record. The headline is what an outlet reported, not established fact. Nothing here says where the story took place.',
};
const CAPTION = {
  [GDELT]: 'News search results, not an official dataset. Counts describe this list only, not all coverage of any story.',
  [RSS]: 'BBC World feed items, not an official dataset. Counts describe this list only, not all coverage of any story.',
  [GOOGLE]: 'Google News search results, not an official dataset. Counts describe this list only, not all coverage of any story.',
  none: 'News wire items, not an official dataset. Counts describe this list only.',
};

export default function newsWire(row, ctx = {}) {
  const kind = feedKind(row);
  const title = plainText(row.title) || 'News story';
  const publisher = publisherOf(row);
  const published = publishedLabel(row);
  const language = kind === GDELT ? plainText(row.language) : '';
  const country = kind === GDELT ? plainText(row.sourcecountry) : '';
  // A Google News summary is often just the headline and the publisher again: no card for that.
  const rawSummary = plainText(row.summary);
  const summary = kind === GOOGLE && rawSummary.toLowerCase().startsWith(String(title || '').toLowerCase().replace(/\s+-\s+[^-]+$/, '').slice(0, 40)) ? '' : rawSummary;
  // A Google News link is Google's redirect to the story, not the publisher's website: no Website row.
  const linkedHost = linkHost(urlOf(row));
  const host = kind === GOOGLE && isGoogleNewsHost(linkedHost) ? '' : linkedHost;

  // Source-status rows are notices, not stories. The selection may be a copy of its feed row.
  const stories = (Array.isArray(ctx.rows) ? ctx.rows : []).filter((r) => r && typeof r === 'object' && r.status !== 'source_status');
  const key = publisherKey(row);
  const others = key ? stories.filter((r) => publisherKey(r) === key && !sameStory(r, row)).length : 0;

  const windowValue = kind === GDELT || kind === GOOGLE ? windowOf(ctx.feed) : kind === RSS ? 'Latest items' : '';
  const board = [
    { label: 'Feed window', value: windowValue || NOT_ON_RECORD, note: kind === RSS ? 'the feed states no fixed window' : undefined },
    ...(stories.length ? [{ label: 'Stories on the wire', value: String(stories.length), note: 'in this list' }] : []),
    ...(stories.length && key ? [{ label: 'Same publisher', value: String(others), note: others === 1 ? 'other story in this list' : 'other stories in this list' }] : []),
    ...(country ? [{ label: "Publisher's country", value: country, note: "publisher's home country, not where the story took place" }] : []),
  ];

  return {
    title,
    meta: ['News wire', publisher].filter(Boolean),
    badge: kind === GDELT ? { text: 'Reporting search', tone: 'grey' } : kind === GOOGLE ? { text: 'News search', tone: 'grey' } : kind === RSS ? { text: 'News feed', tone: 'grey' } : undefined,
    links: linkedHost ? sourceLinks(row, kind === GOOGLE && isGoogleNewsHost(linkedHost) ? 'Read the article (via Google News)' : 'Read the article') : [],
    glance: {
      tiles: [
        { label: 'Published', value: published || NOT_ON_RECORD, sub: kind === GDELT ? 'India date; first seen by the news search' : kind === RSS || kind === GOOGLE ? 'India date; feed publication date' : 'India date' },
        { label: 'Publisher', value: publisher || NOT_ON_RECORD, sub: kind === GDELT ? 'publisher domain' : kind === RSS ? 'outlet' : kind === GOOGLE ? 'as named by Google News' : undefined },
        { label: 'Feed', value: FEED_NAME[kind] || NOT_ON_RECORD, sub: kind === GDELT ? 'reporting search, not an official dataset' : kind === GOOGLE ? 'news search, not an official dataset' : kind === RSS ? 'live news feed' : undefined },
        ...(language ? [{ label: 'Language', value: language, sub: 'as tagged by the news search' }] : []),
      ],
      visual: {
        type: 'board',
        title: 'Feed state',
        rows: board,
        caption: CAPTION[kind] || CAPTION.none,
      },
    },
    about: {
      label: '02 · What the item says',
      rows: presentRows([['Publisher', publisher], ['Published', published], ['Website', host]]),
      cards: summary ? [{ heading: kind === GOOGLE ? 'Summary as listed by Google News' : `Summary as published by ${plainText(row.outlet) || 'the feed'}`, body: summary }] : [],
    },
    touches: {
      label: '03 · Story & what it touches',
      links: others ? [{ title: `Other stories from ${publisher}`, detail: `${others} more on the wire` }] : [],
    },
    footer: {
      ask: 'Ask AI about this story',
      // The feed envelope carries no fetch time; the only date is the one the item carries.
      provenance: {
        source: SOURCE[kind] || 'Geopolitics News Wire feed',
        asOf: published,
        flags: published ? [] : ['as-of not on record'],
      },
      note: NOTE[kind] || NOTE.none,
    },
  };
}
