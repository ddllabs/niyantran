# Law answer validation release

> **Status: Historical (2026-10-24).** Extractive containment release; F247 synthesis remains open. No ingestion authorization.

This supersedes the earlier partial answer-release receipt for the corrected behavior, while preserving that historical failure record. F248 case-number display was already verified. This release addresses F247 attribution/citations and F249 exact placeholder responses.

Law drafts are buffered while bounded selection and audit operate on caller-authorized original text. Listing rows cannot support legal findings. The model selects server-owned excerpt IDs; unknown IDs, cross-source rebinding, malformed output and incomplete streams fail closed. Final output is deliberately extractive: deduplicated original passages with source citations and qualified positional context. Generated statements are not displayed because the semantic audit did not reliably verify their support. This contains model-generated attribution errors but does not establish complete or relevant legal interpretation. F247 synthesis remains open. Longer excerpts and extra model passes increase length, latency and query cost; shared usage/deadline limits remain in force.

Exact `llm_result` placeholders are rejected in draft promotion and envelope parsing. Streaming prefixes are held so a bounded correction can run before the placeholder becomes visible. Repeated malformed output returns an error. This is a targeted guard, not a general detector of every nonsensical answer.

## Evidence and failures retained

PR23 (`c07c644cfae6205b2640477a1943a832628e4239`, research-chat v78) added review and placeholder handling. Its original Globiz answer passed independent source comparison; the date test correctly distinguished the 1 September notice from 6 September commencement and opened paragraph 7.29 in original text. A costs follow-up failed closed without a diagnostic reason.

PR24 (`c7e7a12d8fb4a3cdaf557b00a7360ee8240e0f30`, v79) corrected an unjustified 32-character quotation minimum and added text-free reason codes. It does not establish that the minimum caused the earlier live failure. A fresh v79 original answer failed closed with `quote_not_found`; this diagnosed the model-transcription problem addressed by PR25's server excerpt selection.

Controlled NTER placeholder challenges never published a bare `llm_result` completed answer. The attached-record challenge failed source verification. The isolated challenge returned awkward explanatory prose; this is not legal-answer acceptance or proof the exact malformed-provider branch occurred. Deterministic handler tests reproduce the exact placeholder, prove bounded correction before display, and prove repeated placeholders cannot complete.

PR25 (`aa16d5fae4db266c103efdbe6e5f61f90c14aedc`, v80) introduced source-bound excerpt selection. The costs follow-up passed in 21 seconds with three original-document citations; clicking the operative citation highlighted paragraph 7.34. The original question instead exhausted the reviewer's 6,000-token output limit after 145 seconds and failed closed. PR26 makes reviewer reasoning explicit: low/minimal where supported, otherwise catalog off maps to provider none. DeepSeek Flash supports high/xhigh/none and defaults to high; the draft retains user-selected High reasoning. No limits are increased.

PR26 (`b191ab19cd263b27a77401f90216b9ea1f14d26d`, v81) completed the original question in 22 seconds, passing source review. Its follow-up improved attribution but failed exact claim-to-citation support: a combined debt/costs claim cited only debt, and a negative merits assertion cited disposition. PR27 adds an atomic four-claim contract and a separate retain-only support audit of each claim against its own excerpt. Dropped claims produce an evidence-limit notice; empty or invalid audits fail closed. Both calls share existing attempt/time/usage limits.

PR27 (`fcf4f2f4fe9e2351c0f47f901dbc4f05679c69f7`, v82) still failed live acceptance: the original answer attached 2018 dates to a disposition quotation that contained neither date. The same-model audit retained that claim. PR28 adds a deterministic own-quotation numeric-date guard and gives the small audit the serving model's supported draft reasoning, with a 4,000-token audit output cap. The selection pass remains bounded at 6,000 tokens with explicit low/none reasoning. Shared request deadlines and attempt limits are unchanged. Numeric-date presence does not establish event attribution, calendar validity, or dates written in words; semantic review is still necessary.

