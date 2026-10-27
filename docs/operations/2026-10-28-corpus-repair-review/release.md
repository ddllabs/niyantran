# F257–F260 production release receipt

> **Status: Living.** 2026-10-28 (IST). Released after explicit owner authorization. New ingestion and larger batches remain held.

## Code and deployment

- PR [#62](https://github.com/ddllabs/niyantran/pull/62), merge `8f01b348de0ff3edf7fd457a81f474515369d15b`.
- Both required CI jobs passed on the reviewed branch and PR. Main CI run `40581999207` also passed on that merge.
- Production Vercel deployment `dpl_53zLHXm3osUN3ueTgnctFDo6wq7f`, READY, that same commit; `www.nter.pro` and `nter.pro` aliases verified.
- Supabase migrations `record_document_associations` and `feature_search_recovery` applied. `research-chat` v107 ACTIVE, bundle SHA-256 `23ab51ace89ec247b19776181f760d303d9981ef51b1d5839faca948a1405d00`.
- JWT deployment setting preserved; handler authentication remains enabled. No ingestion worker or queue was resumed by this release.

## Integrated verification

Independent SQL/repair and UI/server reviews found no remaining blockers on integrated `f2541a73`. Existing persona work was preserved.

- `npm test`: 6,649 tests / 436 files passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 1,440 passed.
- `npm run lint`, `npm run build`, and `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`: passed.
- Supplied-text, Law reconciliation and mapping-planner client suites: 26 passed. The first restricted loopback mock run hit EPERM; the permitted rerun passed.
- Integrated local SQL: all 61 fixture assertions and migration-removal controls passed, but the existing `billing_live_cycle` concurrency probe initially failed to observe contention. Its unchanged isolated rerun passed. Both full required CI jobs subsequently passed; the initial local run is not represented as entirely green.
- Earlier Docker/ENOSPC recovery history is retained in [verification.md](verification.md).

## Existing mappings repaired, content unchanged

The cutoff inventory contained 5,947 registered Parliamentary documents: 4,749 ready and 1,198 held (1,116 incomplete indexing; 82 unsupported/unverified identity). The approved manifest contains 5,638 associations, because one answer can map to more than one member's listing.

- Manifest SHA-256: `102b734567d764aa354c838a7e1e3df292f444bfedcd3ea4d84d96f94c9beac7`.
- Decision: `owner-authorized-20261028-f257-mapping-repair`; approver: Vighnesh Shukla.
- Immediately before applying, all 5,638 current fingerprints and expected alias sets were rechecked: zero stale candidates or conflicts.
- The transaction locked source documents/chunks against writes and listing/association tables against concurrent mutation, then applied only this manifest. It asserted whole-row content hashes and expected link count before committing.
- Exact replay of all 5,638 entries with the same decision/evidence succeeded with no duplicate links.
- Authenticated resolver checks returned Full text for all 5,638 associations and 4,749 distinct documents.

| Invariant | Before, after apply, after exact replay |
|---|---|
| Documents in approved set | 4,749 |
| Chunks | 49,090 |
| Non-null vectors | 49,090 |
| Full document-row aggregate hash | `d5458cf917eff56d8f9a99c7acb71d41` |
| Full chunk-row aggregate hash | `43590eb7649b737e38da93ec0db5f471` |

The full-row comparison includes OCR, metadata and vectors, not only counts. No OCR, embeddings or chunks were regenerated. `ANALYZE public.record_document_links` was run. No held candidate was admitted. Local manifests and raw preflight output remain ignored under `ingest/f257-review-20261028`; they are not a portable client inventory or permission to apply a new repair.

## Authenticated NTER acceptance

All five reported Parliamentary records were opened from the listing and attached through their record action: FFO, FMBAP, ROB Jalandhar, Smart Grid (Ramesh Awasthi alias), and Electric Vehicle Station. Each displayed Full text, Attached only, and automatic web off for indexed documents. Hosted resolution independently verified all five Smart Grid aliases against the same existing answer UUID.

Two fresh generic questions asked for the document's government answer and attached-source citations:

| Record | Message ID | Total / search | Result |
|---|---|---|---|
| FFO | `b1deba52-c0f0-402d-bbd3-8ef51c455cb3` | 12,831 / 1,409 ms | Complete, substantive cited answer, 5 passages |
| FMBAP | `a08f86cd-df98-4863-a235-ea9a0142e61c` | 16,992 / 1,495 ms | Complete, substantive cited answer, 4 passages |

A direct join of recorded chunk IDs back to `document_chunks` independently confirmed exactly one intended document for each of the FFO, FMBAP and Globiz runs. Both Parliamentary answer traces recorded `focus=attached`, exactly the intended document UUID, the verified Parliamentary row tuple, `retrieval_mode=document-exact`, and `content_valid=true`. Neither trace had a web or unscoped document-search step. FMBAP source 3 opened the matching official PDF URL and highlighted the minister's answer; the displayed figures and relief exclusion matched that passage and annexure.

These are bounded acceptance observations, not a latency SLA or an exhaustive answer-quality audit. The generated FMBAP answer also rendered a Markdown table as text inside HTML and called its synthesis verbatim; these presentation/wording limitations do not invalidate the verified source identity, but are not claimed fixed by F257–F260.

Law acceptance also passed on Globiz: Full text and automatic web off; fresh answer `bd5aea45-2566-4f7b-9325-044dbe71eea3` completed in 32,893 ms (2,475 ms search). It separated applicant/respondent submissions from tribunal findings and disposition, with nine citations from one document. The trace bound both searches to document `1597c9df-162a-4d74-860d-1cbf8f5a3bb2`, attached focus, document-exact retrieval and valid content.

Authenticated hosted negative controls returned unmapped with no document ID for existing State Booth Political History and Economics NSE/BSE rows. No Growth rows existed in this hosted sample, so Growth coverage remains supported by local mock/SQL tests rather than claimed hosted evidence.

Economics live negative/control test: selected India GDP growth 2025 in Economic Simulator, Selection + pins. The UI enabled automatic web and did not show Full text. Turn `390a2a60-8451-4799-9ba5-96f2175adf27` completed in 59,299 ms, with 15 web pages from three searches, no document-search step, no resolved document IDs and valid nonempty content. The answer visibly separated supplied 7.57% context from external excerpts and warned that period comparability was unverified. This used the existing conservative excerpt fallback; it does not establish improved Economics prose or latency. The chip showed Coverage unavailable because this feed selection lacked a stored resolvable row; no unrelated PDF was substituted.

## Remaining boundaries

- F261 tracks outdated Parliamentary answer-availability copy/cached briefs and member-name attachment suggestions. The old record view may still say the answer is unavailable while the verified chat chip correctly shows Full text. Do not re-ingest to fix this display mismatch.
- The original 1,198 held documents still need current reconciliation, not automatic admission. Bill inventory also had 229 documents needing separate identity review; other collections need tested adapters.
- Feature underfill recovery is bounded at 100,000 eligible chunks; it is not a solution for unlimited corpus scale, and filled approximate results are not guaranteed exhaustive exact recall.
- New corpus batches, queue resumes and autopilot remain held. Recommended progression after reviewed script changes is 100 documents, then 1,000 only after explicit authorization and acceptance.
