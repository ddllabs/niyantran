// What /api/site-figures serves when the database cannot be read (F142 fallback). It used to hold the
// counts measured on 2026-10-12, which went stale (documents read 3,431 while the database held over
// 30,000). A figure that cannot be measured now is shown as "—", never as an old number: every field is
// null, and the pages show their own build-time snapshot figures (src/data/preview-figures.json) only
// where the snapshot counts the same thing (bills, fronts). No imports: the server reads it too.
export const MEASURED_FIGURES = {
  bills: null,
  documents: null,
  ministries: null,
  fronts: null,
  as_of: null,
};
