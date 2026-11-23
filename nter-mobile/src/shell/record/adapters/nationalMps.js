import { dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * MP Profiles & Performance → record panel (F124 N7). Rows are the embedded member register
 * (national_mp_report_card): name, party, constituency (Lok Sabha members only), state, a count of
 * questions asked, the committees as one "; "-joined string, an attendance column that is empty on
 * every row, and the member's Sansad profile link. There is no analysis pack, no house column, no
 * date, and no MPLADS or debates field on any row.
 *
 * The house is read from the member's own source link (sansad.in/ls/… or /rs/…) because that is
 * what the source itself says. The party stays exactly as the register holds it ("BJP" and
 * "Bharatiya Janata Party" are both in there); normalising it is a separate data task (F126).
 * Every count is a register count over a period the register does not state, never a measure of
 * effectiveness, and the panel carries no ranking.
 */
const MAX_RELATED = 3;
const MAX_CHIPS = 12;
const HOUSES = { ls: 'Lok Sabha', rs: 'Rajya Sabha' };

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Lok Sabha or Rajya Sabha from a Sansad profile link whose first path segment is /ls/ or /rs/;
 * '' for anything else (no link, another host, plain http, a different path), never a guess.
 */
export function houseFromSource(url) {
  const m = /^https:\/\/(?:www\.)?sansad\.in\/(ls|rs)\//i.exec(String(url ?? '').trim());
  return m ? HOUSES[m[1].toLowerCase()] : '';
}

/** The distinct committees of the "; "-joined list, in listed order; the register repeats names. */
function committeesOf(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value ?? '').split(';')) {
    const name = clean(part);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

const listedCount = (value) => String(value ?? '').split(';').filter((p) => clean(p)).length;

/** The same member: the same Sansad profile, or (with no link) the same id and name. Row ids repeat across houses. */
const sameMember = (a, b) => (a.source_url || b.source_url ? clean(a.source_url) === clean(b.source_url) : clean(a.id) === clean(b.id) && clean(a.mp_name) === clean(b.mp_name));

/** An attendance figure the register holds, as written (a bare number gets a percent sign); '' when empty. */
function attendanceOf(row) {
  const held = clean(row.attendance_pct ?? row.attendance);
  if (!held) return '';
  return /^\d+(\.\d+)?$/.test(held) ? `${held}%` : held;
}

export default function nationalMps(row, ctx = {}) {
  const name = clean(row.mp_name ?? row.name ?? row.title) || 'Member';
  // The desk hands over shaped rows (F126): a unified `party` with the register's spelling in
  // `party_raw`, and `house` read from the member's own link. A raw row still works.
  const party = clean(row.party);
  const listedAs = clean(row.party_raw);
  const state = clean(row.state);
  const constituency = clean(row.constituency);
  const house = clean(row.house) || houseFromSource(row.source_url);
  const questions = clean(row.questions_asked);
  const committees = committeesOf(row.committees);
  const repeats = listedCount(row.committees) - committees.length;
  const attendance = attendanceOf(row);
  const asOf = dateLabel(row.as_of);

  // Members of the same party, exactly as the register spells it, in the same state: the register
  // holds no constituency shared by two members. Name order, so no member is placed above another.
  const related = party && state
    ? (ctx.rows || [])
      .filter((r) => r !== row && !sameMember(r, row) && clean(r.party) === party && clean(r.state) === state)
      .sort((a, b) => clean(a.mp_name).localeCompare(clean(b.mp_name)))
    : [];

  return {
    title: name,
    meta: [party, house, state].filter(Boolean),
    links: sourceLinks(row, 'Member profile (source)'),
    glance: {
      tiles: [
        { label: 'Questions asked', value: questions || 'Not on record', sub: questions ? 'register count' : 'blank in the register' },
        {
          label: 'Committees',
          value: committees.length ? String(committees.length) : 'Not on record',
          sub: committees.length ? (repeats > 0 ? 'distinct; repeats counted once' : 'named in the register') : 'blank in the register',
        },
        constituency
          ? { label: 'Constituency', value: constituency, sub: state || undefined }
          : { label: 'State', value: state || 'Not on record', sub: house || undefined },
        { label: 'Attendance', value: attendance || 'Not on record', sub: attendance ? 'as held in the register' : 'the register holds none' },
      ],
    },
    about: {
      label: '02 · About this member',
      rows: presentRows([
        ['Party', party],
        ['Listed as', listedAs && listedAs !== party ? listedAs : ''],
        ['House', house || 'Not on record'],
        ['Constituency', constituency || 'Not on record'],
        ['State', state],
      ]),
      chips: committees.slice(0, MAX_CHIPS),
      cards: [
        { heading: 'How the house is read', body: house ? `The register has no house column. The house is read from the member's source link (${house}).` : "The register has no house column, and this member's source link does not name one." },
        {
          heading: 'What these counts are',
          body: `Questions asked and committees are register counts over a period the register does not state. They are not a measure of effectiveness and not a ranking. ${attendance ? 'Debates and MPLADS utilisation are' : 'Attendance, debates and MPLADS utilisation are'} not on record.`,
        },
      ],
    },
    touches: {
      label: '03 · Member & party',
      links: [
        ...related.slice(0, MAX_RELATED).map((r) => ({
          title: clean(r.mp_name) || 'Member',
          detail: [houseFromSource(r.source_url), clean(r.constituency)].filter(Boolean).join(' · ') || state,
          row: r,
        })),
        ...(related.length > MAX_RELATED ? [{ title: `Other members listed as ${party} in ${state}`, detail: `${related.length - MAX_RELATED} more on the register` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this member',
      provenance: { source: 'Sansad member profiles (sansad.in)', asOf: asOf || undefined, flags: asOf ? [] : ['as-of not on record'] },
      note: `This is a register of members, not a ranking, and its counts are not a measure of effectiveness. Party names are unified only where the full name and the abbreviation are certainly the same party, and the name as listed is shown beside it; related members are matched on that name.`,
    },
  };
}
