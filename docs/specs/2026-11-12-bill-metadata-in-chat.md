# Bill metadata in the research chat (F325, proposed)

> **Status: Living (draft for the developer, 2026-11-12).** Not approved. Two small changes to the live research
> chat (`supabase/functions/research-chat/`, shared code in `supabase/functions/_shared/`). Baseline `c43ecfe3`.
> Related: web search ([spec](2026-10-13-web-search.md)), web recovery
> ([spec](2026-10-19-rag-citation-web-recovery.md)), prompt cache policy
> ([F253](2026-10-24-ai-research-cache-policy.md)), contextual chunk headers held under F289
> ([open work](../plans/open-work.md)). Tracker id F325 is the next free number; the supervisor adds the line.

Evidence marks: **read** = seen in the checkout at `c43ecfe3` (file:line); **inferred** = reasoned from read code, not
executed; **measured** = the developer's read-only live counts of 2026-11-11 (counts only), or a count run on a
file in the checkout (named). Nothing here was executed against NTER or a deployed function.

## Summary

- **Change 1 (web identity).** When the forced web-only call fires for a Bills record, its instruction names the
  bill as *title (Bill No. n of yyyy, House)*, taken from the verified listing row. Today it says only "the CURRENT
  attached subject". Recurring titles make this matter: the bundled listing has 65 Finance Bills, 67 Appropriation
  Bills and 922 Constitution (Amendment) Bills (measured, `public/data/embedded_csv/national_bill_tracker.json`).
- **Change 1 (first query): recommend no change.** The pre-search never runs when the record has no indexed
  document, and when it does run it is confined to that record's own documents, so naming the bill there
  disambiguates nothing. It would only change the embedded query text. See Conflicts found, C1.
- **Change 2 (facts line).** Each retrieved Bills document gets one bounded line of its own `documents.metadata`
  in the search reply the model reads (number, year, House, introduced date, status, ministry). It is built after the
  RPC has ranked the rows, from the metadata read the chat already makes, and it is never embedded.
- Built as a small generic formatter with a field list per feature. Only Bills has a list in this build; Law and
  Parliamentary Questions render byte-identically to today.
- No client change, no new handle, no citation change, no schema or migration, no embedding change.

## Current state

### The web decision and the forced web-only call

| # | Fact | Where | Mark |
|---|---|---|---|
| 1 | `decideWebSearch` turns web on automatically for attached/selection scope when any record has `indexed === false` (reason `record-without-document`). | `research-chat/webPolicy.ts:35-49`, `57-71` | read |
| 2 | `webScopeOf` sets `indexed: false` when the row has no document key, or when the resolver reports coverage `unmapped`, `registered` or `incomplete`. Records are listed attachments first, then the selection. | `research-chat/handler.ts:1789-1821`; called at `1003` | read |
| 3 | Web is *required* when it is offered, a target record has `indexed === false`, no document chip resolved, and `requiresWebContext(message)` holds. For a selection plus a deictic question the target is the last record only. | `handler.ts:1069-1072`; `turnScope.ts:34-37` | read |
| 4 | The required flag reaches the agent as `webSearch.required`. | `handler.ts:1336-1338` | read |
| 5 | After a research call that did not search the web, the agent makes one web-only call (`tools: []`, `tool_choice: 'required'`) with this fixed user message: "The current attached record has no indexed full text, and this question needs context beyond its fields. Search the web now for the CURRENT attached subject, not the previous subject. …" It names no bill. | `agent.ts:1046-1059`, request built at `874-893` | read |
| 6 | The model writes the web query. OpenRouter runs it with the Exa engine, 5 results per search, at most 3 searches per turn. Nothing in the function fetches a page. | `_shared/webSearch.ts:1-23`, `51-62` | read |
| 7 | The model already sees the row's number, House and date: the record text is every scalar field of the row (`bill_number: …`, `house: …`, `date_introduced: …`), with identifiers skipped. | `src/lib/sourceUrls.js:159-213` (via `_shared/deskRows.ts:199-201`); shown at `handler.ts:943`, `1057` | read |
| 8 | The Bills listing row's fields are `bill_name, bill_number, house, sector, date_introduced, current_stage, bill_type, bill_category, …`, with no ministry. Houses are exactly `Lok Sabha` (6,522) and `Rajya Sabha` (3,297). | bundled listing file above | measured (bundled copy, not NTER) |
| 9 | The year in a bill key comes from the year that ends `bill_name`, else from the first four characters of `date_introduced`. | `_shared/deskRows.ts:208-217` | read |

