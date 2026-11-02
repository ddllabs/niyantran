# National v1.1 completion plan

> **Status: Living (2026-11-03).** Plan only: nothing here starts a load. Shared copy: the owner's doc "National v1.1
> completion plan" on claude.ai. Owner decisions of 2 November 2026 are recorded below. The National segment finishes
> first; all legal work is on hold.

Finish the National v1.1 citation pack: 14,742 of its 24,801 documents (about 630,000 chunks) are not live yet. This plan
loads them through the developers' bulk pipeline (F278) without lowering any check that today's cohorts pass.

## Where v1.1 stands

10,059 of 24,801 documents are live (40.6%); 10,056 of them are indexed. Only Lok Sabha answers are close to done; every
other collection waits for its adapter and the new search foundation.

| Collection | In pack | Live | Remaining | Remaining chunks (est.) | Licence class in pack | What blocks it |
| --- | --- | --- | --- | --- | --- | --- |
| Bills | 9,709 | 2,895 | 6,814 | 355,903 | gazette_s52_1_q_i_unconfirmed | Bills adapter with admission links (F275); 3 live bills not indexed |
| Regulatory | 3,319 | 474 | 2,845 | 216,872 | govt_material_confirm_counsel | No listing rows: listing decision (F275) |
| MP profiles | 3,157 | 0 | 3,157 | 7,406 | gazette_s52_1_q_i_unconfirmed | Admitted by owner (2 Nov); MP-profile adapter |
| Cabinet decisions | 868 | 0 | 868 | 2,964 | pib_reproducible_with_conditions | No adapter |
| Budget documents | 486 | 1 | 485 | about 38,000 | govt_work_permission_required | No adapter |
| Bill corrigenda | 365 | 0 | 365 | 2,017 | gazette_s52_1_q_i_unconfirmed | Part of the Bills adapter |
| Lok Sabha answers | 6,840 | 6,683 | 157 | 3,469 | gazette_s52_1_q_i_unconfirmed | Held by the existing screens |
| Transfer orders | 29 | 0 | 29 | 116 | govt_material_confirm_counsel | No adapter |
| Industry documents | 28 | 6 | 22 | about 3,000 | govt_public_record_cite_only | No adapter |
| **Total** | **24,801** | **10,059** | **14,742** | **about 630,000** | | |

Measured 2026-11-01. Live counts are live National `source_key`s matched against the inventory key lists (read-only).
Chunk estimates come from the repository chunker at `ea34b555`, and the embedding cost is about US$2.50 at today's rate.
Re-OCR of thin scans adds about US$4 per 1,000 pages; the developers expect tens of dollars for v1.1. No v1.1 record is
`servable=false`.

## Gates before any bulk batch

No v1.1 batch runs until all four gates are met. Bills alone would take its feature from about 89,000 chunks to about
445,000. Regulatory would go from about 10,000 to about 228,000. Both are far past the 100,000-chunk bound at which feature
search fails today (F272).

1. **Retrieval foundation live** (F278 §4). Bills and Regulatory each get their own partition, with chunk facets and the
   access check last. Hybrid search ships only if the eval gate passes. The baseline to beat is feature-mode hit@10: Bills
   91.7%, Regulatory 90.0%, Lok Sabha answers 91.7%. No feature may drop, and p95 latency may not get worse.
2. **Owner decisions recorded** (done 2 November 2026; section "Owner decisions" below): approval model, collections in
   and out, licence classes, budget ceiling and data access.
3. **Pipeline ready** (F278 §5): a server-side runner with a scoped ingestion credential and no personal session token.
   It needs set-based registration, a batch ledger, automatic stop rules and automated per-batch acceptance, each with
   offline tests and a dry run against a disposable database.
4. **Adapter reviewed per collection.** Each adapter ships with causal tests and its own admission rules. The F266 checks
   for Lok Sabha answers are the model: refuse with a named reason, write nothing, all in one transaction.

