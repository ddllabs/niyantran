# Scoped retrieval — why attaching a bill does not scope the RAG, and what to change

> **Status: Historical (2026-09-22).** Implemented by 406dd58 and migration
> 20260922104646; D5 (ingest current bills) not done, carried by
> docs/plans/2026-09-22-corpus-expansion.md. (Updated 2026-09-24; originally
> "Status: proposed. 2026-09-22. No code changed while writing this.")

## The complaint

Dragging a bill into the research panel and asking about it returns citations
drawn from the desk row's tabular metadata, not from the bill's OCR text. Some
turns retrieve nothing relevant; one turn ("Bankers' Books Evidence Bill, 2026")
retrieved passages from fifteen unrelated documents while Focus was set to
"Attached only".

## What is actually implemented

The TenderBase pattern — scope retrieval to the one record the user is looking
at — **is** built:

    attachment.document_key
      -> documentKeysOf()                         validate.ts:183
      -> resolveDocumentIds()                     index.ts:313
         (documents.metadata->>'document_key')
      -> scopedDocumentIds                        handler.ts:600
      -> scope                                    agent.ts:289
      -> match_documents(p_document_ids => scope) retrieval.ts:83

The chunk/parent binding is also correct and needs no change. Every row of
`document_chunks` carries `document_id uuid NOT NULL`, indexed by
`document_chunks_document_order (document_id, chunk_index)`. This is the exact
equivalent of a `tender_id` on the chunk, normalised as a foreign key instead of
denormalised onto the row. **No graph database is required**; the relationship
already exists and is indexed. `document_chunks.metadata` is `{}` on all rows and
is a forward-compatibility slot that nothing reads (corpus-reconciliation spec,
"Empty columns resolved as by-design").

## D1 — Scoped retrieval is structurally broken (root cause)

`match_documents` filters with

    and (p_document_ids is null or c.document_id = any (p_document_ids))

This is the same disjunction defect fixed in `search_desk_rows` earlier today
(migration 20260922073933). Two branches do not mention the column, so the
planner must produce one plan that also works when the parameter is null. It
therefore cannot pre-filter on `document_id`, and falls back to scanning the
HNSW index and discarding non-matching rows afterwards — **post-filtering**.

`hnsw.ef_search` is 40, the same as `match_count`. HNSW collects ~40 candidates
from the whole 54,219-chunk graph, then the `document_id` filter deletes almost
all of them. The average document is 23 chunks, i.e. 0.04% of the corpus.

Measured on the live database:

| scope target | asked | returned |
| --- | --- | --- |
| 45-chunk document | 40 | **1** |
| 915-chunk document | 40 | **12** |

The 915-chunk probe used one of that document's own chunk embeddings, so an
exact match with similarity 1.0 existed and was still **not returned** (best
similarity 0.691). Scoped retrieval is therefore not merely truncated, it is
losing the single most relevant passage.

Consequence: the scoped search usually returns zero or near-zero, which trips
D2. **Scoping has never worked for any document, at any coverage level.**

### Options measured

| strategy | 45-chunk doc | 915-chunk doc |
| --- | --- | --- |
| as-is, HNSW post-filter | 1 chunk, 8 ms | 12 chunks, 3 ms |
| `hnsw.iterative_scan = relaxed_order` | 40 chunks, **19,820 ms** | 40 chunks, 1,019 ms |
| exact scan, indexes disabled | 40 chunks, 1,635 ms | 40 chunks, 1,634 ms |
| **pre-filter on document_id, then sort** | **40 chunks, 12 ms** | **40 chunks, 840 ms** |

The 915-chunk case is correct but slower than it should be, and the plan says
why: the join to `documents` for the `indexed_at is not null` guard becomes a
`Seq Scan on documents` (2,338 rows, 237 ms) feeding a Hash Join, because the
predicate matches every row and has no index. The vector work itself is cheap -
the bitmap scan over 915 chunks takes 80 ms. A scoped search already knows its
document ids, so that guard should be a nested-loop primary-key probe, not a
hash of the whole table. Secondary optimisation, folded into the same change.

`iterative_scan` is correct but pathological on small documents: it widens the
search until it finds 40, which on a 45-chunk target means traversing most of the
graph. Rejected.

The pre-filter plan is `Index Scan using document_chunks_document_order`
(`Index Cond: document_id = ANY (...)`) feeding a sort of 45 rows. It is both
**faster and exact** — no approximation, because 23-915 rows is small enough to
score exhaustively. HNSW should not be used at all for a scoped search.

### Change

Split the two retrieval modes rather than overloading one RPC with a nullable
filter. When `p_document_ids` is non-empty the predicate must be unconditional
so the planner pre-filters; when it is empty the query keeps today's HNSW path.
`search_desk_rows` (migration 20260922082308) is the precedent: assemble the
predicate per call so absent filters are absent from the SQL, not folded into a
disjunction.

