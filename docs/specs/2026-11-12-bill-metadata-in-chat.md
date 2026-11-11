# Bill metadata in the research chat (F331, proposed)

> **Status: Living (draft for the developer, 2026-11-12, revision 2 after independent review).** Not approved. Two
> small changes to the live research chat (`supabase/functions/research-chat/`, shared code in
> `supabase/functions/_shared/`). Baseline `c43ecfe3`; first draft committed as `3cc1bac2`. Related: web search
> ([spec](2026-10-13-web-search.md)), web recovery ([spec](2026-10-19-rag-citation-web-recovery.md)), prompt cache
> policy ([F253](2026-10-24-ai-research-cache-policy.md)), contextual chunk headers held under F289, the role rule on
> shared bill keys (F325), the hybrid fallback (F288) ([open work](../plans/open-work.md)). This spec also closes
> F329 (renderChunk titles), whose tracker line is not on `main` in this checkout.

Evidence marks:

- **read**: seen in the checkout at `c43ecfe3` (file:line).
- **inferred**: reasoned from read code, not executed.
- **measured**: the developer's read-only live counts of 2026-11-11 (counts only), or a count run on a named file in
  the checkout.

Nothing here was executed against NTER or a deployed function.

## Summary

- **Change 1, web identity.** The forced web-only call can fire for one Bills record. When it does, its instruction
  names the bill as *title (Bill No. n of yyyy, House)*, or as *title (Bill No. n, introduced yyyy-mm-dd, House)*
  when the year in the title and the introduction year differ. Today the instruction says only "the CURRENT attached
  subject".
  - Recurring titles make this matter. The bundled listing has 65 Finance Bills, 67 Appropriation Bills and 922
    Constitution (Amendment) Bills (measured, `public/data/embedded_csv/national_bill_tracker.json`).
  - In 1,011 of the 7,770 rows whose title ends in a year, that year differs from the year of `date_introduced`
    (measured, same file).
- **Change 1, first query: no change (recommended).** Under attached or selection focus, the pre-search never runs for
  a record without documents, and when it does run it is confined to the record's own documents.
  - Under broad focus with the reader's web override on, a forced web call can fire. The pre-search then runs
    corpus-wide with the bare message on a first turn.
  - Under desk focus with the override on, the same happens, with the pre-search scoped to the module.
  - Naming the bill in those queries would change ranking, which this spec does not do. See C1.
- **Change 2, catalogue line (v1).** Each retrieved Bills document gets one line in the search reply:
  "Catalogue fields (not passage text; cite no passage for them): Bill No. n of yyyy | House | introduced
  yyyy-mm-dd".
  - v1 carries **identity fields only**. Status and ministry are deferred (Q5).
  - The line comes from the `documents.metadata` read the chat already makes after the RPC has ranked the rows. It is
    never embedded, and it is not counted in the reply budget, so the passages kept are exactly today's.
- **One new rule in the system prompt** (the citation rules, not the persona files): catalogue lines are not passage
  text and no passage is cited for them.
- **Titles are flattened in `renderChunk`**, so a title cannot forge a catalogue line (closes F329). Ordinary titles
  render byte-identically.
- **Built as a small total formatter.** It never throws and has a field list per feature. Only Bills has a list. Law,
  Parliamentary Questions and the rest render byte-identically.
- **Nothing else changes:** no client, handle, citation shape, schema, migration or embedding.

## Current state

### The web decision and the forced web-only call

