import { isCabinetBody } from '../../../lib/parliament.js';
import { dateLabel, plural, presentRows } from './common.js';
import { parseFeedDate } from './feedDate.js';
import { plainText, text } from './feedText.js';

/**
 * Cabinet Decisions (National) → record panel (F124 N6).
 *
 * The module is NOT a list of Cabinet decisions yet (F125 will filter it). Its live rows are every
 * Press Information Bureau release (server/nationalFeed.mjs, the "cabinet decisions" branch:
 * `enrichPibEnglish` stamps `stage: 'PIB release'` and `source: 'Press Information Bureau'`, and the
 * branch's `shaped` sets `ministry` to the row's ministry or else its source, so a live row's
 * "ministry" is the publisher, never a ministry). The stored fallback is a six-row register
 * (public/data/embedded_csv/national_cabinet_decisions.json) of which one row is a Cabinet decision.
 *
 * So the panel never calls a release a Cabinet decision on the strength of where it came from.
 * It does so only when the release's own title states that the Cabinet, a Cabinet committee or the
 * CCEA approved something (`statesCabinetDecision`); every other item is a "Press release". Decision
 * type and outlay are not held on any row, so they are never shown or derived from a title.
 *
 * Title and summary are untrusted feed text: they are kept as plain strings (the renderer escapes
 * them), with the few entities RSS leaves behind decoded once and invisible controls removed.
 */
const NOT_ON_RECORD = 'Not on record';
const MAX_RELATED = 3;
const MAX_MINISTRIES = 3;
const PUBLISHER = /^(?:the\s+)?(?:press information bureau|pib)$/i;


// ---------------------------------------------------------------------------------------------
// What the title says: the only basis for the "Cabinet decision" label.
// ---------------------------------------------------------------------------------------------

