import { headlineKey } from '../../../lib/newsDedup.js';
import { dateLabel, plural, presentRows } from './common.js';
import { parseFeedDate } from './feedDate.js';
import { plainText, text } from './feedText.js';

/**
 * National Morning Brief → record panel (F124 N9).
 *
 * The Morning Brief is not a digest. It is a live list of wire items that src/desks/MorningBriefDesk.jsx
 * fetches in the browser and hands to the shell with `onFeed` (lines 149-174): India government and
 * parliament articles from a GDELT reporting search ("Top of the Day"), the Press Information
 * Bureau RSS ("Government Wire") and an India economy and markets GDELT search ("Economy"), with
 * Google News RSS as the fallback for the two GDELT sections. Nothing is stored or generated. A wire
 * item is evidence that something was reported, never a verified record or a finding.
 *
 * What the adapter is given:
 *  - the selection: the item plus `section`, `headline`, `topic` and `region` (desk lines 202-208);
 *  - `ctx.rows` (the shell's `feed.rows`): the three sections merged and deduped. The desk tags each
 *    row with its `section` before the merge (F124). A row without one (an older feed) is told apart
 *    only for the PIB wire (its `source` is the literal 'PIB'); a GDELT or Google News row is then
 *    "Top of the Day or Economy", and the board says so rather than guessing;
 *  - `ctx.feed`: the envelope, whose `coverage.through` ('3d') is the only window the desk states
 *    (for the GDELT and Google News searches; the PIB RSS states none) and whose `meta.pib` is
 *    'OFFLINE' when the PIB wire could not be reached.
 *
 * Item text is untrusted third-party data: it stays a plain string (the renderer escapes it), with the
 * few entities RSS leaves behind decoded once (never `&lt;` or `&gt;`, so nothing turns back into
 * markup) and invisible controls removed. Only the item's own https link is ever a link. `ctx.packs`
 * is null for this module.
 */
const NOT_ON_RECORD = 'Not on record';
const MAX_RELATED = 3;

const TOP = 'Top of the Day';
const GOV = 'Government Wire';
const ECO = 'Economy';
const SECTIONS = [TOP, GOV, ECO];
const EITHER = 'Top of the Day or Economy';
const BOTH = 'Top of the Day and Economy';

const PIB = 'pib';
const GDELT = 'gdelt';
const GOOGLE = 'google';

const WIRE = { [TOP]: 'India government and parliament wire', [ECO]: 'India economy and markets wire' };
const AGGREGATOR = /^(?:gdelt|google news)$/i;


// ---------------------------------------------------------------------------------------------
// Dates: read strictly, never guessed, never in the machine's local zone.
// ---------------------------------------------------------------------------------------------

/** IST is India time (PIB's feed is Indian), and full month names are read (feedDate.js, F127). */
const parseDate = (value) => parseFeedDate(value, { ist: true, monthNames: true });

/** The item's own date: `date`, then `published`, then `seendate`. The checklist's eventDate is derived in the machine's zone and is not used. */
function publishedAt(row) {
  for (const candidate of [row?.date, row?.published, row?.seendate]) {
    const at = parseDate(candidate);
    if (at) return at;
  }
  return null;
}
const publishedLabel = (row) => {
  const at = publishedAt(row);
  return at ? dateLabel(at.toISOString()) : '';
};

// ---------------------------------------------------------------------------------------------
// What an item is: section, wire, source.
// ---------------------------------------------------------------------------------------------

const asObject = (r) => (r && typeof r === 'object' && !Array.isArray(r) ? r : null);
const sourceName = (row) => plainText(row?.outlet) || plainText(row?.source);

/**
 * The section, when the desk makes it certain: the row's own `section` (one of the three names the
 * desk uses), else the PIB wire, whose items alone carry the literal source 'PIB' (a GDELT domain
 * such as "pib.gov.in" is not the literal). Otherwise '': a GDELT or Google News row could be from
 * Top of the Day or Economy, and the merged feed rows do not say which.
 */
function sectionOf(row) {
  const tag = plainText(row?.section).toLowerCase();
  const named = SECTIONS.find((s) => s.toLowerCase() === tag);
  if (named) return named;
  return /^pib$/i.test(plainText(row?.source)) || /^pib$/i.test(plainText(row?.outlet)) ? GOV : '';
}

/** Which wire made the item: the PIB RSS, a GDELT search (rows carry `reporting_search`), or the Google News RSS fallback. */
function kindOf(row) {
  if (sectionOf(row) === GOV) return PIB;
  if (text(row?.reporting_search)) return GDELT;
  if (/^google news$/i.test(sourceName(row))) return GOOGLE;
  return null;
}