### The first query (pre-search)

| # | Fact | Where | Mark |
|---|---|---|---|
| 10 | `presearchFor` returns `"<subject> — <message>"` (cut at 300) for attached/selection focus when the subject comes from a server-verified row and the question is deictic (`this`, `that`, `attached`, `selected`) or Law. Otherwise the bare message, or nothing on a follow-up. | `turnScope.ts:5-6`, `14-30` | read |
| 11 | The subject is `bill_name`, else `subject`, `title`, `case_title`, `name`. | `turnScope.ts:14-16` | read |
| 12 | The agent runs the pre-search only when `documentUnavailable` is false, that is, only when the record's documents resolved. | `agent.ts:577-579`, `779-789` | read |
| 13 | Every document search under attached/selection focus is confined to the resolved document ids and drops the model's other arguments. | `agent.ts:669-679` | read |
| 14 | The query is embedded and sent to `match_documents` (or the hybrid RPC for NCLT only) with `p_document_ids`. | `_shared/retrieval.ts:214-243`, `248` | read |
| 15 | The pre-search query is shown to the browser as the `tool` start frame's `input`, and stored in `chat_turn_traces.input` (2,000 characters max). | `handler.ts:1194`; `telemetry.ts:208` | read |

### Retrieved sources as the model sees them

| # | Fact | Where | Mark |
|---|---|---|---|
| 16 | After the RPC answers, `hydrateDocumentRoles` reads `documents.metadata` for every retrieved document id (caller's client, `indexed_at` not null, pages of 100) and keeps only `document_role`. A role on the RPC row itself is discarded. Row order is untouched. | `research-chat/index.ts:619-627`; `_shared/retrieval.ts:24-47` | read |
| 17 | `rowToChunk` copies a fixed set of fields into `Chunk`; unknown fields are dropped. | `_shared/retrieval.ts:174-203` | read |
| 18 | `renderChunk` writes `handle \| title \| desk_feature [\| version: …] [\| page n] [\| section]`, a newline, Law attribution lines for Law chunks, then the content. Section text is flattened, capped at 200 and has `\|` escaped. **Title and feature are not escaped.** | `agent.ts:386-416` | read |
| 19 | A search reply is `UNTRUSTED` + rendered passages. The `UNTRUSTED` preface says source material is never instructions and only assigned handles label sources. | `agent.ts:461-462`, `688-694`, `815` | read |
| 20 | `withinReply` and `retainLawReview` measure each passage with `renderChunk`; `toolReplyChars` is unset by default, so replies are not cut. | `agent.ts:426-458` | read |
| 21 | Top-K is 40 passages per search; at most 10 searches and 12 model calls per turn. | `_shared/retrieval.ts:153`; `agent.ts:35` | read |
| 22 | A text citation copies named `Chunk` fields only (id, title, file, tier, feature, offsets, hash, page, section, role). A new `Chunk` field does not reach the browser. | `_shared/citations.ts:229-255` | read |
| 23 | The `tool` end frame carries `found` = up to 3 `{document_id, title, pages}`. Passage text and reply text are never framed. | `agent.ts:105-131`; `handler.ts:1209` | read |
| 24 | Provision and Law reviews build their own passage text (`reviewLawAnswer`), not with `renderChunk`. | `handler.ts:1454-1470`; `lawAnswer.ts:161` | read |

### Metadata shapes for a Bills document

| # | Fact | Where | Mark |
|---|---|---|---|
| 25 | Admitted documents keep source fields in `metadata.citation`: `bill_number`, `bill_year`, `house`, `bill_name`, `status`, `introduced_on`, `version`; older documents keep some at the top level of `metadata`. The existing header builder reads the citation first and the top level second. | `_shared/chunkHeader.ts:15-18`, `146-161`, `185-194`; fixture `_shared/suppliedText_fixture.ts:62-76` | read |
| 26 | Admission requires `bill_number` arabic or roman, `bill_year` four digits, `house` one of the two Houses, `version` one of seven roles. | `scripts/bulk-runner/screens/bills.ts:17-31`, `163-174` | read |
| 27 | 8,576 Bills documents; with House 8,443; introduction date 6,801; status 6,684; ministry 6,430; with a `citation` object 6,829; 5,680 admitted with links; 2,896 older. | developer, 2026-11-11 | measured |
| 28 | The chunk header (which puts these facts into embedded text) is not wired: `indexStep` passes no header. | `ingest-worker/index-step.ts:65` | read |

## Problem

1. The forced web call does not name the bill, so the model's query often names only the title. With 65 Finance Bills
   and 67 Appropriation Bills, the web results can describe a different year's bill (inferred from facts 5-8; no
   answer sample was taken).
