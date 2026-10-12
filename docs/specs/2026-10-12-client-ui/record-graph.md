# Module: record-graph

> **Status: Living.** Owner approved scope and implementation on 2026-10-12.

## Confirmed target and outcome

The live record pane's **What this bill connects to** graph, implemented by
LinkageGraph in src/desks/BillRecordPane.jsx, is removed from visible record
inspection until a future approved graph integration. This is distinct from the
National Policy Intelligence Graph module, which remains accessible.

Observed live reproduction is recorded in index.md. Source inspection shows
shared BillRecordPane handling bill, pipeline, question and regulatory records;
the live execution confirmed only a bill. Local verification now covers all four shared paths.

## Scope

src/desks/BillRecordPane.jsx, graph-specific .brec-* rules in src/index.css,
relevant colocated tests.
NationalRecord.jsx only if a presentation boundary requires it. No change to
src/lib/impactRecord.js, analysis/ontology datasets or Download identity mapping.

Remove visible graph canvas, title/node counts, Rebuild layout, Show all companies,
link-strength/directional legend, graph-only Links filters, Where the impact lands
and How the impact travels controls/output, graph hint and structural-linkage
footnote. Remove obsolete layout space and graph-only UI state/effects if safe.
Preserve the underlying data/model implementation for future work.

## Acceptance

- No graph or graph-only controls/copy appears in normal or expanded Record
  panels, summary or Full reasoning view on any shared BillRecordPane path.
- Do not remove factual prose merely because it mentions a sector/company.
  Record facts and their Read more content, substantive summary/reasoning,
  changes/watch information, related coverage, source provenance, PDF links,
  All records/back action and Ask AI remain usable.
- Existing verified PDF resolver still returns the correct document for the
  selected record. No record rows, identities, corpus or source mappings change.
- No empty graph-shaped gap or replacement Coming soon panel.
- No Neo4j integration, database change or backend deployment is included.
- Add a meaningful absence regression guard and prove it fails with the current
  graph restored. Exercise records with and without links plus expanded panel;
  apply index.md verification commands and runtime checks.
