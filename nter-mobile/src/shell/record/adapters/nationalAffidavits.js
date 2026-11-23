import { dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * Candidate Affidavit Database → record panel (F124 N8). Rows are the embedded MyNeta / ADR register
 * (national_candidate_affidavit): name, party, constituency, a count of criminal cases, education, and
 * total assets and liabilities as the strings "Rs 8,05,85,824~ 8 Crore+" (the exact rupee figure, a
 * tilde, and the source's own rounded-down gloss). There is no analysis pack, no date, no state, no
 * outcome, no case list and no pending/convicted split on any row.
 *
 * Every figure is what the candidate declared in the nomination affidavit, not something verified
 * here, and ADR's terms bar commercial use and redistribution, so the panel says the figures are
 * viewable here and not for export, and offers no download, export or PDF action.
 *
 * Related candidates are deliberately not drawn. The register holds one candidate per constituency
 * name except for three names that two candidates share (AURANGABAD, HAMIRPUR, MAHARAJGANJ), and a
 * row carries no state, so a shared name cannot show a shared seat. The member register places each
 * pair in a different state. Linking on the name would invent a relation.
 */
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * "Lok Sabha 2024" from the record's own MyNeta link (myneta.info/LokSabha2024/...); '' for any other
 * link, so the election is named only where the data says it.
 */
export function electionOf(url) {
  const m = /^https:\/\/(?:www\.)?myneta\.info\/LokSabha(\d{4})\//i.exec(String(url ?? '').trim());
  return m ? `Lok Sabha ${m[1]}` : '';
}

/**
 * A declared amount. `exact` is the rupee figure as written, with the source's "~ 8 Crore+" gloss
 * dropped and non-breaking spaces made plain; it is never rounded, converted or reformatted. `stated`
 * is the whole statement in the source's own words. A statement of a shape this does not know is
 * returned whole in both; a blank gives empty strings.
 */
export function declaredFigure(value) {
  const stated = clean(value);
  if (!stated) return { exact: '', stated: '' };
  const m = /^Rs (\d[\d,]*)(?:~.*)?$/.exec(stated);
  return { exact: m ? `Rs ${m[1]}` : stated, stated };
}

export default function nationalAffidavits(row) {
  const name = clean(row.name ?? row.title) || 'Candidate';
  const party = clean(row.party);
  const constituency = clean(row.constituency);
  const education = clean(row.education);
  const cases = clean(row.criminal_cases);
  const assets = declaredFigure(row.total_assets);
  const liabilities = declaredFigure(row.liabilities);
  const election = electionOf(row.source_url);
  const asOf = dateLabel(row.as_of);

  return {
    title: name,
    meta: [party, constituency, election].filter(Boolean),
    links: sourceLinks(row, 'Affidavit record (MyNeta)'),
    glance: {
      tiles: [
        { label: 'Declared assets', value: assets.exact || 'Not on record', sub: assets.exact ? 'as declared, not verified' : 'blank in the register' },
        { label: 'Liabilities', value: liabilities.exact || 'Not on record', sub: liabilities.exact ? 'as declared, not verified' : 'blank in the register' },
        { label: 'Criminal cases', value: cases || 'Not on record', sub: cases ? 'declared count; cases not listed' : 'blank in the register' },
        { label: 'Education', value: education || 'Not on record', sub: education ? 'as declared' : 'blank in the register' },
      ],
    },
    about: {
      label: '02 · As declared in the affidavit',
      rows: presentRows([
        ['Party', party],
        ['Constituency', constituency],
        ['Education', education],
        ['Declared assets', assets.stated],
        ['Liabilities', liabilities.stated],
      ]),
      cards: [
        { heading: 'Declared, not verified', body: 'Every figure here is what the candidate declared in the nomination affidavit. None of it has been verified by this terminal.' },
        { heading: 'Criminal cases', body: 'The register holds only a count of the cases the candidate declared. Individual cases, with their sections, courts and status, are not on record; the affidavit has the particulars.' },
        { heading: 'Licence', body: 'The source (MyNeta / ADR) restricts commercial use and redistribution. These figures are viewable here, not for export.' },
      ],
    },
    touches: {
      label: '03 · Candidate & constituency',
      links: [],
    },
    footer: {
      ask: 'Ask AI about this affidavit',
      provenance: {
        source: 'MyNeta / ADR candidate affidavits (licence-restricted: viewable, not exportable)',
        asOf: asOf || undefined,
        flags: asOf ? [] : ['as-of not on record'],
      },
      note: 'The affidavit is the authority; this row is an index to it. Figures are as declared and not verified, and the source restricts redistribution.',
    },
  };
}