## Order of work

Five work packages, run one collection at a time in this order. Each collection starts with a 100-document validation
batch that must pass acceptance before the rest of that collection loads.

| # | Work package | Documents | Chunks (est.) | Adapter work | Batches |
| --- | --- | --- | --- | --- | --- |
| 1 | Lok Sabha answer holds | 157 | 3,469 | None new: F266 path; resolve each hold reason | One batch of those cleared |
| 2 | Bills, corrigenda, 3 unindexed bills | 7,182 | 357,920 | Bills adapter with admission links (F275); v1.2 bill patches applied first | 100, then 1,000-document batches |
| 3 | Regulatory | 2,845 | 216,872 | Regulatory adapter; listing decision | 100, then 1,000s |
| 4 | Cabinet, budget, transfer orders, industry | 1,404 | about 44,000 | One small adapter per collection | 100 (or all, if fewer), then the rest |
| 5 | MP profiles | 3,157 | 7,406 | MP-profile adapter; reconcile with v1.2's current set | 100, then the rest |

- **Why this order:** smallest risk and already-admitted path first. Bills next, because it is the largest gap and has an
  adapter in progress. MP profiles last, because they need their own adapter and v1.2's 565 current profiles reconciled
  first.
- **Ramp check:** after 10,000 documents (during package 2), the F278 §7 gate applies. Batch receipts must be complete,
  the automated sample 100%, verify equal to plan, and the eval rerun with no feature's recall@10 lower.
- **Never chained:** a collection that stops for a failed sample or a policy question does not block the next package,
  but nothing in the stopped collection resumes until the developers fix it and say so in its receipt.

**After v1.1, still National:**

- the 122,776 "MP Profiles & Performance" records as their own collection;
- then the v1.2–v1.5 updates (their affidavits stay out, and v1.2's 1,819 text replacements stay a separately reviewed
  step);
- then v1.6 (delivered 2 November: 204,975 documents, 175,669 `servable=false`, 7,068 replacing v1.4/v1.5 documents,
  3,198 affidavits out); then v1.7, whose OCR started 3 November. v1.5 is not the last National pack. v1.6 and v1.7
  are not in the November inventory and need the same read-only inventory first.

Legal starts only when the owner lifts the hold.

## Quality standards for every batch

Every check today's cohorts pass carries over. The pipeline automates the check, and each batch receipt records its
result. The left column is the current rule on `main` ("Rules for every ingestion run" and the F266 admission rules).

