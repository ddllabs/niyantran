# Set-based document registration: design (F278 step 8, task C3a)

> **Status: Living (2026-11-02).** Design for the supervisor's review before any code (plan
> `docs/plans/2026-11-02-phase-c-hybrid-and-registration.md`, C3a, on `task/hybrid-search`). Spec:
> [bulk ingestion](../specs/2026-11-01-bulk-ingestion.md) §5 and §7. Open work: F278 (also F266, F268, F272–F275, F281).
>
> **Evidence class.** Everything below about current behaviour comes from reading the files cited (`path:line`, at
> `main` `792ef0fc`; Phase B at `task/chunk-partitions` `c948539b`). Nothing was executed, and no database was
> read. Sections are marked **Current** (what the code does today) or **Proposed** (this design).

## 0. Summary

- **One bulk RPC.** `ingest_register_batch` registers up to 100 documents per call. It writes documents, their text
  inputs, their queued jobs and their listing links. It never writes chunks or vectors.
- **One admission core.** The batch RPC and today's `ingest_register_text` share the same supplied-text checks:
  immutable sources, a per-source lock, payload hashes, the F266 named checks and links in the same transaction. The
  single-document RPC becomes a one-document wrapper with the same error messages.
- **`ingest-documents` stays separate.** It is a mutable replace path with synchronous embedding, used for repairs.
  The bulk runner never calls it.
- **Duplicate text is refused.** A text already held under another `source_key` is refused as `duplicate_text`.
- **The worker does the paid work.** It chunks and embeds across several documents of a batch at once.
- **A ledger** (collection policy, batch, batch item) binds every registration to a sealed manifest and lets the
  runner resume after a lost answer.
- **The runner's credential** is a dedicated database role that may only execute these functions. No personal
  session is involved.

## 1. One RPC or two

### Current

There are three registration paths, not two.

| Path | Caller and credential | Semantics |
|---|---|---|
| `ingest-documents` (Edge Function) | `scripts/ingest-national-desk.mjs` with the project secret key `sb_secret_…` (`scripts/ingest-national-desk.mjs:25`, `:431-433`), POST to `/functions/v1/ingest-documents` (`:467`) | Bearer must equal the secret key (`supabase/functions/ingest-documents/handler.ts:155-158`); up to 50 documents a request (`:18`, `:397-399`), one at a time (`:408-419`); **upsert by `source_key`** that replaces text and metadata (`index.ts:16-24`, `handler.ts:309-319`); metadata merged, with link-map replace rules (`handler.ts:190-219`); chunked and **embedded inside the request** (`:300-361`), committed in slices of 100 (`:52`, `:363-381`), `indexed_at` set last (`:384`). It refuses page-aware, supplied-text and section-context documents (`:267-274`). It has no admission checks, links or duplicate check |
| `ingest_register_text` (SQL, via `admin-ingest`) | `scripts/corpus-text-import.mjs` (client cohorts) with an admin user's session token. `admin-ingest` requires `is_platform_admin()` (`supabase/functions/admin-ingest/handler.ts:4`, `:174-175`) and calls the RPC with the service client (`index.ts:127`) | Server-side preparation `prepareSuppliedText` (`supabase/functions/_shared/suppliedText.ts:39-195`), confirm hash (`admin-ingest/handler.ts:819-828`). Law wrapper: global law lock and `law_reconcile` fingerprint for a new law source (`supabase/migrations/20261023184450_law_listing_publication.sql:209-224`). Core `ingest_register_text_unmapped`: Law and Lok Sabha answers only (`supabase/migrations/20261028130000_pq_admission_links.sql:48-60`), **immutable**, inserts the document, text input and job, plus F266 links for questions (`:64-143`). One document per call |
| `ingest_register` (SQL, PDF uploads) | `admin-ingest` upload flow | Inserts a document with **empty text** (`content_sha256` of `''`) and stage `ocr` (`supabase/migrations/20261001140000_ingestion_v2.sql:365-374`; also `20261001180000_corpus_records.sql:535-543`) |

All three are service-only. `ingest_register_text` and its siblings are granted to `service_role` only
(`20261022230537_supplied_text_connection.sql:99-100`; `20261023184450_law_listing_publication.sql:226-227`).

### Proposed: one bulk RPC on the supplied-text core; `ingest-documents` stays separate

- **`ingest_register_batch`** is the only registration call the bulk runner makes. It reuses the supplied-text
  admission core. Today that core is the body of `ingest_register_text_unmapped`, refactored into per-check functions
  that return a reason instead of raising (§5.3).
- **Collections are adapters.** Each admitted collection is an adapter that names:
  - its `source_key` pattern;
  - its desk tier and feature;
  - its identity checks;
  - its link writer.

  The two that exist are carried over: **Law** (`law_reconcile` / `law_prepare_intent`) and **Lok Sabha answers**
  (F266). National v1.1's other collections (Bills, corrigenda, regulatory, cabinet, budget, transfer orders,
  industry) still have no adapter (`docs/plans/open-work.md:37`, F275). Each is added as its own reviewed adapter,
  not as a generic "National" one. A collection without an adapter is refused `no_adapter`.
- **`ingest_register_text` stays, as a wrapper.** It calls the core with one document and re-raises the same
  messages. `admin-ingest` maps those messages (`admin-ingest/handler.ts:829-832`), so client cohorts under the
  current rules keep working unchanged.
- **`ingest-documents` is not mapped onto the batch RPC.** Three of its behaviours conflict with the bulk rules:
  - it replaces an existing source's text;
  - it merges metadata into an existing document;
  - it embeds inside the request, which is the per-request path §5.2 removes.

  The F281 repairs depend on the first two (`scripts/f281-repair/repair.mjs:14`;
  `docs/research/2026-11-01-f281-broken-documents.md:233-241`). It stays as the reviewed **repair** path. The runner
  never calls it. Retiring it, or restricting it to repairs, is a separate decision (Q4).

### Who calls it, with which role and grants

**Current.** The National path uses the project secret key, which bypasses RLS on every table. The supplied-text path
uses a person's admin session token (handoff rule 7; F268). The admin role is full admin, and no ingestion-only role
exists (`docs/plans/open-work.md:38`).