Constraint: `match_documents` is `security invoker` (corrected - an earlier draft
of this spec said definer, which was wrong) and runs under the caller's RLS.
Signature, return type, volatility and grants must not change.

## D2 — The unscoped fallback is silent

agent.ts:291:

    if (found && !found.length && scope) found = await searchAttempt(call, args);

When the scoped search returns nothing the turn quietly re-runs across all
54,219 chunks. Given D1 this fires on essentially every scoped turn, which is
why "Attached only" produced passages from fifteen other documents.

The fallback is defensible; its silence is not. The reader cannot tell that the
evidence came from outside the document they attached.

### Change

Keep the fallback, record it. The turn must emit an activity frame and the
answer must carry a line stating that the attached document yielded nothing and
the search was widened. Once D1 is fixed this should become rare, and when it
does happen it is a real signal that the document has no relevant passage.

## D3 — Only the first search of a turn is scoped

agent.ts:289 gates the scope on `budget.documentSearches === 0`. A second search
in the same turn is corpus-wide even when the user is still asking about the
attached bill.

### Change

Scope every document search while an attachment is in play. Widening should be
an explicit decision (D2), not a side effect of being the second call.

## D4 — Focus is advisory text only

`focus` reaches exactly one place server-side, prompt.ts:159, where it selects a
sentence for the prompt. Nothing enforces it. "Attached only" is a request to
the model, not a constraint on retrieval.

### Change

Bind focus to retrieval. `attached` must restrict document search to the
resolved document ids and must not widen without the D2 disclosure.

## D5 — Coverage: current bills have no documents

Distinct bill keys on the desk that resolve to a document:

| era | desk keys | have a document | coverage |
| --- | --- | --- | --- |
| 2020-2026 | 1,242 | 6 | **0.5%** |
| 2010-2019 | 2,491 | 107 | 4.3% |
| 2000-2009 | 1,797 | 831 | 46.2% |
| 1990-1999 | 1,153 | 255 | 22.1% |
| pre-1990 | 2,732 | 36 | 1.3% |

The corpus is a 2000-2009 archive; the desk shows current business. Every bill
in the reported session was 2025 or 2026, so `scopedDocumentIds` was empty and
no filter was applied at all. The join itself is healthy: 1,235 of 1,314
document keys match a desk row.

This is an ingest task, not a code fix, and it is the only item here that
changes what the user sees on current bills. D1-D4 make scoping work; D5 gives
it something to scope to.

## D6 — The agent searches once and stops

Across eight consecutive production turns: one `search_documents` each, 40
chunks each, **zero failed steps**. The budget allows `maxSearches: 10`
(agent.ts:17). Nothing was rejected or timed out by the database. The model
simply does not search again.

The owner's reading is that the attachment's structured metadata is rendered
into the prompt and reads as sufficient, so the model answers from it. That is
consistent with the answers observed, which cite tabular fields accurately and
report the bill text as "Not in record".

### Change

Prompt, not budget. The rule to state is that supplied metadata describes a
record but is not the record's text, and that any question about what a document
says requires retrieval. Refining and searching again when the first search is
weak must be described as normal, not exceptional. Top-k stays at 40 by explicit
instruction — breadth comes from more, better-targeted searches, not from a
larger single result set, which would raise hallucination risk rather than lower
it.

## D7 — Two attached documents: the larger one takes every slot

Multi-file scoping is already plural end to end: `documentKeysOf` returns a set
(validate.ts:183), `resolveDocumentIds` uses `.in(...)` over all of them,
`scopedDocumentIds` is `string[]`, and `match_documents` takes `p_document_ids
uuid[]`. D1's predicate is `= any (p_document_ids)`, so N documents need no
further plumbing.

What does not work is the division of the 40 slots. Ranking is global across the
union, so a document's share is proportional to its chunk count. Measured, with
both documents attached and top_k 40:

| attached pair | split |
| --- | --- |
| 915-chunk gazette + 45-chunk synopsis | **35 / 5** |
| 915-chunk gazette + 23-chunk document (typical size) | **40 / 0** |

The second row is the problem: a normal-sized bill attached beside a large one
is retrieved zero times and is invisible to the answer. "Compare these two
bills" would be answered entirely from one of them, with nothing in the
transcript saying so.

TenderBase does not meet this because their scoped RPC takes a single
`p_tender_uuid`; multi-document chat is our requirement, not a pattern to copy.

### Change

Give each attached document a quota rather than pooling the slots: rank within
each document and keep the best `ceil(top_k / N)` from each.

    row_number() over (partition by c.document_id order by c.embedding <=> q) <= quota

Total returned stays at 40 - this does not raise top_k, it redistributes it. Two
documents get 20 each, four get 10 each. A document smaller than its quota
simply contributes everything it has.

Measured on the 915 + 23 pair: 40 rows in **19 ms**. The planner turns the rank
limit into a `Run Condition` on the WindowAgg and stops early, and the bitmap
pre-filter on `document_chunks_document_order` is preserved.

