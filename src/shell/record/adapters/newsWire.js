import { dateLabel, plural, presentRows, sourceLinks } from './common.js';

/**
 * Geopolitics News Wire → record panel (F121). A wire item is a news report, not a verified
 * record: the headline is what an outlet reported, never a fact the platform vouches for.
 *
 * Rows come in two live shapes (server/featureFeed.mjs): GDELT DOC 2.0 article rows (`gdeltRows`,
 * with `domain`, `language`, `sourcecountry`, `seendate`) and the BBC World RSS fallback
 * (`parseRssOrXml` + `outlet`, with a plain-text `summary`). `sourcecountry` is the publisher's
 * country, not where a story happened, so the panel draws no map. Article text is untrusted
 * third-party data: it is passed through as plain strings (the renderer escapes them), never as
 * markup, a link or an instruction. The feed carries no fetch time, so the only as-of date is the
 * one the item carries.
 */
const NOT_ON_RECORD = 'Not on record';

const GDELT = 'gdelt';
const RSS = 'rss';

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/**
 * Control characters (other than whitespace, which is collapsed to a space) and the bidirectional
 * marks and overrides, which can hide or reorder what a reader sees.
 */
const isInvisible = (code) => code <= 8 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)
  || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
const withoutInvisible = (s) => Array.from(s).filter((ch) => !isInvisible(ch.codePointAt(0))).join('');
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };

/**
 * Article text as one line of plain text: the few entities RSS leaves behind decoded once (never
 * `&lt;` or `&gt;`, so nothing can turn back into markup), invisible controls removed, whitespace
 * collapsed. It stays a string; nothing here builds HTML.
 */
const plainText = (value) => withoutInvisible(text(value))
  .replace(/&(?:amp|quot|apos|#39|#x27|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()])
  .replace(/\s+/g, ' ')
  .trim();

/** RFC 822 zone names, in minutes east of UTC. A zone not listed (BST, IST, CET) is ambiguous and is not guessed. */
const ZONES = { GMT: 0, UT: 0, UTC: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const GDELT_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/i;
const RFC_DATE = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([A-Za-z]{1,3}|[+-]\d{4}))?$/;

/** A real instant from calendar parts and a UTC offset in minutes, or null. Reads no local zone. */
function instant(year, month, day, hour, minute, second, offset) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(ms - offset * 60000);
}

const offsetOf = (zone) => {
  if (/^[+-]\d{4}$/.test(zone)) {
    const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5));
    return Number(zone.slice(3, 5)) > 59 ? null : (zone[0] === '-' ? -minutes : minutes);
  }
  const key = zone.toUpperCase();
  return Object.hasOwn(ZONES, key) ? ZONES[key] : null;
};

/**
 * The instant a feed date names, or null. Three shapes are read, each strictly:
 *  - GDELT seendate "20261012T143000Z" (UTC);
 *  - RFC 822 pubDate "Mon, 12 Oct 2026 14:30:00 GMT" (a listed zone name or a ±hhmm offset);
 *  - ISO 8601 / Atom "2026-10-12T14:30:00+01:00" (a zone is required with a time).
 * A bare calendar date ("12 Oct 2026", "2026-10-12") is read as that date. Anything else, an
 * impossible date, or a time with no zone is not a date: `new Date(text)` would guess and would
 * read local time on the machine.
 */
function parsePublished(value) {
  const t = typeof value === 'string' ? value.trim() : '';
  if (!t) return null;
  let m = GDELT_DATE.exec(t);
  if (m) return instant(...m.slice(1, 7).map(Number), 0);
  m = ISO_DATE.exec(t);
  if (m) {
    const [year, month, day] = m.slice(1, 4).map(Number);
    if (m[4] == null) return instant(year, month, day, 0, 0, 0, 0);
    const zone = m[7].toUpperCase();
    const offset = zone === 'Z' ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * (zone[0] === '-' ? -1 : 1);
    if (zone !== 'Z' && Number(zone.slice(-2)) > 59) return null;
    return instant(year, month, day, Number(m[4]), Number(m[5]), Number(m[6] || 0), offset);
  }
  m = RFC_DATE.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (!month) return null;
    if (m[4] == null) return instant(Number(m[3]), month, Number(m[1]), 0, 0, 0, 0);
    const offset = offsetOf(m[7]);
    return offset == null ? null : instant(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0), offset);
  }
  return null;
}

/** "12 Oct 2026" in India time for the item's own date (GDELT seendate first, then date), or ''. */
function publishedLabel(row) {
  for (const candidate of [row.seendate, row.date]) {
    const at = parsePublished(candidate);
    if (at) return dateLabel(at.toISOString());
  }
  return '';
}

