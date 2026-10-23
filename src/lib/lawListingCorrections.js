/**
 * Reviewed metadata-only corrections to the bundled Law register.
 * F243 evidence and exact scope: docs/plans/2026-10-23-globiz-listing.md.
 * This publishes a listing, not an ingestion or a document_key attachment.
 */
const NCLT_CORRECTIONS = [{
  id: 'law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a',
  source_key: 'law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a',
  title: 'In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]',
  subject: 'In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025]',
  entity: 'Globiz Exim Private Limited',
  date: '2026-07-08',
  remarks: 'Rejected',
  court: 'NCLT',
  source_url: 'https://ibbi.gov.in/uploads/order/7c2928dab0f907c71d2c2aa47f13b6ce.pdf',
}];

export function withNcltListingCorrections(rows) {
  const urls = new Set(rows.map(row => row.source_url));
  // Append after the legacy sort: existing generated IDs include the array index.
  // The table's normal date sort still applies when the user chooses that column.
  return [...rows, ...NCLT_CORRECTIONS.filter(row => !urls.has(row.source_url)).map(row => ({ ...row }))];
}