**Proposed.** A dedicated role named `corpus_ingest`:
- **Created by migration as `NOLOGIN`.** The repository is public, so no password appears in any file. The owner
  enables it once, out of band: `alter role corpus_ingest login password …`, set in the dashboard. This is a
  production credential action (Q1).
- **Holds no table privileges** and does not bypass RLS. It has `EXECUTE` only on:
  - `ingest_batch_open`, `ingest_batch_add_items` and `ingest_batch_seal`;
  - `ingest_register_batch`;
  - `ingest_batch_status`, `ingest_batch_stop` and `ingest_batch_requeue`;
  - `ingest_text_holders`;
  - the acceptance readers (§7).

  All of them are `security definer`. It cannot call `chunk_commit`, `ingest_register`, `law_publish`,
  `record_mapping_apply`, the activation functions, or anything in billing.
- **Used only by the runner.** The runner connects to Postgres directly through the pooler, from a developer-run host
  that stores the password server-side. The credential is rotated per collection, as F275's manifest-bound grant
  intended. No Edge Function sits between the runner and the database (§4, F274).
- **Writes no collection policy.** Policies are written by a `service_role`-only function, `ingest_policy_approve`,
  which requires `decision_id`, `approver` and `evidence_sha256` in the same form as `law_publish`
  (`20261023184450_law_listing_publication.sql:175-176`). The owner approves the policy; the supervisor records it.
- **Records the caller.** Inside a `security definer` function `current_user` is the owner, so the ledger records
  `session_user` (`corpus_ingest`) as the actor. `ingest_jobs.requested_by` stays null, because it is a foreign key
  to `auth.users` (`20261001140000_ingestion_v2.sql:144`).
- **Fallback.** If a login role is not acceptable on NTER, the same functions sit behind a small Edge Function with
  its own secret, checked the way `ingest-worker` checks its secret (`supabase/functions/ingest-worker/handler.ts:5-9`,
  `:87-93`, `:224`). That adds back the F274 stall surface, once per call instead of once per document.

## 2. Admission rules carried over, by name

| Rule | Current (cited) | In the batch RPC (proposed) |
|---|---|---|
| **Immutability of an existing source** | Re-registering an existing `source_key` returns `existing:true` only if the stored `payload_sha256` **and** `expected` are equal. Otherwise it raises `conflict: existing source is immutable` (`20261028130000_pq_admission_links.sql:66-73`). The `protect_supplied_text` trigger refuses any later change to the row except `indexed_at`/`chunker_version` before indexing (`20261022230537_supplied_text_connection.sql:177-190`) | Same. Two named reasons: `immutable_conflict` (supplied-text source, different payload) and `legacy_source` (the key belongs to a document not registered as supplied text, e.g. a National document from `ingest-documents`; today that case raises the same immutable message because no `ingest_text_inputs` row exists, `:68-69`). The batch path never updates an existing `documents` row |
| **Per-source lock** | `pg_advisory_xact_lock(hashtextextended(source_key, 724891))`, then `documents … for update` (`20261028130000_pq_admission_links.sql:65-66`) | Same lock. All source locks of a call are taken up front, sorted (§5.2). The existing-key branch writes nothing, so it takes `for share` instead of `for update` (§5.2) |
| **Payload hash; idempotent reruns** | Server-computed `sha256(payload)` must equal `payload_sha256` (`:45-46`); text hash must equal `text_sha256` (`:58`); `expected` chunk plan validated (`:61-63`) | Same, per document. A rerun of the same call, or of any document, returns `existing` with the stored `document_id`, `job_id` and job status. Nothing is written again |
| **F266 checks: named refusal, write nothing, one transaction** | `national question held: answer_key_conflict / house_conflict / subject_conflict / date_conflict / ministry_conflict`; `another document holds this file_url`; `another document holds this answer`; `no desk row for its file_url` (`:78-113`); answer lock `hashtextextended(answer_key, 724893)` (`:83`); links inserted in the same transaction (`:123-141`) | Same checks under the same names, as reasons in the result (`answer_key_conflict`, `house_conflict`, `subject_conflict`, `date_conflict`, `ministry_conflict`, `file_url_held`, `answer_held`, `no_desk_row`). A refused document writes nothing. An admitted document's links commit with it |
| **Law admission** | New law source: global law lock `724892`, `law_reconcile` must not be `held`, and the caller's `mapping_fingerprint` must equal the proposal (`20261023184450_law_listing_publication.sql:213-219`). Publication intent written by trigger `law_prepare_intent` (`:245-257`); publication at indexing by `law_indexed_publication` (`:259-276`) | Same. Reasons `law_admission_held` (with `law_reconcile`'s reasons) and `stale_mapping`. Each law document carries its own `mapping_fingerprint` |
| **Listing rows never changed by the loader** | Registration inserts `record_document_links` rows but never writes `desk_rows` (`20261028130000_pq_admission_links.sql:127-135`). Law's own projection is written by `law_publish` at indexing, not at registration (`20261023184450_law_listing_publication.sql:197-199`), and guarded by `law_protect_projection` (`:278-293`). Handoff rule 8 | The batch RPC never inserts, updates or deletes `desk_rows`. It may only lock them (`for update`, as today) and insert link rows. A fixture asserts the `desk_rows` digest is unchanged by registration (§8) |
| **`document_key`** | Supplied text never sets `metadata.document_key`: `prepareSuppliedText` copies only an allow-list of fields, which has `document_key_suggested` but not `document_key` (`suppliedText.ts:155-179`). For questions the suggestion must equal `pq_answer_key(file_url)` (`suppliedText.ts:58-64`; SQL `20261028130000_pq_admission_links.sql:78-80`). `ingest-documents` takes keys from the link map (`handler.ts:202-219`); the unique index covers ingestion-v2 documents only (`20261001180000_corpus_records.sql:195-196`) | The batch path keeps this: it **never sets `document_key` from a pack**. A document joins its listing record only through an adapter's corroborated links (F257/F266 style). For an adapter that needs a key (Bills, F275), the key must have a desk row and no other holder under the existing corpus-key lock (`hashtext('corpus-key:'‖key)`, `20261001180000_corpus_records.sql` header). Otherwise it is refused `key_held` |
| **F281 lesson: title or key that doesn't match the text** | Title guard `titleMatches` (`src/lib/titleGuard.js:146`); printed bill number and title references `identityProblems` (`src/lib/documentRepair.js:593`), used by the repair tool (`scripts/f281-repair/repair.mjs:516-527`). Neither runs at registration today | The checks run in the runner's manifest pre-check (they are JavaScript, and SQL cannot run them). Their verdicts are bound into the record's `review.checks` (`title_guard`, `bill_identity`) together with the rules hash. An adapter that needs them (Bills) refuses `review_incomplete` unless both are `true`. This is caller-asserted, as the five existing checks are (`suppliedText.ts:74-77`). The DB re-checks only what SQL can (§6). Limit: a wrong runner could assert `true`, so automated acceptance (D2) re-runs the title guard on the stored text of the sample |
| **`servable`** | Not enforced anywhere: no read policy or code mentions it (`docs/operations/national-plan-v1.1-to-v1.2-2026-10-30.md:86`; `docs/operations/national-v1.2/b0-report.md:75`; a repository search finds it only in docs and pack scripts) | Refuse `not_servable` when the record carries `servable = false`, unless the collection policy says otherwise. It cannot say otherwise until a read policy enforces `servable` (spec §4.1 item 3). Registering unservable text with no read-side enforcement would serve it |
| **Licence class and personal data** | `licence_class` is copied into the input (`suppliedText.ts:173`) and not checked. Personal-data collections are out of scope (spec §8). Affidavits carry `eci_govt_PERSONAL_DATA_G02` (`b0-report.md:65`); MP profiles carry no class (corpus inventory report, Policy section) | The collection policy lists its admitted `(desk_tier, desk_feature)` pairs and admitted licence classes. Any other is refused `collection_not_admitted` or `licence_not_admitted`. A class matching `%PERSONAL_DATA%` is never admitted by default. MP profiles are excluded by feature, because they carry no class |