/** Which feed made the row: the envelope's flag (`source.gdelt`) when it has one, otherwise the row's own fields. */
function feedKind(row, feed) {
  const flag = feed?.source?.gdelt;
  if (flag === true) return GDELT;
  if (flag === false) return RSS;
  if (text(row.domain) || text(row.seendate) || text(row.reporting_search)) return GDELT;
  if (text(row.outlet) || text(row.summary)) return RSS;
  return null;
}

const publisherOf = (row) => plainText(row?.domain) || plainText(row?.outlet);
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

const FEED_NAME = { [GDELT]: 'GDELT DOC 2.0', [RSS]: 'BBC World RSS' };
const SOURCE = { [GDELT]: 'GDELT DOC 2.0 reporting search (not an official dataset)', [RSS]: 'BBC World RSS' };
const NOTE = {
  [GDELT]: 'A news report fetched live from a reporting search, not a verified record. The headline is what an outlet reported, not established fact. The date is when GDELT first saw the article. Nothing here says where the story took place.',
  [RSS]: "A news report fetched live from the BBC World RSS feed, not a verified record. The headline and summary are what the outlet reported, not established fact. The date is the feed's publication date. Nothing here says where the story took place.",
  none: 'A news report fetched live, not a verified record. The headline is what an outlet reported, not established fact. Nothing here says where the story took place.',
};
const CAPTION = {
  [GDELT]: 'GDELT DOC 2.0 reporting search results, not an official dataset. Counts describe this list only, not all coverage of any story.',
  [RSS]: 'BBC World RSS items, not an official dataset. Counts describe this list only, not all coverage of any story.',
  none: 'News wire items, not an official dataset. Counts describe this list only.',
};

export default function newsWire(row, ctx = {}) {
  const kind = feedKind(row, ctx.feed);
  const title = plainText(row.title) || 'News story';
  const publisher = publisherOf(row);
  const published = publishedLabel(row);
  const language = kind === GDELT ? plainText(row.language) : '';
  const country = kind === GDELT ? plainText(row.sourcecountry) : '';
  const summary = plainText(row.summary);
  const host = linkHost(row.source_url);

  // Source-status rows are notices, not stories. The selection may be a copy of its feed row.
  const stories = (Array.isArray(ctx.rows) ? ctx.rows : []).filter((r) => r && typeof r === 'object' && r.status !== 'source_status');
  const key = publisherKey(row);
  const others = key ? stories.filter((r) => publisherKey(r) === key && !sameStory(r, row)).length : 0;

  const windowValue = kind === GDELT ? windowOf(ctx.feed) : kind === RSS ? 'Latest items' : '';
  const board = [
    { label: 'Feed window', value: windowValue || NOT_ON_RECORD, note: kind === RSS ? 'the feed states no fixed window' : undefined },
    ...(stories.length ? [{ label: 'Stories on the wire', value: String(stories.length), note: 'in this list' }] : []),
    ...(stories.length && key ? [{ label: 'Same publisher', value: String(others), note: others === 1 ? 'other story in this list' : 'other stories in this list' }] : []),
    ...(country ? [{ label: "Publisher's country", value: country, note: "publisher's home country, not where the story took place" }] : []),
  ];

  return {
    title,
    meta: ['News wire', publisher].filter(Boolean),
    badge: kind === GDELT ? { text: 'Reporting search', tone: 'grey' } : kind === RSS ? { text: 'RSS', tone: 'grey' } : undefined,
    links: host ? sourceLinks(row, 'Read the article') : [],
    glance: {
      tiles: [
        { label: 'Published', value: published || NOT_ON_RECORD, sub: kind === GDELT ? 'India date; first seen by GDELT' : kind === RSS ? 'India date; feed publication date' : 'India date' },
        { label: 'Publisher', value: publisher || NOT_ON_RECORD, sub: kind === GDELT ? 'publisher domain' : kind === RSS ? 'outlet' : undefined },
        { label: 'Feed', value: FEED_NAME[kind] || NOT_ON_RECORD, sub: kind === GDELT ? 'reporting search, not an official dataset' : kind === RSS ? 'live RSS feed' : undefined },
        ...(language ? [{ label: 'Language', value: language, sub: 'as tagged by GDELT' }] : []),
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
      rows: presentRows([['Publisher', publisher], ['Published', published], ['Link host', host]]),
      cards: summary ? [{ heading: `Summary as published by ${plainText(row.outlet) || 'the feed'}`, body: summary }] : [],
    },
    touches: {
      label: '03 · Story & what it touches',
      lanes: ['PUBLISHER', 'STORY', 'PUBLISHED', 'SAME PUBLISHER'],
      nodes: {
        left: publisher ? { l1: publisher } : undefined,
        center: { code: 'N', l1: 'This story', l2: 'News report' },
        right: published ? { l1: published } : undefined,
        far: others ? { l1: plural(others, 'other story', 'other stories'), l2: 'same publisher' } : undefined,
      },
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
