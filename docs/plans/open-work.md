# Open work: the one list

> **Status: Living.** Created 2026-09-29 from the earlier trackers. "Current state" below was re-read on 2026-11-26 and
> the milestones were re-checked on 2026-11-08; the rest was rewritten as a clean slate after the local cleanup
> session (`main` at `3a51724` and the docs commit after it). Every item is
> either Done (with its commit or its operations record), waiting on one
> named owner decision, in one of four later phases, or an accepted risk.
> Since 2026-11-26 this file holds only open items; closed ones are in [open-work-done.md](open-work-done.md).

- [ ] **F273 — Research-chat model catalogue and the citation-repair model.** *Remaining: measure the repairs since 2026-10-31 (`model_call_logs`, purpose `citation_repair`); the repair model itself is set. 2026-11-10 (F299)* *2026-10-30, owner-approved, through the admin AI models page:*
  - **Disabled `google/gemini-2.5-flash-lite` ("Gemini 2.5 Lite").** As a chat model it answered 18 times up to 21 Oct, then failed 6 of 6 ("Provider attempt failed."). It caused cohort 1's failed acceptance turn. No role used it; a stale saved choice falls back to the default before sending (`normalizeResearchChoice`).
  - **Enabled `openai/gpt-6.1-terra` ("GPT - Terra") and `mistralai/mistral-large-4-0` ("Mistral - Large").** Both on paid plans (F150: GPT Terra paid; new models default to paid), tier 2. Each answered one attached-record question correctly with the right single source (Terra 182 credits, Mistral 109).
  - **Open: the repair model.** Production's `AI_REPAIR_MODEL` still calls `google/gemini-2.5-flash-lite`, not the owner-approved `google/gemini-3.5-flash-lite` recorded in the 2026-09-21 recovery plan. Of 63 repairs, 47 were declined by the server ("content"), 8 failed at the provider and 8 succeeded. Decide whether to set the secret back to the recorded value, and why repairs are declined, before relying on repair.
  - **2026-10-31, owner-approved:** `AI_REPAIR_MODEL` set to `google/gemini-3.5-flash-lite`; the secret digest matches. All 64 repairs so far used 2.5 Lite: 8 succeeded, 48 were declined for "content" and 8 failed at the provider. The rate was the same before and after the 19 Oct quote format (2/22, 6/42). A "content" decline means the reply did not quote the answer exactly or changed more than the markers.
  - **Open:** measure the next ~30 repairs (`model_call_logs`, purpose `citation_repair`). If most are still declined, the fault is in the exact-quote matching (`repair.ts`), not the model.

- [ ] **F274 — `admin-ingest` returned HTTP 503 on a committed registration.** *Remaining: watch for stalls after a committed registration (the importer retry, `ee433539`, mitigates it). 2026-11-10 (F299)* 2026-10-29 19:19:46 UTC, cohort 1 document 54: the registration had committed (indexed, linked) but the caller saw 503, so the importer stopped as uncertain and the run resumed under the owner's instruction. Find the cause in the function logs; a committed write should not return 503.
  - **2026-10-31, second occurrence:** remainder cohort document 329 (`fa1044b9`). The logs show `rpc/ingest_register_text` answered at 11:17:02.3 and the worker indexed the document by 11:17:18. `admin-ingest` logged the result, the next line of code, only at 11:17:46.8, and no response was logged. The importer had given up at its 30-second timeout. No lock waits or database errors in that window: the stall is inside the Edge Function after the database answered. The 29 Oct case is probably the same (its logs are past retention).
  - **Importer fix (this branch):** a lost answer (timeout, network error, HTTP 5xx or 429) is asked for once more after 10 seconds with a 120-second timeout; registration is idempotent, and the server's per-source lock prevents duplicates. Only a second loss stops the run. The summary adds `existing` and `retried` counts; `submitted` is unchanged, because the batch driver relies on it.
  - **Open:** watch for further stalls; report to Supabase if they recur.

