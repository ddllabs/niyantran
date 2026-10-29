# Message for the corpus ingestion agent

> **Status: Living.** 2026-10-29. F257–F260 released through PR #62, F261 through PR #64, F264 through PRs #66 and #67, F266 through PRs #70 and #72 (merge `60f453f15063924d44d3f04e402b4a3427be0320`), F270 and the access rule through PR #74 (merge `41839f07f838112f6cf7ceb3c397e04e487ca61e`), and the reply below through the PR that adds it; all reviewed mappings applied. Ingestion may resume only under the rules below, one owner-approved cohort at a time.

## F264 addendum — released 2026-10-28

The two-label public capability/admin-readiness increment is released and accepted on NTER: [release evidence](2026-10-28-f264-release.md). The release does not authorize resuming ingestion. Read [the readiness contract and runnable export guide](corpus-readiness.md) before preparing an inspection report. The rules for resuming are in the next section.

Public Full text / Record only labels are presentation, not ingestion admission evidence. Preserve operational reason codes in reports and admin inspection. A Record only label does not prove missing OCR, missing embeddings or a missing mapping; never re-ingest solely to change it. Partial documents may have usable indexed passages. Null legacy keys do not prove Law/ordinary records are unlinked.

Before proposing the next cohort, reconcile stable listing tuples and current caller-visible document associations, complete vectors and publication/access separately. Keep immutable document/text/chunk hashes, all aliases, collection adapters, holds, checkpoints and exact retry evidence. Readiness pages are bounded observations, not a complete alias inventory or transactional snapshot; they cannot replace approved mapping repair manifests. Admin visibility is not proof of public-user access.

Keep the existing ingestion engine and its dry-run/manifest approvals. Unsupported adapters remain held. After the release is accepted, prepare 100 documents for separately approved validation before proposing 1,000. No batch, mapping repair, queue restart, OCR regeneration or embedding replacement is authorized by this addendum.

## F266 addendum — released 2026-10-29

Lok Sabha question answers are admitted only together with their links to the listing rows that name the same sansad.in answer file, in one transaction ([release evidence](2026-10-29-f266-release.md), [admission rules](supplied-text-import.md)). A mismatch of house, subject, ministry or answer date, a URL with no listing row, or an answer another document already holds is refused with a named reason and writes nothing. All 5,865 question documents you imported are now linked (1,207 further links for the 1,116 that were still indexing at the earlier snapshot, including 6 re-run jobs); the 82 imported on 2026-09-21 stay held. Production now runs `main` for `admin-ingest` and `ingest-worker`; your branch's migration `20261027120000` and `suppliedText.ts` change are superseded and must not be re-applied.

## Reply to the 2026-10-29 reconciliation and validation cohort 1

The receipts for batches 2–6, the production-change list, the reconciliation and validation cohort 1 were received in the client agent's single-file handoff of 2026-10-29 (written against `main` `498152f`). Since then:

