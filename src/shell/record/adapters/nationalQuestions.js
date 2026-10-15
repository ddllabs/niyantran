import { analysisFor } from '../../../lib/impactRecord.js';
import { dateLabel, presentRows, provenanceFlags, sourceLinks } from './common.js';
import { titleCaseCaps } from './feedText.js';

/**
 * Parliamentary Question Database → record panel (F124 N3). Rows are the Lok Sabha question register
 * (Digital Sansad): who asked which ministry what, and on what date. The register holds no answer
 * text and an empty status on every row, so the lifecycle ends in an answer that is "not on record"
 * and no badge is drawn unless a row really carries a status. The analysis pack (ctx.packs, loaded
 * by the panel host) adds a short brief, why it matters and watch-for for the few questions it
 * covers. Pure and synchronous: it reads the saved pack only and never fetches or generates anything.
 */
const MAX_RELATED = 3;
const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;

/** A field's text, or '' when the row holds nothing real: the shaping helper's "Not reported", a dash or blank. */
const held = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /^(not reported|—|–|-)?$/i.test(s) ? '' : s;
};
/** "MICRO, SMALL AND MEDIUM ENTERPRISES" → "Micro, Small and Medium Enterprises"; a mixed-case name as written (feedText.js, F127). */
const titleCase = (v) => titleCaseCaps(held(v));
const sentence = (v) => { const s = held(v).toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
/** Only an ISO date is read; "02.04.2026" would be misread as month-first, so it is never parsed. */
const when = (v) => (ISO_DATE.test(String(v ?? '').trim()) ? dateLabel(String(v).trim()) : '');
const stamp = (r) => String(r.date || r.occurred_at || '');

/** The register's rows by member name (trimmed, lower case), built once per rows array. */
const MEMBER_INDEX = new WeakMap();
function memberIndex(rows) {
  let index = MEMBER_INDEX.get(rows);
  if (!index) {
    index = new Map();
    for (const r of rows) {
      if (!r || typeof r.mp_name !== 'string') continue;
      const k = r.mp_name.trim().toLowerCase();
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(r);
    }
    MEMBER_INDEX.set(rows, index);
  }
  return index;
}

export default function nationalQuestions(row, ctx = {}) {
  const packs = ctx.packs?.ready ? ctx.packs : null;
  const a = packs ? analysisFor(row, packs.analysis) : null;

  const subject = held(row.subject) || held(row.title);
  const member = held(row.mp_name);
  const party = held(row.party);
  const ministry = titleCase(row.ministry);
  const house = held(row.house);
  const type = sentence(row.question_type);
  const status = held(row.status);
  const tabled = when(row.date) || when(row.occurred_at);
  const asOf = when(row.as_of);

  const taken = new Set();
  const unique = (title, detail, id) => {
    let t = title;
    if (taken.has(t) && detail) t = `${title} (${detail})`;
    if (taken.has(t)) t = `${t} #${id}`;
    taken.add(t);
    return t;
  };
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  // The register has thousands of rows and this runs on every selection, so the rows are indexed by
  // member once per list (memberIndex) instead of scanning the whole register each time.
  const key = member.toLowerCase();
  const mine = member
    ? (memberIndex(rows).get(key) || [])
      .filter((r) => r !== row
        && held(r.status) !== 'source_status'
        && !(r.id != null && r.id === row.id)
        && !(held(r.subject) === subject && stamp(r) === stamp(row)))
      .sort((x, y) => stamp(y).localeCompare(stamp(x)) || Number(y.id) - Number(x.id))
    : [];
  const countTitle = `Other questions by ${member}`;
  taken.add(countTitle);
  const links = mine.slice(0, MAX_RELATED).map((r) => {
    const detail = [when(r.date) || when(r.occurred_at), titleCase(r.ministry)].filter(Boolean).join(' · ');
    return { title: unique(held(r.subject) || held(r.title) || 'Question', when(r.date) || when(r.occurred_at), r.id), detail, row: r };
  });
  if (mine.length > MAX_RELATED) links.push({ title: countTitle, detail: `${mine.length} others on the register` });

  const tiles = [
    { label: 'Tabled', value: tabled || 'Not on record', sub: house || undefined },
    { label: 'Ministry', value: ministry || 'Not on record' },
    ...(member ? [{ label: 'Asked by', value: member, sub: party || undefined }] : []),
    ...(type ? [{ label: 'Type', value: type }] : []),
  ];

  const cards = [
    ['Summary', a?.brief],
    ['Why it matters', a?.why_it_matters],
    ['Watch for', a?.watch_for],
  ].filter(([, body]) => String(body ?? '').trim()).map(([heading, body]) => ({ heading: `${heading} (register analysis)`, body: String(body).trim() }));
  const chips = [...new Set((Array.isArray(a?.tags) ? a.tags : []).map((t) => String(t ?? '').trim()).filter(Boolean))];
  const isPdf = /\.pdf(\?|#|$)/i.test(String(row.source_url || ''));

  return {
    title: subject || 'Question',
    meta: [house, type ? `${type} question` : ''].filter(Boolean),
    badge: status && status !== 'source_status' ? { text: sentence(status), tone: 'grey' } : undefined,
    links: sourceLinks(row, isPdf ? 'Question (PDF)' : 'Source on Sansad'),
    glance: {
      tiles,
      visual: {
        type: 'timeline',
        title: 'Question lifecycle',
        right: asOf ? `register as of ${asOf}` : undefined,
        steps: [
          { label: 'Tabled', detail: tabled || 'Date not on record', done: true },
          { label: 'Answer', detail: 'Not on record' },
        ],
        caption: "The register holds no answer text, so the ministry's answer is not on record here.",
      },
    },
    about: {
      label: '02 · About this question',
      rows: presentRows([
        ['Member', member],
        ['Party', party],
        ['Ministry', ministry],
        ['House', house],
        ['Type', type],
        ['Tabled', tabled],
      ]),
      chips,
      cards,
    },
    touches: {
      label: '03 · Question & its reach',
      links,
    },
    footer: {
      ask: 'Ask AI about this question',
      provenance: {
        source: 'Digital Sansad question register (sansad.in)',
        asOf,
        flags: [...(asOf ? [] : ['as-of not on record']), ...provenanceFlags(row)],
      },
      note: `A question is a member's claim, not a finding: the premise in it is the member's own and is not verified here. The ministry's answer is not on record here.`,
    },
  };
}