- [ ] **F275 — Developer decisions in the client's National plan.** *Remaining: the regulatory listing decision, MP profiles, the v1.2 destructive replacements, the 82 Lok Sabha replacements, the delta's `desk_row_links.csv` and load order, and review of the 118 live bills that do not match and the 132 with no key; the Bills adapter and load are done (`811feba3`, `39faf8ae`). 2026-11-10 (F299)* From `docs/operations/national-plan-v1.1-to-v1.2-2026-10-30.md` (client branch): a Bills adapter with admission links (6,813 bills; R7's 315); a listing decision for regulatory documents (2,845, no listing rows); whether and how MP profiles (3,157, personal data) are served; how the v1.2 pack's 1,819 destructive text replacements are applied; `servable=false` enforcement; and a server-issued single-use ingestion grant bound to one approved manifest (would replace the per-run session token, F268). None is authorized by the plan. 2026-10-31, from the B0 report (`docs/operations/national-v1.2/b0-report.md`): v1.2's 10,492 candidate affidavits (personal data, 1,354 `servable=false`, about 617k chunks, six times the F272 bound; affidavits were kept out of scope on 2026-09-30), its 565 MP profiles, the 82 Lok Sabha replacements of the held September imports, the delta's `links/desk_row_links.csv`, and the load order on top of v1.1. F287 confirms the Bills adapter is a blocker: `deskOk` admits only Law and National Questions, so the load relabelled Bills as question answers. Real bills of 915 and 2,240 chunks also exceed the supplied-text limit of 800. **2026-11-07:** Bills adapter built ([spec](../specs/2026-11-07-bills-adapter.md)): it identifies one bill for 2,646 of the 2,764 live bills with a key, none ambiguous. Not on NTER. Open: the owner's agreement to the relaxed text check, a dry run on the real pack, and links for live bills. Also from the spec: the 118 live bills that do not match and the 132 with no key need review. 2026-11-15 correction: "Not on NTER" in the 2026-11-07 note about the Bills adapter is superseded: the adapter and the Bills load are done and live (2026-11-10, [record](../operations/2026-11-10-bills-load.md)).

- [ ] **F278 — Bulk corpus ingestion.** *Remaining: the ramp (100k, 1M), hybrid (T9), capacity (F279, F294) and the owner's sign-off; the foundation and runner are built and Bills are loaded. 2026-11-10 (F299)* About 18 million documents to ingest, against about 850 documents an hour and one owner approval and sign-in per run today. [Spec](../specs/2026-11-01-bulk-ingestion.md), a draft:
  - a retrieval foundation first (2026-11-01, agreed by the developer): chunks partitioned by feature with an HNSW index per partition, chunk-level facets filtered during the index walk, hybrid keyword and vector search, contextual chunk headers, all gated by a per-feature eval;
  - 2026-11-01, plan step 2 (retrieval eval baseline) done on the replica: feature-mode document hit@10 is 51.8% for NCLT (29 of 56), 91.7% for Bills (55 of 60), 90.0% for Regulatory (54 of 60) and 91.7% for Parliamentary Questions (55 of 60). On NCLT, exact search finds 33 of 56 in the top 10 against 29 for the live index. [Report](../research/2026-11-01-retrieval-baseline-v2.md).
  - collection-level owner approval;
  - a developer-run, server-side bulk pipeline with automatic stops and automated acceptance;
  - an inventory first;
  - a ramp of 10k, 100k, then 1M documents.
  - 2026-11-02, from the F281 repair ([record](../operations/2026-11-02-f281-repair.md)): the client packs carry truncated OCR text for scanned documents, so bulk acceptance must test text per page and OCR thin scans from the official source. The title guard (`src/lib/titleGuard.js`) and the bill-number check belong in the bulk pipeline's acceptance checks. Eval consequence: the replica is a 2026-11-01 snapshot and no longer equals NTER for the 97 repaired documents, so refresh it, or rebuild the question set, before any live comparison.
  - 2026-11-03, plan step 3 (partitions, PR #95): recall is unchanged in every feature on the final files; broad and focused search latency are recorded gate exceptions (developer, 2026-11-03), conditional on a before-and-after measurement on NTER ([plan](2026-11-01-chunk-partitions.md)). NTER was upgraded the same day to the Large instance (8 GB RAM, 2 GB shared buffers) and a 20 GB disk; the migration builds its indexes with 1GB. [Apply runbook](../operations/2026-11-03-phase-b-apply.md). 2026-11-03: applied to NTER with the developer's authorization, both files exit 0. The before-and-after measurement is no worse in every mode, with no question lost: broad, focused and feature search are faster and document hit@10 rose slightly (broad 196 to 199 of 249, feature 205 to 206); results in the runbook's log. Next: drop `document_chunks_unpartitioned` once production has run cleanly for an agreed period (about 5 GB); measure broad and focused latency again after a few days of real use.
  - 2026-11-04, plan steps 4 and 5: set-based registration (C3) merged (PR #98), not applied. Hybrid round 1 rehearsed on a Phase B copy: on the generated set NCLT doc@10 29 to 40 of 56, but on the 30 held-out developer questions 19 to 19 (doc@40 21 to 24), so it does not ship. The developer chose to pursue hybrid search and contextual chunk headers together: [plan](2026-11-04-hybrid-and-contextual-retrieval.md), decisions D1 to D4 pending.
  - 2026-11-05, plan steps 4 and 5: hybrid round 2 and contextual headers measured on rehearsal copies, tuning sets only ([note](../research/2026-11-05-hybrid-and-headers-matrix.md)). Hybrid NCLT doc@10 29 to 44 of 56 with nothing lost; headers help NCLT but lose 6 of 60 Parliamentary Questions, which no index setting recovers. Supabase's recipe as written adds nothing. Cold hybrid latency on NTER blocks production until measured. The sealed set is not run.
  - 2026-11-05, sealed run (agent-written set, [result](../research/2026-11-05-hybrid-and-headers-matrix.md#the-sealed-run)): NCLT doc@10 vector 14, hybrid with NCLT headers 19, hybrid 14 as run, or 21 with its 17 timed-out calls repeated. Neither candidate meets the latency bar locally. T8: no critical SQL defect, changes requested, no production step yet; hybrid against vector-only (7 gained, 0 lost) is credible and hybrid against headers (21 to 19) is noise. The developer chooses the option.
  - 2026-11-06: the developer chose hybrid only (F289 holds headers), on lower risk, not on a proven recall lead over headers. T9 is now the hybrid migration and the app switch, each separately authorized; cold latency on NTER and F288 still come first.
  - 2026-11-09, T8: `20261102120000_chunk_hybrid_search.sql` applied to NTER (55 s, index 124 MB, history row by hand); the app does not call it. Warm, 72 NCLT questions, timed in the database: hybrid p95 483 ms against vector-only 170 ms, doc@10 58 against 40, as on the replica. The plan's latency bar (224 ms) fired; the developer recorded an exception, with vector-only kept as the fallback. The cold run after 6 idle hours and F288's two rollout checks come before T9 ([record](../operations/2026-11-09-hybrid-apply-and-measure.md#result-2026-11-09)).
  It needs the owner's sign-off, in one consolidated message, before it replaces the rules for every ingestion run. 2026-11-11: the order of the remaining work is in the [plan](2026-11-11-national-ingestion-next.md).

- [ ] **F279 — Corpus capacity decision.** *Waits on the developer. 2026-11-10 (F299)* The database holds 17,496 documents, 391,555 chunks and 6.5 GB (about 14 kB per chunk), with a 1.5 GB HNSW index. At 18 million documents that becomes about 400 million chunks and about 6.5 TB, and feature search already breaks above 100,000 chunks (F272). Partitioning by feature is decided in the F278 spec (§4.1); decide index size reduction (smaller vectors with re-ranking), two tiers, an external vector store, or a larger instance, from the inventory and measurements, and record it in `docs/decisions/` before the corpus passes 1 million documents. 2026-11-15 correction: the corpus figures above are from 2026-11-10 (F299) and are out of date; NTER held 23,289 documents when re-read on 2026-11-15. **Developer decision, 2026-11-15:** no decision is needed at 23,289 documents; take it up again at 250,000 documents. **Measured 2026-11-18** on the developer's go-ahead, because the packs take the corpus to about 236,000 documents ([figures](2026-11-18-national-scale-readiness.md), task E4): NTER holds 25,894 documents and 833,144 chunks at 13.5 kB a chunk, 4.0 kB of it the vector index. On a local copy of 392,945 real embeddings, an index of one bit per dimension, re-ranked with the full vector over its first 200 candidates, costs 490 bytes a chunk and agrees with exact search as well as today's index does (0.978 against 0.964). At 4 million chunks that is a 2 GB index instead of 16 GB, against 8 GB of memory. The disk (40 GB) is too small for the packs under every option. Not measured: above 393,000 chunks, the cold re-ranking read on NTER, and the desk and document filters. *Waits on the developer's choice of option. 2026-11-18*

- [ ] **F288 — App fallback when hybrid search fails.** *Remaining: live since 2026-11-16 11:49 UTC (flag row created); signed-in check 2026-11-17 took the hybrid path (retrieval 1,718 ms); the fallback has not fired on NTER. The second search in that answer was the fixed Law context search, confined to the documents already found, which is vector-only by design. 2026-11-17* From the T8 gate review (2026-11-05): a cold hybrid call past 8 s returns 57014 where `match_documents` would have answered, and nothing inside the statement can recover it. Before the app switches to `match_documents_hybrid`, add a fallback to `match_documents` behind an `app_flags` kill switch. Optional at the same time: pin `md5(prosrc)` of `law_published_document_ids()` in the migration's drift guard. Correction 2026-11-06: the app aborts at 4 s (F295), before 57014 can return, so the fallback must trigger on that abort and needs its own time budget. 2026-11-09: the developer chose option A (hybrid 2.5 s, then vector-only 4 s, both adjustable in the flag row, off by default); the apply-and-measure runbook for NTER is [here](../operations/2026-11-09-hybrid-apply-and-measure.md), with `scripts/eval-retrieval.mjs --target nter` (read-only, as `authenticated`). Then built ([spec](../specs/2026-11-08-hybrid-fallback.md)): the `app_flags` row `hybrid_search` (absent means off; budgets adjustable and clamped), hybrid then a vector-only fallback with its own budget, only for an NCLT feature search with no document ids, no fallback after Stop, no fallback when only role hydration fails; independent review accepted with nits, all applied. Not deployed; the flag row does not exist. Left open: the `tool` frame type in `supabase/functions/_shared/chatStream.ts` does not list `retrievalPath`, `hybridMs` and `fallbackReason` (no client reads them yet); whether a cancelled hybrid fetch stops its statement on the database, and whether NTER's logs record RPC arguments (the query text), are T9 checks. 2026-11-10 ([result](../operations/2026-11-09-hybrid-apply-and-measure.md#result-2026-11-10-cold-run-and-f288s-rollout-checks)): the logs do not record the search text on the app's path; a cancelled call keeps running on the database (shown through the CLI path, capped at 8 s for the app); the cold run, taken during the Bills load, failed the 2.5 s rule with 4 of its first 6 hybrid calls over it, max 5.5 s, answers unchanged. Awaits the developer: ship with the fallback, or re-run cold after the loads. 2026-11-15 correction: the last sentence is superseded by the keep-warm decision of 2026-11-11 recorded under F324 (keep-warm applied; one cold measurement straight after the next eviction decides, and the developer then decides to ship or hold hybrid and the `hybrid_search` flag row). 2026-11-16: that measurement passed (F324), the developer chose to ship, and the row `hybrid_search` (`enabled` true, `hybrid_ms` 2500, `fallback_ms` 4000) was created on NTER at 11:49 UTC after a rolled-back dry run; rollback is deleting the row. Remaining: one signed-in NCLT question on the site, then a read of `messages.activity` to confirm the hybrid path; the fallback has not yet fired on NTER.

- [ ] **F289 — Decide later: chunk headers and model-written context.** *Waits on the developer. 2026-11-10 (F299)* The developer chose hybrid only on 2026-11-06 ([D5](2026-11-04-hybrid-and-contextual-retrieval.md#decisions-developer-2026-11-04)). Metadata headers (`supabase/functions/_shared/chunkHeader.ts`) stay in the repository, off. They gained in broad search (38 to 42 of 45) but cost a re-embedding and lost 6 Parliamentary Questions when applied to every desk. Model-written context per chunk, D1's third option, was never tested; it is estimated at US$150–400 for NCLT and may suit questions that name no party (hybrid found 6 of 15). Testing it needs its own decision, a costed NCLT pilot and a new sealed set, since the 2026-11 set is spent. **Developer decision, 2026-11-15:** not now; take it up again after the hybrid decision.

- [ ] **F285 — The bulk runner must guard partitions.** *Remaining: automatic partition creation and its revoke and row-level security lines; Parliamentary Questions in the default partition. The runner itself is built (`8d232373`, `283df2be`, `e1a47bbb`, `75f4c48e`). 2026-11-10 (F299)* Nothing creates a partition automatically. A new desk lands in the default partition, and past 100,000 chunks it can raise `FEATURE_SEARCH_RECOVERY_LIMIT`. Moving it later needs that desk's ingestion stopped and its vector index rebuilt (no re-embedding). The runner should refuse a load whose projected chunks pass 100,000 on a feature without a partition, and a new partition needs the revoke and row-level security lines in `20261101120000_document_chunks_partitioned.sql`: a partition read directly bypasses the parent's policies. F287 adds runner requirements (2026-11-06): size each call on the whole request under the 8 MB limit, since chunk rows add to the text; keep `claim_batch` × workers at or below `max_running`, or workers queue; about four workers did best locally; remove control codes only after checking the pack's hashes against the original text, and hold a text with too many (likely a shifted font), because real text has some and registration refuses them; add a disk stop rule. A desk in the default partition is the real exposure: Parliamentary Questions holds 68,064 chunks there. 2026-11-07: the runner's stages are built on `task/f285-bulk-runner` ([spec](../specs/2026-11-07-bulk-runner.md)), with the partition guard, disk stop and per-call sizing; the command line, production `Db`, pack reader and acceptance are still to come. 2026-11-08: the command line and the production `Db` (`psql` as `corpus_ingest`, no new dependency) are built and proved on the full-size copy, PostgREST and `psql` alternating in one sitting ([spec](../specs/2026-11-08-runner-cli-and-acceptance.md)); 2026-11-09: automated acceptance (slice B) is built with the developer's decisions (stored-vector probe, 50 a batch, all passing, the developer's own login read only), proved on the load copy, including a removed vector caught by name; the pack reader waits on pack access. 2026-11-10: the pack reader is specified ([spec](../specs/2026-11-10-pack-reader.md)): one documents entry of one pack, read from Drive by the read-only service account, verified against the pack's manifest, filtered (`servable = false`, `BARRED_` licences and v1.6 replacements dropped and counted) into a records file with a receipt. *2026-11-15 (night):* built on `task/f285-partition-guard` (`72fb98e7`), independently reviewed (accept with changes; seven changes applied). The 100,000-chunk refusal already existed in `plan.ts`; the list of partitioned features came only from the collection file. `run` now reads the list from the database catalog (read-only) and judges by it; `plan` stays offline and judges by the file, so the two can differ. New migration `20261114090000_create_document_chunks_partition.sql`, not applied anywhere: `public.create_document_chunks_partition(feature)`, run by hand by the owner of `document_chunks`; it creates a partition with row-level security and the revokes, refuses a feature that has rows in the default partition, refuses an existing partition that lacks the access rules, waits at most 2 s for its lock, and states its rollback. Fixture `create_document_chunks_partition.sql` passes with its vacuity proof; removing the table revoke fails it. 617 bulk-runner tests pass; the full SQL suite passed on the pre-review version (79 fixtures) and only this fixture was re-run after. Still open: Parliamentary Questions in the default partition (the function refuses it by design; the move is the procedure in the header of `20261101120000_document_chunks_partitioned.sql`); the stored-chunk count (`chunksNow`) still comes from the collection file; the function is in `public` (execute revoked from public, anon, authenticated and service_role); `run` now makes its pre-checks before printing the plan.

- [ ] **F286 — Unexplained slow window on the hybrid rehearsal copies.** *Ready to build. 2026-11-10 (F299)* In the sealed run of 2026-11-05, the hybrid-only feature pass had 17 timeouts on every desk, including desks hybrid does not touch, and the next warm-up 24, while the same path ran vector-only two minutes earlier with none. Load rose to about 12; no autovacuum or other query was found ([note](../research/2026-11-05-hybrid-and-headers-matrix.md#the-sealed-run)). Establish the cause, and whether hybrid's calls contribute, before production. F287 saw the same signature on 2026-11-06 with vector-only search, on the base copy as well as the grown one, so hybrid is not its cause: the trivial read timed beside each search stalled too. Host load explains one of the two worst passes and not the other. 2026-11-11: the three local rehearsal copies (`niyantran_rehearsal_c2hybrid`, `c2mixed`, `b9final`, 10 GB each) were dropped with the developer's approval to free the measuring laptop's disk, so the window can no longer be studied on them; rebuild a copy from the replica and the migrations if this is taken up. **Developer decision, 2026-11-15:** deferred: the copies it was seen on were dropped on 2026-11-11; rebuild one only if it is taken up.

- [ ] **F292 — Broad search misses the latency bar at size.** *Waits on the developer. 2026-11-10 (F299)* Measured 2026-11-06 at 2.5 times the chunks: p50 1.4 to 1.8 times and p95 1.5 to 2.1 times, against the bar of 1.2 × base + 20 ms, in both sittings. Focused search holds; feature p95 stays within the bar on two of three quiet grown passes. Decide whether the bar or the search changes before v1.1 ([results](../research/2026-11-06-ingestion-load-proof.md#e4-search-at-size)). 2026-11-15 (developer): deferred; not built until the corpus size makes it matter.

- [ ] **F293 — Cold writes are four to five times slower.** *Ready to build. 2026-11-10 (F299)* The first 20,000-chunk window after other work ran at 14.5 and 18.8 chunks/s against 70 to 83 warm, with commits up to 85 s, which is past `corpus_ingest`'s 60 s though the worker commits as `service_role`. NTER's first batch and any batch after a restart start cold. Check worker and Edge Function limits, and have the runner warm up or start slowly. **Developer decision, 2026-11-15:** deferred as a measurement; loads start with one small file, as the Regulatory load does.

- [ ] **F296 — A timed-out embedding call fails the search.** *Waits for a live retry: 3,208 embedding calls since 2026-11-06 all succeeded. 2026-11-10 (F299)* On NTER, 4 of 449 searches since 2026-10-01 failed on an embedding call at the 4 s bound, the largest search failure seen. Later calls in the same conversations took under 1 s. Consider one retry or a separate budget. **Developer decision 2026-11-06:** one retry per query when a call gets no response. Merged in PR #102 / `d02966de` and deployed as `research-chat` v111 on 2026-11-06; moves to Done once a live retry is observed.

- [ ] **F297 — Default Focus searches no corpus.** *Waits on the developer. 2026-11-10 (F299)* A new user's Focus is Attached (`src/ai/AiPanel.jsx:442`). With nothing attached, no document or desk row is searched (`research-chat/agent.ts:573-575`), though the prompt still says to search the record. Run against fakes, not in a browser. Decide whether this is intended for a first question.

- [ ] **F298 — Broad search with a tier filter may underfill silently.** *Ready to build. 2026-11-10 (F299)* The tier is a post-filter, with no iterative scan or recovery. Read from the code, not measured.

- [ ] **F301 — One failed embedding call fails every document in it.** *Remaining: the first real batch through v11, and the optional review items. 2026-11-13* The supplied-text batch step fails every job whose chunks a failed embedding call carried, permanently (`supabase/functions/ingest-worker/supplied-batch-step.ts`), and the batch's `failure_rate` counts jobs. With `claim_batch` 10, one provider error early in a batch can pass `failure_rate` before `min_decided` is large, and stop the batch. Each innocent document in that call also uses up its single requeue. Seen in the F285 proof on 2026-11-07 (9 failed of 37 decided). Either set a sizing rule for policies (`min_decided` at least `claim_batch` / `failure_rate`) or have the worker retry the call's other documents. The F285 proof's own policy (`min_decided` 60) avoids it, so the proof does not show it. Also open from the F285 review, optional: questions lose the pack's text hash when control codes are removed; `completed` can return with an empty `accepted` for the last batch; the requeue path for items already held by another batch is untested. 2026-11-11, design (read from code, not run): confirmed at `supplied-batch-step.ts` 154 and 169-171; the claim setting was 8 on the Bills load, and the F285 proof's figures here are not in any repository document. The Bills policy (`min_decided` 400, `failure_rate` 0.02, `claim_batch` 8) sat exactly on `min_decided` = `claim_batch` / `failure_rate`, so it tolerated one bad call. Recommended: when a call carrying several documents fails, the worker re-embeds each document's share alone, so only a document whose own call fails is failed (one `ingest-worker` deploy, no migration; at most one window re-embedded per failed call). Interim, no code: `min_decided` at least 2 x `claim_batch` / `failure_rate` in any policy. Apply F291 before deploying this, since a deploy kills running jobs. Awaits the developer's choice. 2026-11-12: built (`70074038`), not deployed: when a call that carried chunks of several jobs fails, `supplied-batch-step.ts` embeds each job's share alone, in claim order, before any further window; only a job whose own call fails is failed. Every call is logged with its batch; inside the deadline reserve no solo call starts and the jobs not yet retried are released with no error. An independent review found no defect and asked for three tests, added (the vector stored on each chunk is its own input's; a call paid for and then not logged is not bought again; the reserve reached between solo calls). Worst extra spend per failed shared call: one window, about US$0.004. It covers a bad document, not an outage (F328). The interim sizing rule for policies stays. Deployed 2026-11-12 as `ingest-worker` v11 from `d93325ed`, after F291 was applied ([record](../operations/2026-11-13-release.md)); no job has run through it on NTER yet.

- [ ] **F302 — The SQL fixtures job runs close to its 20-minute limit.** *Remaining: split the SQL fixtures job; `Build and tests` also grew with F306. 2026-11-10 (F299)* On 2026-11-07, for PR #105 (commit `6890de05`, no SQL changed), the push run's `SQL fixtures (disposable Postgres)` job passed in 17.5 minutes, and the pull-request run of the same commit was cancelled at the job's `timeout-minutes: 20` (`.github/workflows/ci.yml`) while still in `npm run test:sql`. A cancelled required job blocks the merge until it is rerun. Each new fixture adds its own build and its vacuity rebuild, so the margin keeps shrinking. Either raise the limit or split the fixtures across parallel jobs; first measure which fixtures take the time. 2026-11-11: measured on PR #135's run (19 min 10 s of the 30-minute limit; over 20 minutes on PR #136). `chunk_hybrid_search` takes 367 s, about a third; then `ingest_admission_scans` 83 s, `document_chunks_partitions` 79 s, `ingest_register_batch` 51 s, `feature_search_recovery` 47 s; the other 72 fixtures take 15 s or less each. No change now; if a split is needed, `chunk_hybrid_search` in its own job is the one that pays, and it adds a required check name. 2026-11-15 (developer): deferred. A split adds a required check name, which needs a branch-protection change; the job has a 30-minute limit and ran in about 19.
  - **2026-11-07, measured** from the stamped CI logs of PR #106's two passing runs (19.1 and 16.9 minutes, 73 fixtures): `chunk_hybrid_search` takes 390 to 436 s, 38% of the job. With `ingest_admission_scans` (92 to 102 s), `document_chunks_partitions` (76 to 77 s), `feature_search_recovery` (49 to 50 s) and `ingest_register_batch` (37 to 43 s), five fixtures take 62%. The other 68 take 5 to 12 s each. PR #106 hit the limit too, on its push run, so each PR commit runs the job twice (push and pull request) and either one timing out blocks the merge.
  - **Stopgap (this change):** the job's limit is 30 minutes, and `run.sh` prints each fixture's seconds and the total. **Open:** when the total nears 25 minutes, split the fixtures into parallel jobs behind a final job that keeps the required name `SQL fixtures (disposable Postgres)`, so branch protection does not change.

- [ ] **F305 — Two unexplained failures of the bulk proof on 2026-11-08.** *Ready to build. 2026-11-10 (F299)* On the full-size load copy, with `scripts/load-proof/bulk-proof.ts --db psql`: one run's resumed batch stopped with `drain_timeout` (120 of 200 admitted documents indexed, 9 jobs failed, while unrelated test runs shared the machine); another, started one second after the previous run ended, stopped at once with `precheck_disagreement`. Six alternating PostgREST and `psql` runs straight after, from the same reset each time, all passed, so neither is specific to the `psql` connection. Watch for a repeat; if one comes, keep the run's receipt and the batch's ledger rows before resetting. 2026-11-13: two more unexplained failures, in the Regulatory rehearsal (`scripts/load-proof/regulatory-proof.ts`, fake embedder): automated acceptance reported `probe_not_first` ("not in the top results") for 1 of 50 sampled documents in 1 of the supervisor's 18 normal runs and 1 of the builder's 2, from the same reset and the same sample as runs that passed. Checked in 9 passing runs afterwards: a search with each Regulatory document's own first stored vector found the document every time, so an index miss was not observed. The failing databases were reset before they were inspected; the acceptance reports are kept outside the repository. Next time, stop before the reset. 2026-11-15: TRACED. A failed proof run now keeps its evidence outside the repository, and reset and drop refuse until it is marked inspected (branch `task/f340-f305-proof-harness`, `455c5b57`). The first rehearsal after that caught the failure with the database intact (1 of 50 sampled, `probe_not_first`). Cause, reproduced on the preserved database: an approximate-index miss. The feature goes from 10,548 to 19,293 chunks in the rehearsal, above the 15,000 limit for an exact scan, so `match_documents` uses the HNSW helper at `ef_search` 400; the failing document's own first vector does not return it at 400 or 600 and does at 700; an exact scan ranks it first at similarity 1.0 with the next at 0.097, no ties, no duplicate vector. The same probe fails 20 of 20 on that database; the same document is found on a second database built from the same data, because concurrent inserts build a different graph each run. At 400, 13 of 19,293 chunks miss their own vector on both databases. Not a race, not stale statistics, not a load defect. The fake vectors are near-random (neighbours at about 0.1 against a real median of 0.836), the worst case for the index. Measured on NTER the same day, read-only, through `match_documents`: 150 live documents sampled in each of Parliamentary Questions, Bills and NCLT; 450 of 450 in the top 10, 449 first; the one exception is a Bills document with another document at similarity 1.0 (identical first-chunk text). Limits: 150 per feature; run as the database owner; the plan was not captured. Fix built (developer decision 2026-11-15, "report, cap at one"): when a probe is not first, acceptance repeats it as an exact search in a read-only transaction with index scans off; exact rank 1 is recorded as an index miss in the report and on the console and passes; more than one index miss in a sample fails the batch (`probe_index_miss_excess`); an exact search that does not rank it first, or a recheck that errors or times out (60 s), stays `probe_not_first`. 588 bulk-runner tests pass; committed on local branch `task/f305-acceptance-index-miss` (`1045538f`), not pushed. The exact recheck scans every chunk of the feature, which on a large collection on NTER is slow and displaces cache; it runs only after a probe has failed. Remaining: run the rehearsal with clustered vectors; the two 2026-11-08 failures (`drain_timeout`, `precheck_disagreement`) are still unexplained and now have evidence-keeping. The preserved database `niyantran_ingest_load_reg_test` is still marked uninspected. No change to `ef_search` is proposed on this evidence. *2026-11-15 (later):* the acceptance change and the harness landed in PR #149 (`291c3b95`); the rehearsal proof prints the index-miss count from `0a3f65ea` on `task/f339-f345-regulatory-screen` (one miss reported and passed in the run of that day). *2026-11-15 (night):* `--vectors clustered` on the rehearsal (`916b1c4b`): fake vectors built from each text's words, so chunks of one document lie close together; the default stays random. One run in each mode on the local first-96 input: 15 of 15 and no index miss in both, so the pair shows no difference yet; a miss rate needs repeats. Not independently reviewed (harness only).

- [ ] **F307 — Pack records need a screening stage before the runner.** *Remaining: the Parliamentary Questions screen and screens for other collections; Bills screening and load are done (`1b6dddb5`, `39faf8ae`). 2026-11-10 (F299)* Found 2026-11-09 in the pack reader's proof ([spec](../specs/2026-11-10-pack-reader.md#result-2026-11-09-night)): `prepare.ts` and admission take a screened record, a top-level `text_sha256` and a `review` (`status: 'eligible'`, the text hash, the `source_key`, and `checks` for every check the collection's policy requires). Pack records carry `content_sha256` and no review, so all 6,840 v1.1 Parliamentary Questions were held. Build, per collection, a screen that runs the owner's checks (the F266 screens for answers, text per page, bill identity) and writes the review from their results, never by default. 2026-11-10: specified, Bills first ([spec](../specs/2026-11-10-screening-stage.md)): a screen per collection writes the review only from checks that ran (read-only NTER reads as the developer's login; text per page against the official PDF as a check, no re-OCR); the 157 held answers wait. The v1.2 delta's manifest is `manifest_delta.json`, which the pack reader must accept. 2026-11-10: proof done; follow-up [spec](../specs/2026-11-10-bills-admission-rules.md) admits the listing's own key and file names with runs of dots. 2026-11-10: Bills loaded on NTER ([record](../operations/2026-11-10-bills-load.md)): 5,680 bills, 266,947 chunks, US$1.34, every job succeeded; the admission rules (PR #117, `39faf8ae`) applied between the loads and rescued 543. Open: the Parliamentary Questions screen, specified 2026-11-10 ([spec](../specs/2026-11-11-pq-screen.md), a draft): v1.1 has nothing left to load (6,683 of its 6,840 answers are live, the other 157 fail the owner's F266 rules), but v1.4 and v1.6 carry answer entries (Lok Sabha 18th, Rajya Sabha, Parliament Library LS16 and LS17), to be counted after the disk cleanup; `claim_batch` 8 and `max_running` 16 are still raised. 2026-11-11, counted read-only with `pack.ts select` (receipts and profiles in `~/niyantran-eval-cache/bills-next/` and `pq-next/`; counts only). **Bills:** v1.5 `parliament_library_bills` 616 and v1.6 452 (1,046 distinct, 380 of v1.6's are replacements) are all `servable=false`, licence class `parliament_elibrary_permission_pending`, so the reader drops every one; their suggested keys repeat (499 keys for 616 records, 376 for 452), so the shared-key refusal (F314) is needed before they could load. v1.6 `bills_archived_copies` has 3 servable records (2011 bills from web.archive.org, `gazette_s52_1_q_i_unconfirmed`), one over the 600,000-character limit (F311). None of the 1,049 `source_key`s is on NTER. So no Bills load is pending; the library bills wait on the owner's permission. **Questions:** see the [spec's count](../specs/2026-11-11-pq-screen.md#t0-count-2026-11-11): v1.4 has 49,330 servable answers (Lok Sabha 22,461, Rajya Sabha 26,869), none in v1.1 and none with a listing row on NTER, so admission would refuse all of them (`no_desk_row`) until the listing grows; v1.6's 144,694 library questions are all `servable=false`. 2026-11-11, Regulatory profiled (counts only; v1.1 and v1.4 read, v1.3, v1.5 and v1.6 not): v1.1 has 3,319 records (TRAI 1,837, CCI 1,361, RBI 96, SEBI 25; 174.7 million characters; licence class `govt_material_confirm_counsel`; no `servable` field; 3,198 with no link; 22 over 600,000 characters); v1.4 has RBI 382 + 18,846, RBI text fixes 7,801 (replacements), TRAI 2,170 and SEBI 16,693 (242.0 million characters; 1,256 records share a suggested key), all `servable` true where the field exists, one `reg:` link each. NTER's 474 regulatory documents are all among these 49,211 keys. Not yet read: v1.4's licence classes and the desk feature names. Estimated, not measured: v1.1 about 220,000 chunks, v1.4 about 570,000. 2026-11-15: a search-only screen with Regulatory as its configuration now exists (`bdf4f96a`, F330); the Parliamentary Questions screen remains. 2026-11-15: the Parliamentary Questions screen is deferred until it has its own spec and the owner supplies the missing Rajya Sabha key for v1.4.

- [ ] **F311 — Long bills are past the platform's per-document limit.** *Waits on the developer. 2026-11-10 (F299)* Found 2026-11-10 in the Bills proof: 41 bills are over `SUPPLIED_TEXT.maxChars` (600,000 characters; the Companies Bill, 2009 has 261 pages) and 8 more over its 800-chunk limit (`supabase/functions/_shared/suppliedText.ts`), so neither the screen nor the adapter can take them. Loading them needs either higher limits (worker memory and time to be measured first) or a document split into parts that stay one bill for citation. **Developer decision, 2026-11-15:** the long bills stay out; the limits are not raised.

- [ ] **F312 — Four Bills documents have no `indexed_at`.** *Remaining: the 3 owner-held documents (F314). The fourth, `8bffca18`, was taken out of search on purpose on 2026-11-02 as a duplicate of `ee462209` (F281 record), not an orphan. 2026-11-10 (F299)* Found 2026-11-10 in the rescued Bills' acceptance ([record](../operations/2026-11-10-bills-load.md#the-two-acceptance-failures-in-the-last-file)), where they were first described as registered and never indexed. Corrected the same day, read-only: three (2026-10-08) were indexed and then held on 2026-10-09 by the owner's decision (`metadata.mapping_hold`: their bill key also names another bill; their chunks were removed with the owner's approval), so they are F314's first known cases, not orphans. The fourth, The Finance Act, 2003 (registered 2026-09-21), has all 504 chunks and vectors but no `indexed_at` and no bill key, so no record reaches it and the resolver would call it registered. Decide with F314; nothing is deleted without the developer's go. **Developer decision, 2026-11-15:** the three held documents stay held.

- [ ] **F314 — Bills records are shown another bill's documents.** *Remaining: readiness and the admin readers, a key with house and introduction date, and why the screen let documents onto shared keys; the resolver is fixed. 2026-11-10 (F299)* Found 2026-11-10, read-only on NTER: the Bills key is `bill:<title year>:<number>` (`billDocumentKey` in `src/lib/deskRows.js`), with no house and no introduction date, and `record_resolve_document_keys` returns every document with a record's key. 396 of 9,415 keys name two or three different bills (796 rows); 374 rows resolve to a document whose title is the other bill on their key (for example, the State Bank of India (Amendment) Bill's record shows the Constitution (Tenth Amendment) Bill, 1956). 34 of those rows were wrong before the F307 load; the load added 499 of the 538 documents involved: no step of the screen or of admission refused a key that other rows share (which check should have, not yet read in code). Search itself is not affected; record links, record coverage and anything grounded on a record are. The owner held three such documents on 2026-10-09 pending disambiguation (F312). Decide: a resolver that also requires the row's bill (title, house, introduction date) to match the document, applied with a dry run like the admission rules; a new key with house and introduction date (app, rows and documents re-keyed); or hold the 499 until one of those lands. No load of further Bills before this is decided. 2026-11-10: the developer chose the resolver ([spec](../specs/2026-11-10-shared-bill-keys.md), migration `20261110180000`); dry run on NTER: 374 wrong rows to 0, no row on an unshared key changed, 242 of the 796 rows on shared keys now read `unmapped` (they had only the other bill's document). Applied on NTER 2026-11-10 12:24 UTC (PR #121, `a9521312`), with the dry run's checks inside the transaction and the history row; the live definition is the repository's. Still open: the acceptance check's own key join (F316), a key with house and introduction date, the admin functions that read `document_key` themselves (readiness among them; F300, recorded 2026-11-08 with 398 shared keys, is the same finding and is merged here), and why the screen let documents onto shared keys. 2026-11-11, traced (read from code; counts on the shipped listing): the screen and admission did not fail; passing a shared key is their designed and tested behaviour (`screens/bills.ts` `listing_row`, `ingest_bill_rows`: they find the record's own bill among the key's rows and never ask whether another bill is there; `bills_test.ts` 954-967 asserts a shared key passes). Admission linked each document to its own bill; the wrong pairings came from readers joining by key, which the resolver fixed. On all 396 shared keys of the shipped listing the bills are in the same House; they differ by name always and by date on 369. The admission 'ambiguity guard' covers one bill under two keys, not this. Proposed, not built: in the screen, hold a record on a shared key whose title is not its own bill's name (what the resolver would hide). The role rule on shared keys is F325. 2026-11-12 (read-only on NTER): admission already matches a document to its listing row by key, House, name and introduction date and writes record links (5,680 Bills links, one per bill loaded in November); the resolver's Bills branch ignores them and compares titles. Reading the links first would gain 0 of the 796 rows on shared keys today and 24 rows mapped by title belong to older documents with no link, so the title must stay as the fallback; 426 of the 796 have no mapped document. A key with House and introduction date would still leave 27 keys shared (same House, same day). Bills documents on NTER carrying each field: House 8,443, introduction date 6,801, status 6,684, ministry 6,430 of 8,576. Web search turns on when the resolver finds no document for a record; a naive switch to the generic link check would read every Bills record as `held` and turn it off, so any resolver change must compare the document side only. The chat changes that use this metadata are F331 ([spec](../specs/2026-11-12-bill-metadata-in-chat.md)). **Developer decision, 2026-11-15:** keep the resolver; no new key (27 keys would still be shared). The screen is to hold a record on a shared key whose title is not its own bill's name. *Ready to build.*

- [ ] **F318 — Law ingestion, on hold.** Legal is on hold by the owner's decision (2026-11-03, [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md)). When it resumes: the larger NCLT cohort after cohort-2 (the owner's approval); L2's text-layer check of the 874 Supreme Court and NCLT PDFs; and the Law exceptions from the 2026-10-23 reconciliation (86 dedupe winners, 17 translation parents, 169 incomplete-page declarations, 3 competing-text identities; see the corpus inventory item). *Waits on the owner. 2026-11-10 (F299)*

- [ ] **F322 — Verified-empty modules still read as unavailable in places.** From the F320 review (2026-11-10): `src/lib/stateLandingSummary.js` treats any status row as unavailable (exclude readiness `empty`); `DeskStateShell.jsx`'s empty heading reads "No matching rows" and shows no source link; the desk header's coverage label reads "No live rows"; other answers that set `nothing_new` (`server/nationalFeed.mjs` Policy Pipeline and the related answer, the SDL auctions in `featureFeed.mjs`) still render "Source offline or empty". Add a rendering test for the empty state. *Ready to build. 2026-11-10*

- [ ] **F323 — A long run of "nothing new" is not noticed.** From the F320 review (2026-11-10): a title rule that silently rejects every headline now reads as a healthy NOTHING NEW indefinitely. Flag a module whose answers have been `nothing_new` for N consecutive refreshes (for example 7 days) for a look. *Ready to build. 2026-11-10*

- [ ] **F324 — Keep NCLT search warm before the hybrid switch (T9).** From the cold re-run (2026-11-10): slow first searches follow eviction, not idle time, and NCLT's search set is about 3.0 GB with its TOAST storage (1.76 GB; hybrid reads embeddings for up to 2,000 candidates). The developer chose on 2026-11-11 to keep NCLT's whole set warm on the current 8 GB ([spec](../specs/2026-11-11-search-keep-warm.md)): `pg_prewarm` and `public.search_keep_warm()` (migration `20261111090000`), a `pg_cron` job every 10 minutes. 2026-11-11 dry runs (rolled back): `supabase_admin` owns `pg_prewarm` and grants PUBLIC execute, which `postgres` cannot revoke; accepted by the developer (the Data API serves only `public` and `graphql_public`), and the self-check records it. The TOAST relation does not stay cached in 8 GB (every prefetch re-read it, 55 s), so the developer chose to warm the indexes and table only (1.23 GB, about 8 s a run). Applied on NTER 2026-11-10 21:06 UTC (PR #133, `879899bf`), after a final rolled-back dry run (3.0 s call; `anon` and `authenticated` cannot execute `search_keep_warm()`), with its history row; `pg_cron` job 7 `search-keep-warm` (`3-59/10 * * * *`, as `postgres`) created, first run 21:13 UTC succeeded in 83 ms. Rollback: `select cron.unschedule('search-keep-warm')`, drop the function and the extension, delete the history row. 2026-11-16: the cold measurement was taken at 11:19 UTC, after the Regulatory load (which pushed keep-warm runs from 0.1 s to as much as 28 s, so the set was evicted): vector-only first call 351 ms, hybrid slowest call 1.29 s, no call over 2.5 s, all 72 rankings unchanged; hybrid read 45,979 TOAST blocks ([result](../operations/2026-11-09-hybrid-apply-and-measure.md#result-2026-11-16-cold-measurement-after-the-regulatory-load-keep-warm-on)). The rule passes. Not covered: the first minutes after a database restart, before keep-warm's first pass. The developer chose to ship; the `hybrid_search` row was created on NTER at 11:49 UTC ([record](../operations/2026-11-09-hybrid-apply-and-measure.md#result-2026-11-16-the-app-switched-to-hybrid-t9)). *Remaining: a measurement of the first searches after a database restart, when one next happens. 2026-11-16*

- [ ] **F325 — On a shared bill key, the second bill's document of a role can never be admitted.** Found 2026-11-11 in the F314 trace (read from code): the unique index `documents_bill_key_role` and admission's `bill_role_held` (`20261107120000_bills_adapter.sql` 46-48, 255-266), and the screen's `role_held_live` and `role_collision`, treat key, House and role as one bill. Where two bills share a key (396 keys), once one holds a role the other's document of that role is refused or held as a duplicate. This may explain part of the 242 rows that read `unmapped` after the resolver fix (inferred, not counted). Only a key with house and introduction date fixes it (F314's open option). *Waits on the F314 key decision. 2026-11-11* **Developer decision, 2026-11-15:** accepted as a limit of shared keys; such records are held at the screen (F314). No key change.

- [ ] **F330 — Regulatory has no admission path.** Found 2026-11-12 while specifying the Regulatory screen (read from code): `ingest_admit_tier` and `ingest_admit_adapter` know only Law, Parliamentary Questions and Bills, `ingest_policy_approve` refuses any other desk, and the worker's `prepareSuppliedText` rejects the feature; the 474 regulatory documents on NTER came from the first corpus pass (2026-09-21). The pack spells the desk "Regulatory Body Watch (RBI SEBI TRAI CCI)" and the listing "Regulatory Body Watch (RBI/SEBI/TRAI/CCI)", so the screen core finds no listing rows. Loading Regulatory therefore needs a search-only admission branch (a migration), a change to the worker's shared text code with deploys, and a screen ([spec](../specs/2026-11-12-regulatory-screen.md)). The same path would serve the other v1.1 collections. Built 2026-11-12, not applied or deployed: migration `20261113090000_national_search_only` (a search-only branch in the five admission functions, their current bodies plus insertions only; no record link; a completeness basis of `page_check` or `density_only`; file URL and suggested key checked for shape, length and being already held, each behind a unique partial index; `a7c24ba4`), the shared text adapter accepting the desk and the basis with payloads for Law, questions and Bills unchanged, and the generic search-only screen with Regulatory as its configuration (`bdf4f96a`): 17 checks, the basis recorded only from checks that ran and passed on the record, a count-only identifier-shape scan. End-to-end tests from the screen to prepare and plan found that the screen accepted a file URL with no slash after the host, which admission refuses; fixed (`2959b98d`). Each piece independently reviewed (accept with changes, applied). On the v1.1 pack offline: 2,693 of 3,319 records have no offline finding (76 with an official PDF URL, 2,617 for the density-only basis); held: OCR 506, duplicate text 96, page split 31, too long 22, below density 4, too short 1. Still to do before a load: the publisher check in the screen (F332), the count of title and date matches against the 474 first-pass documents, the rehearsal on the load copy, the hand check of 40 TRAI and CCI documents, the owner's three gates (licence, attribution, named individuals) and each NTER step on the developer's yes. *Built; not applied. 2026-11-12* Added 2026-11-12: the screen holds a record whose publisher the chat's resolver cannot name (`publisher_unresolved`; `_shared/publisher.ts` is now a rules file), with a test that resolves the publisher from the prepared record as admission will store it. Measured 2026-11-12: it holds 0 of the 3,319 v1.1 records (spec, build notes). Full screen run the same day: 2,617 screened, 702 held, none on the `page_check` basis (F338). 2026-11-12: the worker half is on NTER in `ingest-worker` v11 ([record](../operations/2026-11-13-release.md)), inert until the migration is applied. 2026-11-13: the rehearsal proof is built and reproduced on a local database (spec, build notes; F339, F305). 2026-11-15: the title and date match against the 474 was done on the local load copy (474 confirmed: TRAI 283, CCI 189, RBI 2): all 474 match a pack record by key, by title and file date, and by content hash, and are exactly the `already_live` set; see F345 for the one pass record that duplicates a live document. Limits: titles and file dates only, no text comparison; local copy, not NTER. The Regulatory load is HELD on F346 (developer decision 2026-11-15). *2026-11-15 (night):* `admin-ingest` v14 deployed and migration `20261113090000_national_search_only` applied on NTER with its history row, after a rolled-back dry run ([record](../operations/2026-11-15-release.md)). No document loaded. Remaining: the load of the 2,605 screened records, on its own go-ahead. *2026-11-15 (late):* the first file is loaded: 100 documents, 8,775 chunks, all jobs succeeded, acceptance passed on 50, and the search check on 55 Regulatory questions is unchanged (Doc@10 50 of 55 before and after). *2026-11-16:* the other 26 files are loaded ([record](../operations/2026-11-16-regulatory-load.md)): 2,605 of 2,605 admitted, 170,822 chunks, every job succeeded, 27 acceptance reports passed (1,305 sampled, no failure, no index miss), US$0.61 logged; the ceiling was raised to 260,000 by decision and the worker settings are back at 1 and 2. Regulatory now holds 3,079 documents and 183,805 chunks. The search check on the 55 questions fell from 50 to 40 documents in the first 10: nine because newly loaded documents rank above the reference one in the exact order too, one an index miss. The earlier "no worse" verdicts compared nothing (the script compares broad mode only; these runs were feature mode). Remaining: the developer's reading of that result; a signed-in check on the site; `eval-retrieval.mjs --compare` must compare the mode it ran; the runner should keep the error text when acceptance throws.

- [ ] **F331 — Bill metadata in the research chat.** From the developer's direction (2026-11-11) to use a bill's other metadata, not only its title ([spec](../specs/2026-11-12-bill-metadata-in-chat.md)). Built 2026-11-12 (`21e050cb`): when the forced web-only call fires for one national Bills record with no indexed document, its message names the bill from the verified listing row ("Bill No. n of yyyy" only when the title year equals the introduction year, otherwise the introduction date); after ranking, each Bills document carries one line of catalogue fields (number with its year, House, introduced date), shown to the model once per document per reply, labelled as not passage text, left out of the reply-size measure and never embedded, cited, saved or streamed; one sentence added to the citation rules. Status and ministry are not shown: admission does not check them and a fact on the line would be cited to a passage that does not say it. Independent reviews of the spec and of the build; 1,587 Edge Function tests pass. Deployed 2026-11-12 as `research-chat` v112 from `d93325ed` (rollback: v111's commit `d02966de`; [record](../operations/2026-11-13-release.md)). Not yet countable: how often the forced web call runs, and for which desk. Signed-in spot-checks on the live site, 2026-11-13, both passed (one turn each): on a Bills record marked "Record only" the chat searched the web, named the bill by its number, House and introduction date as the record has them, and said the corpus holds no document text for it; on a Bills record with full text the answer gave the number with its year, the House and the introduction date as the record has them, and the passage cited for the number contains it. *Remaining: the count of forced web calls, by desk; the developer's word to close. 2026-11-13*

- [ ] **F333 — The Bills screen's rules hash misses three files.** Found 2026-11-12 in the Regulatory screen's review (read from code): `screens/bills.ts` lists its `rulesFiles` without `prepare.ts`, `supabase/functions/_shared/suppliedText.ts` and `_shared/textNormalise.ts`, whose `strip`, `billUrlSegmentsOk` and `sha256Hex` its checks use, so `rules_sha256` does not move when they change. The search-only screen lists them. Add them to Bills (its hash changes once). *Ready to build. 2026-11-12*

- [ ] **F334 — Bills hold details quote values from the record.** Found 2026-11-12 while building the search-only screen (read from code): in `screens/bills.ts` the page-span detail prints the record's `page_number`, and the duplicate-text and collision details print other records' `source_key`; a hold's own `source_key` is printed up to 200 characters. A malformed record can put its own text there. The search-only screen neutralises these (`holdKeys`, wrappers); give Bills the same. *Ready to build. 2026-11-12*

- [ ] **F332 — The publisher in citations for regulatory documents.** From the owner's decision that every citation carries attribution ([spec](../specs/2026-11-12-citation-attribution.md)). Built 2026-11-12 (`dc8e1762`), deployed 2026-11-12 in `research-chat` v112 ([record](../operations/2026-11-13-release.md)): a national Regulatory passage carries its publisher (RBI, SEBI, TRAI or CCI, from one fixed table in `supabase/functions/_shared/publisher.ts`), the model sees it in the passage header with the rule that publishing alone does not make a statement that body's finding, and the citation chip, source list, reader and copied text show it. An unknown or malformed regulator code shows no publisher. Titles and features are escaped so they cannot forge the publisher field. Checked signed in on the live site, 2026-11-13, one turn citing TRAI and CCI documents: the source list shows "Published by" with the regulator's full name at 1280 px and at 375 px (it wraps and stays readable), and the citation chip carries it in its tooltip. Found in the same check: the reader's header cut the publisher line short at both widths (166 of 264 px at 1280 px; 82 of 264 px at 375 px, where only "Published b…" showed). The same check recorded that the bubble's accessible label does not carry the publisher; that is the spec's decision D3 (the chip announces it once), not a defect, and is unchanged. The reader's close button is on screen at 375 px (28 px square); it was not clicked. Not checked: the copied text, and an RBI or SEBI citation. Header fixed 2026-11-15, built, not released: the publisher line wraps and is never cut, and a bar with a publisher is a grid at every width, with Back, the version label, Ask and Close on the first row (Close at the right edge) and the title and publisher on a second, full-width row; a bar without a publisher is unchanged. Independently reviewed (accept with changes, applied). Measured in a browser on a harness built from the two real stylesheets, not on the app with a live citation: at panes of 700, 467, 375, 330 and 288 px the publisher shows in full and Close is at the right edge of the first row; at 288 px Ask's label takes two lines. *Remaining: the header on the live site at both widths after release; a click on the close button at 375 px; the copied text; the owner's answer on wording (regulator's name, or the pack's `citation_text`). 2026-11-15* The `publisher_unresolved` hold in the Regulatory screen, which uses this resolver, is built (2026-11-12, see F330).

- [ ] **F335 — Section labels reach the model with the old escaping.** Found 2026-11-12 in F332's review (counted on NTER, read-only): `sectionText` in `supabase/functions/research-chat/agent.ts` escapes `|` but not a backslash before it, and does not remove the pipe lookalikes that F332 now removes from titles and features. 544 live chunks carry a backslash or a lookalike in their section label, so changing the rule changes what the model sees for them; it was left out of F332 for that reason. Needs a trace of how a section label could forge a header field, then the same escape with a before-and-after count.

- [ ] **F336 — Inline patches in a collection file are prepared without the screen.** Found 2026-11-12 in the review of the publisher hold (read from code, not tested): `prepareAll` in `scripts/bulk-runner/prepare.ts` swaps in the patches named in a collection file's `prepare` block, and a record swapped in that way has not passed the screen's checks. `screen.ts --patches` does screen patch records, so this matters only when a collection file carries the patches itself. No Regulatory collection file does. Trace the path end to end before fixing.

- [ ] **F337 — A regulatory record's `regulator_name` is not checked against its code.** Found 2026-11-12 in the same review (read from code): the search-only screen requires both fields but accepts, for example, code `RBI` with another regulator's name. The chat shows the fixed name from `_shared/publisher.ts`, so nothing wrong is shown today; the stored citation can still carry a contradictory name. Count such records on v1.1 before deciding whether to hold them.

- [ ] **F338 — The page check cannot read RBI's official PDFs.** Found 2026-11-12 in the full screen run on v1.1 Regulatory (executed, then traced with the screen's own client name): `rbidocs.rbi.org.in` answers an automated request with an HTML page (200, about 46 kB) in place of the PDF and in place of `robots.txt`, so the page check finds "not a PDF" and holds the record (`pdf_unreadable`). All 76 v1.1 records with an official PDF URL are held this way and no Regulatory record earns the `page_check` basis; 2,617 records pass on the density-only basis. The hold is the designed behaviour and nothing wrong is admitted. Not tried, and not to be tried without the developer's decision: any way round the host's handling of automated clients. Choices: leave the 76 held; ask the owner for the files in the next pack; or let these records use the density-only basis by configuration (a rule change, so a new rules hash and a review). *Waits on the developer. 2026-11-13* ([spec](../specs/2026-11-12-regulatory-screen.md), build notes) **Developer decision, 2026-11-15:** leave the 76 records held and ask the owner for the files in the next pack; no way round the host is to be tried.

- [ ] **F341 — The citation reader's bar overflows in a narrow split pane.** *Built 2026-11-15, not released; remaining: check in the app with a real citation after release.* Found 2026-11-15 while fixing F332's header (measured in a browser on a harness built from the real stylesheets). The reader is a split pane and can be 288 px wide on a wide window. A bar without a publisher was a single row that could not shrink below its controls: at 288 px Close ended 15 px past the pane's edge, where the surface clips it. The review and measurement added that the Bills version label can be as long as "As passed by both Houses". With that label and no publisher, the single row needs about 458 px before the title gets any room. Below about 350 px with that label, Ask ran under Close, and the bar with a publisher had the same flaw. Built: the pane's own width decides, through a CSS container query on the reader surface, not the viewport. A bar with a version label takes the two-row layout at 560 px and under; any bar takes it at 420 px and under. In the two-row layout Back, the version label, Ask and Close sit on the first row with Close at the right edge, and the title sits on a full-width second row. The version label may wrap there. The placement rules are shared with the publisher layout from F332. DOM order is unchanged. Phones get the two-row layout too, because the viewer pane is full width there. Evidence: measured in a browser on a harness built from the two real stylesheets at a 1280 px window, at pane widths of 960, 700, 563, 562, 470, 424, 422, 375, 340 and 288 px, for five bars (no publisher with no label, a short label and the long label; a publisher with no label and with the long label). No bar overflows, Close sits 13 px inside the pane's edge in every case, Ask never touches Close or the version label, and the publisher is never cut. The query measures the surface's content box, so a 422 px pane counts as 420. Not checked in the app with a real citation.

- [ ] **F346 — The Regulatory v1.1 pack's titles are file names and most dates are missing or invalid; the load is held.** Found 2026-11-15. A seeded sample (seed 20261115) of 20 TRAI and 20 CCI screened records, stratified by year and page-count tercile, was compared with trai.gov.in and cci.gov.in by an agent (a first pass; the developer's hand check of the same worksheet is still outstanding and the spec gives it no pass rule): 37 of 40 found; first and last page match in all 30 files that could be read (6 are scans or font-encoded, 3 TRAI not found); page count equal in all 37; title matches in 1 of 37 (the rest are file names); date matches in 12, differs in 19, unreadable 6. The text comparison used an ad hoc extractor, so it shows a content match only. Across all 2,617 screened records the `citation.date` field is empty in 1,799, a plausible date in 662, not a calendar date in 152, before 1990 or in the future in 4; prepare already drops the invalid ones, and the sample found wrong dates among the plausible ones. 2,583 records have no official file URL (from the spec). Developer decision 2026-11-15: hold the load and ask the owner for real titles, dates and source URLs keyed by `source_key`; a message is drafted, not sent. The worksheet and scripts are outside the repository. *Waits on the owner. 2026-11-15* *2026-11-15 (night):* read-only on NTER: of the 474 Regulatory documents already live, 472 have the file name as their title and none has a citation date, so the held pack is of the same quality as what is served today. `prepare.ts` does not put the title in the chunk text (read, not executed), so a later correction of titles and dates would not need re-embedding. Whether to load now and correct later is the developer's decision; not decided. **Developer decision, 2026-11-15:** the hold is lifted. The screened records load as search-only with the pack's titles, as the 474 live documents have; titles, dates and source links are corrected by `source_key` when the owner sends them. The owner message still goes out. Each production step (the F330 migration, the `admin-ingest` deploy, the load) keeps its own specific yes and its rolled-back dry run. This item stays open until the corrected titles are in.

- [ ] **F284 — NCLT vector index misses answers that exact search finds.** *Ready to build. 2026-11-10 (F299)* Measured 2026-11-05 on a rehearsal copy ([note](../research/2026-11-05-hybrid-and-headers-matrix.md)): vector-only feature search at `hnsw.ef_search` 400 has 5 fewer of 70 NCLT questions in its top 10 than an exact scan; Bills, Parliamentary Questions and Regulatory match exact search. With contextual headers the Bills index also loses 2 of 60. Measure a higher `ef_search` or a rebuild with higher build parameters against latency before the corpus grows; a larger partition will not make this better. **Developer decision, 2026-11-15:** deferred: the local rehearsal copies are gone, and a self-recall check on NTER on 2026-11-15 found 450 of 450 sampled documents in the top 10.

- [ ] **F283 — Migration history on NTER differs from the repository.** *Waits on the developer. 2026-11-10 (F299)* Read 2026-11-03: since 2026-10-18 migrations were applied through the Supabase MCP, which records its own timestamp as the version, so 18 repository files (`20261018160700_billing_purchases` to `20261031130000_retire_grant_paid_plan`) appear under other versions on NTER, and NTER has one row with no file in the repository (`20261027110836_supplied_text_national_questions`). `supabase db push` would therefore re-run those 18 files, billing among them; it must not be used until this is resolved (the Phase B runbook applies its files with psql). Decide: rename the repository files to the live versions, or rewrite the history rows to the repository's (`supabase migration repair`, a production change needing the developer's authorization; billing scope, history rows only). Then find and commit the missing `supplied_text_national_questions` file, or record why it has none. **Developer decision, 2026-11-15:** the rule stays "apply by psql, never `supabase db push`"; the history rows are not rewritten and the files are not renamed.

- [ ] **F415 — File-manager jobs: a hold lapses on a long job.** *From F413, 2026-11-27. Part 2, the Cancel button shown for running jobs, is fixed on `task/file-manager-integration` (F416): Cancel shows for queued jobs only.* (1) The indexing hold lasts a fixed 30 minutes while a job can run longer (the worker renews a 300-second lease, and `user_file_claim` takes back a lapsed one), so the user's credits stop being reserved and they can overspend into debt; `user_file_settle_credits` still charges in full. The fix ties the hold to the lease, which reaches into the worker (`supabase/functions/ingest-worker/user-file-step.ts` on the `file-manager` branch). (2) The file manager's Cancel button (`src/fileManager/DriveJobsDrawer.jsx` on that branch) is shown for running jobs; since F413 a running job refuses with `job_running`, so the button should be hidden for them. Both are the contributor's code; telling the contributor is the developer's step. Review: [2026-11-27-f413-file-manager-credit-review](../research/2026-11-27-f413-file-manager-credit-review.md).

- [ ] **F416 — The `file-manager` branch is not on `main`.** *Spec and plan approved 2026-11-28; integration built on `task/file-manager-integration` (Phases 1 to 3 and the browser check done; see the plan's Progress). Waiting on: CI, the developer's review, the three Edge Function deploys and the merge, each with a yes. Plan: [2026-11-28-file-manager-integration](2026-11-28-file-manager-integration.md).* The contributor's branch (`a4a09d84`, 23 commits, forked 2026-11-13, 434 behind `main`) holds the file manager UI, private files in the AI panel, the four Edge Functions behind them, the website's phone layout (F342), a separate app in `nter-mobile/`, and reports and screenshots. Its last CI failed (two Deno tests), a trial merge stops on 8 conflicts, its four migrations would undo F410 to F413, and its tracker numbers F341 to F346 are taken on `main`. Spec: [2026-11-28-file-manager-branch-integration](../specs/2026-11-28-file-manager-branch-integration.md).

- [ ] **F417 — The private file manager (the contributor's F341).** *Lands with F416's integration PR; numbered F341 on the `file-manager` branch, a number `main` uses for another item.* The drive, uploads, jobs drawer and artifacts (`src/fileManager/`), private files in the AI panel with citations (`src/ai/`), and the Edge Function code behind them (`document-file`, `ingest-worker`, `research-chat`, `_shared/retrieval.ts`). Its schema is `main`'s F410 to F413, not the branch's migrations. The branch's reports are under `docs/reports/f341-*`; its ADR is `docs/decisions/0016-private-file-manager-ingestion-rag-integration.md`.

- [ ] **F418 — The website's phone layout (the contributor's F342).** *Lands with F416's integration PR; numbered F342 on the `file-manager` branch.* Mobile header, bottom navigation and phone-width styles for nter.pro itself (`src/shell/MobileHeader.jsx`, `MobileBottomNav.jsx`, `mobileNav.css`, and phone rules in `src/index.css`, `src/marketing/` and `src/desks/`). QA notes: `docs/qa/phase-2/`.

- [ ] **F419 — The `nter-mobile/` app is not on `main` (the contributor's F343 to F346).** *Deferred by the developer, 2026-11-28.* A separate React + Vite app (Capacitor, app id `pro.nter.app`) with its own CI, `AGENTS.md` and lockfile. It stays on `origin/file-manager` (`a4a09d84`), with its reports, until it is current work. Then decide whether it lives in this repository, and if so how its CI runs from the root workflow. The client and planning PDFs at its top level need a decision before they are committed anywhere.

- [ ] **F414 — The file manager trusts the file size the client declares.** *Found 2026-11-27 in the F413 review.* `user_file_prepare_upload` takes `p_size_bytes` from the client and `user_file_complete_upload` never compares it with the stored object in the `user-files` bucket. The storage quota (`user_storage_used_bytes`, F410) and the indexing hold (F413) both count the declared size, so a client can under-declare to pass the quota. The bucket's 50 MB object limit still applies. Compare the declared size with `storage.objects` metadata at completion, or count from it.

- [ ] **F282 — `supplied_text.sql` fixture fails on chains that include the Law migration.** *Remaining: fix the fixture or retire it; the failure is reproduced and explained. 2026-11-10 (F299)* Seen 2026-11-02 while running SQL fixtures for Phase B and C (F278): the fixture passes on its own chain but fails when its file is applied in a chain that includes the Law publication migration. It predates this work and does not affect CI's chains. Reproduce, then fix the fixture or its chain; until then do not reuse it in a longer chain as evidence.

- [ ] **F281 — Corpus data quality found by the eval review.** *Remaining: the open data issues, and from R7's notes the served bill texts with repeated nonsense phrases (`bill:1996:49`) and 123 indexed bill documents with no key; the repaired batches are recorded. 2026-11-10 (F299)* Found while reading documents for the retrieval eval (A2b and its review). Reported only; nothing is changed. Each item needs a fix-or-retire decision before the bulk backfill relies on the metadata.
  - **2026-11-02: the repair of 97 documents is done** ([record](../operations/2026-11-02-f281-repair.md)). This supersedes "Reported only; nothing is changed" for those 97. `scripts/f281-repair/repair.mjs` at `cdfb638c` (tool), `6866dab4` (review fixes) and `ae6782bc` (manifest as executed): 51 OCR, 31 re-keyed, 10 re-titled and unlinked, 2 decoded, 2 stripped of a cover, 1 re-extracted. Five batches (20, 20, 20, 20, 17) were written to NTER, each read back and audited. 97 documents carry `metadata.text_repair`; indexed documents are unchanged at 17,606; chunks rose from 392,945 to 395,375. Still open: the crossed pair `7e43d403` and `ca1b65ba` (F275); three stated bills with no source (ask the client in the first-collection summary); `cc99b0d2` (decision); three `mapping_hold` documents (held on purpose); 108 key-less false alarms (optional re-title); `410ebf75` and `9726bbf4` (trivial); 11 suspected stray covers not yet read; `8bffca18` and `ee462209` (the same file twice, keep one); the bill key collision (F275). **2026-11-02, second batch** ([record](../operations/2026-11-02-f281-repair.md#second-batch-2026-11-02)): 11 stray covers stripped and 95 key-less file-name titles re-titled from each bill's printed heading (`scripts/f281-repair/manifest-2.json`, tool `3590de93`); six batches written, each read back and audited, `analyze` after; 13 key-less documents left with reasons. `8bffca18` (synopsis copy of the Finance Act, 2003) taken out of search (`indexed_at` cleared, recorded value `2026-11-02 10:34:53.192+00`); `ee462209` (gazette copy) kept. 203 documents now carry `metadata.text_repair`; indexed documents 17,605; chunks 395,375. Still open from the list above: the crossed pair, the sources the client must supply, `cc99b0d2`, the held documents, the 13 key-less exclusions, the trivial two, and the key collision.
  - Title does not match the content: `e4a7d7d2` ("Climate Change Bill, 2012" holds the National Child Welfare Board Bill 2005); `98abd091` ("Central Universities (Amendment) Bill, 2011" holds the Buy Indian Bill 2004); `7e43d403` ("Constitution (Amendment) Bill 1999 (article 16A)" holds the Semiconductor Integrated Circuits Layout-Design Bill); `7fd68cf2` (opens with another bill's cover page).
  - Unreadable text, shifted by three characters: `fb64d5ac` (Taxation Laws (Amendment) Bill 2025, as passed); `1f1ce52a` (Manipur GST (Amendment) Bill 2025, as passed).
  - OCR garbage: `3f6669d6` (TRAI press release 104/2026); `712b7dab` (TCEPF gazette notice). An OCR artefact is appended to `e9e93b9e`.
  - Truncated CCI orders, most of each order missing: `0c47142d`, `e3dd1af0`, `e77b7df8`.
  - Metadata: NCLT `citation.bench` is empty on all 7,549 documents; 1,744 indexed Bills have no citation; placeholder titles with no `document_key`: `7142b662`, `103d8107`, `6d5159b0`; private members' bills carry a ministry, so a ministry filter would misclassify them; non-bill documents sit in the Bills feature; 82 Parliamentary Question documents have no citation and file-name titles; `asked_by` is incomplete on some answers.

- [ ] **F271 — The client agent's production database connector.** *Waits on the owner. 2026-11-10 (F299)* The client agent reads NTER through a Supabase connector (2026-10-29 reconciliation). Handoff rule 6 allows only read-only transactions, but the connector's own credential may allow writes. Owner action: confirm which credential it uses and replace it with a read-only role or remove it; rotate the Colab Secrets ingestion password (`NTER_INGEST_EMAIL` / `NTER_INGEST_PASSWORD`, F268).

- [ ] **F272 — Feature search capacity above 100,000 chunks.** *Remaining: watch for short index walks; Parliamentary Questions are still in the default partition (F285). 2026-11-10 (F299)* `match_documents_feature` recovers an underfilled feature search exactly only up to 100,000 eligible chunks, then raises `FEATURE_SEARCH_RECOVERY_LIMIT` (2026-10-27 migration). Measured 2026-10-29: NCLT / NCLAT (Insolvency) 225,273 chunks, Bill Passage Probability Index 89,014, Parliamentary Question Database 60,611. Measure how often Law searches underfill and provision per-feature indexing (or another bounded exact path) before Law cohorts of 1,000; a Law validation cohort may proceed. 2026-11-01: the F278 spec (§4.1, plan step 3) retires this bound for features with their own partition. F287 (2026-11-06): the error path fired for real on one of 317 questions at 222,000 synthetic Regulatory chunks, from an island of 38 rows that a rebuild cleared; 42% duplicate text is the likely cause, and 0 of 302 walks on real data came up short. Check for short walks in the first real batch. The function is `match_documents_feature_hnsw`. Partitions removed the main cause: a desk's walk no longer competes with other desks. The check itself stays in the helper for every desk. 2026-11-15 (developer): deferred; not built until the corpus size makes it matter.

- [ ] **F268 — Credentials used by the client's autopilot.** *Waits on the owner. 2026-11-10 (F299)* The Law autopilot (batches 7–11) signed in with a stored admin password instead of short-lived tokens. Owner action: change that password. From 2026-10-29 (handoff rule 7) the client signs in with their own admin account for each approved run and passes only that session's token. The admin role is full admin; an ingestion-only role does not exist and would be separate work.

- [ ] **F252 — Law provider-tail latency and uncertainty calibration (deferred future work).** *Waits on the owner. 2026-11-10 (F299)* Owner deferred on 2026-10-25; not a blocker for unrelated work. Resume only under a new scoped task, using observed slow requests/timeouts to prioritize.  F251's compact-evidence optimization and source corrections are released, but wider latency is not solved: Navinchandra timed out at120s in a private run, retried in96s; Jet took87.705s on NTER with most time inside two provider calls. A private Globiz date response also had unnecessary uncertainty despite sufficient evidence, although final live date passed. Investigate using measured, bounded comparisons; preserve High reasoning, attribution/citations, correction limits and cost accounting. Prior latency/throughput routing experiments were rejected; do not reintroduce them without new evidence. No ingestion or larger batches. [F251 evidence](../operations/law-answer-qualification-release.md).

- [ ] **F246 — Law baseline source-membership refresh.** *Waits on the owner. 2026-11-10 (F299)* Canonical seeding captures a reviewed snapshot; protected legacy refreshes cannot add, change or remove its source-only memberships. Before claiming ongoing official-register coverage, specify and implement a provenance-checked membership refresh with stable identities, explicit retirement policy, audit evidence and tests preserving corpus attachments. This is separate from automatic publication of newly admitted supported corpus documents. Other forum adapters, revisions/translations and compound fallback also remain outside the first NCLT adapter. No current ingestion authorization.

- [ ] **Corpus inventory and supplied-text orchestration specification — 2026-10-23.** *Remaining: the three recovery stubs, the adapters for keys other than bills, the three companion checksum differences, and the reconciliation of structured rows with what is live; the capability map, registration and capacity moved to F278, and the Law exceptions to F318. 2026-11-10 (F299)* Owner requested full local reconciliation and a change spec, including the legal pack; **no coding or ingestion in this task**. National: 3,459 stored / 3,456 indexed / 100,716 chunks; all 35,358 current text sources reconciled (3,455 indexed, 315 prepared in the held stage, 26,124 held, 5,464 excluded), with structured dataset records enumerated separately. [Report](../research/2026-10-23-corpus-reconciliation.md), [proposed spec and capability map](../specs/2026-10-23-supplied-text-bulk-orchestration.md). Remaining scope: review/approve capability map and relationship design; preserve frozen R7 checkpoint; resolve per-source quality/mapping exceptions and three recovery stubs; add nonbill key propagation/selection adapters; resolve the 86 Law dedupe winner exceptions, 17 missing translation-parent relationships, 169 incomplete-page declarations and three competing-text source identities, reconcile replacement/occurrence rules and sensitivity handling, and confirm the three internal/external companion checksum differences; implement approved durable supplied-text registration/worker/UI contracts; measure capacity before bulk release. Existing indexed sources without current attachments and the PDF revision/hash differences are preservation/review items, not deletion requests. Full structured-row-to-live reconciliation is outside this document inventory and remains separate work. Broader implementation, release and replacement/backfill authorization remain pending; the separately tracked supplied-text connection increment is now locally authorized.

- [ ] **RAG citation/web production acceptance (2026-10-19).** *Remaining: a real-provider acceptance of the required web-only fallback. 2026-11-10 (F299)* Owner tests expose Lite
  zero-citation answers despite retrieved evidence; repair rejected for changing
  content; no Web calls occurred for missing-text record questions. Existing
  evidence-presence guard permits uncited completion. Generic pre-search and
  previous-subject resolution need regressions. Flash returns8 citations.
  Anti-Doping Source3 is PDF-backed; Source6 is legacy passed-version text.
  Audit:research/2026-10-19-rag-citations-web-audit.md. Owner authorized scoped
  local repair:task/rag-citation-web-recovery. Current-subject pre-search,
  verified pinned-row handles (including missing client tier), anchor-based
  content-preserving citation repair, bounded required web-only fallback and
  truthful missing-source notices implemented locally. New causal regressions;
  6293 application/1172 Deno tests,lint/build/bundle/router pass. Existing PDF
  and Text views observed in owner Arc on Anti-Doping page3/22 with highlights,
  owner-operated switching because native input failed. No viewer rebuild.
  Implementation4a1c978; owner approved push/merge to main. Plan:
  2026-10-19-rag-citation-web-recovery.md. Edge activation and real-provider
  acceptance of required web-tool call remain pending; no Supabase deployment
  in the push/merge authorization. Vercel frontend deploys automatically.

- [ ] **Test browser-global isolation audit (2026-10-21, outside billing repair).** *Remaining: a watch item; audit again if a leaked global recurs. 2026-11-10 (F299)* One full run hit AdminApp's `window.matchMedia` against a leaked browser stub; the isolated admin/billing120 checks and subsequent full6483 run passed. Removed obsolete window setup from modified billing tests; no admin source/test changes or skipped tests. Broader test-order/global cleanup should be audited if recurrence occurs. Evidence in2026-10-21-billing-loading.md.

- [ ] **Complete navigation record-search coverage.** *Waits on the developer. 2026-11-10 (F299)* Current provider covers indexed snapshots only (42 populated modules at review); global catalogue covers120. Before expanding, inventory each module's structured/register/live/planned source and agree a separate read-only provider/index with access/freshness/bounds. Do not expand AI ingestion just for navigation. This is excluded from the scoped preview refinement; needs its own specification and approval. [Coverage evidence](../research/2026-10-25-citation-search-state-review.md).

- [ ] **F355 — Regulatory search is worse after the v1.1 load.** The search check fell from 50 to 40 of 55 on 2026-11-16. Judged 2026-11-18 ([readiness plan](2026-11-18-national-scale-readiness.md), "Phase 0 results"): for each of the ten lost questions, the reference passage and the three passages now ranked first were judged blind by an independent reviewer; in 7 the reference answers and none of the three does (the same regulator on another matter), in 3 a newly loaded passage answers at least as well. `match_documents_hybrid` scores the same 40 of 55 because it applies keyword search to the NCLT desk only. Needs a spec, a measurement on the local copy and then a build of keyword and vector search together for this desk, judged on the 55 questions and on a fresh set written after the load. No further Regulatory load until it passes. Limits of the evidence: three documents per question, excerpts of 1,800 characters. **Developer decision, 2026-11-18:** build it. **Measured the same day, read-only on NTER** ([spec](../specs/2026-11-18-regulatory-search-after-load.md)): the NCLT recipe with the desk set to Regulatory scores the same 40 of 55 as vector only in one sitting, because only 6 questions produce a keyword list; 10 of the 15 misses have the reference at ranks 11 to 84. The spec measures a keyword rule for this desk first and a re-ranking stage second, on the 55 and on a fresh set, before any build. **Measured 2026-11-19, read-only on NTER:** a keyword list of the question's rarer words, fused with the vector list, lifts the first 10 from 40 to 45 of 55 with none lost when a candidate must hold two of the words; the bar is 47. The first 40, which the chat reads, stay at 45. A deliberately broken list scores 39. The variants were chosen on the 55, so a fresh set must confirm it. *Waits on the fresh question set and the developer's decision on the re-ranking measurement. 2026-11-19*

- [ ] **F356 — The runner loses the reason when acceptance fails to finish.** Seen 2026-11-16 in the Regulatory load: acceptance ended without a report three times while the operator's machine slept, the batches were indexed each time, and the cause had to be found from the machine's sleep log because `scripts/bulk-runner` does not keep the error text. Keep the error in the receipt, and let acceptance be run again alone for a batch that is already indexed ([readiness plan](2026-11-18-national-scale-readiness.md), task B1). *Built and independently reviewed 2026-11-19 on `task/f356-acceptance-resume`: the reason goes to the output and to a file beside the receipt, the receipt is unchanged, and running the same command again accepts an indexed batch; not yet run against a real database. Waits on its pull request. 2026-11-19*

- [ ] **F357 — The runner cannot replace a document's text.** Read 2026-11-18 from the pack manifests and the F307 counts: v1.2 carries 1,819 replacements, v1.4 7,801 RBI text fixes and v1.6 7,068 replacements of earlier records, and registration is keyed by `source_key` and payload hash with no path that swaps text and chunks for a live document. Needs a spec first (the old text recoverable; chunks and vectors replaced in one step; search never sees both) ([readiness plan](2026-11-18-national-scale-readiness.md), task B3). *Waits on Gate 0 of the plan. 2026-11-18*

- [ ] **F358 — The pack inventory by entry is incomplete.** Read 2026-11-18 from each pack's manifest on Drive (counts only; table in the [readiness plan](2026-11-18-national-scale-readiness.md)): v1.4 holds 117,631 records, v1.5 108,217 and v1.6 204,975, across 16 desks, of which three have an admission path. Not yet read per entry for v1.3 to v1.6: `servable` (v1.4's manifest does not state it), licence class, characters and the desk name as spelled. Capacity follows from this count and is F279's. *Ready to do (counts only). 2026-11-18*

- [ ] **F374 — Five National desks have no admission route.** Read 2026-11-19 from packs v1.1 to v1.3 on Drive and from the code ([plan](2026-11-19-v1.1-to-v1.3-loads-and-closeout.md)): MP Profiles (3,157 and 565), Cabinet Decisions (868), Budget (486), Industry (28 and 37) and Transfers (29 and 11) have no screen configuration, are not in the search-only desk list and have no policy. All 28 Industry records have no file link; the 486 Budget links are rebuilt from the path. **Developer decision, 2026-11-19:** search-only first, as the [spec](../specs/2026-11-19-five-desk-search-only-route.md) sets out, with its three decisions as recommended. *Built and independently reviewed 2026-11-19 on `task/f374-five-desk-route`: the migration `20261123090000`, five screen configurations, a declared first load for `screen`, and publisher names per desk. NTER read the same day, read-only: the five function hashes, their owner and both index definitions are what the migration's guards expect, and no two documents of these desks share a link or key. Not on NTER; waits on its pull request, then a rolled-back dry run. 2026-11-19* *Merged 2026-11-19 (pull request 195, `c07be79f`). On NTER 2026-11-20: `admin-ingest` and `ingest-worker` redeployed and the migration applied after a rolled-back dry run ([record](../operations/2026-11-20-five-desk-route-apply.md)). Still open: redeploy `research-chat` for the publisher names, screen each v1.1 entry with `--first-load`, approve a policy per desk, then the loads in the plan's order. 2026-11-20* *First Cabinet batch of 100 loaded on NTER 2026-11-20, search-only, with the runner's `chunksNow` finding ([record](../operations/2026-11-20-cabinet-first-batch.md)). 747 eligible Cabinet records remain. The publisher name in a chat citation waits on the research chat redeploy. 2026-11-20* *All 847 eligible Cabinet records are loaded and accepted on NTER as of 2026-11-20 16:07 UTC ([first batch](../operations/2026-11-20-cabinet-first-batch.md), [remainder](../operations/2026-11-20-cabinet-remainder-load.md)). Other desks remain. 2026-11-20* *Dated note, 2026-11-21: Budget parts 001 to 003 are accepted on NTER (140 Budget records stay held, F391), MP Profiles are loaded and accepted (36 parts; 2,950 and 565 admitted across the two packs), and Industry is loaded and accepted (59 documents at the end of the day). Bills v1.2 was screened and nothing was loaded from it. Still open: Transfers (F390) and the held Budget records. Counts and times are in the [national loads record](../operations/2026-11-21-national-loads.md). 2026-11-21* 2026-11-19 correction: this item was recorded as F367 for some hours; the Live TV work took that number on `main` first, so it is F374 from here on, and the documents of this date that say F367 for the five-desk route mean this item.

- [ ] **F368 — A search-only document has no link from its table row.** Read from code 2026-11-19: search-only admission writes no `record_document_links` row, so the row still counts as having no document, and a chat on that row turns web search on although the text is in the corpus. The packs carry the link data. Needs a spec ([plan](2026-11-19-v1.1-to-v1.3-loads-and-closeout.md)), task C1. *Waits on the first search-only loads. 2026-11-19*

- [ ] **F369 — The Regulatory screen refuses web-page text.** Counted 2026-11-19: 7,728 of the 8,261 records in v1.3's regulators archive are web-page text because the PDF was blocked, and `screens/regulatory.json` allows `pdf_text` only. *Waits on F355 and decision D5. 2026-11-19*

- [ ] **F370 — The pack reader refuses a file written in two compressed parts.** Executed 2026-11-19: v1.3's `documents/industry_updates.jsonl.gz` is valid, holds 37 lines in two parts, and `pack.ts select` rejects it as invalid. *Built 2026-11-19 on `task/f370-multipart-gzip` (the real file reads 37 records); waits on its pull request. 2026-11-19*

- [ ] **F371 — The Transfers desk arrives under two spellings.** Counted 2026-11-19: v1.1 writes "Bureaucratic Transfers - AGMUT Cadre" with a hyphen (29 records) and v1.3 and the catalogue use a dash (11). The chat matches a desk by a name with punctuation removed and then searches the one spelling it finds (`moduleName`, read from code), so one of the two sets would not be searched. 2026-11-19 correction: the commas missing from the packs' MP Profiles name are harmless for the same reason. The screen writes one spelling ([spec](../specs/2026-11-19-five-desk-search-only-route.md), design 3). *Specified; waits on Gate A. 2026-11-19*

- [ ] **F407 — Bill corrigenda on a shared bill key would not show on their bill's row.** Found 2026-11-21 in the F372 review (read-only on NTER): 34 of the 330 corrigenda that pass the screen sit on bill keys that more than one bill shares. The Bills resolver (F314, `record_resolve_document_keys`) matches a bill's documents by `metadata->>'document_key'` and holds a row on a shared key to its own bill's documents, so these corrigenda are stored and linked but would not display on the row of the bill they correct. The route (F372) does not change the resolver and does not depend on this. Open: widen the F314 resolver rule for errata, or leave them stored but undisplayed; needs the developer's decision and a spec. 2026-11-21 2026-11-22: the 34 on shared keys were loaded as their own batch and passed automated acceptance (34 of 34), against the expected link_not_full; shared-check 34 in every column. Whether they show on their own bill row is still to be read in the app.

- [ ] **F373 — Pack row files and page boxes have no loader.** Listed 2026-11-19, not read: v1.3 carries three row files and page boxes for 14,959 earlier documents, and nothing in the repository reads either. NTER holds 6 Cabinet rows for 868 Cabinet documents and no Budget or Industry rows. *Needs a decision and a spec. 2026-11-19*

- [ ] **F375 — Live TV: checks that need a person.** One list, so nothing is hidden in closed entries. Each needs a signed-in person at a computer, because the browser refuses tab sharing to automation: a session on a recorded video with sharing on, then an unlock by a second account, a report, and "Re-analyze this block" (the seek on a real player, the position recorded after it); a 20 or 30 minute session; the "No sources found" state; the usage screens after a real charge; the latest-claim strip against the player's own controls; the page on a phone and with a screen reader; the first removal of a video's shared results with a refund; the channel lists, search, "My list" and the live lookup on the real site, on a phone. Also, the live lookup against the real YouTube service on the deployed preview. Released 2026-11-20 (`818ad04a`): the production live lookup answered for one channel (zee-news). Still open: the rest of the live lookup on the real site, the channel lists, search, "My list" and the phone check; and a real refund line seen in a signed-in usage history. Added 2026-11-20, from F382, F384, F387 to F389, F395 and F396: on a 13-inch laptop and a 1366 × 768 laptop, the real player and fullscreen in the layout, the panel staying put while the page scrolls, the transcript strip moving during a real session (a channel and a pasted link), the pasted-video wording and the "nothing is playing" line, a PDF through the button and Hindi in it on Windows and Android, and channel names on a real usage screen. Added 2026-11-21, from F385 and pull request 210 (`dd6de559`): the fallback for a channel that refuses to play inside the app (one of the 15 in F385), the new caution line in the panel, and the lower tabs (Channel Videos and, when fact-check is offered, My sessions; no empty Broadcast Schedule or Archived Segments tab). Added 2026-11-21, from F402: the new watch page signed in, at the client's window size and on a 13-inch laptop: the real player at 16:9 with no dark bars, fullscreen, the panel during a real session (its tabs and transcript strip at its top, its claims scrolling inside it), the Segments button and its overlay, the whole page scrolling as one, and a touch screen.

- [ ] **F404 — The desk landings count a different source from the module tables, and the totals add items that are not records.** Found 2026-11-21 by a read-only audit against main `8ac0d489` and the live site; the developer asked for the fixes the same day. Three defects. (1) The landing endpoints read most modules live first (`serveFeatureFeedWithBackup`) and Economics, Carbon, Sports and Entertainment within a time limit (`serveFeatureFeedWithinLimit`), while the module table (`/api/feature-feed`) reads every scheduled module from the feed store first. So the landing showed a smaller live page or, when the source was slow, an error: National Cabinet Decisions 1 against 93 in the table, Regulatory Body Watch 141 against 257, Morning Brief 171 against 259, about 30 news-wire modules on Law, Global, Economics, Carbon, Sports, Entertainment and State also differed (Cricket 100 against 500, Bollywood 100 against 497, UP High Court 25 against 57). The same cause is why four modules showed an error or "unavailable" on their landing although their tables had rows: Box Office (table 245) and Celebrity Index (246) on Entertainment, SDL Auctions (297) and MLA Defection (1) on State; their live sources (Wikidata, RBI, news search) missed the time limit, the archive stand-in was refused by the projector (`unsupported`, or `served: 'archive'` read as pending), and the store was never asked. The choice was copied in `server/featureFeed.mjs` and `api/router.js` and had to be kept in step by hand. (2) `summarizeModules` (`src/desks/landing/deskPresentation.js`) summed every module whatever its unit: news reports (Morning Brief, Statement Tracker), simulation projection outputs (Delimitation), promises (Manifestos), National Budget's 5 headline figures with its 8 schemes, and Industry Updates' World Bank data points. **Fix.** `landingLoadFeed(pathname)` in `server/featureFeed.mjs` is the one choice, used by both servers: a module `scheduledModuleId` names is read with `serveFeatureFeedStoredFirst`, any other keeps the live loader of its route (the old Policy Pipeline, Satellite and MLA exceptions are now covered by the schedule, so `stateSummaryUsesStore` is gone). The landing counts what the table lists; when the store holds more than the table's first page (`STORE_PAGE_ROWS`, 500) the summary says so in `capped`, `storeTotal` and a sentence in `limitations` (`server/landingStoreCap.mjs`). The Statement Tracker with no person uses the store's default leader (`STATEMENT_LEADERS[0]`), the same as the table. For the total, the National projector gives Budget the unit `schemes and headline figures` and Industry Updates `data points` (the cards keep their counts, equal to their tables), and `summarizeModules` counts only summaries whose unit is `records` (a summary with no unit, Global's, still counts); Economics, Carbon, Sports, Entertainment and Law, whose headline already reads "combined source entries, units vary", pass `allUnits`, as do the sector cards of every desk except National and Global. Tests: `src/lib/landingStoredFirst.test.js` (both servers, the four modules, the cap), `deskPresentation.test.js`, `nationalLandingSummary.test.js`; `stateLandingStored.test.js` updated, as it had pinned the old rule. Built 2026-11-21 on `task/landing-record-counts`; not committed. Landing against table counts were not measured on the live site from the branch. Follow-up 2026-11-22: the cap note now appears only when the table fills its 500-row page (`server/landingStoreCap.mjs`), because Cabinet (93 of 98 stored) and Regulatory were wrongly noted as capped when the module's own row filter shortened them; tests in `src/lib/landingStoreCap.test.js` and `landingStoredFirst.test.js`, built on `task/landing-cap-note`, not committed.

- [ ] **F390 — Transfers: all 29 v1.1 transfer orders are held at screening.** Found 2026-11-20 at screening: the file links of the 29 records return HTTP 404. The ministry site moved its files to a new path scheme, the old file names were not found under it, and the records carry no second link. Needs a working source from the owner, or a decision to load without a page check. *Investigated, not independently re-verified. 2026-11-20*

- [ ] **F409 — Budget OCR: year values missing from table rows.** Found 2026-11-22 on the second run of the 20 (executed, read against each table's totals): tables come back, but 261 of 394 detail rows in 13 of 20 documents lack a year's value or hold a merged cell (in Demand 42 the detail rows sum exactly to the totals for three years and the 2026-27 Budget Estimates column is absent from every detail row). The worker's exact flags give byte-identical text (Demand 42 and 55), so it is Mistral's markdown table output on merged cells, not our settings. Trial of HTML tables: PR 226. Nothing loads until the rows are complete. 2026-11-23: vision trial and full run: GPT-5 mini kept the figures (80 of 108 passed the totals check) but garbled the Hindi in 99 of 108 (it copies the PDFs' broken Hindi font layer); Gemini 2.5 Flash missed rows. Developer chose Mistral for all, so the 114 loaded Budget OCR texts keep clean Hindi but many detail rows still lack the 2026-27 value. Open: a fix that keeps both (e.g. page images to a vision model, or a merge of Mistral text with vision figures).

- [ ] **F392 — The runner needs `chunksNow` for a desk without its own partition.** Found 2026-11-20 in a rehearsal on a local copy: without `limits.chunksNow` for the desk in the collection file, planning stops with `chunks_unknown` before registration. Cabinet is set to 0 for its load. Either document the field in the runner's README or have the runner read the count itself. *Needs a decision on which. 2026-11-20*

- [ ] **F393 — Hybrid search is live for NCLT only.** Developer decision 2026-11-20: keyword and vector search together are required on every desk. Read on NTER the same day: every chunk partition, the default one included, has a keyword index; the flag row and the keyword rule exist for NCLT alone, and that rule measured no gain on Regulatory (F355). [Programme spec](../specs/2026-11-20-corpus-and-search-completion.md), module `hybrid-sitewide`. **Built 2026-11-21, uncommitted until the supervisor lands it** ([spec](../specs/2026-11-21-hybrid-sitewide.md)): the general rule in the private schema with the access check last, a per-desk switch (`hybrid_search_desks`, no row inserted), the per-desk read in the Edge Function, and a fixture proving a desk without a row returns exactly today's rows, a flagged desk uses the hybrid path, and a user without access gets nothing through it (21 mutations after the second review, each failing the fixture). NCLT keeps its rule. **Independent review 2026-11-21 found three required defects (ties cut by chunk id, a sequential-scan probe for common words, a second copy of the hidden-document rule) and three smaller ones (no rollback test, a flag-failure log label and the deploy order, a flag row for NCLT or an unknown desk); all fixed in the same uncommitted build, each with a test that failed first** (spec, "Review fixes"). **Second independent review 2026-11-21: no access defect; two blocking findings in the probe fix (the probe took the desk's btree index, not the keyword index; the settings restore was untested and the spec described it wrongly) fixed in the same build: the probes are now `retrieval_internal.rare_word_counts` (SET clause keeps the planner settings; reads the desk's partition with a desk test no btree can serve), with a fixture check on index scan counts and on the settings after the call, two more mutations (21), the pool of 300 replaced by `fetch first 100 rows with ties`, and `scope` on the `research.hybrid_fallback` log** (spec, "Second review"). Deploy order: migration, then function. Not applied to NTER; no flag row. *Needs a second look at the fixes, the per-desk measurement (no local copy of NTER's chunks exists; the spec says how to take it read-only on NTER), then the developer's decision per desk. 2026-11-21* 2026-11-22 measured on NTER (rolled back, 5 desks, 434 questions): no desk passes. Hybrid is 1.6 to 2.3 times slower warm on every desk (bar 1.2); Bills and Parliamentary Questions lose more questions than they gain; Regulatory reaches 44 of 55 (bar 47). No flag row added; `hybrid_search_desks` empty. Results in `~/niyantran-eval-cache/hybrid-measure-2026-11-22/`.

- [ ] **F397 — An ingest embedding request had no time limit.** Seen 2026-11-20 on NTER: a Budget supplied-text job's embedding call never returned, the job's 300 s lease expired and it was marked `text_outcome_uncertain`; with one worker running the queue stalled for five minutes, and the job needed a manual requeue (batch `8468cf71`, requeued once, then indexed and accepted). First such failure in 23,384 jobs. *Built and independently reviewed twice 2026-11-20 on `task/ingest-embed-timeout`: every embedding request is aborted after at most 75 s, never past the invocation's work budget less 5 s; on both the single-job and batch paths a timeout or provider outage releases a supplied-text job as a non-permanent `embed_outage` (retried with backoff, at most six claims, no batch failure counted); other failures stay permanent. Edge Function tests 1,910 passed. Not deployed; behaviour on the live runtime not yet seen. Budget part 003 waits on the deploy. 2026-11-20*

- [ ] **F398 — Follow-ups from the embedding time-limit review (F397).** Read and run 2026-11-20 by the reviewer: (1) when the second of two requests in one embedding call is aborted, the first request's spend is not recorded (about US$0.001 each time); (2) a slice can start with only about 5 s of call time left, so a slow but healthy call started late is cut off after it may have been billed; (3) a job's `last_error` cannot tell a timeout from a refused connection (only the call log can); (4) OCR (`mistral.ts`) calls its provider with no time limit either. *Not planned. 2026-11-20*

- [ ] **F394 — A load depends on the operator's machine staying awake.** Seen 2026-11-20: the machine slept with its lid closed during the third Cabinet batch; the batch indexed, its acceptance check got no answer, and the runner has no command that runs acceptance alone, so the check is still owed for batch `2537b346`. The keep-awake wrapper does not cover a closed lid. Cabinet stands at 300 of 847 eligible. [Programme spec](../specs/2026-11-20-corpus-and-search-completion.md), module `hands-off-loads`. *Needs an accept-only command and a decision on where long loads run. 2026-11-20* *Dated note, 2026-11-21: the 300 of 847 figure above is out of date; Cabinet is complete at 847 (see F374). `run --register-only` and `accept` are now in use. The 2026-11-21 National loads are the second hands-off use, recorded in the [national loads record](../operations/2026-11-21-national-loads.md). The question of where long loads run is still open, so this item stays open. 2026-11-21*

- [ ] **F403 — A batch's spend ceiling equals its estimate, so a batch stops at its first overrun.** Found 2026-11-21 on the Industry v1.3 batch `6d13945e`. The close check in `supabase/migrations/20261115090000_batch_close_and_failure_count.sql` stops a batch when `v_spend >= b.est_cost_usd`, so the ceiling has no headroom. The runner's token estimate was also low for that PDF text: the real embedding token count was 58% above the estimate (193,724 against 122,326). The batch stopped at 24 of 26 jobs and needed a manual resume with its ceiling raised to US$0.01 (decision `F374-industry-v13b-resume-2026-11-21`). Suggested fix, either headroom on the ceiling (for example 1.5 times the estimate) or a better token estimate. *Not planned. 2026-11-21* 2026-11-22: hit again by all 4 corrigenda batches; each resumed with est_cost_usd 0.01 and an evidence file (`~/niyantran-eval-cache/corrigenda-load-2026-11-22/`). 2026-11-23: the 3 Budget OCR batches stopped 4 times in all (the 50-document batch twice: its documents were larger than planned); resumed at US$0.01, then US$0.05.

## How to use this file

- **This is the only list of open work.** Plans, specs, ADRs and
  `agents/coordination.md` may describe a task in detail, but they don't
  track it. Anything "still open", "later" or "follow-up" must appear here.
- An agent takes an unblocked item, follows `AGENTS.md`, and works on a
  `task/<id>-<slug>` branch. When it lands, the item moves, ticked and with
  its commit hash, to the Done archive, [open-work-done.md](open-work-done.md).
- A new finding gets the next free `F` number (F420 is next) and goes in the
  right section.

## Frontend follow-up

- [ ] **F405 — Homepage figures: every number measured, a named constant, or removed.** *Merged in PR #219 (`6208aff6`); remaining: the preview table rows are illustrative text, and `preview-figures.json` must be rebuilt with the data files. 2026-11-26* Audit of main `8ac0d489`: the desk preview tabs held hand-typed numbers (Electoral 8 by-elections, 1951, bars 480/32/22/9; Statement 128/14/6/3 and bars; Tenders 84/12/9/6 and bars while the live Tenders module has no unexpired tender; Macro 4 updated today, 1991, bars; Fronts 4 in 48 hours, 9 sources, bars), "1952–2026", "Coverage from 1952 onward", "8 Desks", the walkthrough's "02:18", `endpoints: 246` (the registry counts 121), a stale fallback in `measuredFigures.js` (documents 3,431 against 30,651 live), and the carousel's Jurisdictions 27 and Benches 25. Now: the preview figures (`src/data/preview-figures.json`, rebuilt by `scripts/build-preview-figures.mjs`) also count regulatory notices, fronts by stage, bill years and source endpoints; unmeasurable tiles and bars are removed; the fallback holds no number (shown as a dash); the carousel counts jurisdictions and Supreme Court orders from the desks' files. Still open: the preview table rows (bill, contest, notice and series names) are illustrative text, not read from data; and `preview-figures.json` goes stale until rebuilt, so rebuild it with the data files.

- [ ] **F235 — Indian Sports redundant browser fallback.** *Ready to build. 2026-11-10 (F299)* Chrome shows direct Google News RSS canceled after same-origin feature-feed succeeds (200,227stories); console empty and publisher navigation works. Review unnecessary parallel fallback requests separately; no CORS failure proven by this observation. The long-open blank tab recovered on reload and was not reproduced in a fresh session; keep this limitation in browser evidence.

## Development toolchain follow-up

- [ ] **F237 — Local manual-grant bootstrap authority.** *Ready to build. 2026-11-10 (F299)* The existing credits_on_plan_grant manual branch is owned by nter_migrator in the disposable bootstrap and hits the profile guard. Grace tests seed provenance with the trigger disabled inside a rolled-back fixture; no existing trigger was altered. Audit separately before relying on manual grants as a fixture path.

- [ ] **F234 — Dependency advisories.** *Waits on the developer. 2026-11-10 (F299)* Read-only npm audit on 2026-10-19 reports existing Vite/Vitest dependency advisories (2 moderate, 2 high, 2 critical; esbuild, source-map-js, @vitest/mocker, tinypool and dependents). Production dependency audit reported zero then. The 2026-10-25 news preview audit now reports one existing high-severity zod advisory (GHSA-mrhx-c7xc-m3w5); no advisory for pinned fast-xml-parser 5.11.2 or cheerio 1.2.0. Review compatible upgrades separately; no dependency changes in the scoped BBC/form fix.

## Current state — 2026-11-26

Read on 2026-11-26 (about 11:05 UTC), read-only: `main`, the open pull requests, NTER's migration history and Edge
Function list, and aggregate SQL on NTER. **Not re-checked:** the live site, payments, module status, hybrid search
and the milestone checkpoints below. The 2026-11-11 milestone check and its addenda are in
[the Done archive](open-work-done.md), under the same heading.

- **Git:** `main` at `e0966466` (PR #248, F413). #234 to #246 and #248 are merged; #247 (F369, RBI chrome) is open.
  `main`'s CI was green on `e969c180` (PR #245), the last merge before #248.
- **Migrations on NTER:** 117 history rows, the highest version `20261127100000_file_manager_credit_fixes` (F413,
  applied 2026-11-27); the `file_indexing_billing` flag is still off. Before it: `20261126180000_file_manager_grants`
  (F412, applied 2026-11-27), `20261126150000_file_manager_schema` (F411, recorded 2026-11-26) and F410's
  `20261126090000_user_storage_own_user`. `20261126100000_web_text_queue` (PR #239) is applied too, by its own
  workstream after F411's row.
  `20261114090000_create_document_chunks_partition` is deliberately not applied (F285). The history differs from the
  repository for 18 files and one row (F283), so migrations go by `psql`, never `supabase db push`. NTER also holds the
  private file-manager schema, applied outside the migration history; its two storage functions were fixed by F410, and
  `main` describes the whole schema in `20261126150000_file_manager_schema` (F411; its history row is written). Its
  grants were narrowed by F412: anon holds nothing on it.
- **Edge Functions (13):** `admin-ingest` v18, `admin-models` v19, `admin-personas` v5, `budget-ocr` v7, `desk-brief`
  v22, `document-file` v7, `factcheck` v8, `health` v18, `ingest-documents` v26, `ingest-worker` v17,
  `refresh-model-pricing` v19, `research-chat` v115, `transcribe-audio` v8.
- **Corpus on NTER:** 31,133 documents, 31,129 indexed, 864,951 chunks; database 19 GB, and the Phase B backup
  `document_chunks_unpartitioned` is still present. By desk: Bill Passage Probability Index 8,911, NCLT / NCLAT 7,549,
  Parliamentary Question Database 6,683, MP Profiles & Performance 3,515, Regulatory Body Watch 3,079, Cabinet
  Decisions 847, Budget Utilisation & Schemes 461, Industry Updates 59, Bureaucratic Transfers 29. Ingest jobs: 27,676,
  all succeeded; none queued or running.

## Milestones: what is left, in order

Current sequence: **M4 corpus and retrieval**, under the owner's decisions of 2026-11-03 (National first, all legal on hold).
The owner parked corpus work on 2026-10-17 in favour of M1, M2 and payments, then resumed National and Law on 2026-10-23.
Milestone IDs are retained for continuity. Each milestone ends with a checkpoint. The items below track the work; this
section orders it.

**M1. Data-serving clean-up** (backend, research tests and data-configuration repair).
- Done as of the 2026-11-10 sweep: F215, the F160 leftovers and the F202 leftover. Open: T15's checkpoint, which two
  failing state feeds break (F317); F216 research answers asserting what the rows do not say; F210 flaky research-thread
  test; all F201 optional review items now included. F160 also includes reliable reference serving for MLA Profiles & Coverage;
  a true scorecard remains M3. Approved behavior and exact task contracts:
  [spec](../specs/2026-10-17-m1-m2-cleanup.md), [plan](2026-10-17-m1-m2-cleanup.md).
- *Checkpoint:* correct coverage, dates and empty states; no `archive` answer except NSE/BSE;
  no scheduled source above 3 consecutive failures across at least three expected refresh
  opportunities; three consecutive completed CI runs green on first attempt. Verified empty
  sources are distinguished from outages. Production closure requires separately authorized rollout.

**M2. Front-end leftovers** (after M1, on the current integrated UI).
- F208 desk catalogue out of the first-load bundle (then lower the bundle baseline); the Heads of
  State panel shows its Wikidata links (F202).
- *Checkpoint:* entry gzip and total initial JavaScript measured lower before ratcheting the
  current 224,190-byte gzip baseline; catalogue search/navigation preserved; panel checked in a
  browser. Then move to M5 payments, not corpus ingestion.

**M3. Modules waiting on sources or methods** (owner decisions first).
- MLA Report Card from a real source (ADR/MyNeta, assembly records); District Performance,
  District Governance and District Crime (NITI Aspirational Districts, NFHS-5, UDISE+, MGNREGA, an
  approved composite method, a district map); the two tender aggregators (owner's source; F196);
  then the homepage source count (F191).
- *Checkpoint:* each module live from the store with a probe; F191 shows the true count.

**M4. Corpus and retrieval** (in progress; resumed by the owner 2026-10-23; National first and all legal on hold since
2026-11-03, [decision record](../decisions/0014-national-v1.1-ingestion-scope.md); section 3).
- Ordered by the [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §10 (F278). As of 2026-11-08: steps 1
  (inventory), 2 (eval baseline) and 3 (partitions, live on NTER) are done; 4 (hybrid), 6 (Bills adapter) and 8
  (batch registration) are merged and not on NTER; 5 (headers) is held under F289; 7 (capacity) waits on F279 and F294;
  9 (runner, F285) has its stages merged; 10 (acceptance) and 11 (the 10k, 100k, 1M ramp) are not started. Correction 2026-11-15: superseded by the 2026-11-10 status under "M4" in the current-state section above (steps 4, 6 and 8 are on NTER; 10 was used for Bills; 11 has its first collection loaded).
- Search follow-ups before or alongside the ramp: F288, F292, F284, F286, F293, F301; F296 until a live retry is seen.
- Older M4 items still open: F170 rules 4–9 with F37 and F38, P8, P9, P6, F34, F33 (section 3). R5, R7, L1, L2, F40 and F42
  were closed in the 2026-11-10 sweep (F299); Law waits under F318.
- *Checkpoint:* the frozen retrieval eval no worse after each load; cost recorded per batch.

**M5. Payments** (Live checkout public since 2026-10-22; checkpoint not evidenced; section 4).
- F107 legal pages (the lawyer's review); O6 the first real Live payment, live keys, top-up packs, downgrade and renewal rules; P2 organisations later.
- *Checkpoint:* one real payment end to end, credits granted, invoice issued.

**M6. Launch** (section 5).
- D2 nter.pro cutover; O1 nter.news key; O10 Vercel plan upgrade; O11 the old Vercel project
  deleted; P11; P12 dependency majors and the RLS advisor items; P1 home feeds and O9 when the owner
  has the inputs.
- *Checkpoint:* signed-in smoke test on nter.pro.

## Active M1/M2 cleanup programme — rollout 2026-10-17

Owner approved implementation, push/deploy and closure checks; corpus ingestion remains
excluded. Main cleanup through `0e970f4` is live, three compatibility migrations applied,
research-chat v66 (F220, `256f042`) and desk-brief v17 deployed. The T0–T14 implementation entries
have moved to Done with hashes; do not infer the remaining scheduled-observation gate is closed.

[Spec](../specs/2026-10-17-m1-m2-cleanup.md) · [plan](2026-10-17-m1-m2-cleanup.md) ·
[execution/rollout evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md).

- [ ] **T15 (M1/M2):** *Ready to build. 2026-11-10 (F299)* finish real scheduled source observations: three post-rollout expected
  refresh opportunities, including actual daily reference intervals. Never force extra calls
  to simulate those opportunities. Three consecutive first-attempt CI runs previously passed:
  39025298847, 39025660396 and 39026919956 (`d63192b`). Later F218 code CI passed
  on branch/main, but documentation-only run 39028606428 failed F199 (F220).
  F220 is now fixed/deployed as research-chat v66: three consecutive genuine
  post-fix CI runs 39030425827, 39030716589 and 39031190292 passed both app and SQL
  jobs on attempt 1. CI component verified complete at the 12:48 UTC observation;
  no retries, cancellations or empty commits were used. Separate local
  test interference F221 is fixed in `389dbed` (see the Done archive). Active hourly
  read-only follow-ups on this chat, explicitly requested by the owner, notify only on a meaningful
  failure or completion. Vercel connector remains 403; the authenticated CLI works for the exact
  DDL Labs scope. Report closure before beginning payment gateway integration.
  Read-only observation 2026-10-17 12:48 UTC: fixtures and both Music Charts
  modules completed three genuine hourly opportunities (10:40, 11:40, 12:45 UTC),
  all successful; fixtures retain seven current events across all four leagues.
  Daily reference intervals remain pending: MLA next due October 18 10:45 UTC;
  Constitutions first post-rollout opportunity due October 17 15:40 UTC.
  At that observation, origin/main `2dd8ecd` was deployed READY and F222 local.
  F222 subsequently released at `e1a5557` with verified ordinary refreshes;
  separate state-landing 502s were found in its bounded log scan (F223).
  Zero sources above three failures; no new actionable failure or full closure.
  [Observation evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1248-utc).
  Latest read-only observation 2026-10-17 14:48 UTC: fixtures and both charts
  remain at their fourth ordinary hourly opportunity at 13:50, all ok; next due
  just after 14:50, so no new expected opportunity was missed. Daily
  reference opportunities remain unchanged/pending; 188 constitution keys retain
  the inventory fingerprint, MLA reference remains 400 profiles + 100 coverage.
  The final three genuine release CI runs 39034204827, 39034521190 and
  39035656870 passed first attempt; READY production source matches main
  `5302dc3`. F223 subsequently received explicit implementation/release approval
  and was released at `0c1319c`; see the Done archive and its evidence below.
  [Latest observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1448-utc).
  F223 release observation at 15:40–15:42 UTC: runtime `0c1319c` READY;
  branch/main CI 39045568101 / 39045994021 passed both jobs on attempt 1.
  Fixtures/charts fifth genuine hourly opportunity at 14:55 passed. Daily
  references remain pending (Constitutions eligible at 15:45; MLA October 18).
  No source above three failures; hourly follow-up ACTIVE.
  [Evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md#f223-release-and-closure-observation--2026-10-17-1540-utc).
  Subsequent 15:46 UTC read-only observation confirms Constitutions' first real
  post-rollout daily success at 15:45 (unchanged, 188 stable keys, zero failures).
  Next daily due October 18 15:45 UTC; MLA still next due October 18 10:45 UTC.
  Both references still need further genuine daily opportunities; T15 remains open.
  Final F223 documentation head `731428f` deployed READY; both MLA summaries
  verified again 200/store with parity. Final CI 39046364866 passed app/SQL on
  attempt 1; latest three genuine F223 release runs are green. [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1546-utc).
  Read-only 15:49–15:51 UTC follow-up: no new daily opportunity; references
  unchanged, T15 open. Transient unrelated feed failures recorded accurately;
  only Growth Indicators retains failures (2) at 15:50, none above three.
  Serving inventory 70 modules / 257 variants; cron active every five minutes.
  Production `731428f` READY and three genuine first-attempt app/SQL CI runs
  remain green. Hourly follow-up stays ACTIVE; no action required yet.
  [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1549-utc).
  F224 runtime `0074991` is released; its post-deploy production writer
  acceptance remains pending at Growth's next ordinary daily opportunity,
  October 18 after 15:55 UTC (normally 16:00 UTC / 21:30 IST poll). Inspect
  feed_runs/feed_state and per-series logs without forcing refresh. Live API
  failed once on unemployment, then recovered with exact stored-row parity;
  do not substitute those reads for scheduled writer acceptance.
  [F224 evidence](../research/2026-10-17-f224-growth-budget-evidence.md).
  Latest read-only follow-up 17:08 UTC: cron active every five minutes; 70 serving
  modules / 257 variants, zero failing counters. Fixtures/charts seventh real
  hourly opportunity at 17:05. Daily references unchanged (one of three each);
  Growth post-F224 writer acceptance pending tomorrow. F221 test-only fix
  landed as `389dbed`; T15 open and hourly follow-up ACTIVE.
  [F221 and closure evidence](../research/2026-10-17-f221-test-isolation-evidence.md).

  Read-only October18 11:25 UTC: MLA daily observations2/3, next eligible
  October19 10:45:19 UTC; Constitutions1/3, next eligible October18 15:45:01 UTC.
  Growth post-F224 scheduled writer acceptance pending October18 after15:55 UTC,
  normally16:00 UTC poll. All257 serving variants zero failures; */5 cron active
  with expected Vercel route. F227 separately closed by owner real-flow acceptance
  (evidence0cc7198). Earliest overall handoff remains October19 late evening IST,
  conditional on actual third reference success and final release/CI checks.
  Hourly monitor ACTIVE; no forced refresh; Razorpay held, corpus excluded.

  Read-only October18 14:07 UTC: no new blocker; MLA2/3, Constitutions1/3,
  Growth post-F224 writer acceptance still pending its15:55 daily eligibility.
  All257 serving variants zero failures; six recent cron executions succeeded.
  Constitution188-key inventory unchanged; four-league coverage remains explicit.
  Production79c0799 READY; latest three main CI runs39128803358/39131455379/
  39131793656 individually green on attempt1, both app and SQL jobs.
  [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-18-1405-utc).
  Hourly checks continue; F231/F232 remain local/unpublished; payment held.

  Read-only October18 15:15 UTC: unchanged daily gates, MLA2/3 and
  Constitutions1/3; Growth post-F224 writer acceptance pending after15:55 UTC.
  All257 serving variants zero failures; */5 cron active, six recent successes.
  Fixtures24 with all four league windows accounted for; constitution188-key
  inventory unchanged. Production3ccdf8a READY; latest three main CI runs
  39135672936/39138686342/39139165726 individually green attempt1, app+SQL.
  [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-18-1514-utc).
  No new blocker or closure; hourly checks continue; Razorpay held, corpus excluded.

Current production evidence: all 120 modules HTTP 200; World Constitutions 188 stable keys,
fixtures 7 rows and failures reset, MLA reference 400 profiles + 100 coverage records serving
from storage. No source above three consecutive failures. Supabase pg_cron feed-refresh job
runs every five minutes and calls the deployed Vercel refresh route: the refresh system is active.
70 distinct modules / 257 variants serve from storage, with District Performance deliberately
planned/off. Corpus Edge Function versions/hashes and jobs were not changed.

Latest local gates: 6,126 Vitest tests, 1,155 Deno tests, 41 SQL fixtures with vacuity/rollback
checks, lint/build/router/bundle and browser checks pass. Explicitly authorized model evaluation:
4 faithful cases passed on v64; count/coverage case failed, then passed after the narrow v65
correction. Total actual cost $0.03677325, every temporary evaluator deleted. Detailed failed
batches, outputs and version distinctions are preserved; no rubric was loosened.

F218's separate Satellite landing fix is released (`0e2ebfb`) and moved to Done.
It does not close T15's real scheduled observations. The owner's earlier full
orientation list is compared item by item in the
[closure comparison](../research/2026-10-17-orientation-closure-comparison.md).

## Documentation follow-up

  Latest read-only billing-foundation observation2026-10-18: both daily references
  remain2/3; Growth16:00UTC timeout recovered on16:05 retry (not a new expected
  opportunity). Cron remains active every five minutes; no serving source above
  three failures. Detailed evidence in the existing cleanup execution record.

- [ ] **F219. Reconcile living architecture claims with current implementation.** *Ready to build. 2026-11-10 (F299)*
  The owner's orientation-list comparison on 2026-10-17 reconfirmed the architecture
  index's nine-function claim/missing feed-store path and the schema chapter's
  UUID `desk_rows` primary key, contrary to the composite migration key.
  Reconcile current claims without rewriting dated execution snapshots; consult
  rollout sections for current versions/counts. Separate documentation work,
  not an additional M1/M2 or payment prerequisite. [Comparison](../research/2026-10-17-orientation-closure-comparison.md). 2026-11-15: `supabase/functions/` has 11 function folders and NTER has 11 functions deployed, so the nine-function claim is two short.

## UI follow-ups

- [ ] **F107. Legal policies for payment-gateway activation.** *Remaining: the lawyer's review (owner). 2026-11-10 (F299)* Owner request
  2026-10-12: Privacy, Terms, Refund & Cancellation, Delivery and Contact pages
  for Niyantran Strategy Consulting Pvt Ltd (Kolkata, not GST-registered),
  matching plans Free/Plus ₹399/Pro ₹999/Max ₹9,999 priced on AI credits and
  storage, and the grievance officer. [Spec](../specs/2026-10-12-legal-policies.md).
  Drafted and verified on `task/legal-policies` (2026-10-12): six pages at
  clean paths, footer company line and links, signup notice; 2,533 Vitest /
  881 Deno tests, lint, build. Open: full registered address, the eight drafted
  assumptions in the spec, lawyer review, pricing page (F99 with F109).

- [ ] **F169. Module data repair.** *Remaining: only the registry's "Direct feed configured" labels, which no code reads; the feed work is done (ADR 0012, `ffbc8ff6`). 2026-11-10 (F299)* Owner 2026-10-14, after Cabinet Decisions showed one listing:
  "Can you do a complete module-by-module analysis?" … "what do you propose as a fix? … document it".
  [Audit](../research/2026-10-14-module-audit/README.md) of 123 modules (44 live, 10 live but over
  4 s, 4 broken, 46 stored only, 19 not built), [spec](../specs/2026-10-14-module-data-repair.md)
  and [plan](2026-10-14-module-data-repair.md): phase 1 backup files off the live site, phase 2
  repair broken and thin sources (PIB, briefs, Geopolitics, ISL, Regulatory, Manifold, Wikidata,
  F166–F168), phase 3 "As of" dates and an honest admin status screen, phase 4 F160 seeded with the
  larger registers. Approved 2026-10-14 with all five recommendations; Supabase is on Pro;
  Vercel upgrade later; O6 after this work. Phase 4 is records-first (owner 2026-10-14): every
  listed item kept as its own record under rules 1 to 3 of the F170 spec, keyed by the corpus
  identity where the corpus holds the document; no chunking, OCR or full-text fetching in F169.
  - **Phases 1 and 2 live, 2026-10-14** (pushed `11cc881..df556a4`, deployment in `bom1`; PIB dates
    follow-up `c5e4bf2`). Production probe after the deploy, all 120 desk modules: 116 live, 4 stored
    while the new deployment warmed up (all four live on the next run); no backup-pack answer.
    Regulatory Body Watch 10 → 171 rows, AI & Tech 67 stored → 104 live, Top Business Players 0 → 84,
    ISL 1 → 169, Geopolitics newest story 0.5 h old, Morning Brief 220 and Statement Tracker 100
    live. Sports Governance and State Tenders now show the empty state (no pack).
  - **Phase 3 done 2026-10-14:** T9 (`8109eff`) stored modules say "stored copy · as of <newest record
    date>" or "date not recorded" (NSE/BSE "as of 15 Jul 2026"); Energy no longer promises a live feed.
    T10 (`fce768b`) the admin API status screen shows only what checks found ("Not checked" until a
    sweep; stored answers "Stored"); the hand-written list and every promotion rule are gone. Not done
    from T10: the registry's "Direct feed configured" labels (data file) and the database-size line
    (moves to phase 4, which adds a server route for it). Still to do: phase 4 (needs the Vercel
    upgrade to go live).
  - **Phase 4 built 2026-10-15** (C1–C6, each reviewed independently, review findings fixed): C1
    schedule and item keys (`server/feedSchedule.mjs`, ADR 0012); C2 tables and functions
    (`20261015150000_feed_records`: lease token, kind from the schedule, caps, shrink rule, source
    order); C3 store writer and `POST /api/feeds/refresh` (55 s, four at a time, one request per host,
    live answers only, dormant until `FEED_REFRESH_SECRET` is set); C4 pages from the store while
    fresh, labelled "updated N min ago", live path otherwise; C5 admin "Scheduled feeds" health and
    database size (`20261015160000_feed_admin`); C6 `scripts/load-feed-register.mjs` for Cabinet's
    register (79 decisions, one per decision). Local run against the real sources: 64 of 65 modules
    stored (NSE has no live source), 7,000 items, a second run rewrote nothing. C7 go-live: steps 1–2
    (migrations 52 and 53 applied to NTER, dormant code) done with Push 7; step 3 (secret) done by the
    owner 2026-10-15 (Vault `feed_refresh_secret` and Vercel `FEED_REFRESH_SECRET`, production; an
    unsigned `POST /api/feeds/refresh` now answers 401, not 503); step 4 (timer) switched on
    2026-10-15 before the Vercel upgrade (owner); then the Cabinet register load, a day with `serve` off, and `serve` on
    class by class.
  - **MLA Directory's register (owner: option 1, 2026-10-15), live and served.** 31 per-state
    store variants (class `register`, kind `reference`: a reload replaces a state's list), off the
    timer; migration 54 `20261015170000_feed_register_page` (`feed_page_across`, `feed_make_due`, no
    stale flag for registers). Loaded to NTER 2026-10-15: 4,104 MLAs in 31 states; `serve` on. Without
    a state the page shows 16 per state (496); with `state` a state's whole list. Left out of the
    rows: email, the age (birth date kept), and the affidavit figures (assets, liabilities, criminal
    cases), whose only cited source is Wikipedia. Cabinet's 79-decision register is loaded with
    `serve` off until the timer runs (live decisions on top).
    Whether Vercel left `backup/` out of the package can't be read with the available tools; the
    code refuses pack reads on Vercel either way.
  - [x] T0 probe, built 2026-10-14 on `task/f169-phase1`, committed `d70d753`:
    `scripts/module-probe.mjs` (`npm run probe:modules -- --desk national`), module list from
    `DESK_CATALOGUE` (120 desk modules; the audit's 3 off-desk Global entries are not in it),
    records in `modules.json` fields plus adapter, kind and fallback, `--compare <file>`. Unit
    test `src/lib/moduleProbe.test.js`. Before-run on production (all desks, 2026-10-14 15:42 UTC;
    deployment not identified): `docs/research/2026-10-14-module-audit/probe-before-t1.json`, 120
    of 120 answered 200; National rows and `served` equal the audit's for 15 of 17 (Morning Brief and
    Statement Tracker answered 220 and 104 live this time, 0 in the audit). Newest dates differ
    where the audit counted bare years; the probe does not.
  - [x] T1 backup files off the live site, `d70d753`, live 2026-10-14:
    `server/backupFeed.mjs` reads a pack on Vercel only for a module on `LIVE_BACKUP_PACKS`
    (empty); `vercel.json` and the router `config` exclude `backup/**` and include only
    `{src/data/**,public/data/**}`; `src/backupPacksDeploy.test.js` rewritten. The F156 advice
    above to add packs to `includeFiles` no longer applies.
    **Checkpoint 1 owner list (modules seen answering from a pack on production, 2026-10-14):**
    AI & the Tech Industry 67 rows, Sports Governance & Policy 34, State Tender Aggregator 25 (in
    both probe runs); Geopolitics News Wire 38 and Music Charts — India Top 25 100 (first run only,
    when the live source missed 4 s; live 24 and 25 rows on the second); Box Office Tracker (in the
    audit only; live 245 rows in both runs). After T1 these show the plain empty state whenever
    their live source and archive are empty. 69 desk modules have a pack, so any of them that
    misses its live source with an empty archive now shows the empty state instead of pack rows.
    After deploy: re-run the probe over all desks and confirm no `backup-pack` answer.

- [ ] **F170. Storage, chunking and OCR rules (recorded, not scheduled).** *Remaining: the rules the bulk pipeline does not cover (see F278, F285, F307). 2026-11-10 (F299)* Owner 2026-10-14:
  "record all this as a plan and not do the OCR and chunking bit, because I still have a 10 GB
  corpus and a corpus linking file with pre-contained OCR within it." [Spec](../specs/2026-10-14-document-text-rules.md):
  - rules 1 to 3 (one record per item, keep by kind, files in the bucket) feed F169 phase 4;
  - rules 4 to 9 wait for R7's corpus mapping:
    - chunk any item with a body of text, whatever its length;
    - a background queue; one shared chunking per document, with a lock;
    - chunk on demand at drag time; the platform pays for indexing;
    - for leftovers only, a free page-by-page triage before Mistral OCR; Hindi pages go to OCR
      (owner); a cost estimate and a daily cap before any paid run.
  Read 2026-10-14: the ingest worker OCRs every page today (USD 4 per 1,000) and never checks the
  text layer; chat uploads check the text layer for the whole file only, so a scanned PDF with one
  typed page passes with empty scanned pages. Open: news full text kept per chat or shared
  (copyright; recommendation per chat), and the OCR cap amount.
- **Plan for what is left (2026-10-15):** [next work](2026-10-15-next-work.md): small items (F178, F176,
  F175, local signed-in checks), measurements (F41, F35, F59), then F169 phase 4 records-first storage.
  Progress 2026-10-15: F175, F176 and F178 done; F35 and F41 measured; C1 (schedule) and C2 (tables)
  built on branches, C2 in review fixes.

- [ ] **F196. Planned modules: make them work from the sources the repo already names.** *Remaining: two district modules (no source) and two tender aggregators (the owner's source). 2026-11-10 (F299)* Owner
  2026-10-15: "The source is in that only … We just have to make them up and working"; the tender
  aggregators wait for the owner's source. [Research](../research/2026-10-15-planned-module-sources.md):
  of the 17 in scope, 4 news modules and Election Forecast can be built now; SDL auctions from the RBI
  press feed; State Economic, State Fiscal, NITI indices and Cross-State from the RBI state handbook
  (same RBI site as the registry's source); the 5 district themes only as state-level figures; District
  Governance and District Crime have no source and stay planned. Owner decisions (2026-10-15, "I agree
  with your recommendation"): use the RBI handbook as a yearly stored register; the five district
  themes show state-level figures and are renamed; Party Organisation Map is party seat strength per
  state, an India map (official Survey of India boundary) coloured by the largest party, with a table.
  - Batch 1 done 2026-10-15 (`99d3e83`): Sports Governance & Policy, Governor Friction & President's
    Rule, Legislative Productivity (news coverage only) and MLA Defection from curated Google News
    queries (20/20, 19/20, 20/20, 20/20 on-topic in the top 20, with headline guards), Election Forecast
    from Manifold's Indian election markets (play money; 50 markets, 17 open). On `FEED_SCHEDULE`;
    registry and feature map updated (registry addresses 115 → 120; the homepage keeps 246, F191).
    Checks: 37 new tests red first, lint, build, router import, 5,509 Vitest, 1,079 Deno; each module
    answered live on a local server. Left: no Sports history (the F63 pack is not served on the live
    site); resolved Election markets do not show the winner.
  - Batch 2 done and live 2026-10-15 (`6e32b72`, `5f54439`; migration 58
    `20261015230000_feed_nothing_new`): eight RBI Handbook registers (2024-25 edition, published
    11 Dec 2025; 152 tables, 64,445 figures, newest whole years per table, one store variant per table
    with a Table picker), the Cross-State Comparison Engine (ranks the latest complete year), and the
    SDL Auction & Borrowing Tracker (RBI press feed, kept per security; 45 backfilled lines). The five
    "District …" modules show state-level figures under "State …" labels. Independent review found
    three required fixes (partial years, append-only "nothing new" counted as failure, unbounded live
    cache keys), all fixed before loading. Loaded with `load-feed-register.mjs --target prod`, `serve`
    on; production probe: all answer from the store in 0.2–0.7 s.
  - Party Organisation Map live 2026-10-15 (`911d253`, `65ffac8`): party seat strength per state
    assembly from the MLA register (31 assemblies, 4,103 MLAs, as of 19 Aug 2026), an India map from
    DataMeet's states layer (owner-approved download; CC-BY 2.5 India; verified against the official
    Survey of India extent — Ladakh to about 37°04.7′N with Aksai Chin, Gilgit, Skardu, Siachen and
    Shaksgam; Muzaffarabad and Mirpur in J&K; Tawang in Arunachal; the check runs as a test), shipped
    as a 55 KB file, coloured by the largest party, with a table, a national roll-up and an MLA-list
    hand-off. "Majority" means more than half of the MLAs the register lists. Production: 31 rows in
    1.6 s; the map renders as specified.
  - Remaining planned: District Governance & Grievance and District Crime & Safety (no source in the
    repo), Municipal & Panchayat Tender Aggregator (owner's source awaited); State Tender Aggregator
    likewise.

- [ ] **F191. Homepage "Source endpoints" stays 246 (owner, 2026-10-15).** *Waits on the owner. 2026-11-10 (F299)* "Keep it at 246 sources for
  now because we are going to be fixing the rest of the sources and eventually bringing it up to that
  number, or whatever the true number is." The source registry counts 115 working-route addresses
  since F180; the published figure stays 246 (`src/lib/siteFigures.js`) until the sources are sorted
  out, then it shows the true count.

## 2. Awaiting the owner's decision

Each needs one answer, then an agent can finish it.

- [ ] **P12. Advisor findings and the dependency audit** *Remaining: the Vite and Vitest majors, the same as F234; the rest is done (`28c8fc6`, `033f4af`). 2026-11-10 (F299)* (checked 2026-09-29): *2026-10-14 (F171 B6, `28c8fc6`, `eeb9ccd`): `xlsx` is SheetJS 0.20.3 from the vendor's distribution, `npm audit --omit=dev` clean; parsing capped at 10 MB and 5,000 rows a sheet. npm audit no longer tracks SheetJS (URL dependency): check https://cdn.sheetjs.com for releases when touching it. Still open: the Vite/Vitest majors and the RLS advisor items below.*
  - **`xlsx` 0.18.5: high severity, and no npm fix** (prototype pollution
    and ReDoS). `server/sourceExtract.mjs` parses fetched source documents
    and chat uploads with it, so the input is untrusted. The fix is SheetJS's
    own distribution (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`),
    which is not on npm. Decide whether to allow that source.
  - `vite` 5.4 (the esbuild dev-server advisory) and `vitest` 3.2
    (`@vitest/mocker`): moderate and development-only. The fixes are major
    upgrades (Vite 7+, Vitest 4.1.11+). Decide whether to take them now.
  - Twelve RLS policies call `auth.uid()` per row (`auth_rls_initplan`), and
    six foreign keys have no index. The fix is one migration of
    `(select auth.uid())` rewrites and indexes, which needs approval.
  - By design, recorded under accepted risks:
    - RLS with no policy on server-only tables (nine in the October 3 advisor check);
    - eight `SECURITY DEFINER` RPCs callable by signed-in users (they are
      the API);
    - 23 unused indexes (low traffic);
    - three sets of multiple permissive policies.
  - Leaked-password protection and the Auth connection strategy are
    dashboard settings (D1).
  *2026-10-15 (owner: "P12 speedup, go ahead"; `033f4af`): migration 55 `20261015190000_rls_initplan_fk_indexes` applied to NTER with `supabase db push`: the twelve policies read `(select auth.uid())` once per statement (a pre-check refuses if any live policy differs), and the eight unindexed foreign keys have covering indexes. Checks: `npm run test:sql` 34 fixtures pass, the new one fails without the migration; live: 0 bare `auth.uid()` policies, 8 indexes; the security advisor shows only the accepted findings. Left open here: the Vite 7 / Vitest 4 upgrade (developer tooling, no reader-facing speed); unused indexes and multiple permissive policies stay as recorded.*

## 3. RAG v2: retrieval and page-aware ingestion (in progress)

Designed on 2026-09-30. The map and every decision are in
`specs/2026-09-30-rag-v2-capability-map.md`, and the evidence in
`research/2026-09-30-rag-v2-investigation.md`. The old runbook
`plans/2026-09-29-corpus-ingestion.md` is superseded: its measurements stand,
but its commands aren't to be run.

Follow-ups and findings:

- [ ] **F33.** *Ready to build. 2026-11-10 (F299)* A document picker (title search), to focus on a document no
  answer has cited yet.

- [ ] **F34.** *Ready to build. 2026-11-10 (F299)* Let the model choose a desk filter itself. It needs an
  answer-level evaluation first.

- [ ] **F38.** *Ready to build. 2026-11-10 (F299)* A sweeper for `corpus/staging/` objects older than 24 h, and
  for content-addressed objects no document references after a discard
  (admin-upload spec, "Follow-ups").

- [ ] **F37.** *Ready to build. 2026-11-10 (F299)* The `index` step recomposes the whole document on every
  claim. It took 547 ms of laptop CPU for 1,000 pages (I7), so a split
  document of 3,000 or more pages would pass the spec's 1.5 s threshold.
  Persist the composed pages after the first run (the spec's own fallback)
  before ingesting documents that large.

Earlier items, updated:

- [ ] **P6.** *Remaining: reranking; hybrid is tracked under T9 and F288. 2026-11-10 (F299)* Reranking and hybrid keyword search, after the corpus grows.

- [ ] **P8.** *Ready to build. 2026-11-10 (F299)* Re-crawl the 716 documents that have no `file_url`.

- [ ] **P9.** *Remaining: regulator document keys, curated views for modules with no rows, scheduled refresh into `desk_rows`; the questions part is done under F266. 2026-11-10 (F299)* Document keys for parliamentary questions and regulators;
  desk-row "cut two" (curated views, the 41 modules with no rows) and a
  refresh pipeline.

- [ ] **O6.** *Waits on the owner. 2026-11-10 (F299)* After F6: the Razorpay keys on Vercel, then one real payment
  - **2026-10-21 local verification:**6522 application/1174 Edge tests,53 SQL fixtures+53 omission checks, concurrent grace capture, lint/build/bundle/router pass. Independent Astra review has no remaining P1/P2 findings. In-app browser isolated UI actions pass; shared SQL/trigger/Edge activation approved and verified (migration20261021140246,research-chatv70). Runtime a2bd59b passed both required CI jobs39613814829 and is Preview READY/exact-SHA. Owner confirmed newv3Max Captured9000/webhook200. Checkoutclose/retry passes; deliberateTestdecline verified (failedpayment,zeroinvoice/lot,Maxunchanged). DedicatedTestrefund remains owner dashboard handoff; in-app terms block and Arc inspection rejected by automatic review under the existing in-app-only constraint. [Evidence](../research/2026-10-21-manual-grace-evidence.md).
  - **2026-10-21 priority: manual billing +48-hour access-only grace first.**
    Owner defers AutoPay integration/reminders to a later release and directs
    planning toward Live. Grace implementation, manual expiry/renewal notices,
    expiry/renewal/refund/recovery acceptance and exact-SHA CI/Test Preview gates
    remain open. Grace must not issue/extend credits or financial paid periods;
    anchor and explicit-Free semantics freeze before code. [Current contract](../specs/2026-10-21-billing-autopay.md)
    / [revised ordered plan](2026-10-21-billing-autopay.md).
    Standalone Test card and UPI enrollment/first payments verified; recurring
    collection, plan-change handoff and Live capability remain unverified.
    UPI access Request clicked with owner approval but no submission confirmation;
    Settings disabled text conflicts with successful Test mandate execution.
    No AutoPay application implementation or Production activation claimed.
  - **Live-capable approved contract (2026-10-21):** owner authorizes server/SQL
    implementation, verification and Test Preview publication. Versioned mode-
    scoped quote/capture/read functions preserve the approved plan behavior;
    Production checkout and Live keys remain unchanged. Sequential spec/plan:
    2026-10-21-billing-live-contract.md. Shared migration activation separately scoped.
  - **2026-10-20 owner-authorized cycle contract:** implement prorated price/credit upgrades, free next-plan scheduling, manual renewal and retained 10% rollover; delete frozen Test purchase graph for the owner-designated account only; verify and publish Test Preview. Sequential [spec](../specs/2026-10-20-billing-cycle-changes.md) / [plan](2026-10-20-billing-cycle-changes.md). Production web/settings/Live/corpus unchanged; shared additive migration separately approved/applied. Implementation71ee2cc is Test Preview READY; genuine new-flow payment acceptance remains under O6.
  end to end.
  - Added by F111 (2026-10-14; recommendations in the
    [credits plan](2026-10-14-ai-credits.md), "After launch"):
    - **Owner amendment 2026-10-18:** Free and paid accounts can buy top-ups;
      buying credits does not grant paid-model access. One-paisa denomination
      F225 production conversion is complete. Owner subsequently confirmed the
      top-up prices:20,000/50,000/100,000/200,000/500,000 credits for
      ₹499/1,199/2,299/4,399/10,499 respectively, valid12 months. Older pack
      quantities were ten-paisa units and must not feed a new payment catalogue.
    - **Planning authorized2026-10-18:** [spec](../specs/2026-10-18-razorpay-integration.md),
      [ordered plan](2026-10-18-razorpay-integration.md). React Standard Checkout,
      existing Vercel Node REST adapter, Supabase atomic fulfilment/invoice and
      durable webhook recovery. Fix authorized-only/missing-status acceptance,
      add immutable orders/catalogue, captured-only checks, payment top-up RPC,
      raw-byte webhook validation and deduplication before enabling checkout.
      Current previews share NTER. Owner confirms no customers/paid users and
      launch intended within two days. Recommended pre-launch rehearsal can use
      existing NTER with dedicated test buyers and restricted Test preview;
      a second hosted DB is optional, not a mandatory blocker.
      Expanded schema proposal: five private tables (orders, payments, event inbox,
      adjustments, paid periods), additive links on invoices/plan_grants/profile/
      lots/ledger; existing wallet/credit engine retained. Ordered A-O slices and
      local Docker execution evidence is linked below. Five-table migration and application changes implemented locally.
      Owner-generated key is Live mode; no GST registration reconfirmed; seller
      name/address supplied. Merchant/website approval remains unconfirmed.
      Context7 works; Razorpay MCP is not callable/connection unverified here.
      Separate Test-mode credentials/secure provisioning, enforced test-buyer
      allowlist configuration and merchant/legal readiness required. The allowlist
      now exists locally with causal tests and independent review; not deployed.
      Test mode does not isolate
      credit wallets/invoice records. Existing Docker containers are PostgreSQL
      fixtures, not a running full Supabase Auth/PostgREST stack. Owner explicitly approved local implementation/Docker testing before T15.
      Local implementation and Test-branch push/Preview build are approved before
      T15. Hosted migrations, provider writes and Live activation remain separately
      gated. Seller name/address supplied; reviewed adjustments chosen.
    - **Local implementation 2026-10-18:** five private billing tables, atomic
      capture/invoice, signed webhook inbox, leased recovery, anchored periods,
      reviewed adjustments and account purchase UI implemented and independently
      reviewed. [Execution evidence](../research/2026-10-18-razorpay-local-evidence.md).
      Final full SQL:all45 fixtures passed; Deno1,155 passed; lint/build/bundle/router passed.
      Preparation follow-up SQL:all45 fixtures passed, including added replay,
      overpayment, refund-ordering, debt and paid-top-up checks.
      Latest follow-up full Vitest:403 files/6,324 tests passed; the formerly
      timing-out paging file also passed46 isolated tests unchanged. Earlier
      failure retained in evidence; root cause unproven, no threshold/code change.
      Secure handoff prepared: pending separate Test-mode key pair and dedicated
      buyers; Preview task/razorpay-plan only, never broad Preview/Production.
      Owner confirms Test keys ready; no values provisioned. Connector403 persists
      but authenticated CLI fallback now verifies project/link/Production READY
      at3ccdf8a and no billing/Razorpay environment entries. GitHub lacks the local
      task/razorpay-plan branch; Vercel rejected its scoped closed-checkout setting
      with400 and created nothing. Owner now approves the recommended narrow Test
      branch push/Preview build before T15; no main/Production/database/Live changes.
      Published implementation6a749b6/docs24d51d4 on task/razorpay-plan. Preview
      dpl_GxGydDNFEv1By8T6x5WjpM1eboJX READY; CI39151639554 green attempt1 app+SQL.
      Verified Preview-only branch-scoped BILLING_CHECKOUT_OPEN=0 and deployed
      enabled=false/checkoutOpen=false/five packs; main/Production still3ccdf8a.
      **Latest closed Preview refresh:** owner-saved API variables verified Sensitive,
      Preview/task/razorpay-plan only; values/mode not read or authenticated.
      Authorized same-commit24d51d4 redeploy dpl_2D72ZQmN9hmLytECecJNYH97HXPm
      READY. App/config/Plus quote pass; Checkout closed; unauthenticated order401;
      unconfigured webhook503. Public webhook302 to Vercel login; protection unchanged.
      Account ID, independent webhook secret, dedicated test-buyer list and approved
      ingress/migration/Test execution remain pending. Production target
      dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m/source3ccdf8a unchanged before/after.
      No provider write, database/Edge deployment, source push or corpus operation.
      **2026-10-19:** approved owner buyer UUID saved to branch-only Sensitive
      BILLING_TEST_BUYER_IDS; removed broad Preview webhook-secret duplicate only.
      All six billing settings now Preview/task/razorpay-plan; Checkout0. Refreshed
      same source24d51d4 Preview dpl_HRHCghckTkLp5Jzqcp8uDvhunGzC READY. Config
      closed; Production/protection unchanged. New hosted JSON webhook blocker400
      `Webhook raw body unavailable.` reproduced locally with a Vercel-style lazy
      body getter. Scoped original-byte transport fix and causal host-helper test
      required before provider acceptance; no source fix/push yet. Public webhook
      still302; secure ingress and shared DB migration require explicit scope.
      Owner screenshot proves Test registration enabled55 subscriptions; exact
      event list/secret matching not independently verified. No provider write,
      database/Edge/corpus operation. See latest billing execution evidence.
      **Local raw-body fix2026-10-19:** own body descriptor avoids lazy parser;
      replayed data/end reader preserves Vercel original bytes. Causal lazy and
      restored-stream regressions failed before passing; real localhost HTTP
      proves exact UTF-8/whitespace and HMAC, no getter access. Focused80 and
      Deno1,155 tests, lint/build/bundle/router pass. Final full-suite result in
      billing execution evidence. No source commit/push/deploy; current Preview
      still pre-fix24d51d4. Existing ingress/subscription/migration/acceptance gates
      remain; Checkout, Production, Live keys and corpus unchanged.
      Final local verification:403 application files/6,333 tests pass108.48s;
      all other listed checks pass. Raw-body correction remains local/uncommitted.
      Owner approves Test-branch-only publication of this verified raw-body fix
      and closed Preview verification2026-10-19; no Production/DB/Live changes.
      **Published raw-body fix:**18db302 pushed only to task/razorpay-plan;
      Preview dpl_HtZeAsvc2oVEpSPj7Po9u77n6inf READY/exact SHA. Hosted JSON and
      malformed JSON reach signature rejection400; oversized413; unauthenticated
      order401; app/config pass, Checkout0/no exposed key. Production target and
      protection unchanged. CI39160473575 app+SQL green attempt1; raw-body
      correction published/verified18db302. Post-deployment evidence notes local.
      Public webhook302 remains; no valid event/provider/DB/Live/corpus operation.
      Owner authorizes controlled hosted Test rehearsal2026-10-19: reviewed
      additive NTER migration, allowlisted Test flow and reconciliation before
      Live; public checkout/Live/corpus gates retained. Financial baseline captured;
      browser UI handoff requested due unavailable automation. See billing plan.
      **Hosted foundation2026-10-19:** approved migration applied to NTER as
      20261018200238/billing_purchases, reviewed local20261018160700 SHA recorded.
      Five private RLS tables/service-only RPCs verified; all original profile/
      financial fingerprints and balance preserved; new billing tables empty.
      Test Checkout still closed. Temporary Test share token revoked after307
      cookie handshake; non-expiring alias exception blocked before execution by
      automatic approval review. Explicit Test-alias exception approval pending;
      owner agrees to guided Test UI steps. No payment/Live/Edge/corpus change.
      **Approved Test ingress / pilot ready2026-10-19:** owner explicitly approved
      alias-only protection exception until manual revocation after testing; applied
      and unsigned public webhook400 verified after redeploy. No paid add-on.
      Branch-only Checkout1; Preview dpl_7Z3ZA131HxYPektqosTJ7tUgF5Ws READY18db302,
      runtime Test prefix/enabled confirmed without printing key. Test-buyer guard
      retained. Production target/protection unchanged; no Live/Edge/corpus action.
      Orders/payments/events/invoices0 before guided owner20k/499INR simulated pilot.
      Genuine provider acceptance/reconciliation pending. Close Test Checkout and
      manually revoke alias exception after testing; detailed billing evidence linked.
      **Test pilot blocked2026-10-19:** two Plus399INR intents reconciling with
      no provider order ID; payments/events/invoices0; owner reports Test Orders
      empty. Do not retry payment. Local safe order-stage/provider-status
      diagnostics verified locally:8causal red cases,88focused/6341full/1155Deno
      pass; lint/build/bundle/router pass. Root cause unconfirmed; code uncommitted
      and owner approved Test-only diagnostic publication2026-10-19.
      Published runtime895b7a0/recordcd1413c only Test branch; Preview
      dpl_8ouxfCPPnQ2zQMrE7Zh3Vtr9B26g READY/exactcd1413c, Test config and
      unsigned webhook400 verified. Production target/protection unchanged.
      CI39164169136 attempt1 initially in progress. Controlled owner top-up
      order-only reproduction completed: provider_create/http401 in safe hosted
      log20:39:36UTC. Razorpay rejected API authentication; exact credential fault
      unconfirmed. New top-up intent reconciling/unbound; payments/events/invoices0.
      Owner must securely correct matching Test key pair (branch-only), then Test
      redeploy and bounded recovery before further purchase attempts. Webhook
      secret and Production/Live remain unchanged. O6 acceptance still blocked.
      Owner-reported API-secret update followed by approved Test redeploy:
      dpl_AMXGYdcbnso3kdKugsZhSC6rqMKh READY/exactcd1413c. Metadata shows
      WEBHOOK_SECRET updated02:29IST; KEY_SECRET remains Oct18 23:55IST.
      Pause order attempts; owner must correct API-secret field and preserve
      matching webhook secret. Later metadata confirms correct API pair updates
      02:36/02:37IST; Test redeployed dpl_93oRKJG9xbUEVFby77Jr1Pi1JJhJ READY
      cd1413c, runtime Test mode. Fresh50k order-only owner reproduction requested;
      credential acceptance subsequently confirmed: fresh50k and Pro Test provider
      orders created/bound ready; payments/events/invoices0. Earlier20k/Plus stuck
      because stable browser intent reuses unbound reconciling rows, and nonfresh
      claims never retry. Open recovery defect: distinguish definitive rejected
      creation from uncertain outcomes; safe explicit retry with causal duplicate/
      timeout safeguards and controlled reconciliation of older intents required.
      Owner approved local fix plus Test publication2026-10-19. Implementing
      durable rejection metadata/atomic same-intent retry; timeout/unknown remains
      pending. Additive shared-DB migration and legacy operator decisions require
      separate concrete approval; main/Production/Live/corpus excluded.
      Local recovery verified:6351Vitest/1155Deno/46SQL fixtures pass;102focused,
      causal service/client red, vacuity, retry and capture concurrency, original
      billing fixture with new migration, lint/build/bundle/router pass.
      Ready for release; awaiting shared-Supabase two-column/service-only-RPC
      migration approval and reviewed classification of the three old Test
      intents. No hosted schema/row mutation or Test publication yet; preserve
      working Preview until dependency can be applied.
      Owner approved shared additive migration and reviewed Test repairs. Hosted
      migration20261018214242/billing_creation_retry applied exact08fb2591 hash;
      service-only grants verified; financial fingerprints unchanged. Actual
      Razorpay Test All Orders complete1-2 inventory contains only new Pro/50k;
      old three receipts absent, zero captured payments. Reviewed three exact
      old Test intents:retryable=true, one operator audit each; no grants/invoices.
      Ready for authorized Test-only publication; Production web/Live/corpus
      unchanged.
      CI39164169136 app+SQL green attempt1. Separately
      observed Production redeploy dpl_3jVL7ikUYANELS4Jt94vDF1Sqckj from same
      main3ccdf8a; protection unchanged, initiator unknown, no agent Production action.
      Recovery releasef96863f/recordsd709ecb pushed only Test; Preview
      dpl_CnpXP4qtm4HgnKarC3SuUF7uPzHE READY/exactd709ecb. Config Test mode,
      webhook400, signed-in purchases/invoices200; Production web/protection
      unchanged. CI39169346694 app+SQL green attempt1. Owner Checkout retry
      succeeded: original Plus5af59ea0 and topup734e8f1c now ready/bound to Test
      orders, retry permission consumed, review audit retained; five intents total,
      zero payments/invoices and unchanged financial fingerprints. Oldest Plus
      remains retryable. No payment initiated by agent.
      **Purchase-status wording follow-up approved:** display-only ready orders
      now Awaiting payment; uncertain/retryable/terminal labels retained. Causal
      rendering test failed before fix; 58 focused tests, lint/build/bundle pass.
      Full suite 404 files/6,358 tests green; commit10fd50a pushed only Test,
      Preview dpl_DHpUe1gv4isyHGpLRkbELS4BW81v READY/exact10fd50a;
      deployed CreditsPage asset verifies both labels. Arc history data remains
      loading; owner refresh verification pending. CI39170163103 in progress.
      Production target/protection unchanged; spec2026-10-19-purchase-status-wording.
      No stable intent/API/SQL changes. Actual captured Test payment and signed
      provider webhook acceptance remain pending.
      **Billing purchase experience — local 2026-10-20:** owner authorized UI
      cleanup after screenshot. Review before payment, current-plan distinction,
      collapsed identifiable unconfirmed attempts/admin tools, honest read errors
      and cross-section refresh implemented locally; audit rows unchanged.
      Spec/plan2026-10-20-billing-purchase-experience. Focused136 and Deno1155
      pass; lint/build/bundle/router pass, synthetic browser desktop/320px checked.
      Full app6363 pass/5 fail: four publisher fixture clocks already fixed on
      newer main, one feedStore timing case passes in isolation. No publication;
      main integration/full green and hosted payment acceptance still pending.
      **2026-10-20 Test continuation:** UI89bab64 preserved; latest main9d89c1b
      integrated via dc9a5e7. Operator alias and stale-plan preflight6515956;
      shared migration separately approved/applied, canonical hashes and service-
      only grants verified. All financial fingerprints unchanged. Full6386 app,
      1172 Deno,47 SQL fixtures pass, plus lint/build/bundle/router. New review
      requires explicit confirmation and never auto-replaces uncertain payments.
      Test publication/remote acceptance in2026-10-20-billing-preflight-release.md.
      **Test release verified:**6182686 Preview READY; CI39311346794 attempt1
      both jobs green. Deployed review/current-plan/history assets and API guards
      verified. Production deployment/protection unchanged and billing disabled.
      Hosted migration history20261019192743; actual captured Test top-up,
      signed webhook/invoice and plan lifecycle rehearsal still pending.
      **Purchased plan periods — 2026-10-20:** canonical active/future display
      implemented with confirmed dates, allowances and invoice links, no early
      balance/access change. New read-only service RPC separately approved and
      applied (local20261019194527/hosted20261019195351); canonical hash matches,
      financial fingerprints identical, advisor counts unchanged. Full6402 app/
      1172 Deno/48 SQL fixtures plus lint/build/bundle/router pass. Accounting
      matrix covers9 paid transitions and5 packs on all4 plans; no denomination
      or commercial rule changes. Test publication authorized; final deployed
      SHA/remote CI reported in chat. Actual owner capture/reconciliation and
      plan lifecycle rehearsal remain open. Spec/plan2026-10-20-billing-plan-period-display.
      **Owner Test payments reconciled — 2026-10-20:**500k topup₹10,499
      and Pro₹999 captured/fulfilled,1 invoice/lot/grant each. Balance566460.511
      reconciles exactly. No confirmed₹499 in account records. **Open blocker:**
      signed webhook delivery returns400 (42 observed POSTs), verified inbox empty;
      callback worked but webhook acceptance has not passed. Owner asked for
      dashboard response text; cause not yet established. Invoice rendering in
      IAB unverified (Open produced no tab); stored invoice facts verified.
      UI polish proposed only. See purchased-period execution record. No code,
      config, provider/payment or Live mutation in this read-only investigation.
      **Webhook diagnostic follow-up:** Razorpay response body null; Test
      requests reach api/router (WAF allow), exact rejection stage unknown.
      Prepare local Test-only allowlisted category logging; no secrets/bodies/
      headers/identifiers. Spec/plan2026-10-20-test-webhook-diagnostics. New
      Test publication approval required; no schema/provider/financial mutation.
      Local diagnostics verified:6408 app/1172 Deno, focused114, lint/build/
      bundle/router pass;5 causal failures before logging. Only fixed Test
      stage/status emitted; Live/unrelated silence and unexpected-error redaction
      verified. Owner approved Test-only publication:6100095 pushed, Preview
      dpl_izDrfEvZ4xyKfViHwvDxrHFse8mo READY; CI39321500694 green attempt1.
      Unsigned control logs signature as expected; this is not a provider
      delivery. At20:47 UTC October19 no natural retry had reached the new
      deployment; actual signed failure remains unknown. Inbox0, fulfilled
      Test orders2, captured payments2. Production commit/config/protection
      unchanged. See diagnostics plan for release evidence.
      **Natural retries20:51–20:52 UTC:**3 deliveries on6100095 log signature/400,
      distinct from the unsigned control. Rejection stage confirmed before
      merchant/inbox processing; secret mismatch versus raw-byte/signature input
      difference remains to establish. No secret/provider/financial change.
      Owner authorizes Test-only fix. Local signature/raw-byte replay checks
      pass; no proven code defect. Branch-only Sensitive secret scope confirmed.
      Owner has original webhook secret; secure re-entry into the one Vercel
      Preview variable requested, awaiting save before redeployment and real
      webhook acceptance. Production/Live unchanged; purchases remain paused.
      **Customer history cleanup (owner approved local fix):** hide unpaid and
      safe-to-retry checkout-only records, retain completed/refunded and unresolved
      payments visibly, preserve all internal records and duplicate protections.
      Spec/plan2026-10-20-checkout-history; local fix verified:2 causal red cases,
      focused120/full6409 pass, lint/build/bundle and synthetic browser pass.
      Source/test/task records remain uncommitted/unpublished; no stored attempt,
      retry guard, backend, Production or Live change.
      **Plan discovery UI (owner approved local):** show included credits on
      plan cards, server-active paid badge under avatar and account Change plan
      dialog with current plan and safe review handoff. Existing downgrade
      scheduling/payment logic preserved. Spec/plan2026-10-20-plan-discovery;
      local verified:4 causal red guards, focused74/107 and full6421 pass,
      lint/build/bundle, disposable plan-period SQL+vacuity and desktop/mobile
      synthetic dialog checks pass. Current plan/allowances/timing and explicit
      review handoff confirmed; actual hosted payment rehearsal remains pending.
      Uncommitted/unpublished; webhook secret re-entry separately pending.
      Owner now approves publishing both UI fixes to task/razorpay-plan Test
      Preview. Released7aa3cc3, READY dpl_2EZ2aLSNLxQy9cLk7XGPiGCFHkr3;
      authenticated badge/menu/picker/allowance/Plus-review handoff verified,
      abandoned list absent, no payment initiated and browser errors0. CI39393838099
      attempt1 app/Edge and database jobs green. Production/Live unchanged.
      Post-release evidence edits remain local; webhook-secret re-entry pending.
      Owner requests attached profile pill with distinct Plus/Pro/Max colours;
      local follow-up verified:25 profile tests, lint/build/bundle,6 browser
      overlap checks and light/dark contrast pass. Uncommitted/unpublished;
      see plan-discovery record. Production/Live unchanged.
      Subsequently owner-approved badge release caa3212 READY as
      dpl_8pp5Soxo6nhdkQAU8XeLvJskQNhp, CI39410686188 both jobs green attempt1;
      live Pro pill overlap/colour verified. Fresh readiness read shows inbox0,
      adjustments0 and only2 fulfilled Test products (500k/Pro). Signed webhook,
      remaining provider lifecycle/recovery/refund/invoice-view acceptance and
      launch/Live gates remain open; details in plan-discovery release record.
      Owner saved original webhook secret: metadata update verified; exactcaa3212
      redeployed Test-only as dpl_BhTpje1R95zM18MVSHn3rCEa4EoZ READY. Inbox0
      before delivery; no webhook requests in preceding hour. Await natural or
      owner-replayed existing Test captured event before claiming signature
      acceptance. No new payment; Production runtime/closed Checkout retained.
      **Webhook blocker resolved for new Test events —20Oct19:54 IST:** owner
      completes499INR top-up; authorized/captured/order.paid each200 and inbox
      done attempt1. Exactly1 captured payment/invoice NIY/2627/00003/20000-credit
      lot/grant; wallet586286.87 equals lots, debt0, Pro period unchanged.
      Original durable intent reused. Three distinct events are not duplicate
      replay/browser-close acceptance; those and plan/refund/invoice-view/Live
      gates remain open. Full evidence in webhook-diagnostics record.
      Owner Pro->Max Test upgrade verified: captured9999INR, invoice00004,
      one750000 monthly grant, unusedPro65000 replaced; topups/signup preserved,
      wallet1271286.87 debt0, all3 events done attempt1. Downgrade pending.
      Owner requests distinct Current plan/Popular badge styling: scoped local
      green current state versus purple recommendation verified:31 tests,
      lint/build/bundle and both-theme browser comparison pass; local/unpublished.
      Subsequent owner Plus Test399 purchase also verified: invoice00005, future
      period20Nov–20Dec, zero early lots/ledger entries, Max/balance unchanged;
      all3 events done attempt1/HTTP200. Real future activation remains pending,
      not forced. Recovery/duplicate/refund/invoice-view and Live gates stay open.
      **Commercial policy reopened by owner:** full-price upgrades and purchasing
      future lower-plan months are rejected as the intended change-plan UX.
      Discuss proration, unused-paid value/credits and no-charge downgrade
      scheduling before further implementation or Live opening. Previous Test
      checks establish mechanical accounting only. Owner requests publication of
      existing label CSS first; no new billing coding or financial changes.
      **Previously observed operator-list defect:** billing/adjustments503; read-only reviews RPC
      reproduces42702 ambiguous pay.id (table alias versus PL/pgSQL variable).
      Resolved by6515956 and the separately approved shared migration above;
      real read-only reviews RPC now succeeds. Full adjustment/refund acceptance
      still needs actual Test events; an empty list alone does not prove it.
      O6 remains open for restricted external Test-mode acceptance and release gates;
      no main/Production push/deployment, provider write, key provisioning or payment.
    - **Downgrade at the next cycle:** the new billing fulfilment queues a lower plan
      until the current `plan_period_end`.
    - **Renewal dates anchored to the first paid day,** so they do not drift
      after the 31st.
    - **No auto-renew at launch** (owner decided 2026-10-14); the Terms and refund policy say so
      (F161).

- [ ] **P2.** *Waits on the owner. 2026-11-10 (F299)* Organisation seats, organisation billing, Razorpay
  subscriptions.

## 5. Launch

- [ ] **O11. Delete the old Vercel project `niyantran-desk-reference-v6` (owner).** *Waits on the owner. 2026-11-10 (F299)* Its Git link was
  removed under F94 (2026-10-12); the project and its deployment history remain. Deleting it is the
  owner's action in the Vercel dashboard.

- [ ] **P11.** *Waits on the developer. 2026-11-10 (F299)* Whether `require_parameters` makes reasoning a hard routing
  constraint, and whether a single attachment should be capped at its
  per-document quota. Decided on D3's evidence.

## 6. Waiting on owner assets

- [ ] **O9.** *Remaining: none unless the owner sends a new mockup; close if the owner confirms. 2026-11-10 (F299)* Desk-landing visual inputs: National mockup received on 2026-10-04 and tracked by F81. The supplied HTML also includes Global/Law references; State and other desk visual scope remain unapproved. The National plan replaces the older spec's waiting-for-mockup assumption for National. Global implementation was authorized on2026-10-05 and is tracked in F82.

- [ ] **O1.** *Waits on the developer. 2026-11-10 (F299)* `NTER_TERMINAL_API_KEY` on Vercel, and nter.news pointed at
  production. Until then every nter.news push is refused.

- [ ] **P1.** *Waits on the owner. 2026-11-10 (F299)* Database-backed home feeds (`plans/2026-09-23-home-feeds-plan.md`).
  It needs the schema agreed and a market-data vendor. The conflict pulse
  still shows the static war list.

## 7. Accepted risks and won't-fix

- **F277 — Standing check for date-dependent tests.** Declined by the owner on 2026-10-31. The F276 audit (fake clocks, all three suites) was a one-off.

Each can be reopened by the condition named.

- **DNS rebinding in source fetching** (`specs/2026-09-28-authorization-review.md`).
  It needs a signed-in account. Closing it would mean pinning the resolved
  address in the HTTP client.
- **A disabled service-role JWT in public git history** (`25723f7`). The key
  is disabled, and removing it would mean rewriting `main`.
- **1,288 documents with unknown `integrity`.** It can't be recovered from
  the inputs.
- **Previews share the live Supabase project.** There is no Supabase
  branching. Test writes use test accounts only, and migrations stay
  additive and fixture-tested.
- **The preview wildcard in `ALLOWED_ORIGINS`.** Anyone can name a Vercel
  project so that its `*.vercel.app` host matches
  `niyantran-*-ddl-labs.vercel.app`. The functions authenticate with a
  bearer token that a foreign page can't read, so an allowed origin gains
  nothing. Reopen if any function starts accepting cookies.
- **Advisor findings that are by design** (see P12): RLS with no policy on
  server-only tables, the `SECURITY DEFINER` RPCs that are the API, unused
  indexes at today's traffic, and multiple permissive policies.
- **P4. Deferred agent features:** compaction, memories, user
  uploads and binary attachments, a durable queue for long turns. Not
  planned until the owner schedules them. (Web search moved to F130 on
  2026-10-13.)
- **P10.** Google sign-ups, and email sign-ups that wait for verification,
  skip the plan step and get no signup trial. They can start one from the
  upgrade dialog. Reopen if it matters commercially.
- **P13.** Two ADRs are numbered 0005. Left unless the ADRs are renumbered.
- **P15.** Two unused extension points, kept on purpose: `ai_models.params`
  and `StreamRequest.max_tokens`. Wire them up when a model needs either.
- **P17.** `reconcileSavedTurn` answers `false` both for "still locked" and
  for a repeat call; a test pins it and the only caller handles it. Reopen
  if a caller needs to tell them apart.
- **Live TV known limits, closed 2026-11-21** (reopen by the condition in
  each entry): F352 (a re-check can change a verdict; users are told), F365
  (no rounding rule), F379 (lookup budget per server instance) and F383
  (refund amounts on a future redenomination).