## 3. Duplicate-text rejection

**Current.** Nothing rejects the same text under another `source_key` (plan, Current state). `documents.content_sha256`
is the SHA-256 of `ocr_text` (`supabase/migrations/20260921000003_corpus_and_desk.sql:18`) and has no index (the
indexes on `documents` are listed in `20260921000003:26`, `20261001160000_ingest_discard.sql:48`,
`20261027231901_admin_corpus_readiness.sql:12-14` and `20261001180000_corpus_records.sql:195`). The PDF path stores
the empty-text hash `e3b0c442…` on every pending upload (`20261001140000_ingestion_v2.sql:373`). The same file under
two keys is allowed on that path by design (`20261001160000_ingest_discard.sql`, the `documents_file_sha256` note).

**Production has 0 duplicate groups among indexed documents on 2026-11-02.** This is the supervisor's measurement
(plan C3a). I did not run it. Before C3b ships, re-measure it over **all** rows the rule will check, not only indexed
ones (Q6). Re-check one pair in particular: `8bffca18` and `ee462209` are the same PDF file, 504 chunks each
(`docs/research/2026-11-01-f281-triage.md:143-144`; `docs/operations/2026-11-02-f281-repair.md:138`). If their stored
texts are equal, the count above is wrong.

### Proposed rule

1. **What counts.** Identical text only: equal `content_sha256`, the exact UTF-8 bytes, which is the existing column.
   No normalisation in the database.
   - Normalised near-duplicates (texts equal after `normalise()`, `supabase/functions/_shared/textNormalise.ts:6-8`)
     are reported by the manifest pre-check as `near_duplicate`. They are held for review by collection policy and
     never refused by SQL.
   - Reason: the exact hash needs no new column, no backfill and no normalisation decision. Normalised equality can
     join texts that differ in substance, such as tables whose cells differ only in spacing.
2. **The database rule.** A document is refused `duplicate_text` if another `documents` row already holds the same
   `content_sha256` under a different `source_key`:
   - whatever its indexed state: queued, failed, held and indexed rows all count;
   - except the empty-text hash, which marks a PDF placeholder.

   The refusal detail names the holder's `document_id` and `source_key`, never the text. A held text keeps its
   identity. For example, the 82 Lok Sabha imports held since 2026-09-21 would refuse a re-import of the same text
   under new keys, which matches the owner's hold.
3. **Re-registering the same key** is not a duplicate. Same payload → `existing`. Different payload →
   `immutable_conflict` or `legacy_source` (§2).
4. **Race.** Before the check, the call takes `pg_advisory_xact_lock(hashtextextended(content_sha256, 724894))` for
   every text in the call, sorted (§5.2).
   - A new partial index `documents_content_sha256 on documents(content_sha256) where content_sha256 <> '<empty hash>'`
     keeps the check an index probe.
   - It is **not unique**. The legacy paths may still write duplicates: `ingest-documents` upserts, and the PDF path
     may activate two keys to one text. A unique index would also make the F281-style repairs and uploads fail at
     their write.
   - A unique constraint is a later option, once the legacy paths are restricted (Q4).
5. **Within one manifest.** `ingest_batch_seal` refuses a manifest whose items share a `content_sha256`
   (`manifest_duplicate_text`). Which key is canonical is a policy decision: the legal pack's own dedupe list marks
   aliases with `keep=0` (1,271,630 alias keys in the corpus inventory report, Policy section). It is never the
   database's choice, so a call can never contain two texts that are equal to each other.
6. **The pre-check and the database rule agree.** The runner's pre-check:
   - groups the manifest by `content_sha256`;
   - asks `ingest_text_holders(p_hashes text[])` for live holders (hashes, keys and ids only, no text);
   - runs `ingest_register_batch(..., p_dry_run => true)`.

   Any database refusal the pre-check did not predict is a **disagreement**, which is a stop condition (§4.4). The
   database stays the authority.

"One text, one document, many links" is already the model elsewhere:
- one Lok Sabha answer file serves several question rows through several `record_document_links`
  (`20261028130000_pq_admission_links.sql:127-140`);
- a bill's synopsis and gazette roles are links, not copies.

