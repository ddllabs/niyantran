# Plan: single existing-text corpus pilot

> **Status: Living.** Sequential operational plan. No delegation. Tracked under R7 in `open-work.md`; scope is the [single pilot spec](../specs/2026-10-09-corpus-single-pilot.md).

1. Confirm clean checkout, production target, current bill mapping, exact source/text hash and no existing document. Prepare a one-document manifest and full text outside Git; assert cardinality one and source/key identity.
2. Invoke the existing script with that manifest and `--dry-run`. Require exactly one dry-run result and six prospective chunks, without provider calls or writes.
3. Invoke the same manifest once without `--dry-run`; require one indexed result and six chunks. Preserve a nonsecret receipt. No other manifest/source is allowed.
4. SELECT stored document/hash/metadata/indexed status and chunk counts, embedding presence and source spans. Execute scoped `match_documents` using the sample's embedding as a plumbing check; this is not a semantic question or owner acceptance.
5. Record measured outcome here and under R7. Give the owner the bill title, test questions and limitations. Stop for owner RAG acceptance before bulk work.

Write scope: this plan, its spec and R7's pilot subsection only. Existing script/Edge Function/API/UI/schema remain unchanged. Verification: existing script dry-run, live receipt, SQL checks and clean source diff; application build/test suites are not required for documentation-only changes. Signed-in user-facing acceptance remains the owner's.

## Execution checkpoint — 2026-10-09

Local branch `task/corpus-single-pilot-20261009`; application code and main unchanged. One-document manifest and text prepared outside the checkout; source SHA and 4,797-character length validated. Existing script authenticated dry-run attempted, but network fetch failed before a result from the Edge Function. Receipt reports zero indexed documents, zero embedding tokens and zero cost. Fresh connector SQL also failed at transport. Git reference refresh and current Supabase changelog fetch could not resolve their hosts. No live ingestion request was submitted. Do not infer a successful server-side dry run or fresh production counts from these failures. Resume at the fresh SELECT and authenticated dry-run gates after connectivity returns. Owner RAG acceptance and all bulk work remain pending.

## Successful resume — 2026-10-09

Connectivity restored. Fresh SELECT baseline: 2,340 documents, 54,340 chunks; zero documents under the proposed source/bill key; two existing listing rows.

- Existing script authenticated dry-run: exactly one dry-run document, six prospective chunks, zero errors, zero tokens/cost.
- Existing script live invocation: exactly one indexed document, six inserted chunks, zero errors; 1,082 provider tokens, USD 0.00002164.
- New UUID: `38f15384-c4c9-45a3-8d3f-2259ba1411cd`; indexed `2026-10-08T20:56:02.836Z` (2026-10-09 in Asia/Kolkata).
- Stored original text SHA: `75628e697f9577e105659c2c3f374e8cb214a13b21492dc74e69557b4010d7dd`; SQL recomputation agrees; 4,797 characters.
- Six embeddings present; six unique chunk hashes; all six stored character spans exactly select their content from the original full text. All are text-only document citations, with no page geometry or storage registration.
- `match_documents` scoped to the new UUID returns six results, all belonging to this document and carrying the expected PDF URL and source spans. Self-vector top similarity 1 proves retrieval plumbing only; it is not a semantic question test.
- Post-ingestion totals: 2,341 documents and 54,346 chunks, exactly +1 and +6. No bulk ingestion occurred.

Evidence: manifest, original text, dry-run/live receipts and SQL verification are in the thread's `corpus-single-pilot` evidence directory outside Git. Documentation only remains uncommitted on `task/corpus-single-pilot-20261009`; no application code change, merge, push or deployment. `git diff --check` passes. Owner signed-in RAG/citation/Download PDF acceptance remains pending; R7 stays open.

Owner test: find Government of Union Territories (Amendment) Bill, 2025 (Lok Sabha, Bill 113); attach to chat; ask what section 45 would change and what detention period triggers the proposed removal rule; open the supporting text citation and compare with the Download PDF link. Do not claim page-based yellow highlights for this text-only pilot.

## Owner acceptance — 2026-10-09

The owner confirmed the live sample RAG test: “yes ok it worked”. The single-document pilot is accepted. This confirms the tested sample flow; it does not certify all bulk candidates or authorize their ingestion. Bulk work under R7 remains open for a separate go-ahead and a scoped plan.