/** The host of an https link, or '' (an http, relative or malformed link is neither shown nor opened). */
function linkHost(url) {
  const u = text(url);
  if (!/^https:\/\//i.test(u)) return '';
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' ? parsed.hostname : '';
  } catch {
    return '';
  }
}
const httpsUrl = (row) => (linkHost(row?.source_url) ? text(row.source_url) : '');

/**
 * Who published the item. A named outlet is one; for a GDELT item with no domain the article link's
 * host is; "GDELT" and "Google News" are the search, not an outlet, and are never grouped.
 */
function publisherOf(row, kind) {
  const raw = sourceName(row);
  if (raw && !AGGREGATOR.test(raw)) return { name: raw, named: true, fromLink: false };
  const host = linkHost(row?.source_url).replace(/^www\./i, '');
  if (kind === GDELT && host) return { name: host, named: true, fromLink: true };
  return { name: raw, named: false, fromLink: false };
}
const publisherKey = (p) => (p.named ? p.name.toLowerCase().replace(/^www\./, '') : '');

/**
 * The same item: the same object, the same link, or the same headline. The desk collapses repeat
 * headlines with `headlineKey` (src/lib/newsDedup.js), so a copy under another link is still a copy.
 */
function sameItem(a, b) {
  if (a === b) return true;
  const ua = text(a?.source_url);
  if (ua && ua === text(b?.source_url)) return true;
  const ka = headlineKey(a);
  return Boolean(ka) && ka === headlineKey(b);
}

/** "Last 3 days" from the envelope's coverage.through ("3d"); '' when it states no whole number of days. */
function windowOf(feed) {
  const m = /^(\d+)d$/i.exec(text(feed?.coverage?.through));
  const days = m ? Number(m[1]) : 0;
  return days > 0 ? `Last ${plural(days, 'day')}` : '';
}

const BADGE = {
  [PIB]: { text: 'Government Wire', tone: 'blue' },
  [GDELT]: { text: 'Reporting search', tone: 'grey' },
  [GOOGLE]: { text: 'News search', tone: 'grey' },
};
const DATE_SUB = {
  [PIB]: 'India date; PIB publication date',
  [GDELT]: 'India date; first seen by the news search',
  [GOOGLE]: 'India date; feed publication date',
};
const DATE_NOTE = {
  [PIB]: ' The date is the publication date in the PIB release feed.',
  [GDELT]: ' The date is when the news search first saw the article.',
  [GOOGLE]: " The date is the feed's publication date.",
};

function sourceSub(kind, publisher) {
  if (kind === PIB) return 'Press Information Bureau release feed';
  if (kind === GOOGLE) return 'Google News search result; the outlet is not named in the item';
  if (kind === GDELT) {
    if (publisher.fromLink) return 'taken from the article link; the news search named no publisher';
    return publisher.named ? 'publisher domain, per the news search' : 'news search result; the publisher is not named';
  }
  return undefined;
}

function provenanceSource(kind, section) {
  const wire = WIRE[section];
  if (kind === PIB) return 'Press Information Bureau release feed (Government Wire)';
  if (kind === GDELT) return `News search${wire ? `, ${wire}` : ''} (not an official dataset)`;
  if (kind === GOOGLE) return `Google News search${wire ? `, ${wire}` : ''} (not an official dataset)`;
  return 'National Morning Brief wire';
}