A refused duplicate is therefore a candidate for a reviewed link to its holder, through the adapter's link path. It is
never a second document.

## 4. Where chunking and embedding happen

### Current

- **`ingest-documents`** chunks and embeds inside the request (`handler.ts:300-361`). It has a time ceiling of about
  700 chunks per invocation (`:39-50`). The script sends documents over 200,000 characters alone
  (`scripts/ingest-national-desk.mjs:37`, `:335`).
- **The supplied-text path is already asynchronous.**
  - Registration queues an `index` job (`20261028130000_pq_admission_links.sql:121-122`) and `admin-ingest` pokes the
    worker (`admin-ingest/handler.ts:835-838`).
  - The worker claims **one** job per invocation (`ingest-worker/handler.ts:191`), within a 100 s budget and a 300 s
    lease (`ingest-worker/types.ts:23-28`).
  - At most **two** jobs run at once (`INGEST_MAX_RUNNING`, `20261022230537_supplied_text_connection.sql:112`).
  - The worker recomputes the chunk plan and refuses a mismatch before paying (`ingest-worker/supplied-step.ts:34-40`).
  - It embeds in slices of 100 and skips slices already stored with equal `embed_hash`
    (`ingest-worker/index-step.ts:275-299`), commits through `ingest_text_commit` (100 rows at most,
    `20261022230537:68`), and activates only after every expected chunk is present (`:76-98`).
  - Embedding calls carry up to 96 inputs or 200,000 tokens (`supabase/functions/_shared/embed.ts:19`).
- **An expired supplied-text claim becomes `failed` / `text_outcome_uncertain`** instead of being retried, because
  vectors may have been bought and not committed (`20261022230537:125-129`). Measured result of this path: about 850
  documents an hour (spec §1).

### Proposed

1. **Registration writes documents, text inputs, jobs and links only.** It never reads or writes `document_chunks`.
   - The chunk plan (`expected`) is still computed by the caller with the shared code (`prepareSuppliedText` is
     already imported by the Node client, `scripts/corpus-text-import.mjs:10`) and bound at registration.
   - The worker still recomputes the plan and compares, so a wrong plan costs nothing paid
     (`supplied-step.ts:35-40`).
   - Each job carries `batch_id`.
2. **The worker embeds across documents.** One invocation claims up to `K` index jobs of the **same batch**.
   - Each claimed job keeps its own claim token, so fencing is unchanged.
   - The worker builds one input stream across their stale chunks, cut into embedding calls at `EMBED_BATCH` bounds.
   - It commits each document's slices with its own token, activates each document, and splits spend across jobs by
     token share. The exact totals stay in `model_call_logs`.
   - `INGEST_MAX_RUNNING` and `K` move from constants into a settings row (`ingest_settings`), so the supervisor can
     raise them, recorded and reviewed, without a migration. Changing them is a production configuration change.
   - Concurrency stays bounded by the claim lock (`4917230411`, `20261001140000_ingestion_v2.sql:400`).
3. **Optional, later: the provider batch endpoint** (spec §5.2, about half price, may need a direct provider API).
   - A provider batch is asynchronous, up to a day. A job must not sit in `running` while it waits, or the
     expired-claim rule above fails it.
   - The design would therefore keep the job `queued`, with `next_attempt_at` set to the poll time and a row in
     `ingest_embed_batches` (provider batch id, input file hash, job ids, state
     `prepared → submitted → completed → committed | failed | expired`, spend).
   - A claim that finds a completed provider batch commits its vectors instead of embedding.
   - **Recommendation: not in C3b.** Spec §2 says cost is not the constraint (about US$800 for everything). Do it only
     if measured throughput needs it (Q7).
4. **Ledger, retries, resumability.**
   - Every call writes its documents' outcomes into `ingest_batch_items` in the same transaction. After a lost answer
     (the F274 case), the runner reads `ingest_batch_status` instead of guessing, then re-sends only the items still
     `planned`. A re-send of a committed item returns `existing`.
   - Uncertain jobs (`text_outcome_uncertain`) are requeued by `ingest_batch_requeue`, which calls the existing
     `ingest_retry` (`20261001140000_ingestion_v2.sql:582-611`). It requeues at most once per job, and only while the
     batch's uncertain count is under its stop threshold. Committed slices are skipped on the retry
     (`index-step.ts:277-281`), so only uncommitted vectors are bought again.
5. **Stop rules (spec §5.1), enforced server-side.** `ingest_claim` gains one condition: it does not claim a job whose
   batch is `stopped`, or whose batch or collection has reached its spend or chunk ceiling. Paid work therefore stops
   even if the runner dies. A batch becomes `stopped` with a `stop_reason` when:
   - one refusal reason exceeds the policy threshold;
   - the database and pre-check disagree (§3.6);
   - an outcome is still uncertain after its one requeue;
   - spend or chunks exceed the reservation;
   - the job failure rate exceeds the policy threshold;
   - the acceptance sample fails (§7).

   Resuming after the fix is a developer step, `ingest_batch_resume`, which is service-role only and recorded.
6. **What stays synchronous, and why.**
   - **Admission** (every check in §2, §3 and §6), the **document row**, the **text input**, the **job row**, **links**
     and **ledger counts** stay in the call. Refusals must be named and write nothing (F266). Links must commit with
     their document, so that a record never shows text it is not linked to. The pre-check must be able to compare its
     verdicts with the database's verdicts on the same call (dry run).
   - **Chunking, embedding, committing and activation** are asynchronous. They are the paid and slow part, and they
     are already idempotent per chunk.
7. **What this removes.**
   - The runner makes one database call per 100 documents, not one Edge Function request per document.
   - No Edge Function sits between it and the database. The F274 stall happened inside `admin-ingest` after the RPC
     had answered (`docs/plans/open-work.md:10`), so that surface is gone.
   - A lost answer is resolved from the ledger.

## 5. Batch size and transaction shape

### 5.1 Units

- A **batch** is one ledger row bound to one sealed manifest of one collection: up to 10,000 items, the §7 ramp unit.
- A **call** is one `ingest_register_batch` request within a batch: **at most 100 documents, at most 8 MB of request,
  including the chunk plans**. A document whose payload is over 1 MB travels alone.
