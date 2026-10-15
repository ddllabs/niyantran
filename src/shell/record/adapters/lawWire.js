import { dateLabel, presentRows, sourceLinks } from './common.js';
import { parseFeedDate } from './feedDate.js';
import { plainText, text } from './feedText.js';
import { plainLabel } from '../../../lib/plainSourceNote.js';

/**
 * The nine Law wire modules → record panel (F128 L4; docs/specs/2026-10-13-law-record-panels.md,
 * "Wire modules"). These modules have no docket behind them: the judiciary wire branch of
 * server/featureFeed.mjs serves Google News RSS coverage as news items (GDELT DOC 2.0 rows, no longer
 * fetched, may still be stored).
 * A row is therefore a report about a forum, never a record of it, and the panel says so in the
 * badge, in tile three, in the callout and in the footer. Nothing here describes an item as an
 * order, a charge, a holding or a stage, and no deadline is computed.
 *
 * Rows come in two live shapes. Google News: { date (RFC 822 pubDate), title ("Headline - Publisher"),
 * source_url, summary, publisher (from <source>; absent when the item has none), section, reporting_search }.
 * GDELT: the article's own fields (domain, seendate, language, sourcecountry) plus date, source_url,
 * section. Article text is untrusted third-party data: it stays a plain string (the renderer escapes
 * it), with invisible and bidirectional characters removed, never markup, a link or an instruction.
 * The checklist's derived entityName, id and eventDate are not source fields and are never shown.
 *
 */
const NOT_ON_ROW = 'Not on the row';
const ON_ROW = 'On the row';

const GOOGLE = 'google';
const GDELT = 'gdelt';

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

/**
 * What each module's real record holds, as a lawyer needs it. `pub` completes "These fields are
 * published by …" and "…, not …"; `clock` is the forum's own clock, which a news item never holds.
 */
const CONFIG = {
  'UP High Court (Allahabad) Order Feed': {
    pub: 'the Allahabad High Court',
    clock: 'Next date',
    needs: ['CNR', 'Stage', 'Bench and roster', 'Interim order status', 'Next date and purpose', 'Order sheet text', 'Connected matters'],
    quick: ['Hearing note', 'Client status update'],
    callout: 'This module holds news coverage of the Allahabad High Court, not its cause lists or orders. A report of an order is not the order.',
    cite: 'There is no case to cite. Cite the publisher and the date, and say plainly that the underlying order was not read.',
  },
  'District Court Case Tracker': {
    pub: 'eCourts',
    clock: 'Next date',
    needs: ['CNR number', 'Case type, number and year', 'Parties', 'Acts and sections', 'Stage', 'Last and next hearing date', 'Order PDFs'],
    quick: ['Hearing note', 'Client status update'],
    callout: 'A district-court tracker with no case on it: the rows are news items, and none reaches a cause list, a stage or an order.',
    cite: 'There is no case to cite. Cite the publisher and the date, and say plainly that the underlying order was not read.',
  },
  'NGT Environmental Litigation Tracker': {
    pub: 'the NGT',
    clock: 'Compliance by',
    needs: ['Original Application number and year', 'Zonal bench', 'Applicant and respondent', 'Project or clearance challenged', 'Direction issued', 'Compliance deadline', 'Committee reports on record'],
    quick: ['Case note', 'Compliance & deadline sheet'],
    callout: 'NGT directions carry compliance deadlines and compensation, the two things a client asks about first. Neither is on this row, and neither can be inferred from a headline.',
    cite: 'A direction has consequences; a report of a direction does not. Quote the publisher, and get the order before advising.',
  },
  'CAT & Consumer Disputes (NCDRC) Watch': {
    pub: 'CAT and the NCDRC',
    clock: 'Appeal window',
    needs: ['OA or complaint number', 'Bench or commission', 'Applicant or complainant and opposite party', 'Service cadre, or value of goods and services', 'Impugned order or deficiency alleged', 'Relief sought', 'Relief granted'],
    quick: ['Case note', 'Limitation & deadline sheet'],
    callout: 'Service law (CAT) and consumer law (NCDRC) share no procedure, limitation period or relief. This item does not say which forum, if either, decided anything.',
    cite: 'Say which forum, or say neither.',
  },
  'HC Judge Profiles & Bench Analytics': {
    pub: 'the High Courts and the Supreme Court collegium',
    clock: 'Retires',
    needs: ['Appointment and elevation dates', 'Parent High Court', 'Benches and rosters sat on', 'Judgments authored', 'Subject distribution', 'Cited-by count', 'Denominator for every rate shown'],
    quick: ['Bench memo (factual)'],
    callout: 'Factual only. This row is commentary, not a record of a judge: no appointment dates, judgments or rates are on it, and none are computed.',
    cite: 'Commentary about a judge is not a record of a judge. Attribute it to the publisher and leave it there.',
  },
  'ICC Proceedings': {
    pub: 'the ICC',
    clock: 'Next step',
    needs: ['Situation and case number', 'Chamber', 'Suspect or accused', 'Charges under the Rome Statute', 'Procedural stage', 'Filing date and document number', 'Warrant status'],
    quick: ['Case brief', 'Chronology'],
    callout: 'ICC coverage names individuals. Nothing on this row establishes a charge, a warrant or a stage; a headline about a named person is not a court record.',
    cite: 'Name the stage or do not name the person. “Reported to be under investigation” and “charged” are different claims.',
  },
  'ICJ Proceedings': {
    pub: 'the ICJ',
    clock: 'Next time-limit',
    needs: ['Case title and General List number', 'Applicant and respondent', 'Basis of jurisdiction', 'Phase', 'Orders and judgments with dates', 'Time-limits fixed for pleadings', 'Separate and dissenting opinions'],
    quick: ['Case brief', 'Chronology'],
    callout: 'The ICJ publishes its contentious and advisory lists, numbered. This row is a news item, not an entry in them.',
    cite: 'Provisional measures bind. A report that measures were sought does not.',
  },
  'WTO Dispute Settlement': {
    pub: 'the WTO',
    clock: 'Compliance period ends',
    needs: ['DS number', 'Complainant and respondent', 'Measure at issue', 'Agreements and articles cited', 'Panel composition and third parties', 'Current stage with its date', 'Compliance and retaliation status'],
    quick: ['Dispute brief', 'Chronology'],
    callout: 'WTO disputes carry a DS number and a published timeline. This row is a news item and names neither.',
    cite: 'Cite the dispute number or cite nothing.',
  },
  'Sector Tribunals (ITAT / TDSAT / SAT / DRT)': {
    pub: 'ITAT, TDSAT, SAT and DRT',
    clock: 'Appeal window',
    needs: ['Appeal or OA number', 'Bench', 'Assessment year, licence or order appealed against', 'Section or regulation in dispute', 'Quantum or penalty', 'Stay status', 'Date of pronouncement and appeal window'],
    quick: ['Case note', 'Limitation & deadline sheet'],
    callout: 'Four tribunals, four statutes, four limitation regimes. This item does not establish which tribunal, if any, decided anything.',
    cite: 'An ITAT order binds differently from a SAT order. Naming the wrong forum is worse than naming none.',
  },
};