PR28 (`fd676f62453854afadd16222087cefe06f5cb91c`, v83) completed the original in 18 seconds and follow-up in 22 seconds. The original still attached a negative debt-merits assertion to disposition rather than the confined-inquiry passage. Independent review rejected synthesis acceptance. The follow-up separated debt and costs submissions, but that does not repair the original failure.

PR29 (`fb38d839e885e2531c387da288074879e6dda5e5`, research-chat v84) changes the bounded Law response path to extractive containment: deduplicated original excerpts, neutral qualified positional context, and source-bound citations. Generated statements are not rendered, even if the auditor incorrectly approves them. Existing internal selection/audit gates remain. This is containment, not a successful legal synthesis implementation. Selection relevance, completeness, response length and provider/time-budget failure remain limitations. F247 stays open for repeatable synthesis evaluation.

## Validation boundaries

Source paragraph 7.29 establishes 6 September 2018 commencement after the 1 September notice. Section 3 contains debtor submissions; 7.33 records limitation; 7.34 rejects/disposes and makes no order as to cost. Structured page_number is absent, so an original-text highlight is not an exact-page PDF deep link.

Local verification: 6,575 application tests, 1,255 Edge tests, lint, build and diff checks passed. Causal tests failed prior implementations for placeholder handling, review integration, fabricated quotes, tail priority, short quotations and excerpt selection. Independent code review found no remaining blocker. Sampled website acceptance cannot certify every document, question or model.

No re-ingestion, OCR, rechunking or corpus embedding was performed. `corpus-evidence.json` and read-only `verify.sql` record preservation of the ten Law documents, 527 chunks, ten jobs and 436 insolvency listings. Website tests incur ordinary query embeddings/model usage, which is distinct from corpus embeddings.

## Client continuation

The [canonical agent handoff](../law-next-batch-agent-message.md) remains preparation-only: up to 100 eligible new documents, excluding the ten completed documents, using existing scripts and automatic listing publication. No 100-document submission or 1,000-document run is authorized by this release. A future bounded run still needs exact cohort/resource authorization and its own listing, retrieval, citation, checkpoint and duplicate-prevention acceptance.

## Final deployment checks

The v84 deployment returned 40 runtime files, all byte-identical to the reviewed payload. The payload includes `functions/deno.json`, which the deployment-read tool omits. An unauthenticated POST returned 401. No auth configuration was changed.

V84 original-question acceptance returned one original disposition excerpt in 38 seconds. Clicking its citation highlighted original paragraphs 7.33–7.35, including rejection and no order as to cost. It did not render the unsupported debt-merits paraphrase. This is an extractive containment check, not full synthesis acceptance.

The same-conversation submissions/costs follow-up failed closed after 13 seconds, showing an explicit verification error and no usable answer. The bounded log window recorded `research.law_review_rejected` / `invalid_shape`; the raw model reply was not retained, so no more specific cause is claimed. This is a failed availability/answer acceptance check, not a successful follow-up.

The date question returned the original paragraph 7.29 excerpt in 18 seconds, preserving 1 September 2018 notice and 6 September 2018 commencement. Its citation highlighted that original passage. Independent review accepted these bounded extractive/original-highlight checks and rejected full F247 closure. No exact-page PDF deep-link acceptance is claimed.

Final database fingerprint comparison after v84 website tests is identical to baseline. Counts remain 3,469 documents and 101,243 chunks globally; Law has ten documents, 527 chunks, ten jobs and 436 insolvency listings.

Release gates: all required PR29 checks passed on `f89f41d53b46915309b8412343ddb28fad4bef5c`. Main CI run `40039058638` passed on merge `fb38d839e885e2531c387da288074879e6dda5e5`. Vercel production deployment `dpl_DZXUifETDcagPf4pJjhQm4hxYwag` is READY with that exact commit and `aliasAssigned: true` for both `www.nter.pro` and `nter.pro`. Research-chat v84 is the separately verified Edge deployment.