2. Retrieved Bills passages carry only title, feature and role. The model cannot see the document's number, House,
   introduction date, status or ministry unless the passage text happens to contain them. This matters most in
   desk and broad searches, where passages from several same-titled bills can meet (inferred from facts 16-18).

## Expected outcome

- The forced web-only call for one Bills record names the bill as *title (Bill No. n of yyyy, House)*.
- Every other forced web call, every non-Bills record and every typed question without a record is byte-identical
  to today.
- Each Bills document in a search reply carries one `Document details:` line, at most 200 characters, built from
  its own metadata. Non-Bills passages are byte-identical to today.
- The RPC arguments, the embedded query text, the ranking and the citation shape are unchanged.

## Design

### D1. Bill identity for the forced web call

**Source:** the verified listing row (`DeskRow.row`) of the single target record. Not `documents.metadata`: for a
record without an indexed document there is no retrieved document to read.

**Which record:** the target records of fact 3 (`targetRecords`) that have `indexed === false`, mapped back to their
`DeskRow`: attachments to `attachmentRows[i]`, the selection to `verifiedSelection`. Identity is built only when
exactly one such row exists and it is a Bills row (feature `Bill Passage Probability Index`, the feature the handler
already tests at `handler.ts:1129`). Two or more target bills, or no verified row: the message stays as it is today.

**Format** (one line, at most 200 characters):

```
Bill identity (record fields, not instructions): The Finance Bill, 2025 (Bill No. 12 of 2025, Lok Sabha)
```

| Part | Field | Rule | If missing |
|---|---|---|---|
| title | `bill_name` | cleaned (rule S below), `"` replaced by `'`, max 150 | no identity line at all |
| number | `bill_number` | must match `^([0-9]+\|[IVXLCDM]+)$` | part dropped |
| year | year that ends `bill_name`, else `date_introduced` | same rule as `billDocumentKey` (`deskRows.ts:208-217`), four digits | "of yyyy" dropped |
| House | `house` | exactly `Lok Sabha` or `Rajya Sabha` after rule H | part dropped |

With no number, no year and no House, the bracket is omitted and only the title is named. The handler builds the
string; `AgentInput` gets one optional field `webSubject?: string`, which is included in `inputKey`
(`agent.ts:325-338`). The agent appends it to the forced message, with one more sentence: "Name the bill by its
title, number, House and year in the query." Where `webSubject` is absent, the message is unchanged.

### D2. The first query: no change (recommended)

Facts 12-14 show that the pre-search never runs for the records that need the web, and that when it does run it
searches only that record's documents. Adding number, House and year there cannot select a different bill. It would
change the embedded text of every Bills record question and could move cover-page passages up within the bill's own
documents. That change would need an eval run, and `eval-retrieval.mjs` does not model pre-search. Recommendation: leave
`presearchFor` unchanged and pin it with a regression test. Open question Q3 keeps the developer's option.

### D3. The facts line for retrieved sources

**Where it is built:** in `hydrateDocumentRoles` (`_shared/retrieval.ts:25-47`). It already reads `metadata` for
exactly these documents. From the same read and the RPC row's `desk_feature`, it also attaches
`document_facts: string`. Any `document_facts` on the RPC row is discarded, as `document_role` is (`retrieval.ts:43`).
`rowToChunk` copies it only when it is a string of at most 200 characters. No new query, no new column.

**Why ranking cannot change:** the line is built after `match_documents` has returned and ordered its rows
(`retrieval.ts:283-285`). It is not part of `args`, the query or the embedding, and similarity is copied unchanged.
`onTrace` sees the same chunk ids in the same order.

