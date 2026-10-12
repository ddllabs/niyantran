# Approved corpus version ingestion

> **Reconciled 2026-10-13 (F105):** this work is in `main` and production (`d0a8020` (corpus integration, 2026-10-12); the retrieval correction reached production as `research-chat` v48 on 2026-10-13). Lines below that call it uncommitted, local only or unmerged describe its state on the date written.

> **Status: Living.** Execution completed 2026-10-10; final independent audit and accounting passed. R7 mapping work and owner natural-language sample acceptance remain open.

Owner-authorized resume uses the existing sequential_500_v1 worker: at most 500 documents per job, one document in flight, complete version-4 context chunks, with independent audits and ANALYZE/count gates. Current proven queue is 175 alternate-version documents for 116 already-covered bill keys, 12,842 chunks and 8,584,074 Unicode characters. It adds versions, not new bill coverage. Do not expand it with unverified or wrong-Download candidates.

Manifest SHA256: `82b8c55cec3aa128967d556939c698efc5c963638aa40f125e35c60018c3f623`. Artifact root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-version-live-20261010`. Job file: `job/stage-01.json`. Baseline: 2,576 documents, 2,573 indexed, 72,917 chunks, 1,464 covered listing bill keys. Conservative budget ceiling USD 1.088228; final receipt cost is separate.

Prerequisite release: research-chat v47 ACTIVE, based on the served v46 graph with only version-role transport/render/guidance edits in four runtime files. All 33 runtime files compared against the prepared release; custom authentication and verify_jwt:false preserved; live unauthenticated POST rejected with 401. ingest-documents v19 unchanged. Full original v46 rollback graph retained under `research-chat-rollback-v46` in the artifact root. No unrelated local telemetry or research-coverage changes deployed.

Repository gates: app 2,465 tests /184 files passed; Deno 880 passed; focused worker 90 passed; release-graph 3 passed; lint and build passed; build retains existing large-bundle warning. No SQL/schema change. All current local changes remain uncommitted on `task/corpus-single-pilot-20261009`; main untouched.

Verified maintenance gates:

| New documents | New chunks | Total documents | Indexed | Total chunks |
| --- | --- | --- | --- | --- |
| 20 | 121 | 2,596 | 2,593 | 73,038 |
| 40 | 340 | 2,616 | 2,613 | 73,257 |
| 60 | 659 | 2,636 | 2,633 | 73,576 |
| 80 | 1,125 | 2,656 | 2,653 | 74,042 |
| 100 | 1,857 | 2,676 | 2,673 | 74,774 |
| 120 | 2,999 | 2,696 | 2,693 | 75,916 |
| 140 | 4,804 | 2,716 | 2,713 | 77,721 |
| 155 | 6,914 | 2,731 | 2,728 | 79,831 |
| 165 | 8,923 | 2,741 | 2,738 | 81,840 |
| 172 | 11,078 | 2,748 | 2,745 | 83,995 |
| 175 (final) | 12,842 | 2,751 | 2,748 | 85,759 |

At each gate, every cumulative document/vector/span/input/section/identity/attachment was independently checked, with two real scoped citation probes per document. ANALYZE ran on document_chunks/documents/desk_rows; real and planner counts matched; zero orphan chunks and zero chunks under unindexed documents; listing rows 34,184 and covered keys 1,464 unchanged. PostgreSQL start time stayed 2026-09-28 08:19:47.722698+00. Exact fresh acknowledgement preceded each resume. Worker stopped cleanly with status complete. Final independent audit checked all 175 documents /12,842 chunks and 350 scoped citation probes; final count/planner/orphan/coverage/usage reconciliation passed. Owner natural-language sample acceptance remains pending.

Excluded: 51 alternate-version identity holds, 19 source-proven documents for 18 uncovered keys whose Download resolver is wrong, broader unverified/nonbill/oversize cohorts. No frontend/schema/compute change, metadata backfill, cleanup, Git publication or new unattended OS service.


Final accounting: 175 dry runs and 175 paid invocations; no paid retries, unknown usage or partial-write holds. 1,984,754 embedded tokens, USD 0.03969508 actual embedding cost. USD 0.21364556 reserved is a conservative byte-based ceiling, not actual spending. The job completed its ingestion phase across ten independently reviewed maintenance gates; first write to final verification took about 144 minutes, including cumulative audits, source refetches, duplicate completed-entry revalidation and capacity sampling. This is a supervised foreground process with saved checkpoints and bounded crash/transient retries, not a newly installed unattended service.

Health/capacity: 187 retrieval windows, two isolated bad windows (indices 18 and 87), no consecutive bad-window pair and no health pause. Worst sampled broad/scoped p95 738.49/755.33 ms. 44 capacity windows; maximum sampled CPU 17.07%, minimum sampled available memory 38.23%, maximum sampled disk activity 6.24%. These are samples, not continuous peak guarantees. CPU pressure did not require lower document counts in this run; reviewed source readiness remains the constraint for a full 500-document queue. Future speed improvements should preserve audit/recovery evidence and be separately verified.

Owner RAG samples: refresh and re-attach the bill from the listing to a new chat. Ask a text question, inspect citations, and check version labels against the opened source PDF. The introduced and Lok Sabha-passed versions below were newly ingested and independently probed; existing additional versions may also be attached.

| Bill | New introduced document | New Lok Sabha-passed document | Suggested question |
| --- | --- | --- | --- |
| Indian Forest (Amendment) Bill, 2017 (`bill:2017:208`) | `b01b8c90-6a79-46e9-811a-b488b8f32253` (9 chunks) | `c54311e0-d7c8-4d18-ad20-cda056b33465` (4 chunks) | Using the introduced version, explain what the bill changes and its stated reasons, with citations. |
| Constitution (Scheduled Tribes) Order (Fourth Amendment) Bill, 2022 (`bill:2022:219`) | `a3b8187e-b03f-43e2-9c90-d88e376c1c74` (10 chunks) | `cdb228dd-d785-4764-bc01-bdc0d39702fb` (4 chunks) | What changes does this bill make to Karnataka's Scheduled Tribes list? Cite the introduced and Lok Sabha-passed sources and identify each version. |

Evidence files: `job/final-verification.json`, `job/final-accounting.json`, `job/counts-175.json`, `job/stage-01.json.verification-175.json`, `job/execution.log`, `job/audit-175.log`, plus each archived maintenance acknowledgement/count/audit. The deployed research-chat v47 hash remained `a54690a52c61113b97b42a40a436ab445e989b4a0734b49ee24443a241918ed5`; ingest-documents v19 unchanged. Original two page-OCR sources and existing unindexed/no-chunk stubs were outside the manifest. No cleanup, original-corpus edit, metadata backfill or frontend release was performed.


Owner-requested recurring monitor (2026-10-10): updated existing heartbeat `check-corpus-ingestion` to ACTIVE, every 15 minutes, targeting this chat. Saved configuration was read back to confirm status, interval and target. It checks actual locks/checkpoints/progress; resumes only eligible unfinished owner-authorized manifests, performs full independent maintenance audits before acknowledgement, and avoids duplicate writers. With the175-doc manifest complete and no further ready queue approved, it investigates remaining mappings without guessing or releasing held cohorts. Notifications are limited to meaningful progress, completion, failures or owner action. No new OS service or separate goal was created. The heartbeat retains all production boundaries for deployments, schema, cleanup and holds.

Screenshot change-counter audit (read-only): the app showed82 edited files /15,682 additions, including freshly materialized served-source and release/rollback copies outside Git. At audit time the repository tracked diff was12 files /244 additions /18 deletions (includes open-work documentation), with58 untracked files:43 documentation files /1,759 lines;13 worker/preflight scripts and tests /1,077 lines;2 shared context source/test files /216 lines. These reflect accumulated local corpus work, not all changes newly authored in the latest175-doc execution. Outside the checkout, release artifact graph36 files /7,297 lines and original rollback graph33 files /7,020 lines are largely whole-source copies, not newly written application behavior. The screenshot's visible temporary index/retrieval/agent/prompt files are also whole-source copies. The precise82-file UI selection is not equivalent to Git status. No code or artifact cleanup was performed during this audit.

Monitor scope clarified by owner2026-10-10: each check also inventories already-mapped source records absent from documents or lacking complete indexing/embeddings, reconciles exact source/key/version/PDF identities against live document/chunk/vector state and completed receipts, and separates mapping-only from proven readiness. Fully verified sources are eligible only through an exact released manifest; new candidates get fresh draft preflight evidence, not automatic execution release. Partial writes, existing unindexed stubs, page-pipeline records and Download/identity holds retain recovery review. Explicit mandatory original/PDF/body/listing/attachment/chunk/hash/input/token/price/budget/dry-run/health/capacity/exclusive-writer checks precede automatic writes; independent full vector/scoped-citation/count/planner/orphan audits follow. Saved ACTIVE15-minute configuration and added scope/checklist read back and verified. No ingestion was performed by this configuration-only amendment.