/** The committee's name, as PIB writes it: "Cabinet Committee on Economic Affairs". */
const COMMITTEE = /^\s+Committee\s+on\s+[A-Z][a-z]+(?:\s+(?:and\s+)?[A-Z][a-z]+){0,2}/;
const VERB = '(?:approv(?:es|ed|al)|clears|cleared|nod|okays|okayed|sanctions|sanctioned|decides|decided|endorses|endorsed|ratifies|ratified|accepts|accepted|gives\\s+(?:its\\s+|ex[- ]post\\s+facto\\s+)?(?:approval|nod|go-ahead))';
/** "… approves", "… chaired by the Prime Minister approves", "… also approves": the verb follows the subject directly. */
const ACTIVE_TAIL = new RegExp(`^\\)?(?:,?\\s+(?:chaired|headed|led)\\s+by\\s+[^,;:|]{1,80}?)?,?\\s+(?:(?:also|today|has|have|had|formally|unanimously)\\s+)*${VERB}\\b`, 'i');
/** "… approved by the Union Cabinet". */
const PASSIVE = /\b(?:[Aa]pproved|[Cc]leared|[Ss]anctioned|[Ee]ndorsed|[Rr]atified|[Aa]ccepted|[Oo]kayed)\s+by\s+(?:the\s+)?(?:Union\s+)?(?:Cabinet\b(?!\s+(?:Ministers?|Secretary|Secretariat|Mission|Rank)\b)|CCEA\b)/;
/** The word right before a match, when nothing but spaces separates them. */
const PREVIOUS_WORD = /(?:^|[^\p{L}\p{N}])([\p{L}\p{N}][\p{L}\p{N}'’-]*)\s+$/u;

/**
 * True only when the title itself says the Cabinet, a Cabinet committee or the CCEA approved
 * (or cleared, sanctioned, endorsed, ratified, accepted, decided) something. The subject must be the
 * Union Cabinet: "Cabinet" or "CCEA" capitalised, with the decision verb straight after it (or after
 * "chaired by …") or the passive "approved by [the Union] Cabinet". Not counted, because they are
 * not the Cabinet deciding:
 *  - "Cabinet Secretary / Minister / Secretariat …";
 *  - another body's cabinet ("Assam Cabinet approves"): a capitalised word other than "Union"
 *    before "Cabinet";
 *  - "Cabinet apprised", "Cabinet briefing", "Cabinet decisions" (a briefing about them), and a
 *    verb that comes later in the sentence.
 * It misses unusual phrasings, which is the safe direction: the item then reads "Press release".
 */
export function statesCabinetDecision(title) {
  const line = String(title ?? '');
  if (PASSIVE.test(line)) return true;
  for (const m of line.matchAll(/\b(?:Cabinet|CCEA)\b/g)) {
    const previous = PREVIOUS_WORD.exec(line.slice(0, m.index));
    if (previous && /^\p{Lu}/u.test(previous[1]) && !/^(?:Union|The)$/i.test(previous[1])) continue;
    const after = line.slice(m.index + m[0].length);
    if (ACTIVE_TAIL.test(after.replace(COMMITTEE, ''))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Dates: read strictly, never guessed, never in the machine's local zone.
// ---------------------------------------------------------------------------------------------

/** PIB's dates: IST is India time, and full month names are read (feedDate.js, F127). */
const parseDate = (value) => parseFeedDate(value, { ist: true, monthNames: true });

/** "12 Oct 2026" (India date) for a date string, or ''. */
const labelOf = (value) => {
  const at = parseDate(value);
  return at ? dateLabel(at.toISOString()) : '';
};

const releasedLabel = (row) => [row.date, row.occurred_at, row.source_date_raw].map(labelOf).find(Boolean) || '';

// ---------------------------------------------------------------------------------------------
// Row facts.
// ---------------------------------------------------------------------------------------------

const titleOf = (row) => plainText(row?.title) || plainText(row?.topic);
// F125: the server keeps only releases whose issuing body (PIB's release page) is the Cabinet or a
// Cabinet committee and sets `ministry` to that body; a title that states a Cabinet approval also counts.
const isCabinet = (row) => isCabinetBody(plainText(row?.ministry)) || statesCabinetDecision(titleOf(row));

/** The ministry the row holds. The publisher name the server falls back to is not a ministry. */
function ministryOf(row) {
  const m = plainText(row?.ministry);
  return m && !PUBLISHER.test(m) ? m : '';
}
const ministryKey = (name) => name.toLowerCase();

/** The https link as given, or '' (an http, relative or malformed link is neither shown nor opened). */
function httpsUrl(value) {
  const u = text(value);
  if (!/^https:\/\//i.test(u)) return '';
  try {
    return new URL(u).protocol === 'https:' ? u : '';
  } catch {
    return '';
  }
}

const prid = (row) => /[?&]PRID=(\d+)/i.exec(text(row?.source_url))?.[1] || '';

/** The same release: the same object, the same PIB release number or link, or (with neither) the same title and date. */
function releaseKey(row) {
  const id = prid(row);
  if (id) return `prid:${id}`;
  const url = text(row?.source_url).toLowerCase();
  if (url) return `url:${url}`;
  const title = titleOf(row);
  return title ? `title:${title.toLowerCase()}|${text(row?.date)}` : '';
}
function sameRelease(a, b) {
  if (a === b) return true;
  const ka = releaseKey(a);
  return Boolean(ka) && ka === releaseKey(b);
}

/** The stored last-known-good register, not the live feed: its rows carry the register's own fields, and the envelope says fallback. */
const isStored = (row, feed) => Boolean(row?.occurred_at || row?.as_of || row?.provenance || row?.pdf_url) || feed?.fallback === true || feed?.source?.adapter === 'embedded';

const kindLabel = (cabinet) => (cabinet ? 'Cabinet decision' : 'Press release');

export default function nationalCabinet(row, ctx = {}) {
  const title = titleOf(row) || 'Press release';
  const cabinet = isCabinet(row);
  const kind = kindLabel(cabinet);
  const ministry = ministryOf(row);
  const released = releasedLabel(row);
  const asOf = labelOf(row.as_of);
  const stored = isStored(row, ctx.feed);
  const summary = plainText(row.summary);
  const release = httpsUrl(row.source_url);
  const pdf = httpsUrl(row.pdf_url);
  const number = prid(row);

  // The items the feed served: its own rows without source-status notices, each release once, and the selection (it may be a copy).
  const items = [];
  const served = (Array.isArray(ctx.rows) ? ctx.rows : []).filter((r) => r && typeof r === 'object' && !Array.isArray(r) && r.status !== 'source_status');
  for (const r of [...served, row]) if (!items.some((x) => sameRelease(x, r))) items.push(r);
  const cabinetItems = items.filter(isCabinet).length;

  // Ministries the feed names (the publisher is not one), most represented first.
  const byMinistry = new Map();
  for (const r of items) {
    const name = ministryOf(r);
    if (!name) continue;
    const entry = byMinistry.get(ministryKey(name)) || { name, n: 0 };
    entry.n += 1;
    byMinistry.set(ministryKey(name), entry);
  }
  const tagged = [...byMinistry.values()].reduce((sum, e) => sum + e.n, 0);
  const shown = [...byMinistry.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, MAX_MINISTRIES);
  const mine = ministry ? byMinistry.get(ministryKey(ministry)) : undefined;
  if (mine && !shown.includes(mine)) shown.push(mine);

  const boardRows = [
    { label: 'Items in this feed', value: String(items.length), note: stored ? 'in the stored register' : 'served today' },
    { label: 'Cabinet decisions', value: String(cabinetItems), note: cabinet ? 'includes this item' : 'by issuing body or title', tone: cabinetItems ? 'blue' : undefined },
    { label: 'Other releases', value: String(items.length - cabinetItems), note: cabinet ? undefined : 'includes this item', tone: items.length - cabinetItems ? 'grey' : undefined },
    { label: 'Ministry tagged', value: `${tagged} of ${items.length}`, note: tagged ? 'items that name a ministry' : 'the feed does not tag a ministry' },
  ];
  const labels = new Set(boardRows.map((r) => r.label.toLowerCase()));
  for (const e of shown) {
    if (labels.has(e.name.toLowerCase())) continue;
    labels.add(e.name.toLowerCase());
    boardRows.push({ label: e.name, value: plural(e.n, 'item'), note: e === mine ? "This item's ministry" : undefined });
  }

  // Other items from the same ministry, newest first, each release and each title once; never the selection or a copy of it.
  const seenTitles = new Set([title.toLowerCase()]);
  const related = ministry
    ? items.filter((r) => !sameRelease(r, row) && ministryOf(r) && ministryKey(ministryOf(r)) === ministryKey(ministry))
      .map((r) => ({ r, at: parseDate(r.date)?.getTime() ?? -Infinity }))
      .sort((a, b) => (b.at > a.at) - (b.at < a.at))
      .map(({ r }) => r)
      .filter((r) => {
        const key = titleOf(r).toLowerCase();
        if (!key || seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      })
    : [];

  return {
    title,
    meta: [ministry, 'PIB'].filter(Boolean),
    badge: cabinet ? { text: 'Cabinet decision', tone: 'blue' } : { text: 'Press release', tone: 'grey' },
    links: [
      ...(release ? [{ label: 'PIB release', href: release }] : []),
      ...(pdf && pdf !== release ? [{ label: 'Release PDF', href: pdf }] : []),
    ],
    glance: {
      tiles: [
        { label: 'Date', value: released || NOT_ON_RECORD, sub: released ? 'release date, India' : 'the feed gives no readable date' },
        { label: 'Ministry', value: ministry || NOT_ON_RECORD, sub: ministry ? 'as tagged in the feed' : 'the feed does not tag a ministry' },
        { label: 'Kind', value: kind, sub: cabinet ? 'the title states a Cabinet approval' : 'the title does not state a Cabinet approval', tone: cabinet ? 'blue' : undefined },
      ],
      visual: {
        type: 'board',
        title: stored ? 'What the stored register holds' : 'What the feed served today',
        right: stored && asOf ? `as of ${asOf}` : undefined,
        rows: boardRows,
        caption: `${stored ? 'The stored copy of the Press Information Bureau feed, not today\'s releases. ' : ''}The feed keeps PIB releases whose issuing body, as each release page names it, is the Cabinet or one of its committees. "Cabinet decisions" counts those, and any title that states a Cabinet approval.`,
      },
    },
    about: {
      label: '02 · About this release',
      rows: presentRows([
        ['Ministry on record', ministry],
        ['Released', released],
        ['PIB release number', number],
        ['Published by', 'Press Information Bureau'],
        ['Register as of', stored ? asOf : ''],
      ]),
      cards: summary ? [{ heading: 'Summary as published', body: summary }] : [],
    },
    touches: {
      label: '03 · Release & what it touches',
      links: [
        ...related.slice(0, MAX_RELATED).map((r) => ({
          title: titleOf(r),
          detail: [kindLabel(isCabinet(r)), labelOf(r.date)].filter(Boolean).join(' · '),
          row: r,
        })),
        ...(related.length > MAX_RELATED ? [{ title: `More from ${ministry}`, detail: `${related.length - MAX_RELATED} more in this feed` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this release',
      provenance: {
        source: stored ? 'PIB press releases (stored register)' : 'PIB press releases (live feed)',
        asOf,
        flags: [...(stored ? ['stored copy, not the live feed'] : []), ...(asOf ? [] : ['as-of not on record'])],
      },
      note: 'A press release is not an approval, and an approval is not an implementation. The feed keeps only releases issued by the Cabinet or one of its committees, as each PIB release page names its issuing body; when the latest PIB window holds none, it shows the stored Cabinet decisions.',
    },
  };
}