**How it is shown:** `renderChunk(handle, c, { facts })` puts the line after the header line and before any Law
lines and content. The search-reply builders (`agent.ts:693`, `815`) pass `facts: true` only for the first passage
of each document in that reply, so a document's line appears once per reply. `withinReply` keeps measuring with the
line on every passage. That over-counts, which is safe, and the cap is unused by default.

```
ref:abc123-4 | The River Navigation (Amendment) Bill, 2025 | Bill Passage Probability Index | version: As introduced
Document details: Bill No. 12 of 2025 | Lok Sabha | introduced 2025-03-04 | status: Pending | ministry: Ports, Shipping and Waterways
<passage text>
```

**Fields, order and caps (Bills):**

| Order | Field | Read from | Normalisation | Cap |
|---|---|---|---|---|
| 1 | number + year | `citation.bill_number`, `citation.bill_year`, then top level | number by the D1 pattern, year four digits; "Bill No. n of yyyy", "Bill No. n" or "yyyy" | 25 |
| 2 | House | `citation.house`, then top level | rule H | 11 |
| 3 | introduced | `citation.introduced_on`, then top level | ISO `yyyy-mm-dd` for an ISO or day-month-year date that exists; anything else dropped | 21 |
| 4 | status | `citation.status`, then top level | rule S; "status: …" | 40 |
| 5 | ministry | `citation.ministry`, then top level | rule S; "ministry: …" | 80 |

The version is not repeated: it is already the header's `version:` field whenever `metadata.document_role` is valid
(`agent.ts:404-405`). The line holds no title, key, file name, URL, id or storage path.

**Missing fields and disagreement.** A missing or invalid field is left out; the words "undefined", "null" and "n/a"
never appear. With no field left, there is no line, and the passage renders exactly as today. Each field is read from
the citation first and the top level second, the order the header builder uses (`chunkHeader.ts:188-194`). When both
hold a value and they differ, the citation wins: admission checked it (fact 26). The disagreement is not shown and
not logged. The whole line is capped at 200 characters; a field that does not fit is skipped, and a later, shorter
one may still be used (the header rule, `chunkHeader.ts:205-212`).

**Rule H (House):** trimmed and case-folded. `lok sabha` gives `Lok Sabha`, `rajya sabha` gives `Rajya Sabha`, and
anything else is dropped. Abbreviations are not guessed, because the stored values in the older shape were not read.

**Rule S (sanitising, every value, D1 and D3).** Metadata comes from external packs and is untrusted.

1. Only strings and finite numbers are accepted; objects, arrays, booleans and null are dropped.
2. `toWellFormed()`; every control (`\p{Cc}`) and format (`\p{Cf}`: bidi overrides, zero-width) character
   becomes a space; whitespace is collapsed to single spaces and trimmed. A value can never hold a newline.
3. Anything matching `HANDLE_RE` (`_shared/handles.ts:10`) is removed, so a value cannot pose as a source handle.
4. `|` becomes `\|`, as `sectionText` does (`agent.ts:386-389`), so a value cannot add a field.
5. Clipped to the field cap, never inside a surrogate pair (`chunkHeader.ts:48-54`).
6. Structured fields (number, year, House, date) must also pass their shape check. Only status and ministry carry
   free text, and they are clipped to 40 and 80 characters.

The line opens with a fixed label and sits inside the `UNTRUSTED` reply (fact 19). A hostile value can therefore add
at most 80 characters of one-line text to a block the model is already told is data. That is the same exposure the
passage content has today.

Where the code already does this: section labels are escaped and capped (`agent.ts:386-389`); the header builder strips
control characters (`chunkHeader.ts:40-46`); document-chip titles are whitespace-collapsed (`prompt.ts:288`). Passage
titles in `renderChunk` are **not** escaped (fact 18). That gap is out of scope here and reported below.

### D4. Scope: a generic formatter with a list for Bills only (recommended)

A new pure module, `_shared/documentFacts.ts`, exports `documentFacts(feature, metadata): string` and
`billIdentity(row): string`. It holds a table from `desk_feature` to a field list, and only
`Bill Passage Probability Index` has an entry. Every other feature returns `''`, so Law, Parliamentary Questions and the
rest render byte-identically.