/** A module the table does not list still gets a valid coverage panel. */
const GENERIC = {
  pub: 'the court or tribunal concerned',
  clock: 'Next date',
  needs: ['Case number', 'Parties', 'Forum', 'Stage', 'Order text'],
  quick: ['Case note'],
  callout: 'This module holds news coverage of a court or tribunal, not its records. A report of a decision is not the decision.',
  cite: 'There is no record to cite. Cite the publisher and the date, and say plainly that the underlying record was not read.',
};
// F84 narrowed the searches to each forum's own terms; a keyword match can still miss.
const BROAD_SEARCH = 'It was found by a keyword search for this forum and may still not concern it.';

export const LAW_WIRE_FEATURES = Object.keys(CONFIG);

const configFor = (ctx) => {
  const name = text(ctx?.feed?.feature);
  return name && Object.hasOwn(CONFIG, name) ? CONFIG[name] : GENERIC;
};

/** Which feed made the row: its section text first (the server always sets it), then the row's own fields. */
function feedKind(row) {
  const section = text(row.section);
  if (/gdelt/i.test(section)) return GDELT;
  if (/google news/i.test(section)) return GOOGLE;
  if (text(row.domain) || text(row.seendate)) return GDELT;
  if (text(row.publisher)) return GOOGLE;
  return null;
}

/** The outlet as Google News names it, else the GDELT publisher domain, else ''. */
const publisherField = (row) => plainText(row?.publisher);
const publisherOf = (row) => publisherField(row) || plainText(row?.domain);
const publisherKey = (row) => publisherOf(row).toLowerCase().replace(/^www\./, '');

/** The headline as published, and the same without a trailing " - <publisher>" that equals the row's publisher field exactly. */
const headlineOf = (row) => plainText(row?.title);
function titleOf(row) {
  const headline = headlineOf(row);
  const publisher = publisherField(row);
  const suffix = ` - ${publisher}`;
  if (publisher && headline.length > suffix.length && headline.endsWith(suffix)) return headline.slice(0, -suffix.length).trim() || headline;
  return headline;
}

const urlOf = (row) => text(row?.source_url);

/** The same item: the same object, the same link, or (when neither has a link) the same headline and date. */
function sameItem(a, b) {
  if (a === b) return true;
  const ua = urlOf(a);
  const ub = urlOf(b);
  if (ua || ub) return ua === ub;
  const title = headlineOf(a);
  return Boolean(title) && title === headlineOf(b) && text(a?.date) === text(b?.date);
}