- **Current bounds** these build on:
  - 4,000,000 octets of payload per document (`20261022230537:25`; `suppliedText.ts:7`);
  - 800 chunks and 600,000 characters per document (`suppliedText.ts:7`, `:186-189`);
  - the postmaster loss at about 17 MB of jsonb in one call (`ingest-documents/handler.ts:24-33`).

  The 100-document and 8 MB limits are proposals for the rehearsal to confirm or lower (§9).
- **One registration call in flight per collection.** Registration is cheap, and parallelism belongs in the worker.
  This rules out registration–registration deadlocks by construction. The sorted lock order below is the second
  defence.

### 5.2 Lock order

The order is the same in every path:

1. the global law lock `724892`, only in a Law batch;
2. per-source locks `hashtextextended(source_key, 724891)`, sorted by lock value;
3. per-text locks `hashtextextended(content_sha256, 724894)`, sorted;
4. per-answer locks `hashtextextended(answer_key, 724893)` (Lok Sabha) or the corpus-key lock (keyed adapters),
   sorted;
5. row locks:
   - `documents` of existing keys `for share`, by `source_key`;
   - `desk_rows` `for update`, ordered by `(tier, feature, row_key)`.

**Batches hold one collection, never a mix.** So a Law call and a Lok Sabha call never interleave locks 1 and 4.

**This matches today's single path.** It takes source, then answer, then rows (`20261028130000:65-87`). The
single-document wrapper takes the new text lock between source and answer, so the two paths share one order.

**Against the worker** (Phase B applied):
- Activation takes `724892`, then `ingest_jobs for update`, then `documents for update`
  (`20261023184450:238`; `20261022230537:80-85`). A Law registration takes `724892` first, so the two queue and
  cannot cycle. A Lok Sabha registration never takes `ingest_jobs` locks: it reads the latest job without a lock
  (`20261028130000:70`).
- Phase B's chunk trigger takes `documents for share` on each chunk insert
  (`task/chunk-partitions:supabase/migrations/20261101120000_document_chunks_partitioned.sql:391-419`). That is why
  the existing-key branch takes `for share`, not today's `for update`: the two are compatible, so a registration
  rerun no longer blocks the worker's chunk writes.
- Registration only **inserts** documents. So Phase B's `documents_chunk_facets` trigger (`AFTER UPDATE`, `:422-443`)
  never fires from registration.
- Registration never reads `document_chunks`. It therefore cannot be the reader-then-writer that deadlocks with the
  partition swap (`:66-69` of that header).

### 5.3 Partial failure

- **Two phases in one transaction, no subtransactions.**
  - Phase 1 takes the locks, then runs every check for every document and collects the reasons. The checks become
    functions that return a reason instead of raising.
  - Phase 2 writes only the admitted documents.
  - Because the locks are held, phase 1's verdicts are still true in phase 2.
  - Per-document `BEGIN … EXCEPTION` blocks would open up to 100 subtransactions per call with writes. That exceeds
    PostgreSQL's 64-entry subtransaction cache and slows every other backend's snapshots, so it is avoided.
- **The result is per document.** Each document is `admitted`, `existing` or `refused` with a named reason.
- **Named refusals do not block the rest.** The other documents commit. `p_all_or_nothing => true` makes any refusal
  write nothing (for validation cohorts).
- **An unexpected error rolls back the whole call.** That includes a lock timeout, a constraint violation or a bug.
  Nothing is written, the runner retries after backoff, and two consecutive failures stop the batch.
- **Time and memory bounds.** The runner sets `lock_timeout = '5s'` and `statement_timeout = '60s'` per session. The
  target is a p95 call of a few seconds, which the rehearsal measures. A Law call holds `724892` for its whole length,
  which delays Law activations by that much (`20261023184450:238`). That is one more reason to keep calls short.

## 6. Text quality gates at registration

| Gate | Current | Proposed (database side, per document) |
|---|---|---|
| Hash and length | text hash, `n_chars` in code points, page count vs `pages` (`suppliedText.ts:47-51`, `:97`, `:134-136`); SQL re-checks the hash and 1–600,000 characters (`20261028130000:54-60`) | Same, in SQL too (`n_chars_mismatch`, `page_count_mismatch`) |
| Declared quality | `text_quality` must be `ok`; `page_split` is `exact` or `none` (`suppliedText.ts:65-68`) | Same |
| **Control codes** | Checked only by the repair tool: U+0000–U+001F except tab, LF, CR, plus DEL (`src/lib/documentRepair.js:64-70`, `:77`). This catches shifted-font text (F281) | Refuse `control_codes` when the text matches `[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]` |
| **Text per page** | Not checked. The F281 addendum: for 202 Regulatory documents the stored length equals the pack's own `n_chars`, so the pack's OCR was truncated and an `n_chars` check cannot catch it (`docs/research/2026-11-01-f281-triage.md:375-386`). The 45 thin ones were found at `n_pages` of 5 or more and under 600 characters a page (`:243`); the official PDFs carry 900–2,600 (`:252-254`). Same threshold in `ocrChecks` (`src/lib/documentRepair.js:310-320`) | Refuse `thin_text` when `n_pages ≥ policy.min_pages_for_density` (default 5) and code points / `n_pages` < `policy.min_chars_per_page` (default 600). If the policy needs a page count and the record has none, refuse `no_page_count`. Both numbers live in the collection policy, because short-page collections (some answers, notices) are legitimately thin |
| Title and identity | §2 (runner pre-check, bound in `review.checks`) | Required by adapters that need them |

**Routing a thin scan.** A `thin_text` refusal writes nothing. The batch receipt lists it, with its official
`file_url`, under `ocr_route`. Such documents are registered later from the **official file** through the OCR
pipeline:
- the ingestion-v2 `ocr` stage with Mistral (`20261001140000_ingestion_v2.sql`, stage `ocr`);
- never from pack text, because re-importing pack text restores the truncation (triage addendum).

A bulk adapter for that route (fetching the official PDF, `ingest_register` per document, the OCR budget) is
**separate work, not in C3b** (Q8). A sample comparison against the official file is acceptance work (D2, spec §5.3),
not a registration gate.