To add a feature later: add a table entry and golden tests, check one answer sample, and record it in this spec. PQs
are not added now. Their facts duplicate the subject line, and the header experiment lost Parliamentary Questions
(F289). That experiment was an embedding effect and does not prove a prompt-line effect, but it is reason to measure
first.

The module does **not** import `chunkHeader.ts`. That builder's output is pinned by `HEADER_VERSION` and goldens and
belongs to the held embedding path (F289). Sharing code would let a chat change move an embedding hash, or the
reverse. The field names are copied from it, and the duplication is noted.

## Privacy and outbound data

| Path | Today | After change 1 | After change 2 |
|---|---|---|---|
| Model provider (through OpenRouter) | system prompt, history, the user's message, record text (including number, House and introduction date), retrieved passages | plus one instruction line with the bill's title, number, year and House, all already in the record text | plus at most 200 characters per Bills document of public catalogue fields (status, ministry, introduced date) |
| Web search engine (Exa, through OpenRouter) | the query the model writes. It may contain words from the user's message (inferred: the model composes it) | the model is asked to add the bill's number, year and House | no change |
| Browser frames | the pre-search query as `tool.input`; titles in `found` | no change (D2 leaves the pre-search alone) | no change (facts 22-23) |
| Stored | `chat_turn_traces.input` holds queries; `chat_messages.usage` holds counts | no change | no change |

Nothing user-specific is added: no user id, name, email, plan, conversation id or document the user uploaded. Number,
House and year are public fields of a public bill listing (fact 8). The model may still put words of the user's
question into its web query, exactly as today; this change neither adds nor removes that.

**Approval line (developer):** "The bill's number, House and introduction year may be named to the web search for a
Bills record without an indexed document." Approved: ____ (date) ____

## Effects

| Area | Effect | Evidence |
|---|---|---|
| Prompt size and credits | Change 1 adds about 40 tokens to one call on a required-web Bills turn. Change 2 adds at most about 50 tokens per Bills document per search reply. A confined Bills reply has passages from 1-4 documents (about 200 tokens at most); a broad reply of 40 passages from 40 Bills documents, about 2,000 tokens at most. Later calls in the turn resend earlier replies. Credits are settled from the provider's cost, so cost rises with tokens; there is no separate size limit to change. | `agent.ts:35`; `retrieval.ts:153`; `handler.ts:239-248`, `616-637` (read); token figures inferred at 4 characters a token |
| Caches | There is no answer cache ("No full-response caching", F253). Prompt caching is per conversation and prefix-based; the system prompt does not change. Tool replies change only within new turns. Nothing cached becomes invalid or wrong. Expected: provider cache hits on Bills turns may fall slightly for one turn, if at all. | cache spec §Outcome; `_shared/openrouterStream.ts:105-127` (read) |
| Checkpoint | `webSubject` joins `inputKey`, so a resumed turn cannot mix inputs. Checkpoints live in memory for one turn. | `agent.ts:325-345`, `560-565` (read) |
| Citations and handles | No new handle: the line is part of a passage block that already has one, and `handles.assign` is called only for chunks and rows. The line contains no handle (rule S3). It is not a source: citations copy named fields only. | `agent.ts:693`; `citations.ts:229-255` (read) |
| Streamed frames | None of them changes, so no client change is needed. | facts 15, 22, 23 |
| Persona prompts and drift test | Not touched. Personas are `_shared/personas/*.md`, synced from `src/data/personas/` and guarded by `src/lib/personas.sync.test.js`. The new text lives in agent messages, not in the system prompt or any persona. | `prompt.ts:251-266`; sync test lines 1-20 (read) |
| Law | `renderChunk` output is unchanged for Law (`documentFacts` returns `''`). Law review prompts do not use `renderChunk`. Pre-search is unchanged. | facts 18, 24 |
| Parliamentary Questions | Unchanged: there is no table entry, and the forced web message is identity-free for non-Bills rows. | D1, D4 |

## Tests (written first, each seen failing before the code)