| Standard today | In the bulk pipeline | Evidence in the batch receipt |
| --- | --- | --- |
| Owner approves each exact manifest (rule 1) | Owner approves the collection policy once. Each batch manifest is generated and hashed, then checked automatically against that policy | Manifest hash, policy version |
| Admission refuses with a named reason and writes nothing (F266) | Same, per adapter. Metadata mismatch, a URL with no listing row, or a source another document holds is refused | Refused count by reason |
| Full URL identity, text hash, no title-only matching, no invented keys | Same. Keyed by `source_key` and payload hash | Text hashes valid = documents |
| Idempotent registration, per-source lock | Same. Duplicates against live are computed from the key lists before every batch | New, existing and duplicate counts |
| `--max-chunks` and `--max-estimated-cost-usd` from the dry run (rule 3) | Batch ceilings from its dry run, plus the owner's ceiling per collection | Estimate against actual tokens and US$ |
| Oversized documents held (256-chunk rule for answers; bills over 700 chunks) | Each collection's policy sets a maximum chunk count. Larger documents are held for a separate bounded load | Held count by reason |
| No autopilot: stop and report (rule 2) | The pipeline stops itself on any of these: an uncertain outcome after one retry; a refusal class above the policy threshold; a cost or chunk overrun; a failed sample; an error-rate breach. Developers resume only after the fix | Stop reason, resume note |
| `verify.sql` read-only, equal to its header | The same query, run automatically per batch and committed. Any value off plan fails the batch. Values: documents, indexed, text hashes, chunks = vectors, all 1536-d, links, links = listing rows, URL and text equal, one successful job each, spend, fingerprint | Query output and fingerprint |
| Website acceptance: five signed-in records per cohort (rule 5) | Automated per batch on a random sample: text hash equals pack, chunks and vectors complete, links resolve `full` for a signed-in reader, and a passage probe returns the document first. Plus a developer spot check of five records per collection: Full text, one attached-record question each, the right file cited, every checked figure in the stored text | Sample results; spot-check table |
| Retrieval quality (F278 §4.4) | Eval rerun after each collection and at the 10,000 ramp gate. No feature's recall@10 lower, and p95 measured | Eval report link |
| Receipt per cohort, committed (rule 4) | Automatic per batch. A summary per collection goes to the owner | Receipt path |
| No direct SQL; shared code and migrations only via reviewed PRs (rule 6); `ANALYZE` after loads by the developer | Unchanged | PR links |
| Listing rows never changed by the loader (rule 8) | Unchanged. A missing or wrong row is reported, not fixed in the load | Rows-by-URL count |
| No stored passwords or personal tokens (rule 7) | A scoped server-side credential. Payments, billing and accounts keep their hard stop | Credential name, never its value |
| No OCR or embedding regeneration to fix associations | Unchanged. The v1.2 destructive text replacements (1,819) stay a separate reviewed step | Not applicable |
| Receipts name no personal email address; no text or personal data committed | Unchanged | Not applicable |

## Text and identity checks added after the 2026-11-02 repair

This week the developers repaired 97 live documents. The pack's text cannot be taken as complete, so every collection's
adapter adds two checks before admission.

1. **Text per page.** Compare each document's text page by page against its official PDF: page count, characters per
   page and empty or near-empty pages. A thin or missing page is re-OCR'd from the official source (sansad.in, CCI, TRAI,
   the ministry site), never from the pack. Where the official PDF cannot be fetched, the document is held with a named
   reason. OCR costs about US$4 per 1,000 pages and counts against the collection's ceiling. The batch receipt records
   pages checked, pages re-OCR'd and OCR spend.
2. **Bill identity.** For every sansad bill, the title and bill number in the text must match the listing row and the
   source URL before any link is written. A mismatch is refused with a named reason and listed for review, never linked
   by title alone. This also covers the F281 cases where a bill's title does not match its content.

## Collection notes

Each adapter's dry run has to account for these items before its validation batch. Counts are for the remaining
documents only.

| Collection | Size outliers | Duplicate texts | Later versions to reconcile first | Data-quality items |
| --- | --- | --- | --- | --- |
| Bills | 227 over 256 chunks; 52 over 700 (largest 3,362) | 14 | v1.2 `bills_links_fixed` (100) and `bills_recovered` (55). Load the patched version, never load then replace | Mis-linked sansad bills: run the title and bill-number checks. F281: titles not matching content, text shifted by three characters, 1,744 indexed bills with no citation. Pack has 1,743 OCR bills with no page split. Preserve R7's frozen manifest and 315 staged sources |
| Bill corrigenda | none | none | none | No page split (all 365) |
| Regulatory | 189 over 256; 33 over 700 (largest 3,940) | 75 | v1.3 `regulators_archive` and v1.4 `regulators_rbi_textfix` share 7,725 keys; v1.3 `refresh_sebi` | No listing rows; regulator to be derived from host. In 45 of 202 live multi-page documents the pack's OCR held only the last pages (re-OCR'd from CCI and TRAI this week), so check every page. 506 OCR documents with no page split |
| Lok Sabha answers | 3 over 256; 1 over 700 (1,033) | none | v1.2 replacements for the 82 held September imports | Re-screen read-only and record each hold's reason; release only holds whose reason is fixed |
| MP profiles | none | 194 | v1.2 `mp_profiles_current` (565) | Admitted by the owner (2 Nov). The 122,776 "MP Profiles & Performance" records in the 18 September handover are also admitted; they load as their own collection after v1.1 |
| Cabinet decisions | none | none | none | HTML text, no page split; PIB attribution conditions |
| Budget documents | not measured per document | not measured | none | Licence tag says permission required; the owner cleared it (2 Nov) |
| Transfer orders | none | none | none | Names officers; the owner ruled they load as public records (2 Nov) |
| Industry documents | none | none | none | Cite-only licence |