## 7. Interfaces to fix now (runner D1, acceptance D2)

All are proposed. Names are binding for D1 and D2 once the supervisor accepts this note.

### 7.1 Functions

```
ingest_batch_open(p jsonb) returns jsonb
  p: { collection, manifest_sha256, items_planned, chunks_planned, est_tokens, est_cost_usd, runner_commit }
  -> { batch_id, state: 'open' }
  refuses: no_collection_policy, policy_inactive, manifest_exists (same hash: returns the existing batch instead)

ingest_batch_add_items(p_batch uuid, p_items jsonb) returns jsonb       -- up to 1,000 items per call, state 'open'
  item: { source_key, payload_sha256, content_sha256, chunks, est_tokens }

ingest_batch_seal(p_batch uuid) returns jsonb
  server recomputes sha256 over the canonical sorted items; must equal manifest_sha256
  refuses: manifest_hash_mismatch, manifest_duplicate_text, over_policy_ceiling
  -> { state: 'sealed', items }

ingest_register_batch(p_batch uuid, p_documents jsonb,
                      p_dry_run boolean default false,
                      p_all_or_nothing boolean default false) returns jsonb
  p_documents[i]: { payload, payload_sha256, expected, pages, sections, mapping_fingerprint? }
                  -- the same fields as today's single call (admin-ingest/handler.ts:826-828)
  -> { batch_id, dry_run,
       results: [ { source_key, outcome: 'admitted'|'existing'|'refused'|'would_admit',
                    reason?, detail?, document_id?, job_id?, job_status?, links? } ],
       totals:  { admitted, existing, refused, by_reason: { <reason>: n } },
       batch:   { state, items, planned, admitted, existing, refused } }

ingest_batch_status(p_batch uuid, p_source_keys text[] default null) returns jsonb
  -> items with outcome, document_id, job status/stage/error_code, indexed; batch counts, spend, state, stop_reason

ingest_batch_stop(p_batch uuid, p_reason text) returns jsonb          -- runner or pipeline; idempotent
ingest_batch_requeue(p_batch uuid, p_job_ids uuid[]) returns jsonb    -- uncertain/failed jobs, once each
ingest_text_holders(p_hashes text[]) returns table(content_sha256 text, source_key text, document_id uuid)

-- service_role only (supervisor):
ingest_policy_approve(p jsonb) returns jsonb    -- decision_id, approver, evidence_sha256 required
ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
```

**Named refusal reasons (closed list).**
- **Carried over** (§2): `bad_payload`, `payload_hash_mismatch`, `invalid_source_or_text_hash`, `bad_chunks`,
  `duplicate_or_invalid_chunks`, `immutable_conflict`, `legacy_source`, `missing_job`, `answer_key_conflict`,
  `house_conflict`, `subject_conflict`, `date_conflict`, `ministry_conflict`, `file_url_held`, `answer_held`,
  `no_desk_row`, `law_admission_held`, `stale_mapping`, `key_held`.
- **New**: `not_in_manifest`, `manifest_mismatch` (payload hash differs from the item), `batch_not_sealed`,
  `batch_stopped`, `no_adapter`, `collection_not_admitted`, `licence_not_admitted`, `not_servable`, `duplicate_text`,
  `control_codes`, `thin_text`, `no_page_count`, `n_chars_mismatch`, `page_count_mismatch`, `review_incomplete`.

### 7.2 Ledger tables

All have RLS on and no policies. `service_role` gets select only. `corpus_ingest` gets nothing; it reads through the
functions.

- **`ingest_collection_policies`**
  - `collection` (pk), `policy_sha256`, `admitted` (jsonb list of `{desk_tier, desk_feature, adapter}`),
    `licence_classes` (text[]);
  - `min_chars_per_page`, `min_pages_for_density`, `require_page_count`;
  - `budget_usd`, `chunk_ceiling`, `stop_thresholds` (jsonb: per-reason refusal share, failure rate, uncertain
    count);
  - `decision_id`, `approver`, `evidence_sha256`, `active`, `approved_at`.
- **`ingest_batches`**
  - `id`, `collection` (fk), `manifest_sha256` (unique);
  - `state` check in `open, sealed, registering, registered, indexing, indexed, accepted, stopped`;
  - planned counts and estimates; `admitted`, `existing`, `refused` (jsonb by reason), `indexed`, `failed`;
  - `spend_usd` and `tokens` (summed from its jobs), `stop_reason`, `opened_by` (`session_user`), `runner_commit`,
    timestamps.
- **`ingest_batch_items`**
  - `(batch_id, source_key)` pk; `payload_sha256`, `content_sha256`, `chunks`, `est_tokens`;
  - `outcome` check in `planned, admitted, existing, refused`; `reason`, `detail`, `document_id`, `job_id`,
    `decided_at`.
- **`ingest_batch_acceptance`** (D2)
  - `(batch_id, check)` pk, with `check` in `text_hash, chunks_vectors, links_full, retrieval_probe`;
  - `sample` (document ids), `passed`, `evidence` (jsonb), `recorded_at`.
  - A batch becomes `accepted` only when all four have passed. A failing check stops the batch.
- **`ingest_settings`**: a singleton row holding `max_running` and `claim_batch`. Its defaults, 2 and 1, preserve
  today's behaviour.
- **`ingest_jobs.batch_id`**: `uuid null references ingest_batches`. It is a nullable column with no default, so
  adding it does not rewrite the table.
- **New index**: `documents_content_sha256` (§3).

### 7.3 Job and batch states

- **`ingest_jobs` keeps its states unchanged.**
  - `status`: queued, running, succeeded, failed, cancelled.
  - `stage`: index, done for supplied text.
  - Constraints `ingest_jobs_one_active` and `ingest_jobs_done_succeeded` are unchanged
    (`20261001140000_ingestion_v2.sql:122-154`).
  - A stopped batch's jobs stay `queued` and are not claimed. Its running jobs finish their current slice: the claim
    check runs at the next claim, and no lease is broken. Jobs without a batch behave exactly as today.