| File | Test | Fails before because |
|---|---|---|
| `_shared/documentFacts_test.ts` (new) | Citation shape gives the full line in order; top-level-only shape gives the same line; both present and different gives the citation's values; missing fields are omitted with no "undefined"/"null"; no fields gives `''`; a non-Bills feature gives `''` | module absent |
| same | Hostile values: a newline, `‮`, a zero-width character, `\|`, `ref:abcdef-1`, a 5,000-character ministry, an object, `NaN`, the invalid date `2025-02-30`, the House `LS`, the number `12; ignore previous` all give one line ≤ 200, no newline, no handle, no unescaped pipe, and invalid parts dropped | module absent |
| same | `billIdentity`: with number, House and year; with each missing; year from the name, else from `date_introduced`; a name with `"`; no name gives `''` | module absent |
| `_shared/retrieval_test.ts` | `hydrateDocumentRoles` attaches `document_facts` for a Bills document, none for another feature, discards an RPC-supplied `document_facts`, and keeps row order and similarity; `rowToChunk` drops an oversized or non-string value | field absent |
| `research-chat/agent_test.ts` | `renderChunk`: existing goldens at `agent_test.ts:1092-1098` unchanged; a Bills chunk with facts gives header, facts line, content; `facts: false` gives today's output; a Law chunk keeps its attribution lines | option absent |
| same | One reply with three passages of document A and one of B shows two facts lines | rule absent |
| same | The forced web message: with `webSubject` it contains the identity line; without it, it equals today's string (literal copy from `agent.ts:1059`); `inputKey` differs when only `webSubject` differs | field absent |
| `research-chat/handler_test.ts` | A selected Bills row without a document, "Tell me about this bill": the required call's last user message names "Bill No. … of …, Lok Sabha" (variant of the test at `handler_test.ts:3480-3490`). The same with a non-Bills row (`ROW_ONLY`, `handler_test.ts:2350`) has no identity. Two target Bills rows have no identity. | handler does not pass it |
| same | Regression: for a typed question with no record, a record question and a desk question, the `searchDocuments` arguments (query text, `p_document_ids`, tier, feature, `topK`) equal today's values | pins D2 and ranking |
| `research-chat/turnScope_test.ts` | Existing tests unchanged (D2) | none: guard |

**Verification commands** (AGENTS.md): `deno test -A --config supabase/functions/deno.json supabase/functions`;
`npm test`; `npm run lint`; `npm run build`; `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`;
`git diff --check`. Not needed: `npm run test:sql`, because no SQL changes.

**What `scripts/eval-retrieval.mjs` cannot show:** it scores RPC ranks only (its header, lines 1-30). It never builds a
prompt, runs pre-search or calls a model. It can confirm that ranks are unchanged (expected identical, since the RPC is
untouched), but not the answer quality of either change.

**Manual answer spot-checks** (supervisor, on the canary of Rollout step 3, the developer's own account; record pass
or fail and the number of web sources, never the answer text, in the spec):

1. A Finance Bill row from a recent year with no indexed document: "Tell me about this bill". Pass: the web sources
   are about that year's bill.
2. An Appropriation (No. 2) Bill from the Rajya Sabha (roman number) with no indexed document: the same question.
3. A bill with an indexed document (admitted, with links), selected, asking "Who is the ministry and what is the
   status of this bill?". Pass: the answer agrees with the facts line and cites the passage, not the line.
4. A desk-focus search in Bills naming a recurring title ("What does the Finance Bill say about tax rates?"). Pass:
   the answer says which year's bill each claim comes from.
5. One Parliamentary Question record and one NCLT record, each asked a deictic question. Pass: the same behaviour
   as before; no "Document details" in the prompt (checked in the test fakes, not live).

## Rollout

Fact: the Vercel preview shares the live database and the live Edge Functions. The client always calls
`functions/v1/research-chat` (`src/lib/aiClient.js:47`), so a preview build cannot exercise a changed function.

1. **Build** on `task/f325-bill-metadata-chat` from `main`, test first. The supervisor reviews it, commits and opens
   the PR after the developer approves. CI must pass both named jobs.
2. **Know what will ship.** The last recorded deploy is `research-chat` v111 from `d02966de` (2026-11-06; v110 is
   its rollback point; `coordination.md:2414`). Since then `main` has changed `research-chat` and `_shared/retrieval.ts`
   with F288 (`68175648`: hybrid fallback behind `app_flags`, off while the row is absent). Before deploying, read the
   live version with `supabase functions list`, and diff the deployed commit against the merge commit for
   `supabase/functions/research-chat` and `supabase/functions/_shared`. The developer approves that whole diff, not
   only this change (see C3).