## Owner decisions

Tamanesh decided these on 2 November 2026; they replace the suggestions in the first version of this plan.

- [x] **Approval model:** one policy per collection (F278 §5.1) replaces per-run approval for bulk work. Payments,
  billing and accounts keep their hard stop.
- [x] **Order:** the National segment finishes first. All legal work is on hold, including acts, regulations, Supreme
  Court, high courts, tribunals and anything under `NTER_LAW_Corpus`.
- [x] **Collections in (v1.1):** Bills, corrigenda, Lok Sabha holds, regulatory, cabinet, budget, transfer orders,
  industry and MP profiles. The 122,776 "MP Profiles & Performance" records from the 18 September handover are also in,
  as their own collection after v1.1.
- [x] **Collections out:** the tender archive, and all affidavits, including about 10,500 candidate-affidavit OCR files
  in the 18 September handover.
- [x] **Licence classes:** all in, loaded as public government records with attribution. This covers regulatory and
  transfer orders (counsel), budget (permission), cabinet (PIB conditions) and industry (cite-only). The owner made this
  call over the developers' suggestion to hold the counsel and permission classes.
- [x] **Transfer orders:** officer names load as public records.
- [x] **Budget ceiling:** US$100 for v1.1, embedding plus OCR. Each later National pack's ceiling is set when its
  summary arrives (owner, 3 Nov). A ceiling for the legal pack is set when legal resumes.
- [x] **Data access:** a read-only service account on Data Handover. Start setting it up now, since it takes the longest.
- [ ] **The 18 million and `NTER_LAW_Corpus`:** not decided; legal is on hold, so these wait.

## Done when

v1.1 is complete when every one of the 24,801 pack documents is in exactly one of three states, and the owner has the
collection summaries.

1. **Live and accepted:**
   - indexed, every chunk vectored at 1536 dimensions, text hash equal to the pack;
   - linked to its listing rows where the collection has them;
   - covered by a passing batch receipt and its collection's spot check.
2. **Held with a named reason:** the reason, owner and next step are recorded in the collection summary. Examples:
   oversized, failed admission, superseded by a v1.2 patch.
3. **Excluded by owner policy:** none in v1.1 under the 2 November decisions. If a policy changes, each excluded document
   is listed by key on Drive and counted in the summary.

Also required:

- The eval rerun shows no feature's recall@10 below its baseline.
- `verify.sql` totals equal the plan, and every admitted document passed the per-page text check or was re-OCR'd from its
  official source.
- The pipeline spent no more than the owner's ceiling.
- No v1.1 document is held without a reason.

## Sources

- [Bulk corpus ingestion spec, F278 (main)](../specs/2026-11-01-bulk-ingestion.md): §4 retrieval foundation, §5 approval
  model and pipeline, §7 ramp gates.
- [Rules for every ingestion run (main)](2026-10-28-corpus-client-handoff.md), with the F266 admission rules it links.
- [Open work (main)](../plans/open-work.md): F272, F275, F278, F279 and F281.
- [Corpus inventory report and summary.json](corpus-inventory-2026-11/report.md) (commit `1578bf7`). Per-collection key
  lists are on Drive in `Data Handover/_inventory-2026-11/keys/`.
- Live counts: a read-only query of National documents' `source_key` and `indexed_at` on 2026-11-01, matched against the
  v1.1 key lists.
