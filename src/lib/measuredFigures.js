// The last measured figures (F142 fallback). Bills and documents come from read-only queries on NTER
// on 2026-10-12 (docs/specs/2026-10-12-legal-policies.md); ministries and fronts from the carousel's
// snapshot computation the same day. /api/site-figures serves these only when the database cannot be
// read, so the marketing pages never show a blank or a zero. No imports: the server reads it too.
export const MEASURED_FIGURES = {
  bills: 9817,
  documents: 3431,
  ministries: 56,
  fronts: 88,
  as_of: '2026-10-12T00:00:00Z',
};