- **Batch state** moves forward only:

  `open → sealed → registering → registered` (every item decided) `→ indexing → indexed` (every admitted item's job
  `succeeded`) `→ accepted`

  `stopped` is reachable from any state before `accepted`. `existing` items count as decided. Their indexing state is
  read from their job.

## 8. Tests

### 8.1 SQL fixtures

The fixtures run on a disposable database through `run.sh`, with a chain that includes Phase B and ends with the C3b
migration. Each fixture's vacuity check must fail without that migration
(`supabase/tests/run.sh:306-322`).

- **`supabase/tests/ingest_register_batch.sql`**
  - **Authorization:**
    - `anon`, `authenticated` and `corpus_ingest` are denied every table;
    - `anon` and `authenticated` are denied every new function;
    - `corpus_ingest` may execute exactly the §1 list. It is denied `chunk_commit`, `ingest_register`,
      `ingest_text_commit`, `ingest_text_activate`, `law_publish`, `record_mapping_apply`, `ingest_policy_approve` and
      `ingest_batch_resume`.
    - `supabase/tests/least_privilege.sql` is extended for the new objects.
  - **Refusals:** one case per reason in §7.1. Each asserts nothing was written: equal counts of `documents`,
    `ingest_text_inputs`, `ingest_jobs`, `record_document_links`, `law_publications` and `law_document_links`, and the
    item `refused` with that reason.
  - **Duplicates:**
    - the same text under a new key, against an indexed holder, a queued holder and a failed holder → `duplicate_text`;
    - against an empty-text PDF placeholder → admitted;
    - the same key with the same payload → `existing`;
    - the same key with another payload → `immutable_conflict`;
    - a legacy `ingest-documents` row → `legacy_source`;
    - a manifest with a repeated text → `manifest_duplicate_text` at seal.
  - **Idempotency:** replaying a whole call → all `existing`, row counts and ledger counts unchanged. A lost-answer
    replay after commit → the same result.
  - **Dry-run agreement:** for a mixed call, the dry-run outcomes equal the real outcomes document by document, and
    the dry run writes nothing.
  - **Listing rows:** the `desk_rows` digest is unchanged across every case.
  - **Gates:** `control_codes`, `thin_text` at the threshold boundary, `no_page_count` under a policy that requires
    one.
  - **Stop gating:** a stopped batch's queued job is not returned by `ingest_claim`; neither is a job of a batch over
    its spend ceiling.
- **Parity.** `supplied_text.sql`, `pq_admission_links.sql` and `law_listing.sql` pass **unchanged** against the
  refactored single-document wrapper, with their error messages byte for byte. If any must change, the change is
  justified in the review.
- **`supabase/tests/ingest_register_batch_concurrency.sh`**, after `law_listing_concurrency.sh`, on the run.sh
  container only:
  - two sessions register the same text under two keys at once → exactly one `admitted`, one `duplicate_text`;
  - two calls with overlapping keys in opposite input order → no deadlock, consistent outcomes;
  - registration racing the worker's `chunk_commit` and activation on the Phase B schema → no deadlock within the lock
    timeout;
  - registration racing `ingest_discard`.
- **Guard proofs** (AGENTS.md, "prove that it fails"):
  - with the text lock removed, the same-text race admits both;
  - with the `for share` reverted to `for update`, the worker-race case shows the blocking it prevents;
  - with the claim condition removed, the stopped batch's job is claimed.

  Each is recorded as a failing run before the fix is restored.

### 8.2 Offline runner tests

The runner tests use `node --test` with a fake database. They cover:
- **Manifest building:** each item's `payload_sha256` and chunk plan equal what `prepareSuppliedText` computes
  server-side, using the same module.
- **Pre-check:** duplicates within a manifest, holders from a fake `ingest_text_holders`, `near_duplicate`, density,
  control codes, `titleMatches` and `identityProblems` verdicts bound into `review.checks`, and personal-data and
  `servable` exclusions.