- **Rules on main.** "Rules for every ingestion run" is on `main` (PR #71); rules 1, 3, 6 and 7 were revised on 2026-10-29 (owner named; Law validation limits; guarded read-only SQL; own-account sign-in per run).
- **Question ids are pinned** (PR #72): a CI test fixes ids 1–8000 to their answer file and member, the desk-row loader refuses to renumber or change a linked row, and the stored rows carry session and Has answer from the answer URL. Positional `row_key` is no longer an open risk; rule 8 applies.
- **The 82 imports of 2026-09-21 stay held, unlinked.** Owner decision: keep, not retire, not re-register. No action.
- **Unchanged since `498152f`:** `scripts/corpus-text-import.mjs`, `supabase/functions` and `supabase/migrations`, so cohort 1's dry run and manifest `a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c` remain valid. `scripts/load-desk-rows.mjs`, `scripts/pq-row-refresh.sql` and two SQL fixtures did change, so a guard that requires `scripts/` and `supabase/` to equal `498152f` must be re-pinned to the current `main` commit, and the dry run re-run.
- **Push.** The owner authorizes pushing `task/client-corpus-claude-2026-10-29` to `origin`, that branch only, after merging current `main` into it. Never push to `main`; the developer reviews the branch and carries the receipts and client scripts to `main` through a reviewed pull request.
- **Cohort 1 is not yet approved.** After the push the developer reviews `pq-validation-cohort.py`, `pq-cohort-ceilings.mjs`, the tests and `run-validation-cohort-1.py`; then the owner approves the hash in writing.
- **Website acceptance for batches 1–6 passed** on 2026-10-29, done by the developer, signed in, on one answer from each batch (b04's added later the same day; [F266 release evidence](2026-10-29-f266-release.md)); record it in your receipts and do not repeat it.
- **Search capacity** (F272): fallback search within one listing section is bounded at 100,000 searchable chunks. Lok Sabha answers have 60,611 and stay under it. NCLT / NCLAT (Insolvency) already has 225,273, so an underfilled Law search there fails explicitly instead of recovering. The Law validation cohort may proceed; Law cohorts of 1,000 wait for F272.
- **The 121 `last_page_empty` holds** may be proposed after cohort 1 is accepted, as a reviewed client screen change with its own causal test. The other screen holds stay held by default.

## Developer review of the client branch (2026-10-29)

`task/client-corpus-claude-2026-10-29` was reviewed at `5dba5f66` and, after the requested fixes, at `4316929c5e2978267e0a689854f3cd417c1dc36c`, and carried to `main` by the pull request that adds this section.

- **Shared code:** `scripts/` and `supabase/` equal `main`; everything the importer loads is inside them, so the run script's guard (pinned to `8820f63`) covers it.
- **Cohort 1:** manifest `a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c` and the dry-run summary (100 ready, 0 held, 829 chunks, ceiling US$0.046490) match. A separate read-only check found none of the 100 already stored (by text hash, file or link, in any section); all 100 have listing rows (114), and ministry, date and subject agree on all 114 (7 subjects differ only by a double space in the listing).
- **Tests:** the three offline suites pass (9, 11 and 3 tests).
- **Fixed on review:** the ingestion plan now follows the rules on `main`; the developer message is Historical; the PQ section driver and the Law autopilot core refuse to run (they signed in with a stored password and chained batches), with their originals recorded in the client README.
- **Not run by the developer:** the cohort rebuild from the staged input, which is on the client's Drive.

**Cohort 1 is still not approved.** The owner's written approval names the manifest hash above, the commit to run from (this pull request's merge commit on `main`) and the run script's sha256 `050da4fad739ff16f0bc2e37b300eccee2442dd23d4647c562a0bf823f11f15b`. The run then follows `national-pq-batch/validation-cohort-1/README.md`: live check, one submission within 2,000 chunks and US$0.05, `verify.sql`, receipt, five-record website acceptance, stop.

## Rules for every ingestion run (owner, 2026-10-29)

1. **The owner is the only approver.** The owner is Tamanesh Kauri. Every cohort needs the owner's written approval of its exact manifest (file hash) before submission. No approval recorded under any other name counts. The developer (supervisor) reviews the client scripts, dry run and receipts before each approval request and after each run, but does not approve cohorts.
2. **No autopilot.** One cohort, then stop and report. Never chain cohorts, sections or collections.
3. **Size and limits.** The next cohort per collection is a 100-document validation cohort; 1,000-document cohorts only after that cohort passes acceptance and the owner approves. Every submission states `--max-chunks` and `--max-estimated-cost-usd`, set from its dry run. For a 100-document validation cohort: Lok Sabha answers no more than 2,000 chunks and US$0.05; Law orders no more than 4,000 chunks and US$0.25. The importer's conservative ceiling is about 13 times actual spend; choose a representative cohort, not short documents chosen to fit.
4. **Receipt for every cohort**, committed on your branch: the manifest and its hash, the approval, counts (screened, registered, indexed, linked or published, held with reasons), actual spend, and the verification output.
5. **Website acceptance for every cohort:** signed in, open at least five records from the cohort, confirm Full text, ask one attached-record question per record and confirm the cited passage is the right document. Record the result in the receipt. An indexing job alone is not completion.
6. **No shared code, migrations, deploys or direct SQL.** Change client scripts only on your branch and send them for review; shared code, migrations and deployments go only through reviewed pull requests to `main`, done by the supervisor. Hiding or changing records is a reviewed operation, never direct SQL. Reading production is allowed only inside `begin transaction read only; … rollback;`, with every query committed beside the receipt or reconciliation that uses it; no write of any kind, including `ANALYZE` (the developer runs it after loads).
7. **Access: no stored passwords.** For each approved run, sign in yourself on nter.pro with your own admin account and give the agent that session's access token (`NTER_INGEST_ACCESS_TOKEN`); it expires within about an hour. Never put a password in a file, script or environment, and never let an unattended script sign in. The admin role is full admin (there is no ingestion-only role yet), so the token is used only for the approved run.
8. **Listing rows are not yours to load.** Question ids are pinned to their questions and the desk-row loader refuses to renumber them or to change a linked row; never run `scripts/load-desk-rows.mjs`, `scripts/pq-row-refresh.sql` or any listing change. A missing or wrong listing row is reported to the owner.
9. **Collections.** Admitted: Law (NCLT / IBBI orders, through the listing adapter) and Lok Sabha question answers (through F266). Everything else, including Rajya Sabha, Bills and regulators, stays held until a reviewed adapter exists.

## Copyable message

Ingestion stays paused until the owner approves your next cohort's manifest; then follow the rules above exactly. Preserve your corpus branch, checkpoints and receipts. Fetch `origin/main`, confirm it contains merge `41839f07f838112f6cf7ceb3c397e04e487ca61e` (PR #74) and the reply section below, including PRs #62, #64, #66, #67, #70, #71 and #72, and work on a separate task branch. Integrate main deliberately; do not discard uncommitted work, rewrite shared history, or touch another agent's branch. Follow AGENTS.md: leave a scoped reviewable diff unless separately authorized to publish it.

### Read first

- `AGENTS.md`, `docs/agents/onboarding.md`, `docs/agents/coordination.md`.
- `docs/plans/open-work.md` and `docs/specs/2026-10-28-corpus-record-retrieval-contract.md`.
- `docs/operations/2026-10-28-corpus-repair-review/README.md`, `verification.md` and `release.md` in that folder.
- `docs/operations/supplied-text-import.md`, `docs/operations/law-listing-backend-contract.md`, `docs/operations/law-listing-client-guide.md`.
- `docs/specs/2026-10-28-f261-record-availability.md` and `docs/operations/2026-10-28-f261-release.md`.
- `docs/specs/2026-10-28-parliamentary-records-first.md` and `docs/operations/2026-10-29-f266-release.md`.
- Existing ingestion scripts and their tests; `scripts/record-mapping-repair.mjs` and `scripts/record-mapping-repair.test.mjs`.

### What went wrong

The Parliamentary OCR documents and embeddings existed, but the listing records did not have a persisted association that the browser and research server could resolve. Matching a PDF URL during admission was not enough. The shared serving path previously handled Bill/Law mappings; Parliamentary record attachments could therefore carry only SQL metadata.

At larger feature size, approximate search could select global candidates before filtering and return an underfilled feature result. Missing record mappings exposed that path. Implicit widening then escaped the user's chosen context, and an empty model response could be stored as a successful answer. These are separate platform defects; do not describe all of them as corrupt OCR or failed ingestion. Do not infer an unmapped Law document solely from a null legacy key.

### What is now fixed

The released shared resolver uses the current `(tier, feature, row_key)` and reviewed document associations. Bill and Law retain their existing adapters. Browser coverage and server retrieval use the same current identity and permission/readiness checks. Attached and selection searches remain within their resolved documents, desk searches remain within the module, and broad search requires an explicit choice. Empty scoped results do not authorize widening. Automatic web context remains a separately disclosed policy and is not evidence from the attached PDF.

Underfilled feature search now recovers within the same feature, with a 100,000-eligible-chunk bound; above that it fails explicitly. This is not proof of capacity for an 18-million-document corpus or guaranteed exact recall for every filled approximate result. Empty or placeholder output is rejected as a failed answer rather than saved as complete.

The supervisor already applied 5,638 reviewed associations covering 4,749 existing Parliamentary documents, under `owner-authorized-20261028-f257-mapping-repair`. Exact replay created no duplicate links. All 49,090 chunks/vectors and full document/chunk row hashes were unchanged. Do not re-ingest those documents or replay this repair with invented approval values. The original inventory held 1,198 documents for incomplete indexing or unverified identity. On 2026-10-28 the 1,116 that had finished indexing were linked under `F266-backfill-2026-10-28` (1,207 links); the 82 imported on 2026-09-21 stay held. Do not re-ingest any of them.

### Your next work

First send the owner a receipt for every National questions batch after batch 1 and a list of every production change your agent made (deploys, migrations, direct SQL), with dates. Then produce a read-only reconciliation of your batches: document IDs, source keys, exact complete URLs, text hashes, chunk/vector counts, listing tuples, verified links, visibility, holds, checkpoints and costs. Report registered, indexed, mapped, published and website-accepted counts separately. Reconcile against current live state before proposing any action; the old inventory is a cutoff-bound receipt.

Update client scripts locally to consume the released mapping contract. Existing OCR/chunking/ingestion is the engine; do not rebuild it or regenerate text/embeddings to fix associations. `record-mapping-repair.mjs` is a runnable offline planner and approved-SQL renderer, not a database executor. Its automatic adapter supports reviewed Parliamentary exact-source matches only. A new collection needs a tested adapter and policy boundary before admission.

Preserve full URL identity, validate metadata and text hashes, bind reviewed row/document/chunk fingerprints and expected aliases, and hold ambiguous or stale inputs. Never match by title alone or assign arbitrary document keys. One answer may legitimately map to multiple MP rows; distinct versions must remain explicit. Produce the review manifest, dry-run counts, proposed client-script diff, causal tests and limits before requesting a batch release.

### Acceptance before future batches

Verify authenticated Full text coverage, generic attached-record questions, exact document scope in traces, substantive answers, accurate attribution, citations and reader navigation, plus registration and mapping idempotency. Test missing/partial/held/revoked records as well as successes. Preserve checkpoints and enforce document, chunk and spend limits. A successful indexing job alone is not completion.

F261 is now released: Parliamentary record panels show current text coverage separately from source-register answer fields; cached briefs explain their metadata-only basis; new and saved attachment labels use question subjects. Nested Markdown tables render with citations. Prompt guidance distinguishes synthesis from exact quotations. Do not regenerate OCR or embeddings to correct display text.

Treat capability states precisely. Full text requires current accessible indexed documents through verified mappings; partial, held and incomplete states remain distinct. Record only means usable stored metadata with no currently usable full-text mapping. Record snapshot means the stored row identity could not be verified; do not promote it to server-citable metadata. A lookup error is unknown, not proof of absence and not permission to invent a mapping. Automatic web context is separate from attached-document evidence and explicit web overrides remain binding. Source-register has_answer fields are not an embedding-status API.

Do not patch shared frontend/server/search code or the separate F262 empty-chat history issue from the ingestion task. Report platform defects with evidence to the supervisor. The completed F261 checks do not authorize new ingestion or certify every future collection.

No cohort is authorized by this message itself. Your next step after the reconciliation: prepare one 100-document validation cohort (Lok Sabha answers that have a listing row but no document yet, or the next Law orders), run its dry run, and send the manifest, its hash, the dry-run counts and the cost estimate to the owner. Submit only after the owner approves that exact manifest, within the limits above, then send the receipt and the website acceptance and stop. 1,000-document cohorts follow only after that acceptance and a new approval.