Open question for the owner: whether one attached document should also be capped
at its quota. A single attachment with quota 40 is today's behaviour and is
right. The quota only binds when N > 1.

## Hallucination risk — the owner's question

Turn 56623199 ("APPROPRIATION NO. 3 BILL 2026") retrieved 40 chunks from **40
distinct documents** — one fragment each from forty unrelated bills. That is the
worst possible context shape: no document coherent enough to reason over, forty
invitations to blend. Scoped retrieval of 40 chunks from one 915-chunk bill is a
different and far safer object. The instinct that unscoped search over 54,219
chunks invites hallucination is supported by the evidence here.

## Out of scope

Reranking, hybrid BM25, and a graph database. The first two are worth revisiting
after D1-D5; the third is unnecessary because the relationship already exists as
an indexed foreign key.

## TenderBase comparison

Read from `DDL Labs codebase/tenderbase-onboard`, chat agent
`supabase/functions/talk-to-tender/`.

### The filter predicate — they do exactly what D1 proposes

`match_documents_scoped`, migration 20260823115051:8-27:

    WHERE e.tender_id = p_tender_uuid
      AND (p_document_id IS NULL OR e.document_id = p_document_id)

The tender scope is an **unconditional equality on an indexed column**. The
organisation check is not in the query at all - it is hoisted into a guard
clause above it that returns early. That is the same shape D1 proposes, arrived
at independently, and it is why their filtered search works.

Their *optional document narrowing* on the second line carries the same
disjunction defect we have, and their Drive path is weaker still (a join plus
`d.path LIKE v_path || '%'` and two more `IS NULL OR` branches). So the pattern
to copy is the first line, not the file wholesale.

Corroborating detail: `ef_search`, `ivfflat.probes` and `hnsw.iterative_scan`
appear **nowhere** in their migrations or functions. They run HNSW cosine at
default parameters with no partial or composite index. They do not need the
tuning we were considering because the predicate lets the planner pre-filter.
This is direct evidence that fixing the predicate is sufficient and the
`iterative_scan` route is the wrong branch.

### Chunk schema — we already match the relevant half

They denormalise `tender_id` onto the chunk row. They also **deliberately
removed** `organisation_id` from it: migration 20260730192839 is titled "Undo
part 1's denormalisation (not needed)", and their spec states "Tenancy
enforcement scopes via the **parent tender row**, not chunk metadata".

So they use both patterns on purpose: the retrieval scope denormalised, the
tenancy scope joined. Our `document_id uuid NOT NULL` is the direct equivalent
of their `tender_id`, and it is indexed. Nothing to add - and nothing here
suggests a graph database.

### top_k — identical, and identically flat

`DEFAULT_TOP_K = 40` (talk-to-tender/retrieval.ts:10), used for scoped and
unscoped alike, never overridden in production. Their report agent uses 40 with
a 50 ceiling. Keeping 40 is the matching choice, not a compromise.

### Budget

Theirs: `maxSteps 16, maxSearches 14`. Ours: 12 / 10. Comparable; not the
reason we search once.

### Metadata versus evidence — the finding that reshapes D6

Their chat agent injects a 58-column fact sheet and instructs, at
talk-to-tender/prompt.ts:221-228:

> "They are **authoritative** for dates, values, fees, EMD, authority details,
> status and counts. Answer questions covered by the record **directly from it,
> without searching**. Do not fire a document search for a fact that is already
> listed above."

So TenderBase deliberately does the thing we suspected our model of doing. The
difference is that they bound it on three sides:

1. A standing mandatory-search rule, prompt.ts:28 - "Call it before answering
   any question about the tender - always, including on the first turn," with a
   single carve-out for bare greetings.
2. A missing-field rule, prompt.ts:227 - "A field that is missing above is
   unknown, not zero. Search the documents for it instead of guessing."
3. A contradiction rule, prompt.ts:228 - report both and say which is which.

And their sibling report agent takes the opposite line entirely
(run-report/prompts.ts:59-66): "Only chunks returned by the vector search tool
count as evidence. Never treat ... tender metadata ... as evidence."

The lesson for D6 is not "force a search every time". It is that the boundary
must be drawn explicitly: the desk row is authoritative for the fields it
contains - house, stage, dates, sector - and is **not** evidence for anything
about what the bill text says. Our prompt currently draws no such line, so the
model reasonably treats the rendered row as sufficient for both.

### Weak-result refinement - they have the sentence we lack

talk-to-tender has no retry instruction either; a `NO_RESULTS:` sentinel goes
back and the rest is model discretion. Their report agent is explicit
(run-report/prompts.ts:71-73):

> "Read the chunks after every search before choosing the next query. If a chunk
> reveals a better tender phrase or section name, search that phrase next. Do not
> stop after one weak search unless the answer is clearly found."

That is the language D6 should adapt.

### Reranking, hybrid, thresholds

None on either side. Not a gap between us; a shared future option.