3. **Canary (recommended, needs approval).** Deploy the merged commit as a separate function slug,
   `research-chat-canary`, with JWT verification off. Use the runbook's emergency entry form (§3) pinned to the
   merge commit's full sha, so no repository folder is added. Edge Function secrets are project-wide, so the slug
   runs with the live configuration (inferred). Then:
   - The developer runs the five spot-checks by sending a turn to that slug from their own signed-in session. They
     handle their own token; no agent handles it.
   - These are real turns: they write the developer's conversations and spend the developer's credits.
   - Delete the slug afterwards; that needs its own approval.

   The alternative is to skip the canary and use step 4 with the rollback ready. This is the developer's choice.
4. **Deploy** the merged commit with the runbook's standard path
   (`docs/agents/rollback-runbook.md` §3, `supabase functions deploy research-chat --project-ref vfgcppstyzjarlzyqdac --no-verify-jwt`).
   Record the new version and its commit. Verify as the runbook says: `booted` in the logs, an unauthenticated POST
   answers 401 with the production origin, and one signed-in turn writes a `success` row to `model_call_logs`.
5. **Rollback point:** the version that was live before step 4, redeployed from its recorded commit (runbook §3; a
   bundle cannot be downloaded). Without the CLI, use the emergency entry:
   `import { createResearchHandler } from 'https://raw.githubusercontent.com/ddllabs/niyantran/<full-sha>/supabase/functions/research-chat/index.ts'; Deno.serve(createResearchHandler());`
   It must call `Deno.serve` itself (runbook §3).
6. **Watch for 48 hours** (counts only, never user text):
   - `chat_messages.usage`: turns per day with `web_required = true`, and among those, `web_searches = 0`. Compare
     with the 7 days before.
   - `chat_messages` status counts (`complete`, `error`, `truncated`).
   - `model_call_logs` rows by `status` for the chat purposes.
   - Function logs: counts of `research.attempt_failed`, `research.draft_retracted` (reason `searching`) and
     `research_chat.credits_settle_failed`.

   Roll back on any rise in errors or a fall in successes attributable to the deploy.

## Tasks

| # | Task | Size | Write scope | Verification | Depends on |
|---|---|---|---|---|---|
| T1 | Formatter and identity, test first | S | `supabase/functions/_shared/documentFacts.ts`, `documentFacts_test.ts` (new) | `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/documentFacts_test.ts` | approval of this spec |
| T2 | Hydrate and carry `document_facts` | S | `_shared/retrieval.ts`, `_shared/retrieval_test.ts` | the retrieval tests; full Deno suite | T1 |
| T3 | Render once per document per reply | S | `research-chat/agent.ts`, `agent_test.ts` | the agent tests; existing `renderChunk` goldens unchanged | T2 |
| T4 | `webSubject` from the handler into the forced web message; D2 regression test | S | `research-chat/handler.ts`, `agent.ts`, `handler_test.ts`, `agent_test.ts` | the handler and agent tests; full Deno suite, `npm test`, lint, build, router import, `git diff --check` | T1 (T3 for `agent.ts`) |
| T5 | Independent review, commit, PR | S | none (supervisor) | CI both jobs | T1-T4, PR approval |
| T6 | Canary, deploy, watch | S | none (supervisor and developer) | Rollout steps 2-6 | T5 merged, deploy approval |

Sequential: T3 and T4 both edit `agent.ts`. Delegation is permitted for T1-T4 one at a time, inside these scopes.

## Approvals

| # | Decision | Who | Status |
|---|---|---|---|
| A1 | This spec's scope, including D2 (no pre-search change) | developer | pending |
| A2 | Privacy approval line above (number, House, year to web search) | developer | pending |
| A3 | Push the branch and open the PR | developer | pending |
| A4 | Ship the whole function diff since the live version, including F288's dormant code (C3) | developer | pending |
| A5 | Canary slug: deploy, test turns on the developer's account, then delete | developer | pending |
| A6 | Deploy `research-chat` to production | developer | pending |

## Scope

The four task write scopes above, plus this spec and its `open-work.md` line (supervisor).

## Exclusions

