# Medium corpus source audit

> **Status: Living.** R7 follow-up; owner said “go” to investigating the 117 medium candidates and preparing a verified batch. [Plan](../plans/2026-10-09-medium-corpus-preflight.md).

Current state: the 91 passing small sources are ingested; 117 medium candidates remain, 63–697 chunks and 50,075–558,840 characters. Existing preflight selects only the small tier and the live worker refuses more than 100 chunks/50,000 characters per document. The production handler commits vectors in slices of 100; historical invocation interruption near 700 chunks remains evidence, not a current measured capacity guarantee.

Outcome: audit all 117 against original corpus hashes, pack text, current both-feature listing identity/Download PDF URL, actual PDF identity/version/body agreement; produce pass/hold receipts and draft stages with exact chunks/tokens/keys/URLs. Separate source readiness from execution readiness and identify client-input needs only when demonstrated.

Scope: add explicit read-only medium tier to preflight, with safety bounds of 700 chunks/600,000 characters/500 PDF pages and existing 20 MB download cap; default small behavior unchanged. Draft stages <=10 documents /1,000 chunks, no document splitting. No live worker bound changes, paid embeddings, live ingestion, destructive cleanup, endpoint/schema changes, service, deployment or publication. Pass means mapping/source evidence is adequate; executing a medium source still requires measured pilot/recovery limits and an exact release.

Acceptance: all117 have receipts; original hashes/chunk spans and live mappings checked; disjoint pass/hold totals reconcile; changes proven red/green with focused tests, npm test/lint/build; production counts unchanged; report exact runnable subset limits, staged costs, remaining internal/client questions and verification limits.

Executed outcome: all 117 audited; 48 mapping/PDF passes (10,093 chunks), all 48 no-write endpoint checks passed; 69 internal-review holds. Eight passing sources (672 chunks) require only a character-cap extension to 75,000. Exact pilot and seven-source follow-up drafts are frozen but execution-unauthorized. Production counts unchanged. [Readiness report](../research/2026-10-09-medium-corpus-readiness.md).