| # | Fact | Where | Mark |
|---|---|---|---|
| 1 | `decideWebSearch`: the reader's override `true` offers web under any focus (`override-on`). Automatic web is on for attached/selection when a record has `indexed === false`, and for desk when the module has no documents. | `research-chat/webPolicy.ts:35-49`, `57-71` | read |
| 2 | `webScopeOf` lists records only for row/record attachments (flatMap over `request.attachments`), then the selection. The index of a record is **not** the index of its attachment when a document chip comes first. `indexed` is false with no document key, or with coverage `unmapped`, `registered` or `incomplete`. | `research-chat/handler.ts:1789-1821` (records built at `1806-1808`) | read |
| 3 | Web is *required* when it is offered, a target record has `indexed === false`, no document chip resolved and `requiresWebContext(message)` holds. For a selection plus a deictic question the target is the last record only. This does not depend on focus: records come from the attachments under every focus. | `handler.ts:1069-1072`; `turnScope.ts:34-37` | read |
| 4 | The required flag reaches the agent as `webSearch.required`. | `handler.ts:1336-1338` | read |
| 5 | The forced call fires only after a research call that was offered web and did not search it, with no web pages yet, not already attempted, with step budget left, and not late. The forced call has `tools: []`, `tool_choice: 'required'` and a fixed message naming no bill: "…Search the web now for the CURRENT attached subject, not the previous subject…". | `agent.ts:1046-1059`; request at `871-893` | read |
| 6 | The model writes the web query. OpenRouter runs it with the Exa engine: 5 results per search, at most 3 searches per turn. | `_shared/webSearch.ts:1-23`, `51-62` | read |
| 7 | The model already sees the row's number, House and date. The record text is every scalar field of the row (`bill_number: …`, `house: …`, `date_introduced: …`). | `src/lib/sourceUrls.js:159-213` via `_shared/deskRows.ts:199-201`; shown at `handler.ts:943`, `1057` | read |
| 8 | Bills listing fields: `bill_name, bill_number, house, sector, date_introduced, current_stage, bill_type, bill_category, …`; no ministry. Houses are exactly `Lok Sabha` (6,522) and `Rajya Sabha` (3,297). `date_introduced` years run 1952-2026. The longest `bill_number` is 8 characters. | bundled listing file | measured (bundled copy, not NTER) |
| 9 | A bill key's year is the year that ends `bill_name`, else the first four characters of `date_introduced`. | `_shared/deskRows.ts:208-217` | read |
| 10 | No stored field records that the forced call ran. `chat_messages.usage` keeps `web_offered`, `web_required`, `web_reason` and `web_searches` (the provider's count). Call purposes do not single out the forced call. | `handler.ts:1618-1621`, `1631`; `telemetry.ts:426-437` | read |

### The first query (pre-search)

| # | Fact | Where | Mark |
|---|---|---|---|
| 11 | `presearchFor` handles attached/selection focus: `"<subject> — <message>"` when the subject is from a verified row and the question is deictic or Law. Under any focus, Law gets the bare message. Otherwise a first turn gets the bare message and a follow-up gets nothing. | `turnScope.ts:5-6`, `14-30` (bare message `28-29`) | read |
| 12 | The agent runs the pre-search only when `documentUnavailable` is false. That condition is true for attached/selection with no resolved ids, and for desk with no module. Broad focus is never unavailable. | `agent.ts:577-579`, `779-789`; `handler.ts:1025-1029` | read |
| 13 | Under attached/selection focus every document search is confined to the resolved ids. Under desk focus it is confined to the module. Under broad focus the model's arguments stand. | `agent.ts:669-679` | read |
| 14 | The query is embedded and sent to `match_documents` with `p_document_ids`, tier and feature. | `_shared/retrieval.ts:214-243` | read |
| 15 | The pre-search query is sent to the browser in the `tool` start frame (`input`), saved in the message's `activity` and in `chat_turn_traces.input` (2,000 characters max). | `handler.ts:1194`, `1210-1218`; `telemetry.ts:208` | read |

### Retrieved sources as the model sees them

| # | Fact | Where | Mark |
|---|---|---|---|
| 16 | After the RPC answers, `hydrateDocumentRoles` reads `documents.metadata` for every retrieved document id and keeps only `document_role`. A role on the RPC row is discarded and row order is untouched. A throw here fails the search (`afterRpcFailure`). | `research-chat/index.ts:619-627`; `_shared/retrieval.ts:24-47` | read |
| 17 | `rowToChunk` copies a fixed set of fields; unknown fields are dropped. | `_shared/retrieval.ts:174-203` | read |
| 18 | `renderChunk` writes `handle \| title \| desk_feature [\| version: …] [\| page n] [\| section]`, a newline, Law lines, then content. Section text is flattened, capped at 200 and has `\|` escaped. **Title and feature are printed raw**, so a newline in a title starts a new line. | `agent.ts:386-416` | read |
| 19 | A search reply is `UNTRUSTED` followed by the passages. | `agent.ts:461-462`, `688-694`, `815` | read |
| 20 | `withinReply` keeps passages while `renderChunk(HANDLE_ROOM, c)` lengths fit `toolReplyChars`. The handler sets `toolReplyChars = TOOL_REPLY_CHARS` (24,000) when the model's effort is `high`, `xhigh` or `max`. `retainLawReview` measures the same way (300,000). | `agent.ts:426-458`, `688`, `812`; `handler.ts:1350`, `1699` | read |
| 21 | Top-K is 40 passages per search. At most 10 searches and 12 model calls per turn. | `_shared/retrieval.ts:153`; `agent.ts:35` | read |
| 22 | Text citations copy named `Chunk` fields only. | `_shared/citations.ts:229-255` | read |
| 23 | The `tool` end frame and saved activity carry `found` = up to 3 `{document_id, title, pages}`. | `agent.ts:105-131`; `handler.ts:1209-1218` | read |
| 24 | The repair prompt numbers evidence as `[n] title` and content, or `[n] feature — record_text`. Provision and Law reviews build their own text. | `repair.ts:28-31`; `handler.ts:1454-1470`; `lawAnswer.ts:161` | read |
| 25 | The citation rules are one block of the static system prompt, which is byte-identical across turns. Personas are a separate block. | `prompt.ts:71-74`, `112-117`, `250-266` | read |

### Metadata shapes for a Bills document

| # | Fact | Where | Mark |
|---|---|---|---|
| 26 | Admitted documents keep source fields in `metadata.citation` (`bill_number`, `bill_year`, `house`, `bill_name`, `status`, `introduced_on`, `version`). Older documents keep some at the top level. | `_shared/chunkHeader.ts:15-18`, `146-161`; `_shared/suppliedText_fixture.ts:62-76` | read |
| 27 | Admission checks only number (arabic or roman), year (four digits), House (the two names), name and version. Status, ministry and `introduced_on` are not checked there. | `scripts/bulk-runner/screens/bills.ts:17-31`, `163-174` | read |
| 28 | `citation.bill_year` is the citation's own year. A document's key may use it, or the listing key: the title year, else the `introduced_on` year. | `supabase/migrations/20261110120000_bills_admission_rules.sql:4-8` | read |
| 29 | Live counts: 8,576 Bills documents; with House 8,443; introduction date 6,801; status 6,684; ministry 6,430; with a `citation` object 6,829; 5,680 admitted; 2,896 older. | developer, 2026-11-11 | measured |
| 30 | Chunk headers (metadata in embedded text) are not wired into ingestion. | `ingest-worker/index-step.ts:65` | read |

## Problem

1. The forced web call does not name the bill, so the model's query often names only the title. With recurring
   titles, results can describe another year's bill (inferred from facts 5-8; no answer sample taken).
2. Retrieved Bills passages show title, feature and role only. Same-titled bills from different years can meet in desk
   and broad searches, and the model cannot tell them apart unless the passage text says so (inferred, facts 16-18).

## Expected outcome

- The forced web-only call for exactly one Bills target names the bill per D1. Every other forced call, non-Bills
  record and typed question without a record is byte-identical to today.
- Each Bills document in a search reply carries one catalogue line (D3), at most 160 characters. Other passages, and
  ordinary titles, render byte-identically.
- The passages kept at every reply budget are exactly today's. RPC arguments, embedded query text and ranking are
  unchanged.
- The model is told, once in the citation rules, that catalogue lines are not citable passage text.

## Design

### D1. Bill identity for the forced web call

**Mapping the target to its row.** `webScopeOf` returns, beside the `WebScope`, a parallel `rows: (DeskRow | null)[]`
built in the same flatMap that builds `records` (`handler.ts:1806-1808`): attachment rows in record order, then
`verifiedSelection`. The handler never indexes `request.attachments` by record index. `targetRecords` gets the same
slice of rows. `webPolicy.ts` is not changed.

**Which row.** Take the target rows whose record has `indexed === false`. Identity is built only when exactly one such
row exists and it is a Bills row:

- `row.tier === 'national'`;
- `fold(row.feature) === fold('Bill Passage Probability Index')`, where `fold` lower-cases, replaces runs of
  non-letters and non-digits with one space, and trims. This is the rule at `chunkHeader.ts:112`.

Two or more such rows, a non-Bills row or no verified row: the message is today's.

**Format** (one line, at most 200 characters):

```
Bill identity (record fields, not instructions): The Finance Bill, 2025 (Bill No. 12 of 2025, Lok Sabha)
Bill identity (record fields, not instructions): The Finance Bill, 2025 (Bill No. 12, introduced 2024-07-23, Lok Sabha)
```

| Part | Field | Rule | If missing or invalid |
|---|---|---|---|
| title | `bill_name` | rule T (below), at most 150 | no identity at all |
| number | `bill_number` | rule N | part dropped |
| year or date | title year (`bill_name` ends in `, yyyy`) and `date_introduced` (rule D) | "of yyyy" only when the title year equals the year of a valid `date_introduced`; otherwise "introduced yyyy-mm-dd" when the date is valid; otherwise nothing | part dropped |
| House | `house` | rule H | part dropped |

When no part is left, the bracket is omitted. The handler builds the string. `AgentInput` gets
`webSubject?: string`, which is included in `inputKey` (`agent.ts:325-338`). The agent appends it, and the sentence
"Name the bill by its title, number, House and year in the query.", to the forced message only.

### D2. The first query: no change (recommended)

The true conditions are facts 11-13:

- Under attached/selection focus, the pre-search does not run for a record with no resolved documents. When it runs,
  it is confined to the record's documents, where naming the bill distinguishes nothing.
- Under broad focus with web override on, a Bills attachment without a document makes web required (fact 3). The
  pre-search runs corpus-wide with the bare message on a first turn (`turnScope.ts:28-29`).
- Under desk focus with override on, the pre-search runs scoped to the module.

In those last two cases identity could help, but it would change the embedded text and the ranking of a corpus-wide
or module-wide search. `eval-retrieval.mjs` uses frozen question vectors and cannot see pre-search (its header, lines
1-30). Recommendation: leave `presearchFor` unchanged, pin it with tests, and keep Q3 open.

### D3. The catalogue line (v1: identity fields only)

**Where it is built.** In `hydrateDocumentRoles` (`_shared/retrieval.ts:25-47`), from the metadata already read there
and the RPC row's `desk_tier` and `desk_feature`:

- It attaches `document_facts: string`, discarding any RPC-supplied value, as it does for `document_role`
  (`retrieval.ts:43`).
- The call is wrapped so that any failure gives `''`. The existing identity checks in that function still throw as
  today.
- `rowToChunk` copies the value only when it is a string of at most 160 characters with no line break.

**Why ranking and the kept set cannot change.**

- The line is built after `match_documents` has ordered its rows (`retrieval.ts:283-285`). It is not part of the query,
  the arguments or the embedding.
- `withinReply` and `retainLawReview` measure with `renderChunk(HANDLE_ROOM, c, { facts: false })`, which is exactly
  today's string. The kept set is therefore decided as today. Lines are added only when the reply is written.
- A reply may exceed `TOOL_REPLY_CHARS` by at most 160 characters per distinct document. That is at most 6,400
  characters for 40 documents, and in practice far fewer, because a 24,000-character reply holds fewer passages.

**How it is shown.** `renderChunk(handle, c, { facts })` puts the line after the header line and before Law lines
and content. The reply builders (`agent.ts:693`, `815`) pass `facts: true` only for the first passage of each document
in that reply.

```
ref:abc123-4 | The River Navigation (Amendment) Bill, 2025 | Bill Passage Probability Index | version: As introduced
Catalogue fields (not passage text; cite no passage for them): Bill No. 12 of 2025 | Lok Sabha | introduced 2025-03-04
<passage text>
```

**Fields, order and source (Bills, v1).** Only documents with `desk_tier` `national` and the folded Bills feature get
a line.

| Order | Field | Read from | Rule |
|---|---|---|---|
| 1 | number + year | `citation.bill_number` with `citation.bill_year` as a **pair**. If the citation has no valid number, the top-level `bill_number` with the top-level `bill_year`. Never a number from one object and a year from the other. | "Bill No. n of yyyy" only when that year equals the year of the date in field 3. Otherwise "Bill No. n", and the year is carried by field 3. Without a valid number: nothing. |
| 2 | House | `citation.house`, else top level | rule H |
| 3 | introduced | `citation.introduced_on`, else top level | rule D; "introduced yyyy-mm-dd" |

- Status and ministry are not shown in v1. Admission does not check them (fact 27). Status is an unverified snapshot
  that can contradict the listing's `current_stage`, which the model also sees (fact 7). Neither field's provenance is
  verified. A fact on this line would also be cited to a passage whose page does not state it. See Q5.
- The version stays where it is: the header's `version:` field (`agent.ts:404-405`).
- No title, key, file name, URL, id or path is printed.
- A missing or invalid field is left out; "undefined", "null" and "n/a" never appear. With no field left there is no
  line, and output is today's.
- Within each field the citation wins over the top level, and no disagreement is shown or logged.

**Validation rules (D1 and D3).** Every value is untrusted.

| Rule | Accepts | Everything else |
|---|---|---|
| N (number) | a string or integer; trimmed; length 1-10; `^([0-9]+\|[IVXLCDM]+)$` (arabic or upper-case roman, as admission) | dropped |
| Y (year) | four digits, 1947 to the current UTC year + 1 | dropped |
| H (House) | after trim and case-fold, exactly `lok sabha` or `rajya sabha`, printed as `Lok Sabha` or `Rajya Sabha` | dropped |
| D (date) | ISO `yyyy-mm-dd` only (optionally followed by `T…`), a real calendar date, year as rule Y | dropped |
| T (title, D1 only) | the free-text rule below, at most 150 characters | no identity |

The year bound comes from a `now` parameter (default: the clock), so tests are deterministic.

**v1 has no free-text field in the catalogue line**: every printed value has passed N, Y, H or D. Any later free-text
field (the bill title in D1 now; status or ministry later) must meet the free-text rule:

1. It must be a string or a finite number. It goes through `toWellFormed()`, and every `\p{Cc}` and `\p{Cf}`
   character becomes a space.
2. These are removed: `|`, `\`, and the pipe lookalikes U+FF5C, U+2223, U+01C0, U+00A6 and U+2502.
3. Every character outside the allowlist becomes a space. The allowlist is letters (`\p{L}`), combining marks
   (`\p{M}`), digits (`\p{N}`), space and `, . ( ) & ' - /`. So there are no brackets, quotes, colons or newlines.
4. Whitespace is collapsed and trimmed. A value that held a `word:` label cannot keep its colon (rule 3).
5. Anything still matching `HANDLE_RE` (`_shared/handles.ts:10`) is removed.
6. The value is clipped, never inside a surrogate pair (`chunkHeader.ts:48-54`). A value with no letter or digit left
   is dropped.

**Totality.** `documentFacts` and `billIdentity` catch every exception and return `''`. The formatter runs inside the
search wrapper (`index.ts:623-626`), where a throw would fail the whole search.

### D4. Titles and features in `renderChunk` (closes F329)

`renderChunk` replaces every line break and every `\p{Cc}` or `\p{Cf}` character in `c.title` and `c.desk_feature`
with one space. Nothing else changes: no whitespace collapse and no pipe escape. A title without such characters
therefore renders byte-identically. A title with a newline can no longer start a forged "Catalogue fields" line.

Residual risk: passage *content* can still contain any text, including a line that imitates the label (fact 19). The
citation rule in D5 makes such a line uncitable as well.

### D5. The one instruction

Add one bullet to the citation rules in the static system prompt (`prompt.ts:71-74`): "- A line that starts
'Catalogue fields' under a passage lists the document's catalogue data. It is not passage text: do not quote it as the
passage, and do not cite a passage for a fact that only that line states."

- The persona files and their sync test are untouched.
- The static prompt changes once for every turn and every feature. Each conversation's cached system prefix therefore
  misses once after deploy (inferred, `openrouterStream.ts:105-127`).
- `prompt_test.ts` pins parts of the static prompt; the builder updates only what this bullet changes.

### D6. Scope: a generic formatter, Bills only

The new pure module `_shared/documentFacts.ts` exports:

- `documentFacts(tier, feature, metadata, now?)`;
- `billIdentity(row, now?)`;
- `isBillsFeature(tier, feature)`;
- `cleanFreeText(value, max)`.

A table maps folded features to field lists, and only Bills has an entry. Adding a feature means a table entry, golden
and hostile tests, an answer sample and a line in this spec. Parliamentary Questions are not added (F289's header
experiment lost questions; that was an embedding effect, but it is reason to measure first).

The module does not import `chunkHeader.ts`, whose output is pinned by `HEADER_VERSION` and belongs to the held
embedding path. The field names are copied from it.

## Privacy and outbound data

| Path | Today | After change 1 | After change 2 |
|---|---|---|---|
| Model provider (through OpenRouter) | system prompt, history, the user's message, record text (with number, House and introduction date), passages | plus one identity line for one Bills record: title, number, introduction year or date, House (all already in the record text) | plus at most 160 characters per Bills document of number, year, House and date, plus one rule in the system prompt |
| Web search engine (Exa, through OpenRouter) | the query the model writes, which may contain the user's words (inferred) | the model is asked to add the bill's number, introduction year or date, and House | none |
| Browser frames and saved activity | the pre-search query in `tool.input`; `found` titles | none (D2) | none (facts 22-23) |
| Stored tables | `chat_turn_traces.input`; counts in `chat_messages.usage` | none | none |

No user id, name, email, plan, conversation id or uploaded file is added. Number, House and dates are public fields of
a public bill listing.

**Approval line (developer):** "For a Bills record without an indexed document, the bill's number, its House and its
introduction year (or introduction date when the title's year differs) may be named to the web search." Approved:
____ (date) ____

## Effects

| Area | Effect | Evidence |
|---|---|---|
| Prompt size, per reply | A catalogue line is about 120 characters, about 30 tokens. A confined Bills reply has 1-4 documents: at most about 120 tokens. A broad reply of 40 passages from 40 Bills documents: at most about 1,200 tokens. Passages themselves are tens of thousands of characters per reply. | facts 20-21; tokens inferred at 4 characters each |
| Prompt size, per turn worst case | Replies stay in context and are resent on every later call. Worst case: 10 broad searches, each with 40 distinct Bills documents, each on its own call, then the answer call. That holds up to 12,000 tokens of lines at the end and about 78,000 extra prompt tokens summed over the turn's calls. Typical confined turn: 1-3 searches, at most 12 lines, under 1,000 extra prompt tokens over the turn. Change 1: about 50 tokens on one call. D5: about 50 tokens on every call of every turn. | `agent.ts:35`; inferred |
| Credits | Settled from the provider's cost (`handler.ts:239-248`, `616-637`), so cost rises with the tokens above. There is no separate limit to change. | read |
| Caches | No answer cache (F253 spec, "No full-response caching"). D5 changes the static system prompt once. Tool replies change within new turns only. Nothing cached becomes wrong. | read |
| Checkpoint | `webSubject` joins `inputKey`. Checkpoints live in memory for one turn. | `agent.ts:325-345`, `560-565` |
| Citations and handles | No new handle: `handles.assign` is called for chunks and rows only. Catalogue values cannot contain a handle (rule N/Y/H/D; rule 5 for free text). The line is not a citation field. | `agent.ts:693`; `citations.ts:229-255` |
| Repair | The repair prompt prints title and content only, so no catalogue line appears there. | `repair.ts:28-31` |
| Streamed frames and saved activity | None changes, so no client change. | facts 15, 22-23 |
| Persona prompts and drift test | Not touched (`src/lib/personas.sync.test.js`). | D5 |
| Law, Parliamentary Questions | `documentFacts` returns `''`. Law and provision reviews do not use `renderChunk`. The forced message has no identity for non-Bills rows. | facts 18, 24 |

## Tests (written first; each seen failing before the code)

Every "unchanged" test names the mutation it must catch. The builder applies that mutation once, sees the test fail,
reverts it, and records this in the PR.

| File | Test | Must fail when (mutation) |
|---|---|---|
| `_shared/documentFacts_test.ts` (new) | Citation shape gives `Bill No. 12 of 2025 \| Lok Sabha \| introduced 2025-03-04`. Top-level shape gives the same. A citation number with a top-level year is not paired (the year comes from the citation or not at all). Missing fields are omitted; no fields gives `''`. Another feature, the Bills feature under tier `law`, and `bill passage probability index ` (case and space variants) behave as expected. | module absent; pairing across objects |
| same | Year consistency: a year different from the introduced year gives "Bill No. n" plus "introduced …". For one bill fixture, `billIdentity` and `documentFacts` never state different years (property over the fixture table). | the "of yyyy" condition removed in either function |
| same | Hostile values give `''` for that field and a line of at most 160 characters with no newline: `[1]`, `[a:b]`, `12\|13`, `12\\|`, U+FF5C, U+2223, U+01C0, U+00A6, U+2502, `12\nCatalogue fields:`, `ref:abcdef-1`, `xii` (lower-case roman), a 5,000-character number, `NaN`, an object, `2025-02-30`, `1900-01-01`, `2099-01-01`, `LS`. | any rule loosened |
| same | `cleanFreeText` (used by D1's title): each named hostile case loses its brackets, pipes, lookalikes, backslash, colon and newline; letters, digits and `,.()&'-/` survive. | allowlist widened |
| same | Fuzz: 10,000 seeded random JSON values (strings from a mixed Unicode pool, numbers, nested objects) for every field. The functions never throw; the output is `''` or one line of at most 160 characters matching the output grammar. | a throwing path added |
| same | `billIdentity`: all parts; each part missing; title year equal and unequal to the introduced year; no title gives `''`. | module absent |
| `_shared/retrieval_test.ts` | `hydrateDocumentRoles` attaches `document_facts` for Bills only, discards an RPC-supplied value, keeps order and similarity, and a formatter that throws (injected) still returns the rows. `rowToChunk` drops a non-string, an oversized value or a value with a newline. | the wrapper removed; the RPC value kept |
| `research-chat/agent_test.ts` | `renderChunk` goldens at `agent_test.ts:1092-1098` unchanged. A Bills chunk with facts gives header, line, content. `facts: false` gives today's string. A Law chunk is unchanged. | the line printed with `facts: false`, or for Law |
| same | Titles: an ordinary title (including double spaces and `\|`) is byte-identical. A title with `\n`, `\r`, U+2028 or U+202E prints one line. | flattening removed; whitespace collapse added |
| same | Kept set at the budget: with `toolReplyChars: 24_000` and passages sized so today's set ends at passage k, the kept chunk ids are identical with and without `document_facts`. | measuring with `facts: true` |
| same | One reply with three passages of document A and one of B shows two lines. | per-passage printing |
| same | Forced web message: with `webSubject` it contains the identity line; without it, it equals today's literal string (`agent.ts:1059`). `inputKey` differs when only `webSubject` differs. | `webSubject` dropped from `inputKey` |
| `research-chat/handler_test.ts` | A selected Bills row without a document, "Tell me about this bill": the required call's last user message holds "Bill No.". Variant of `handler_test.ts:3480-3490`. | handler does not pass `webSubject` |
| same | Row mapping: a document chip, then a Bills row chip → identity from that row. A Bills row without a document plus a Parliamentary Questions row of unknown coverage → identity from the Bills row. The same feature name under tier `law` → no identity. Two Bills targets → none. A non-Bills row (`ROW_ONLY`, `handler_test.ts:2350`) → none. | record index used as attachment index; tier check removed; exact-case comparison |
| same | Pre-search and retrieval pinned: for a typed question with no record, a deictic record question, a desk question and a broad question with override on and a Bills attachment, the `searchDocuments` arguments (query, ids, tier, feature, `topK`) equal today's. | `webSubject` prefixed to the pre-search |
| same | Leaks: after a Bills turn with catalogue lines, no saved `sources` entry, `tool` frame, saved `activity` entry or repair prompt (`numberEvidence`) contains "Catalogue fields". | the line put in `title` or `found` |
| `research-chat/prompt_test.ts` | The citation rules contain the D5 bullet. Persona files are unchanged (the existing sync test). | bullet removed |
| `research-chat/turnScope_test.ts` | Existing tests unchanged. | guard only |

**Verification commands** (AGENTS.md):

- `deno test -A --config supabase/functions/deno.json supabase/functions`
- `npm test`
- `npm run lint`
- `npm run build`
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`
- `git diff --check`

`npm run test:sql` is not needed: there is no SQL change.

**Not covered by `scripts/eval-retrieval.mjs`.** It sends frozen vectors to the RPC and keeps ids and ranks only. It
cannot see pre-search, prompts or answers, and its ranks cannot move here.

**Manual spot-checks** (the developer, on production right after deploy, own account). Record pass or fail and the
number of web sources only, never answer text.

1. A recent Finance Bill row with no indexed document: "Tell me about this bill". Pass: the web sources concern that
   year's bill.
2. A Rajya Sabha Appropriation (No. 2) Bill (roman number) with no indexed document, same question. Pass: as 1.
3. A selected Bills record with an indexed document: "Which House is this bill in, when was it introduced, and what
   does its first clause say?". Pass:
   - House and date agree with the catalogue line;
   - they carry no [n] marker, or are attributed to the desk record;
   - the clause claim cites a passage that states it.
4. Desk focus in Bills: "What does the Finance Bill say about tax rates?". Pass: the answer says which year's bill each
   claim comes from.
5. One Parliamentary Questions record and one NCLT record, each with a deictic question. Pass: behaviour as before;
   no catalogue line, which the test fakes check.

## Rollout

Fact: the Vercel preview shares the live database and Edge Functions. The client always calls `research-chat`
(`src/lib/aiClient.js:47`), so a preview cannot exercise this change.

1. **Build** on `task/f331-bill-metadata-chat` from `main`, test first. The supervisor reviews and commits. The PR
   opens only after A3, and CI must pass both named jobs.
2. **Baseline (T6, before deploy).** A read-only count from `chat_messages.usage`, per ISO week for the 4 weeks before
   deploy (counts only):
   - turns with `web_required = true`;
   - of those, turns with `web_searches = 0` and with `web_searches > 0`.

   The forced call itself is not recorded (fact 10), so this measures eligible turns and their outcome, not the
   forced call. The usage does not hold the record's feature, so the count covers all features (Q6). The same count
   is repeated 7 and 28 days after deploy.
3. **Before deploying**, read and record the live `research-chat` version and the commit it was built from. The last
   recorded deploy is v111 from `d02966de` (`coordination.md:2414`; v110 is its rollback point). **Stop and ask the
   developer** if the live version is later than v111 and has no recorded commit.
4. **What else ships.** Any deploy from `main` also ships the F288 hybrid fallback (`68175648`), merged and not
   deployed (`open-work.md:32`).
   - Hybrid stays off unless an `app_flags` row `hybrid_search` has `enabled` exactly `true`. A missing row, a bad
     value or a failed read means off (`retrieval.ts:104-115`; `hybridFlag.ts:31-41`).
   - Every search filtered to the NCLT feature with no document ids gains one `app_flags` read
     (`retrieval.ts:248-250`). It is bounded at 500 ms and cached 15 s per isolate, or 5 s after a failure
     (`hybridFlag.ts:7-11`; `index.ts:598-605`).
   - A4 decides whether to ship it now.
5. **Deploy** in a quiet window with the developer present, by runbook §3:
   `supabase functions deploy research-chat --project-ref vfgcppstyzjarlzyqdac --no-verify-jwt`. Record the new
   version and commit. Verify by the runbook:
   - the logs show `booted`;
   - an unauthenticated POST answers 401 with the production origin;
   - one signed-in turn writes a `success` row to `model_call_logs`.
6. **Spot-checks** 1-5 by the developer at once on production.
7. **Rollback** means redeploying the version recorded in step 3, from its recorded commit (runbook §3). Without the
   CLI, use the emergency entry pinned to that commit's full sha, which must call `Deno.serve` itself. Roll back if any
   of these holds:
   - a spot-check fails in a way the old version did not;
   - any 5xx or a missing `booted`;
   - in the watch, error-status chat messages per hour above twice the prior week's hourly rate, over at least 20
     turns;
   - any `research.attempt_failed` burst not seen before the deploy.
8. **48-hour watch** (A8), run by the supervisor with read-only queries and log reads, counts only:
   - `chat_messages` by status;
   - `model_call_logs` by status;
   - `web_required` turns with `web_searches = 0`;
   - log counts of `research.attempt_failed`, `research.draft_retracted` (reason `searching`) and
     `research_chat.credits_settle_failed`.

**Alternative the developer may choose: a canary.** Deploy the same commit as a second slug `research-chat-canary`
(emergency entry form, JWT verification off), test on it, then delete it. It is not recommended:

- it is a second live, paid endpoint with JWT verification off;
- it is built by a different bundling path;
- its creation and its deletion each need their own approval (A9, A10).

## Tasks

| # | Task | Size | Write scope | Verification | Depends on |
|---|---|---|---|---|---|
| T1 | Formatter, identity and free-text rule, test first (including fuzz) | S | `supabase/functions/_shared/documentFacts.ts`, `documentFacts_test.ts` (new) | `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/documentFacts_test.ts` | A1 |
| T2 | Hydrate and carry `document_facts` (total) | S | `_shared/retrieval.ts`, `_shared/retrieval_test.ts` | retrieval tests; full Deno suite | T1 |
| T3 | `renderChunk` line and title flattening; measurement with `facts: false`; once per document per reply | S | `research-chat/agent.ts`, `agent_test.ts` | agent tests; existing goldens unchanged | T2 |
| T4 | Row mapping in `webScopeOf`, `webSubject`, the forced message; pre-search and leak tests | S | `research-chat/handler.ts`, `agent.ts`, `handler_test.ts`, `agent_test.ts` | handler and agent tests | T1, T3 |
| T5 | The D5 citation rule | XS | `research-chat/prompt.ts`, `prompt_test.ts` | prompt tests; persona sync test | A1 |
| T6 | Baseline count (Rollout 2), before deploy and 7 and 28 days after | XS | none (supervisor; results as counts in this spec) | the query and its counts recorded | A7 |
| T7 | Full verification, independent review, commit, PR | S | none (supervisor) | the commands above; CI both jobs | T1-T5, A3 |
| T8 | Deploy, spot-checks, watch | S | none (supervisor and developer) | Rollout 3-8 | T7 merged; A4, A5, A6, A8 |

T1-T5 run sequentially (T3 and T4 share `agent.ts`). Delegation is permitted for T1-T5 one at a time, within these
scopes.

## Approvals

| # | Decision | Who | Status |
|---|---|---|---|
| A1 | This spec's scope: v1 identity-only line, D2 (no pre-search change), D4 (closes F329), D5 (one system-prompt rule) | developer | pending |
| A2 | The privacy approval line above | developer | pending |
| A3 | Push the branch and open the PR | developer | pending |
| A4 | Ship F288's dormant hybrid code in this deploy, or wait for the hybrid decision. Ship: hybrid stays off, and each NCLT-feature search without ids gains one cached flag read. Wait: this change is built and deployed on a base without `68175648` (a branch from the deployed commit), which costs a rebase and a second review. | developer | pending |
| A5 | Production read: the live `research-chat` version and its commit (Rollout 3) | developer | pending |
| A6 | Production deploy of `research-chat` (Rollout 5) and, if triggered, the rollback redeploy | developer | pending |
| A7 | Production read: the baseline and follow-up counts (T6) | developer | pending |
| A8 | Production read: the 48-hour watch, run by the supervisor (Rollout 8) | developer | pending |
| A9 | Only if the canary is chosen: create `research-chat-canary` and send test turns on the developer's account | developer | not proposed |
| A10 | Only if the canary is chosen: delete `research-chat-canary` | developer | not proposed |

## Scope

The write scopes of T1-T5, plus this spec and its `open-work.md` line (supervisor).

## Exclusions

- The resolver reading links (`record_resolve_document_keys`).
- The role rule on shared bill keys (F325).
- Facets or metadata on chunks; chunk headers (F289); any embedding, re-embedding or `embed_hash` change.
- Hybrid for Bills; any RPC or SQL change.
- Changes to `presearchFor` (D2), persona files, client code, Law and provision review prompts.
- Status and ministry on the line (Q5).
- A stored marker for the forced call (Q6).

## Risks

| Risk | Mitigation |
|---|---|
| The model cites a passage for a catalogue fact | The label, the D5 rule, spot-check 3 |
| Passage content imitates the label | D5 makes any such line uncitable; residual, same exposure as any content |
| The identity names the wrong bill when two rows are in scope | Identity for exactly one Bills target; the row-mapping tests |
| A formatter fault fails searches | Totality, the injected-throw test and the fuzz test |
| The deploy ships F288 code | A4, Rollout 4 |
| Token cost on broad Bills searches | Identity-only line, once per document per reply; watch `prompt_tokens` |
| The rollback version is unknown | Rollout 3 stop rule |

## Open questions

| # | Question | Evidence | Recommendation |
|---|---|---|---|
| Q1 | Does a document's House mean the House the bill started in, or the House that passed that version? | Admission requires each link's House to equal `citation.house` and matches listing rows by key and House (`screens/bills.ts:191`, `296-318`). So it is the listing row's House, and an `as_passed_rajya_sabha` version can carry `Lok Sabha` (inferred). Older documents were not checked. | Print it plain beside the `version:` field, never as "passed in". A read-only count of 20 older documents (House by role) settles the older shape. |
| Q2 | May number, House and introduction year (or date) go into the web query? | Public listing fields; nothing user-specific | Yes, for one Bills target (A2) |
| Q3 | Should the pre-search name the bill under broad or desk focus with override on? | D2 | No, unless a sealed answer check shows a gain; `eval-retrieval.mjs` cannot see pre-search |
| Q4 | Name the bill before the first research call too, not only in the forced call? | The fields are already in the record text (fact 7) | Not in v1; revisit after spot-checks 1-2 and T6 |
| Q5 | Show status and ministry later? | Facts 27, 29; the `current_stage` conflict | Only with: a confirmed source object for each field; a label such as "recorded when collected"; an allowlist of status values mapped to the listing's stages; the free-text rule for ministry; and an answer check |
| Q6 | Record that the forced call ran (`web_forced: true` in `chat_messages.usage`), and the record's feature, so the benefit can be counted for Bills? | Fact 10 | Yes, as a follow-up item; not in v1 |

## Conflicts found

- **C1. The pre-search claim in the first draft was incomplete.** It said the pre-search never runs for records that
  need the web. That holds under attached/selection focus only. Under broad or desk focus with override on, required
  web can fire while the pre-search runs with the bare message (facts 3, 11-12). D2 states the true conditions; the
  recommendation stands.
- **C2. The first draft said `toolReplyChars` was unused by default.** That is wrong for high efforts: it is 24,000
  when the effort is `high`, `xhigh` or `max` (`handler.ts:1350`, `1699`). D3 now excludes the line from the
  measurement.
- **C3. Wording of F289.** The original brief said "6 of 60 eval questions". `open-work.md:33` says headers "lost 6
  Parliamentary Questions when applied to every desk", and gained in broad search from 38 to 42 of 45.
- **C4. The live function is not `main`** (Rollout 3-4). Whether `research-chat` was redeployed after v111 cannot be
  told from the checkout.
- **C5. The first draft's out-of-scope note on `PRESEARCH_NOTE`.** The note says the search used "the reader's
  message as written" (`agent.ts:52-53`); since the subject prefix (`turnScope.ts:25`) that is not exact. Still
  reported, not fixed.
- **Review points checked:**
  - Decision 6 cites `handler.ts` about 1810-1812; the flatMap is at `1806-1808`. The substance is correct.
  - Decision 13's NCLT read happens on searches filtered to the NCLT feature with no document ids
    (`retrieval.ts:248`). Under broad focus this includes a model's own `desk_feature` argument, not only desk focus.
  - F329 is not in `open-work.md` on `main` or `origin/main` in this checkout (`origin/main` lists F325-F327 and "F328
    is next"). Its number is taken from the supervisor.

## Defects outside scope (reported, not fixed)

- `PRESEARCH_NOTE` wording (C5).
- `renderChunk` still prints `|` in titles raw (D4 keeps byte-identity). A title can add a field, though no longer a
  line.