export default function nationalMorningBrief(selection, ctx = {}) {
  const row = asObject(selection) || {};
  const section = sectionOf(row);
  const kind = kindOf(row);
  const publisher = publisherOf(row, kind);
  const title = plainText(row.title) || plainText(row.headline) || 'Morning Brief item';
  const published = publishedLabel(row);
  const host = linkHost(row.source_url);
  const url = httpsUrl(row);
  const summary = plainText(row.summary);
  const feed = asObject(ctx?.feed);

  // The Section tile: the desk's name for it when certain, else what the list can honestly say.
  const sectionValue = section || (kind === GDELT || kind === GOOGLE ? EITHER : NOT_ON_RECORD);
  const windowValue = section !== GOV && kind !== PIB && (section || kind) ? windowOf(feed) : '';
  const sourceValue = publisher.name || NOT_ON_RECORD;

  // The items the list holds: source-status notices out, each item once, and the selection in it exactly once (it may be a copy).
  const served = (Array.isArray(ctx?.rows) ? ctx.rows : []).map(asObject).filter((r) => r && r.status !== 'source_status');
  // Each item once: sameItem matches on the link or the headline key, so two sets find a repeat in
  // one pass (F127; it was a nested scan).
  const items = [];
  const links = new Set();
  const keys = new Set();
  const held = new Set();
  for (const r of served) {
    const link = text(r.source_url);
    const key = headlineKey(r);
    if (held.has(r) || (link && links.has(link)) || (key && keys.has(key))) continue;
    items.push(r);
    held.add(r);
    if (link) links.add(link);
    if (key) keys.add(key);
  }
  const at = items.findIndex((x) => sameItem(x, row));
  if (at >= 0) items[at] = row;
  else items.push(row);
  const others = items.filter((x) => x !== row);

  // 01 board: how many items each section holds in this list.
  let boardRows = [];
  let separated = true;
  if (served.length) {
    const sections = items.map(sectionOf);
    separated = sections.every(Boolean);
    const offline = text(feed?.meta?.pib).toUpperCase() === 'OFFLINE';
    const govCount = sections.filter((s) => s === GOV).length;
    const govNote = govCount ? undefined : offline ? 'the desk reports the PIB wire offline' : 'none on hand';
    const mark = (count, mine, extra) => ({ value: plural(count, 'item'), note: [mine ? 'Includes this item' : '', extra].filter(Boolean).join('; ') || undefined, tone: mine ? 'blue' : undefined });
    if (separated) {
      boardRows = SECTIONS.map((s) => {
        const count = sections.filter((x) => x === s).length;
        return { label: s, ...mark(count, s === section, count ? '' : s === GOV ? govNote : 'none on hand') };
      });
    } else {
      const rest = items.length - govCount;
      boardRows = [
        { label: GOV, ...mark(govCount, section === GOV, govNote) },
        { label: BOTH, ...mark(rest, section !== GOV, 'this list does not separate the two') },
      ];
    }
  }

  // Related: other items from the same named publisher (or the PIB wire), newest first, each headline once.
  const key = publisherKey(publisher);
  const seen = new Set();
  const related = key
    ? others.filter((r) => publisherKey(publisherOf(r, kindOf(r))) === key)
      .map((r, i) => ({ r, i, t: publishedAt(r)?.getTime() ?? -Infinity }))
      .sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : a.i - b.i))
      .map(({ r }) => r)
      .filter((r) => {
        const k = headlineKey(r) || plainText(r.title).toLowerCase();
        if (!plainText(r.title) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
    : [];
  const relatedLinks = related.slice(0, MAX_RELATED).map((r) => ({
    title: plainText(r.title),
    detail: publishedLabel(r) || 'Date not on record',
    row: r,
  }));
  const moreTitle = `More from ${publisher.name}`;
  if (related.length > MAX_RELATED && !relatedLinks.some((l) => l.title === moreTitle)) {
    relatedLinks.push({ title: moreTitle, detail: `${related.length - MAX_RELATED} more in this list` });
  }

  return {
    title,
    meta: ['Morning brief', section || publisher.name].filter(Boolean),
    badge: BADGE[kind],
    links: url ? [{ label: kind === PIB ? 'PIB release' : 'Read the article', href: url }] : [],
    glance: {
      tiles: [
        { label: 'Section', value: sectionValue, sub: section ? 'Morning Brief section' : sectionValue === EITHER ? 'this list does not say which' : undefined },
        { label: 'Published', value: published || NOT_ON_RECORD, sub: DATE_SUB[kind] || 'India date' },
        { label: 'Source', value: sourceValue, sub: sourceSub(kind, publisher) },
        ...(windowValue ? [{ label: 'Window', value: windowValue, sub: 'window stated by the desk feed' }] : []),
      ],
      visual: boardRows.length
        ? {
          type: 'board',
          title: 'Section status',
          rows: boardRows,
          caption: `Items on hand in each Morning Brief section. Repeat headlines are collapsed. Counts describe this list only, not all coverage.${separated ? '' : ' This list does not separate Top of the Day from Economy.'}`,
        }
        : undefined,
    },
    about: {
      label: '02 · What the item says',
      rows: presentRows([['Section', section], ['Source', publisher.name], ['Published', published], ['Website', host]]),
      cards: summary ? [{ heading: 'Summary as published', body: summary }] : [],
    },
    touches: {
      label: '03 · Item & what it touches',
      links: relatedLinks,
    },
    footer: {
      ask: 'Ask AI about this item',
      provenance: {
        source: provenanceSource(kind, section),
        asOf: published,
        flags: published ? [] : ['as-of not on record'],
      },
      note: `A wire item is evidence that something was reported, not a verified record. This is a live list of items that matched a wire search, fetched when the page loaded; it is not a generated digest or a personalised ranking.${DATE_NOTE[kind] || ''}`,
    },
  };
}
