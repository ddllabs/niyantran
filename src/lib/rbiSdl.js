/**
 * F196: SDL Auction & Borrowing Tracker. RBI's press releases on State Government Securities (State
 * Development Loans) auctions, read from RBI's press-release RSS (https://www.rbi.org.in/pressreleases_rss.xml,
 * the latest ten releases) and, when an item carries no table, from the release page.
 *
 * Two kinds of release are kept, one row per security offered:
 * - "Auction of State Government Securities": the notice (state, amount to be raised, tenor or the
 *   security re-issued, yield or price auction; the auction date from the text);
 * - "Result of Yield/Price Based Auction of State Government Securities": the result (amount notified
 *   and accepted, cut-off yield, and the cut-off price of a re-issue).
 * "State Government Securities - Full Auction Result" (the bid-by-bid table, laid out by security) is not
 * read; its figures repeat the result's.
 *
 * Each row carries feed_key "sdl:<prid>:<state>:<security or tenor>" (the release, the state and the
 * security re-issued or the new loan's tenor, as slugs; a second identical line in one release gets
 * ":2"), so the feed store keeps every line of a release as its own item (server/feedSchedule.mjs
 * itemKeyFor) and a line keeps its key when the release's table gains or loses another line; the
 * module is of kind `official`, so its items are kept, never replaced. Aggregate lines ("Total",
 * "Grand Total", "Total (A+B)") are not a state's and are left out.
 */
import { cellText, extractTables, gridOf } from './htmlTable.js';
import { handbookState } from './rbiHandbookTables.js';
import { isoFromRbiDate } from './rbiHandbook.js';

export const RBI_PRESS_RSS = 'https://www.rbi.org.in/pressreleases_rss.xml';
export const rbiReleaseUrl = (prid) => `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=${prid}`;

const NOTICE = /^auction of state government securities$/i;
const RESULT = /^result of (?:the )?(?:yield\s*\/\s*price based )?auction of state government securities$/i;

/** 'notice', 'result' or '' for a release title. */
export function sdlReleaseKind(title) {
  const t = cellText(title).replace(/\s+/g, ' ').trim();
  if (NOTICE.test(t)) return 'notice';
  if (RESULT.test(t)) return 'result';
  return '';
}

/**
 * An RSS pubDate as the India (IST) day it falls on. RBI writes "Thu, 15 Oct 2026 17:50:00" with no zone:
 * that is India time, whatever the server's own zone. A date that names a zone is read in it.
 */
function indiaDay(pubDate) {
  const text = String(pubDate ?? '').trim();
  if (!text) return '';
  const zoned = /(?:\s(?:GMT|UTC|UT|[ECMP][SD]T|IST)|\dZ|[+-]\d{2}:?\d{2})\s*$/i.test(text);
  const t = Date.parse(zoned ? text.replace(/\bIST\s*$/i, '+0530') : `${text} +0530`);
  return Number.isFinite(t) ? new Date(t + 330 * 60_000).toISOString().slice(0, 10) : '';
}