- The resolver reading links (`record_resolve_document_keys`) and any change to which documents a record resolves to.
- The role rule on shared bill keys (F314).
- Facets or metadata on chunks; chunk headers (F289); any embedding, re-embedding or `embed_hash` change.
- Hybrid search for Bills; any RPC or SQL change.
- Changes to `presearchFor` (D2); persona or system-prompt text; client code; Law and provision review prompts.
- Escaping passage titles in `renderChunk` (reported below, not fixed).

## Risks

| Risk | Mitigation |
|---|---|
| The model treats the facts line as a citable source or quotes it as passage text | The fixed label says it is document details; the tests check that no handle is created; spot-check 3 |
| The line contradicts the passage (for example an older status) | The status field is what the catalogue says, and the label makes that clear. Spot-check 3; if this happens, drop status and keep it a facts-only line |
| A metadata value tries prompt injection | Rule S; the `UNTRUSTED` block; hostile-value tests |
| The forced message changes the query for the wrong bill when two bills are in scope | Identity only for exactly one target Bills row |
| The deploy ships unrelated merged code (F288) | Rollout step 2 and A4 |
| Token cost on broad Bills searches | Once per document per reply; a 200-character cap; watch `prompt_tokens` in `chat_messages.usage` |

## Open questions

| # | Question | Evidence | Recommendation |
|---|---|---|---|
| Q1 | Does a document's House mean the House the bill started in, or the House that passed that version? | Admission requires every link's House to equal `citation.house`, and matches listing rows by key **and House** (`screens/bills.ts:191`, `296-318`, read). The listing has one row per bill per House. So `citation.house` is the House of the listing row the document belongs to, and an `as_passed_rajya_sabha` version may carry `Lok Sabha` (inferred). For the 2,896 older documents the meaning was not checked. | Show it as plain `Lok Sabha` next to the `version:` field, which states the passage, and never word it as "passed in". A developer read of 20 older documents (counts per House and role, read-only) settles the older shape. |
| Q2 | May number, House and year go into the web query? | Public listing fields; nothing user-specific (Privacy) | Yes, for one Bills target record (A2) |
| Q3 | Should the pre-search also name the bill? | Facts 12-14; C1 | No (D2). If wanted later, only with a sealed answer check, since `eval-retrieval.mjs` cannot see the pre-search |
| Q4 | Should the identity also appear before the first research call when web is offered (not only in the forced call)? | The model already sees the fields in the record text (fact 7); the forced call is the gap the developer named | Not in this build. Revisit if spot-checks 1-2 show the first web query still misses |
| Q5 | Show status and ministry at all? | Status is present on 6,684 of 8,576 documents and ministry on 6,430 (fact 27) | Yes, both capped; drop status if spot-check 3 shows conflicts |

## Conflicts found

- **C1. The "first search query" premise.** The brief expects the first query to name the bill for this/that/selected
  questions. The code runs that query only when the record's documents resolved, and it is confined to them
  (`agent.ts:577-579`, `669-679`, `779-789`). For the web-fallback records it never runs. For the others it cannot
  disambiguate. Hence D2.
- **C2. Wording of F289.** The brief says the headers "lost 6 of 60 eval questions". `open-work.md:33` says they
  "lost 6 Parliamentary Questions when applied to every desk", and gained in broad search from 38 to 42 of 45. Same
  conclusion (no embedding); the numbers are quoted as the tracker has them.
- **C3. The live function is not `main`.** `research-chat` was last recorded as deployed at v111 from `d02966de`.
  F288's merged code (`68175648`) touches `agent.ts`, `handler.ts`, `index.ts` and `_shared/retrieval.ts`, and is
  recorded as not deployed (`open-work.md:32`). Any deploy of this change also ships it. Its kill switch defaults to
  off, but A4 must approve it explicitly. Whether `research-chat` was redeployed after v111 was not determinable from
  the checkout.
- **C4. The year of the listing row.** The brief speaks of the "introduction year". The code takes the year from
  `bill_name` first and from `date_introduced` second (`deskRows.ts:208-217`). D1 follows the code, so the identity
  year matches the document key's.

## Defects outside scope (reported, not fixed)

- `renderChunk` does not escape or flatten passage titles and features (`agent.ts:399-403`). A title with a newline or
  `|` could add a field or a line. Same untrusted-block exposure; worth a separate item.
- `PRESEARCH_NOTE` says the search used "the reader's message as written". Since the subject prefix
  (`turnScope.ts:25`), that is not exact (`agent.ts:52-53`).
