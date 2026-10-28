# Message for the corpus ingestion agent

> **Status: Living.** 2026-10-29. F257–F260 released through PR #62, F261 through PR #64, F264 through PRs #66 and #67, and F266 through PR #70 (merge `498152f3fcfa00849778751f04046803a79f35e7`); all reviewed mappings applied. Ingestion may resume only under the rules below, one owner-approved cohort at a time.

## F264 addendum — released 2026-10-28

The two-label public capability/admin-readiness increment is released and accepted on NTER: [release evidence](2026-10-28-f264-release.md). The release does not authorize resuming ingestion. Read [the readiness contract and runnable export guide](corpus-readiness.md) before preparing an inspection report. The rules for resuming are in the next section.

Public Full text / Record only labels are presentation, not ingestion admission evidence. Preserve operational reason codes in reports and admin inspection. A Record only label does not prove missing OCR, missing embeddings or a missing mapping; never re-ingest solely to change it. Partial documents may have usable indexed passages. Null legacy keys do not prove Law/ordinary records are unlinked.

Before proposing the next cohort, reconcile stable listing tuples and current caller-visible document associations, complete vectors and publication/access separately. Keep immutable document/text/chunk hashes, all aliases, collection adapters, holds, checkpoints and exact retry evidence. Readiness pages are bounded observations, not a complete alias inventory or transactional snapshot; they cannot replace approved mapping repair manifests. Admin visibility is not proof of public-user access.

Keep the existing ingestion engine and its dry-run/manifest approvals. Unsupported adapters remain held. After the release is accepted, prepare 100 documents for separately approved validation before proposing 1,000. No batch, mapping repair, queue restart, OCR regeneration or embedding replacement is authorized by this addendum.

## F266 addendum — released 2026-10-29

Lok Sabha question answers are admitted only together with their links to the listing rows that name the same sansad.in answer file, in one transaction ([release evidence](2026-10-29-f266-release.md), [admission rules](supplied-text-import.md)). A mismatch of house, subject, ministry or answer date, a URL with no listing row, or an answer another document already holds is refused with a named reason and writes nothing. All 5,865 question documents you imported are now linked (1,207 further links for the 1,116 that were still indexing at the earlier snapshot, including 6 re-run jobs); the 82 imported on 2026-09-21 stay held. Production now runs `main` for `admin-ingest` and `ingest-worker`; your branch's migration `20261027120000` and `suppliedText.ts` change are superseded and must not be re-applied.

## Rules for every ingestion run (owner, 2026-10-29)

1. **The owner is the only approver.** Every cohort needs the owner's written approval of its exact manifest (file hash) before submission. No approval recorded under any other name counts.
2. **No autopilot.** One cohort, then stop and report. Never chain cohorts, sections or collections.
3. **Size and limits.** The next cohort per collection is a 100-document validation cohort; 1,000-document cohorts only after that cohort passes acceptance and the owner approves. Every submission states `--max-chunks` and `--max-estimated-cost-usd`; for a 100-document cohort no more than 2,000 chunks and US$0.05.
4. **Receipt for every cohort**, committed on your branch: the manifest and its hash, the approval, counts (screened, registered, indexed, linked or published, held with reasons), actual spend, and the verification output.
5. **Website acceptance for every cohort:** signed in, open at least five records from the cohort, confirm Full text, ask one attached-record question per record and confirm the cited passage is the right document. Record the result in the receipt. An indexing job alone is not completion.
6. **No shared code, migrations, deploys or direct SQL.** Change client scripts only on your branch and send them for review; shared code, migrations and deployments go only through reviewed pull requests to `main`, done by the supervisor. Hiding or changing records is a reviewed operation, never direct SQL.
7. **Access.** Do not use a stored admin password. Each approved run uses a short-lived access token issued by the owner for that run.
8. **Collections.** Admitted: Law (NCLT / IBBI orders, through the listing adapter) and Lok Sabha question answers (through F266). Everything else, including Rajya Sabha, Bills and regulators, stays held until a reviewed adapter exists.

## Copyable message

Ingestion stays paused until the owner approves your next cohort's manifest; then follow the rules above exactly. Preserve your corpus branch, checkpoints and receipts. Fetch `origin/main`, confirm it contains merge `498152f3fcfa00849778751f04046803a79f35e7` (PR #70), including PRs #62, #64, #66 and #67, and work on a separate task branch. Integrate main deliberately; do not discard uncommitted work, rewrite shared history, or touch another agent's branch. Follow AGENTS.md: leave a scoped reviewable diff unless separately authorized to publish it.

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
