# Local verification record

> **Status: Living.** 2026-10-28. Review candidate; not production acceptance.

## Executed evidence

- New failures reproduced before fixes: absent generic row key; wrong coverage RPC; global document fallback; row-tool scope escape; empty HTML persisted complete; Parliamentary member name preferred to subject; lost identity in capped previews; stale broad composer submission; stale legacy coverage key; source-alias and manifest approval guards.
- Independent agents reviewed mapping/RLS and attachment/server integration. Findings were corrected locally, including hidden-source count handling, identity invalidation, authoritative tuples, stale keys, approval bounds and alias preconditions.
- F258 real pgvector fixture passed with migration-omission vacuity, 14,999/15,000 boundaries, >15,000 skew, authenticated RLS, exact document-ID precedence, 100,000/100,001 capacity bounds and cancellation. This preceded the full-suite Docker failure.
- F257 mapping fixture passed and was non-vacuous through direct-ID readiness, mixed hidden links, source/metadata invalidation, reviewed alias sets and exact-evidence rollback (199 output lines). The subsequent Bill/Law tuple delegation and cross-desk checks now passed in the final 244-line fixture and its migration-removal negative control, both focused and within the full suite.
- Client tests: `node --experimental-strip-types --test scripts/corpus-text-import.test.mjs scripts/law-listing-reconcile.test.mjs scripts/record-mapping-repair.test.mjs`: 26 passed.
- Local browser mock: rendered five desks with Full text; unmapped, partial and revoked controls displayed their distinct states. No live auth, hosted write, provider query or NTER acceptance was performed. Application CSS is not part of this standalone component harness.
- Router import passed. No generated public data changed. `git diff --check` passed.

## Environment failures and reruns

The first full application run reported 14 suites unable to write temporary files (ENOSPC), plus three 5-second timeouts. Full SQL verification also hit ENOSPC and was stopped. Docker availability probes subsequently timed out. Other project work uses the same local Docker environment, so it was not restarted or reset.

A focused rerun cleared the environment failures and exposed a selected-record web-indicator identity mismatch; that was fixed. A clean full application rerun then passed 6,636 tests and exposed one outdated Law coverage-error fixture lacking the required row tuple; that fixture and the stale-legacy adapter path were corrected. Final application/Edge results are recorded below.

All production actions, repair application, ingestion and paid-provider tests remain held. No commit, push, pull request, merge or deployment has been performed for this candidate. Changes are an uncommitted review diff on task/corpus-record-contract. The other checkout and client's branch remain untouched.

## Final local results

- `npm test`: 434 files, 6,640 tests passed.
- Full Edge Function suite: 1,423 passed, zero failed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed (13.25 seconds).
- Router import: passed.
- `npm run test:sql`: 59 fixtures and all 59 migration-removal negative controls passed, exit 0. Final F257 Bill/Law adapter execution passed. Local verification is complete for owner review; production acceptance remains held.

Final logs remain in `/tmp/f257-npm-final.log`, `/tmp/f257-edge-final2.log`, `/tmp/f257-lint-release-candidate.log`, and `/tmp/f257-build-release-candidate.log`. NTER acceptance remains pending review. Changes remain uncommitted; no production changes or re-ingestion occurred.

## Docker recovery and completed SQL gate — 2026-10-28 IST

No SQL test runners were active before recovery. Docker API calls timed out; the supported Desktop restart also timed out because four backend processes would not stop. Targeted termination stopped three; the remaining stalled backend required SIGKILL. Reopening Docker Desktop restored the daemon without a factory reset, pruning or volume deletion. Only the two existing disposable Niyantran PostgreSQL containers were started.

The first focused attempt reached PostgreSQL before crash recovery completed and failed with “not yet accepting connections”; this was an environment failure, not a fixture pass. After both `pg_isready` checks accepted connections:

- `bash supabase/tests/run.sh record_document_associations feature_search_recovery`: both passed, with both migration-removal controls failing as intended.
- `npm run test:sql`: all 59 fixtures passed; all 59 negative controls passed, alongside the runner's concurrency and rollback checks. Exit 0.
- `git diff --check`: passed after the verification documentation update.

No implementation code changed during this recovery turn. The earlier 6,640 application tests, 1,423 Edge tests, lint, build, router and client-script checks remain applicable. SQL execution used synthetic disposable databases only; no hosted migration, mapping repair, ingestion, provider request, publication or deployment occurred. The local candidate is ready for owner review, not production-accepted. Working changes remain uncommitted on `task/corpus-record-contract`.

Recovery logs are retained under ignored `ingest/f257-review-20261028/verification-logs/`: `f257-sql-recovery-focused.log` (startup failure), `f257-sql-recovery-focused-ready.log`, and `f257-sql-recovery-full.log`.

## Release review — 2026-10-28 IST

Owner authorized PR, merge after CI, production deployment, verified association repairs and cross-desk NTER checks. Larger batches remain held. Integrated current main (persona rollout) in f2541a73; retained both sets of regression tests. Independent mapping/SQL and UI/server reviews found no blocker. Integrated application suite: 6,649 tests in 436 files; Edge suite: 1,440 passed; lint/build/router passed. Full integrated SQL suite and CI are pending.

Read-only hosted revalidation checked all 5,638 approved associations in groups of 250 against full row/document/chunk fingerprints and source URL peers: zero stale/conflicting associations. The manifest remains SHA-256 102b734567d764aa354c838a7e1e3df292f444bfedcd3ea4d84d96f94c9beac7. This is preflight evidence; apply must still recheck under transaction locks. No mappings applied at this point.