- **Call planning:** the 100-document and 8 MB bounds; a document over 1 MB travels alone.
- **Resume:** a lost answer → status read → only `planned` items re-sent.
- **Stop rules:** each threshold; a disagreement stops.
- **Credentials:** never in argv or logs (as the importer's tests do today).
- **Dry run** writes nothing.

### 8.3 Deno worker tests

- Multi-job claim: per-job fencing (one stale token does not commit another job's chunks).
- Spend split across jobs.
- One job's embedding failure leaves the others' committed slices intact.
- The deadline reserve holds across jobs.
- `max_running` and `claim_batch` are read from `ingest_settings`.

## 9. Migration and rollout

1. **Phase B first.** The partition migration and the set-based access policy ship together, policy first (plan,
   Current state), with their own authorization. C1 (hybrid search) is independent of this work.
   - The C3b migration is timestamped after both `20261101120000` and C1's `20261102120000`, and its fixture chain
     includes Phase B.
   - **Correction to the dispatch:** Phase B as written has two partitions, `document_chunks_nclt` and
     `document_chunks_default` (`20261101120000_document_chunks_partitioned.sql:293-295`), not four. Bills and
     Regulatory sit in the default partition. A later partition is added with "ingestion for the feature stopped"
     (`:76-93`), which this design provides through `ingest_batch_stop` per collection.
2. **C3b migration.** It is additive except for the claim condition and the single-path refactor, and the build is
   done by Opus (`docs/agents/coordination.md`, model assignment). It contains:
   - the ledger tables and `ingest_settings`, `ingest_jobs.batch_id`, and the `documents_content_sha256` index (a
     plain build, since `concurrently` cannot run in a migration transaction; about 17,600 rows);
   - the role, `NOLOGIN`;
   - the functions and grants;
   - `ingest_claim` with the batch and ceiling condition, and defaults equal to today;
   - the single-document wrapper over the shared core.

   Apply it with ingestion paused, as for Phase B.
3. **Worker deploy.** The multi-job claim and the settings read deploy after the migration and are backward
   compatible: without a batch, `claim_batch = 1` and `max_running = 2`, as today.
4. **Rehearsal** on the disposable replica, with Phase B applied, using the existing tool
   (`scripts/eval-replica/rehearse.mjs` on `task/chunk-partitions`).
   - Apply C3b.
   - Run the runner's dry run, then a real run against the replica, for a 1,000-document National v1.1 subset. The
     Lok Sabha answers already loaded must come back as `existing` or `legacy_source`.
   - Measure call time, lock waits, backend memory per call size and worker throughput as `claim_batch` and
     `max_running` grow. Measure the cost of GIN and HNSW maintenance per chunk once C1's index exists.
   - Set the 100-document and 8 MB bounds from these results.
5. **Production.**
   - The owner approves the §5.1 model and the first collection's policy, in the one consolidated message (spec §9).
   - The owner enables the role's login.
   - Then: a dry run only, a 100-document validation batch with `p_all_or_nothing`, then the §7 ramp.
6. **Meanwhile.**
   - `admin-ingest` and `ingest_register_text` keep serving client cohorts under the rules on `main`, unchanged apart
     from the duplicate rule, if adopted (Q3).
   - `ingest-documents` keeps serving reviewed repairs.
   - Neither is used by the runner.
7. **Rollback.** The migration has a Down section (`run.sh` checks it):
   - drop the new functions, role grants, tables, column and index;
   - restore the previous `ingest_claim` and `ingest_register_text_unmapped` bodies.

   This is allowed only while no job carries a `batch_id`. After that, stop batches and keep the ledger, as
   `docs/operations/supplied-text-import.md:150` already prescribes for that path.

## 10. Open questions, each with a recommendation

1. **The runner credential (owner).** Should NTER have a dedicated login role, `corpus_ingest`, with execute-only
   grants, used from a developer-run host?
   - **Recommendation:** yes. It replaces the per-run session token (rule 7, F268) for bulk work, and the secret key
     never leaves the server.
   - The fallback is an Edge Function with its own secret.
   - Bundle this into the consolidated decision message, since the owner asked for no new asks until his reply
     (2026-11-01).
2. **No listing row (supervisor, then owner).** Should a National collection with no listing rows (Regulatory, 2,845
   documents, F275) be admitted as documents without links, against F266's "records first"?
   - **Recommendation:** not in the first collections. Finish the collections that have rows (Bills, through the F275
     adapter) and decide Regulatory's listing first.
3. **The single path (supervisor).** Should the duplicate-text rule also apply to `ingest_register_text`, the client
   cohorts?
   - **Recommendation:** yes. There is one admission core, production has 0 groups, and it closes the same hole for
     the client.
   - This changes the admission rules that apply to the client cohorts, so the change is stated in the handoff.
4. **`ingest-documents` (supervisor).** Should it be restricted to repairs: for example, refuse a new `source_key`
   and allow only existing-key text or metadata replacement under a reviewed manifest?
   - **Recommendation:** yes, as a follow-up task after C3b. That is also the precondition for ever making
     `content_sha256` unique.
5. **`expected` in the payload (supervisor).** The call carries every chunk's content, so it is about twice the text.
   - **Recommendation:** keep it in C3b, since activation compares `content` (`20261022230537:88-93`). Measure in the
     rehearsal. If it is too big, derive content from `ocr_text[char_from:char_to]` in a later change.
6. **Re-measuring duplicates (supervisor).**
   - **Recommendation:** before the migration, run a read-only count of duplicate `content_sha256` groups over all
     documents, excluding the empty-text hash and not only indexed ones, and reconcile the pair
     `8bffca18`/`ee462209`.
   - If any group exists, the rule still works: it only refuses new registrations. Record the groups in open work for
     a keep-one decision.
7. **Provider batch embedding (developers, spec §9 item 9).**
   - **Recommendation:** defer. First measure synchronous multi-document embedding with `max_running` raised. Adopt
     the provider batch only if embedding latency, not database write cost, is the measured bottleneck.
8. **The OCR route for thin scans (supervisor).**
   - **Recommendation:** make it its own task, after C3b: an adapter that fetches the official PDF and registers
     through ingestion-v2's `ocr` stage, with its own budget, since Mistral is paid.
   - Until then, `thin_text` items stay listed in the batch receipt and are not ingested.
9. **`servable` (owner, via F275).**
   - **Recommendation:** refuse `servable=false` at registration until a read policy enforces it. That keeps the
     1,354 unservable affidavits and their kind out without a new read-path change.
10. **The client's National v1.1 completion plan.** The dispatch points to its quality-standards table on
    `task/client-corpus-claude-2026-10-29`. At the locally fetched `origin/task/client-corpus-claude-2026-10-29`
    (`1578bf79`), only `docs/operations/corpus-inventory-2026-11/report.md` exists, and it has no quality-standards
    table.
    - **Recommendation:** the supervisor fetches the branch, or names the file, and checks its table against §2 and §6
      before C3b is dispatched. I could not fetch (no network in this task).

## 11. Decisions (supervisor and developer, 2026-11-02)

- **Credential (developer):** a reviewed migration creates `corpus_ingest` with execute-only grants and no login.
  The developer enables its login and sets its password in the Supabase dashboard; no agent sees or handles it. The
  runner reads it from its own server-side secret.
- **Regulatory admission:** proposed search-only, as the 474 live Regulatory documents are today (no listing rows,
  regulator derived from the source host); the developer's answer is pending. C3b does not depend on it: adapters
  decide per collection.
- **Accepted as recommended (supervisor):** one admission core for the bulk call and the single-document path,
  including the duplicate rule (Q3); restricting `ingest-documents` to reviewed repairs is a follow-up after C3b (Q4);
  the chunk plan stays in the payload, sized in rehearsal (Q5); duplicate groups re-counted over all documents
  before the migration (Q6; `8bffca18` and `ee462209` hold the same PDF but different texts, `0dc54a89…` and
  `9c816e8c…`, so exact-hash counting did not see them; `8bffca18` was taken out of search on 2026-11-02); provider
  batch embedding deferred (Q7); the OCR route for thin scans is its own task (Q8); `servable=false` refused at
  registration (Q9).
- **Partitions:** Phase B now has four partitions (NCLT, Bills, Regulatory, default), committed on
  `task/chunk-partitions` after this note was drafted; §1 and §5's references to two partitions are superseded.