const letters = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

/** Whether the summary says nothing beyond the headline and the publisher (Google News often repeats both). */
function repeatsHeadline(summary, row) {
  let rest = letters(summary);
  // The full headline first, then the shortened one, then the publisher.
  for (const part of [headlineOf(row), titleOf(row), publisherField(row)]) {
    const key = letters(part);
    if (key) rest = rest.split(key).join('');
  }
  return rest === '';
}

/** "What a lawyer needs · what this row has". A wire item holds none of the forum's fields, so each is marked from the row and none is found. */
function needsBoard(needs, pub) {
  const rows = needs.map((label) => ({ label, value: NOT_ON_ROW, tone: 'red' }));
  const held = rows.filter((r) => r.value === ON_ROW).length;
  return {
    type: 'board',
    title: 'What a lawyer needs · what this row has',
    right: `${held} of ${rows.length} on the row`,
    rows,
    caption: `These fields are published by ${pub}. This row is a news item and holds none of them.`,
  };
}

function relatedLinks(row, rows) {
  const key = publisherKey(row);
  if (!key) return [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (out.length >= 3) break;
    if (!r || typeof r !== 'object' || r.status === 'source_status' || sameItem(r, row) || publisherKey(r) !== key) continue;
    const title = titleOf(r);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, detail: `Same publisher · ${publishedLabel(r) || 'undated'}`, row: r });
  }
  return out;
}

function health(row, rows) {
  const stories = rows.filter((r) => r && typeof r === 'object' && r.status !== 'source_status');
  const all = stories.length ? stories : [row];
  const named = all.filter((r) => publisherOf(r)).length;
  return [
    ['Rows', String(all.length)],
    ['Record-level rows', '0'],
    ['Publisher named', `${Math.round((named / all.length) * 100)}%`],
  ];
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const quickPrompt = (label, headline) => `Draft a ${lowerFirst(label)} on “${headline}”. The attached item is a news item, not a court record. Draft from the attached item only, do not state a stage, holding, charge or date it does not give, and state plainly that the underlying order or record was not read.`;

const NOTE = 'The item is coverage. Nothing here is an order, a charge, a holding or a stage.';

export default function lawWire(row, ctx = {}) {
  const item = row && typeof row === 'object' ? row : {};
  const config = configFor(ctx);
  const kind = feedKind(item);
  const headline = headlineOf(item);
  const title = titleOf(item) || 'News item';
  const publisher = publisherOf(item);
  const published = publishedLabel(item);
  const summary = plainText(item.summary);
  const section = plainText(item.section);
  const rows = Array.isArray(ctx?.rows) ? ctx.rows : [];

  const source = kind === GDELT ? 'News search results (live)' : kind === GOOGLE ? 'Google News search results (live)' : 'News search results (live)';
  const publisherSub = publisherField(item) ? 'as Google News names it' : publisher ? 'publisher domain' : 'the item does not name one';
  const publishedSub = !published ? 'the item carries no usable date' : kind === GDELT ? 'India date; first seen by the news search' : 'India date; feed publication date';

  return {
    title,
    meta: [publisher, published ? `Published ${published}` : ''].filter(Boolean),
    badge: { text: 'Coverage — not an order', tone: 'red' },
    links: sourceLinks(item, 'Open the original item'),
    glance: {
      tiles: [
        { label: 'Published', value: published || NOT_ON_ROW, sub: publishedSub },
        { label: 'Publisher', value: publisher || NOT_ON_ROW, sub: publisherSub },
        { label: 'What it is', value: 'Coverage', sub: 'a news report, not an order' },
        { label: config.clock, value: NOT_ON_ROW, sub: 'the item is coverage', clock: true },
      ],
      visual2: needsBoard(config.needs, config.pub),
      callout: { tone: 'red', text: `${config.callout} ${BROAD_SEARCH}` },
    },
    about: {
      label: '02 · The pointers',
      rows: presentRows([
        ['Headline', headline],
        ['Publisher', publisher],
        ['Published', published],
        // F165: the server's section names its feed ("COVERAGE — GOOGLE NEWS RSS"); shown plainly.
        ['Section', plainLabel(section)],
      ]),
      cards: [
        ...(summary && !repeatsHeadline(summary, item) ? [{ heading: 'Summary as published', body: summary }] : []),
        { heading: 'If you cite this', body: config.cite },
      ],
    },
    quick: config.quick.map((label) => ({ label, prompt: quickPrompt(label, title) })),
    touches: {
      label: '03 · Entity & what it touches',
      links: relatedLinks(item, rows),
    },
    footer: {
      ask: 'Ask AI about this item',
      provenance: {
        source: `${source}; not a record from ${config.pub}`,
        asOf: published || undefined,
        flags: published ? [] : ['as-of not on record'],
      },
      health: health(item, rows),
      note: NOTE,
    },
  };
}