/** The RSS feed's items: { title, link, prid, date (ISO day in India), description (HTML) }. */
export function parseRbiPressRss(xml) {
  const items = [];
  for (const m of String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const tag = (name) => {
      const hit = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`, 'i').exec(block);
      return hit ? (hit[1] ?? hit[2] ?? '').trim() : '';
    };
    const link = cellText(tag('link'));
    const prid = /prid=(\d+)/i.exec(link)?.[1] || '';
    items.push({
      title: cellText(tag('title')),
      link,
      prid,
      date: indiaDay(tag('pubDate')),
      description: tag('description'),
    });
  }
  return items;
}

const num = (text) => {
  const t = String(text ?? '').replace(/[,\s₹]/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** A tenor cell: { tenor_years } for a plain number of years, else { reissue: true, security } for "Re-issue of …". */
function tenorOf(text) {
  const t = cellText(text);
  if (/^\d{1,2}$/.test(t)) return { tenor: `${Number(t)} years`, tenor_years: Number(t), reissue: false };
  const re = /^re-?issue of\s+(.+?)(?:,\s*issued on\s+(.+))?$/i.exec(t);
  if (re) return { tenor: t, reissue: true, security: re[1].trim(), ...(re[2] ? { first_issued: isoFromRbiDate(re[2]) || re[2].trim() } : {}) };
  return t ? { tenor: t, reissue: false } : {};
}

/** A cut-off cell: "104.42/7.6672" is price and yield; one number is a yield (a yield auction's cut-off). */
function cutoffOf(text) {
  const t = cellText(text).replace(/\s+/g, '');
  const both = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (both) return { cutoff_price: Number(both[1]), cutoff_yield: Number(both[2]) };
  const one = num(t);
  return one == null ? {} : { cutoff_yield: one };
}

/** A total line ("Total", "Grand Total", "Total (A+B)", "All States"): not a state's line. */
function isAggregate(label) {
  const text = cellText(label).trim();
  return Boolean(handbookState(text)?.aggregate) || /^(?:grand\s+)?total\b/i.test(text);
}

/** A key part: lower case, letters and digits joined by "-", at most 80 characters. */
const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

const COLUMNS = [
  ['state', /^state/i],
  ['notified', /amount to be raised|notified/i],
  ['accepted', /accepted/i],
  ['cutoff', /cut\s*-?\s*off/i],
  ['tenor', /tenor/i],
  ['type', /type of auction/i],
];

/** The auction table of a release's HTML as lines: { state, notified, accepted?, cutoff?, tenor, type? } texts. */
export function sdlTableLines(html) {
  for (const grid of extractTables(html).map(gridOf)) {
    const head = grid.findIndex((row) => row.some((s) => /^state/i.test(s?.text || '')) && row.some((s) => /tenor/i.test(s?.text || '')));
    if (head < 0) continue;
    const at = {};
    grid[head].forEach((slot, c) => {
      for (const [name, re] of COLUMNS) if (!(name in at) && re.test(slot?.text || '')) at[name] = c;
    });
    if (!('state' in at) || !('notified' in at)) continue;
    const lines = [];
    for (const row of grid.slice(head + 1)) {
      const cell = (name) => (name in at ? row[at[name]]?.text || '' : '');
      const state = cell('state');
      if (!state || isAggregate(state) || num(cell('notified')) == null) continue;
      lines.push({ state, notified: cell('notified'), accepted: cell('accepted'), cutoff: cell('cutoff'), tenor: cell('tenor'), type: cell('type') });
    }
    return lines;
  }
  return [];
}

/**
 * One release as rows. release: { kind ('notice' | 'result'), prid, date (ISO day), title, html (the
 * description or the page) }. Each row: date, stage, state (the repository's name, else as written),
 * notified_crore, accepted_crore?, cutoff_yield?, cutoff_price?, tenor, tenor_years?, reissue,
 * security?, auction_type?, auction_date?, release_title, prid, source_url, feed_key, title.
 */
export function sdlRows(release) {
  const text = cellText(release.html);
  const auctionDate = isoFromRbiDate(/auction will be conducted[^.]*?\bon\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i.exec(text)?.[1] || '')
    || isoFromRbiDate(/auction of State Government Securities held on\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i.exec(text)?.[1] || '');
  const stage = release.kind === 'result' ? 'Auction result' : 'Auction notified';
  const url = rbiReleaseUrl(release.prid);
  const seen = new Map();
  return sdlTableLines(release.html).map((line) => {
    const who = handbookState(line.state);
    const state = who && !who.aggregate ? who.state : cellText(line.state);
    const notified = num(line.notified);
    const row = {
      date: release.date,
      stage,
      state,
      notified_crore: notified,
      ...(release.kind === 'result' ? { accepted_crore: num(line.accepted), ...cutoffOf(line.cutoff) } : {}),
      ...tenorOf(line.tenor),
      ...(line.type ? { auction_type: cellText(line.type) } : {}),
      ...(auctionDate ? { auction_date: auctionDate } : {}),
      release_title: release.title,
      prid: release.prid,
      source_url: url,
    };
    // The line's own key: release, state and the security re-issued (else the tenor), never its place.
    const base = `sdl:${release.prid}:${slug(state) || 'state'}:${slug(row.reissue ? row.security || row.tenor : row.tenor) || 'line'}`;
    const copies = (seen.get(base) || 0) + 1;
    seen.set(base, copies);
    row.feed_key = copies > 1 ? `${base}:${copies}` : base;
    if (state !== cellText(line.state)) row.state_label = cellText(line.state);
    row.title = `${state} · ${stage.toLowerCase()} · ₹${notified?.toLocaleString('en-IN') ?? '?'} crore`;
    for (const k of Object.keys(row)) if (row[k] == null) delete row[k];
    return row;
  });
}

/** A release page's date ("Date : Jun 30, 2026") and title, for a release read from its page. */
export function releasePageMeta(html) {
  const s = String(html ?? '');
  return {
    date: isoFromRbiDate(/Date\s*:\s*([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4})/.exec(s)?.[1] || ''),
    title: cellText(/class=["']?tableheader["']?[^>]*>\s*<b>\s*([^<]*State Government Securities[^<]*)</i.exec(s)?.[1] || ''),
  };
}
