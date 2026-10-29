# National corpus: the rest of v1.1, then v1.2. A plan.

> **Status: Living (2026-10-30).** A proposal under the owner's rules for every ingestion run
> (`docs/operations/2026-10-28-corpus-client-handoff.md`). **It authorizes nothing.** Each step is one cohort, in this
> order:
> 1. developer review of the scripts and dry run;
> 2. reviewed pull request to `main`;
> 3. the owner's written approval of the exact manifest hash;
> 4. one run;
> 5. receipt and website acceptance;
> 6. stop.
>
> Numbers are live and read-only (2026-10-30 ~02:00 IST) unless marked as from the 2026-10-27 feasibility check (`claude/national-delta-v1.2-v1.5-feasibility-2026-10-27.md` in the project).

## Where National stands

| Collection (pack v1.1) | In pack | In production | Listing rows | Left | Can it be ingested now? |
|---|---:|---:|---:|---:|---|
| Lok Sabha question answers | 6,840 | 6,047 (all indexed, linked) | 8,000 | 793 | **Yes.** 523 prepared (`national-pq-batch/remainder-cohort/`); 270 held by the screen |
| Bills | 9,709 | 2,896 (2,893 indexed) | 9,817 | 6,813 | No: needs a reviewed adapter. R7 (315 staged) is held |
| Bill corrigenda | 365 | 0 | — | 365 | No: needs a mapping to their bills |
| Regulatory (RBI, SEBI, TRAI, CCI) | 3,319 | 474 | 0 | 2,845 | No: no listing rows; 2,726 need a mapping |
| MP profiles | 3,157 | 0 | — | 3,157 | No: personal data; needs a policy decision and an adapter |
| Cabinet decisions | 868 | 0 | — | 868 | No: needs an adapter |
| Budget documents | 486 | 1 | 0 | 485 | No: needs an adapter |
| Transfer orders | 29 | 0 | — | 29 | No: needs an adapter |
| Industry documents | 28 | 6 | 0 | 22 | No: needs an adapter |

Rule 9 applies: only Lok Sabha answers have a reviewed adapter (F266). Every other collection waits for the developers to ship
an adapter and a policy boundary. The client can screen and dry-run, but never submit, before that.

## Part A: finish v1.1

### A1. Lok Sabha remainder (523), prepared

- **Manifest:** `8b1ac8f3…0b27`.
- **Size and cost:** 5,234 chunks; ceiling US$0.305, about US$0.023 expected.
- **Links:** 632 listing links, all corroborated live.
- **One token covers the run:** about 35 minutes, and the script refuses a token with under 50 minutes left.
- **Details:** `national-pq-batch/remainder-cohort/README.md`.
- **Waits for:** the developers accepting validation cohort 1, then reviewing and merging this folder.

After it, the section holds 6,570 answers, about 66,700 chunks (under the 100,000-chunk search bound, F272).

### A2. Lok Sabha `last_page_empty` (121)

- **Why held:** only the blank last page fails the screen; the text is complete.
- **Proposal:** a reviewed client screen change that accepts a trailing empty page, with a causal test shown to fail without it.
- **Then:** its own manifest and approval. About 1,000 chunks.

The other 149 holds stay held: number or date not in the text, no answer section, unsplit or approximate page splits,
over limits, near-duplicates. Nothing is re-OCRed or forced without a developer decision.

**Lok Sabha is then done:** 6,691 of 6,840 answers (98%).

### A3. Bills (6,813 left), after the developers ship a Bills adapter

1. **Developers:** a Bills adapter with admission links, as F266 did for questions. It covers the `Bill Passage Probability Index` listing (9,817 rows), its key and corroboration fields, and what to do with the R7 315.
2. **Client:** screen the pack read-only, then a validation cohort of 100 bills; then the remainder in one cohort if it fits one token (about 600 documents per run at today's speed).

### A4. Bill corrigenda, regulatory, cabinet, budget, transfer orders, industry

The same path, one collection at a time, each after its adapter: validation cohort of 100, then remainder cohorts.
Regulatory has no listing rows, so it needs a listing decision first.

### A5. MP profiles (3,157)

These are personal data. The owner and developers decide first whether and how they are served. No client work until then.

### Before any v1.1 collection beyond questions

763 indexed National documents hold a reviewed text revision that differs from the pack text (2026-10-27 check). The deltas
join on `source_key` and `content_sha256`, so the developers decide, per collection, whether the stored revision or the pack text wins.

## Part B: start v1.2

**What v1.2 is.** `NTER_citation_pack_v1.2_DELTA_2026-10-06.zip` (172 MB, on Drive) holds:
- about 11,000 new documents (inferred);
- a text replacement for 1,819 re-scanned documents, which deletes their old pages and chunks.

It assumes v1.1 is fully loaded first.

**Blockers from the 2026-10-27 check** (all for the developers):
1. **Load order:** v1.1 has to be complete, or the delta has to be split by collection.
2. **No chunking step:** the pack's SQL loaders skip chunking. Proposal: load v1.2 through the same supplied-text importer and adapters, not the SQL loaders.
3. **`servable=false`** is not enforced by any read policy. It matters from v1.4, but it should be decided now.
4. **The 1,819 replacements are destructive.** Each needs an overlap check against live documents and a developer-approved replacement path. That is a production change, not a client step.
5. **No staging branch:** the packs' own instructions require one.

**Proposed first steps:**
1. **B0, read-only dry run in Colab** (no token, no network to production). Covers v1.2's hash and member manifest, counts by collection, overlap with the open-answer and stored key lists (exported read-only), and exact offline chunk estimates per collection. It is a report for the developers.
2. **B1:** the developers decide per collection which v1.2 records can use an existing adapter (Lok Sabha answers can), and how the 1,819 replacements are handled.
3. **B2:** cohorts as in Part A: validation 100, then remainder cohorts sized to one token, each with its own approval.

## Fewer tokens without breaking rule 7

Today a run needs the runner's own session token, typed once. A token lasts about an hour, which covers about 800 Lok Sabha answers per run.

**What the client already does:**
- sizes each cohort to finish inside one token;
- checks the token's remaining lifetime before submitting.

**What would remove the limit (a developer decision, not a client workaround):** a server-issued ingestion grant bound to
one approved manifest hash. It would be short-lived and single-use, and revoked when the run ends. No stored password or
long-lived key is involved.

## Order and gates

1. Developers accept cohort 1 (website acceptance pending: the chat provider failed).
2. Review and merge A1, then owner approval, then the run.
3. A2: proposal, review, approval, run.
4. Bills adapter (developers), then A3.
5. B0 report, then the developers' v1.2 decisions.
6. Other collections as their adapters land.

Everything else stays held.
