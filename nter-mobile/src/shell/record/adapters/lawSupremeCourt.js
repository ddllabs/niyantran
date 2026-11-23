import { dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * Supreme Court order record panels (F128 L3; docs/specs/2026-10-13-law-record-panels.md).
 * Two modules share one reading of the stored table (`scOrderRows` / `archiveOrderRows`,
 * src/lib/lawPack.js): "Supreme Court Order & Judgment Feed" (`lawSupremeCourt`) and "Order Archive
 * by Topic (Cross-Court)" (`lawOrdersByTopic`).
 *
 * A row is an index entry: case title, diary number, order date, a keyword-classifier topic and the
 * sci.gov.in PDF link. It holds no citation, bench, result, provisions or holding, so the panel says
 * "Not on the row" for each and "Not checked" for good-law status (no citator is on this desk). The
 * topic is printed as the classifier's label, never as a holding; "Other / Unclassified" is shown as
 * "Unclassified" and never used to relate orders. Nothing is computed from statute, and names print
 * exactly as the Court lists them.
 */
const NOT_ON_ROW = 'Not on the row';
const ON_ROW = 'On the row';
const UNCLASSIFIED = 'Unclassified';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * "03-Jul-2026" (the Court's own form) or "2026-07-03" as "03 Jul 2026"; '' for anything else.
 * Parsed by hand and checked against the calendar: `new Date("03-Jul-2026")` reads local time and
 * guesses at other shapes, and a guessed date is worse than none.
 */
export function orderDateLabel(value) {
  const text = clean(value);
  let day;
  let month;
  let year;
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (named) {
    day = Number(named[1]);
    month = MONTHS.findIndex((m) => m.toLowerCase() === named[2].toLowerCase());
    year = Number(named[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    return '';
  }
  if (month < 0 || month > 11 || year < 1 || day < 1) return '';
  if (day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return '';
  return `${String(day).padStart(2, '0')} ${MONTHS[month]} ${year}`;
}

const dateOf = (row) => orderDateLabel(row?.order_date || row?.date);
const titleOf = (row) => clean(row?.case_title || row?.title);
const topicOf = (row) => clean(row?.topic);
const isUnclassified = (topic) => !clean(topic) || /^other\s*\/\s*unclassified$/i.test(clean(topic));
const topicLabel = (topic) => (isUnclassified(topic) ? UNCLASSIFIED : clean(topic));
const hasHttps = (url) => /^https:\/\//i.test(String(url || '').trim());
const pct = (part, whole) => `${Math.round((part / whole) * 100)}%`;
const same = (a, b) => a === b || (clean(a?.diary_no) && clean(a.diary_no) === clean(b?.diary_no) && dateOf(a) === dateOf(b));

/** "What a lawyer needs · what this row has": each field marked from the row itself. */
function needsBoard(row) {
  const has = (v) => Boolean(clean(v));
  const pdf = clean(row.source_url || row.pdf_url);
  const needs = [
    { label: 'Diary number', present: has(row.diary_no) },
    { label: 'Neutral citation', present: has(row.neutral_citation) },
    { label: 'Reported citation', present: has(row.citation) },
    { label: 'Coram and bench strength', present: has(row.coram) },
    { label: 'Result', present: has(row.result) },
    { label: 'Provisions engaged', present: has(row.provisions) },
    { label: 'Holding', present: has(row.holding) },
    { label: 'Subsequent treatment', present: has(row.treatment) },
  ].map(({ label, present }) => ({ label, value: present ? ON_ROW : NOT_ON_ROW }));
  needs.push(hasHttps(pdf)
    ? { label: 'Order PDF', value: ON_ROW, note: 'may need a live court session' }
    : { label: 'Order PDF', value: pdf ? 'Partial' : NOT_ON_ROW, ...(pdf ? { note: 'link is not https' } : {}) });
  const held = needs.filter((n) => n.value === ON_ROW).length;
  return {
    type: 'board',
    title: 'What a lawyer needs · what this row has',
    right: `${held} of ${needs.length} on the row`,
    rows: needs.map((n) => ({ ...n, tone: n.value === ON_ROW ? 'green' : n.value === NOT_ON_ROW ? 'red' : 'amber' })),
    caption: 'Marked from this row. A field not on the row may still be in the order PDF; it has not been read here.',
  };
}

/** Orders in the table by topic, the record's own topic marked. Counts, not weights. */
function topicBoard(row, rows) {
  const counts = new Map();
  for (const r of rows) {
    const label = topicLabel(topicOf(r));
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  if (!counts.size) return undefined;
  const own = topicLabel(topicOf(row));
  const unclassified = rows.filter((r) => isUnclassified(topicOf(r))).length;
  return {
    type: 'board',
    title: 'Orders in the table by topic',
    right: `${counts.size} ${counts.size === 1 ? 'label' : 'labels'}`,
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, n]) => ({ label, value: String(n), ...(label === own ? { note: 'this record', tone: 'blue' } : {}) })),
    caption: `Counts of orders in the stored table, not weights. ${unclassified} of ${rows.length} carry no topic label.`,
  };
}

function relatedLinks(row, rows) {
  const topic = topicOf(row);
  if (isUnclassified(topic)) return [];
  return rows
    .filter((r) => r && !same(r, row) && !isUnclassified(topicOf(r)) && topicOf(r) === topic)
    .slice(0, 3)
    .map((r) => ({ title: titleOf(r), detail: dateOf(r) ? `Same topic · ${dateOf(r)}` : 'Same topic', row: r }));
}

function health(rows) {
  if (!rows.length) return [];
  return [
    ['Rows', String(rows.length)],
    ['Classified', pct(rows.filter((r) => !isUnclassified(topicOf(r))).length, rows.length)],
    ['Order PDFs', pct(rows.filter((r) => hasHttps(r?.source_url || r?.pdf_url)).length, rows.length)],
  ];
}

const NOTE = 'Case titles print exactly as the Court lists them. A topic is a classifier label, not a recommendation or a finding.';
const STILL_GOOD_LAW = { label: 'Still good law?', value: 'Not checked', sub: 'no citator on this desk', clock: true };

function build(row, ctx, variant) {
  const rows = (ctx?.rows || []).filter(Boolean);
  const title = titleOf(row);
  const dated = dateOf(row);
  // The table's snapshot time, not the order date (which the meta and tiles already give).
  const asOf = dateLabel(row.as_of);
  const topic = topicOf(row);
  const unclassified = isUnclassified(topic);
  const topicTile = {
    label: 'Topic',
    value: topicLabel(topic),
    sub: unclassified ? 'the classifier left it unlabelled' : 'classifier label, not a holding',
  };
  const tiles = variant === 'topic'
    ? [
      topicTile,
      {
        label: 'Orders on this topic',
        value: rows.length ? String(rows.filter((r) => topicLabel(topicOf(r)) === topicLabel(topic)).length) : NOT_ON_ROW,
        sub: rows.length ? `of ${rows.length} in the table` : 'no table on hand',
      },
      { label: 'Order date', value: dated || NOT_ON_ROW, sub: 'Supreme Court order' },
      STILL_GOOD_LAW,
    ]
    : [
      { label: 'Court', value: 'Supreme Court', sub: dated ? `order dated ${dated}` : 'order date not on the row' },
      { label: 'Diary no.', value: clean(row.diary_no) || NOT_ON_ROW, sub: 'registry diary number' },
      topicTile,
      STILL_GOOD_LAW,
    ];
  const unclassifiedCount = rows.filter((r) => isUnclassified(topicOf(r))).length;
  const callout = variant === 'topic'
    ? {
      tone: 'amber',
      text: `${rows.length ? `${unclassifiedCount} of ${rows.length} orders in this table are unclassified. ` : ''}The topic is a keyword classifier's label, not a reading of the order.`,
    }
    : {
      tone: 'amber',
      text: 'Order PDFs on sci.gov.in often need a live court session and may not open outside it. A dead link is a source limit, not a missing order.',
    };
  return {
    title: title || NOT_ON_ROW,
    meta: ['Supreme Court of India', dated ? `Order dated ${dated}` : ''].filter(Boolean),
    badge: { text: 'Registry record', tone: 'green' },
    links: sourceLinks(row, 'Order PDF (sci.gov.in)'),
    glance: {
      tiles,
      visual: variant === 'topic' ? topicBoard(row, rows) : undefined,
      visual2: needsBoard(row),
      callout,
    },
    about: {
      label: '02 · The pointers',
      rows: presentRows([
        ['Case', title],
        ['Diary no.', clean(row.diary_no)],
        ['Order date', dated],
        ['Topic', topic ? topicLabel(topic) : ''],
        ['Court', clean(row.court)],
      ]),
      cards: [{ heading: 'What this record does not settle', body: 'The bench, the result and what the order holds are in the order itself. This row is an index entry for it.' }],
    },
    quick: [
      { label: 'Case note', prompt: `Draft a case note on ${title || 'this Supreme Court order'}. Use only the attached record and the order PDF it links, and flag anything they do not state.` },
      { label: 'Synopsis & list of dates', prompt: `Draft a synopsis and list of dates for ${title || 'this Supreme Court order'}. Use only the attached record and the order PDF it links, and flag anything they do not state.` },
    ],
    touches: {
      label: '03 · Court & what it touches',
      links: relatedLinks(row, rows),
    },
    footer: {
      ask: 'Ask AI about this order',
      provenance: {
        source: 'Supreme Court of India order listings (stored table, sci.gov.in)',
        asOf: asOf || undefined,
        flags: asOf ? [] : ['as-of not on record'],
      },
      health: health(rows),
      note: NOTE,
    },
  };
}

/** Supreme Court Order & Judgment Feed. */
export default function lawSupremeCourt(row, ctx = {}) {
  return build(row, ctx, 'sc');
}

/** Order Archive by Topic (Cross-Court). */
export function lawOrdersByTopic(row, ctx = {}) {
  return build(row, ctx, 'topic');
}
