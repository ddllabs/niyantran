# First successful production research turn — findings and scoped tasks

**Date:** 2026-09-22
**Status:** Historical (2026-09-28). R1–R4 were executed on 2026-09-22 (see the execution record) and R5 in `cff88fa`.
> By 2026-09-28 C4 was done and E1 was partly done (email delivery remains under D2). E2 phase 3 and the two
> live-turn checks at the end are tracked as D3 in `docs/plans/2026-09-28-remaining-work.md`.
**Source turn:** conversation `a80e9696-8f64-41b6-9f02-627b0086cec7`, assistant
message at 2026-09-21 18:40:51Z, `status = complete`, 2,342 characters,
$0.004547 across 18,256 tokens.

The first research turn ever to complete in production. The pipeline worked:
turn claim, persistence, streaming, follow-ups, cost accounting and the answer
itself are all correct, and the answer is factually grounded in the attached
rows. Four defects were found in the trail behind it. Only R1 breaks a product
promise; the rest are correctness-of-reporting and cost.

## What the turn actually did

| | |
| --- | --- |
| Tool calls | **none** — `chat_turn_traces` holds one step, `type = answer` |
| `search_ms` | **0** |
| `sources` | **`[]`** |
| Model calls | 2 × `chat_answer`: research 8,655 → 110 tokens (5.4 s), answer 8,591 → 900 (6.5 s) |
| Cached prompt | 16,886 of 17,246 |
| `reasoning_tokens` | **0**, against `reasoning_ms` 9,874 |

**No retrieval ran, and that is correct.** Focus was "Attached only", so the
agent was scoped to the attached rows, which were already in the prompt. Nothing
was wrong with document scoping or metadata filtering because neither executed:
`scopedDocumentIds` was resolved and never used. The corpus of 51,064 chunks was
not consulted.

The attachments did reach the model. The answer names Russia–Ukraine,
Armenia–Azerbaijan, Moldova–Transnistria and Israel–Hezbollah, all real rows of
the 88-row Open Fronts feature, and describes them accurately.

---

## R1 — `record_text` leaks the row key, so citations never resolve

**Severity: high. This is the one that breaks the product.**

### Evidence

The model emitted `[open-fronts:russia-ukraine-war:0]`. That string is not an
invention: it is the exact `desk_rows.row_key`, and it is handed to the model
inside the row's own text. The stored `record_text` for that row ends:

```
entityName: Russia–Ukraine War
id: open-fronts:russia-ukraine-war:0
eventDate: 2022-02-01
```

Corpus-wide: **14,550 of 34,184 desk rows (42.6%)** contain their own `row_key`
as an `id:` line in `record_text`.

The system's citation handle is a different shape entirely —
`HANDLE_RE = /ref:[a-z0-9]{6}-\d+/` — unbracketed and nonce'd. The model emitted
zero handles, so `handlesIn()` returned nothing, the citation ladder resolved
nothing, `sources` persisted as `[]`, and the browser rendered no bubbles. The
bracketed keys remain in the prose as literal characters.

### Root cause

`rowRecordText` in `src/lib/sourceUrls.js` serialises every scalar field of a row
as `${key}: ${value}`. Its `skip` set excludes `members_json`, `timeline`,
`record_text` and others, but **not `id`**. Any field named `id` is therefore
printed with a label that reads, to a model, exactly like a citable identifier.

This is the failure `_shared/handles.ts` anticipated in its own header:

> The model cites a handle, never an id: a UUID in the prompt gets imitated into
> the answer. Handles are unbracketed (a bracketed one looks like a `[1]` marker
> and small models copy it into prose).

The author predicted UUID leakage. The actual leak is `row_key`, through the same
door. **This is a data-shaping defect, not a prompt-tuning one** — a better model
would guess better, but the prompt is offering a plausible identifier and
labelling it `id:`.

### Fix

Exclude identifier fields from `rowRecordText`. At minimum `id`, `record_id`,
`row_key`, `__key`, and anything whose value equals the row's own pin key. The
Deno mirror in `_shared/deskRows.ts` must match, and the two have a parity test
already.

`record_text` is a stored column on 34,184 rows, so this needs a regeneration
pass, not only a code change. That pass rewrites `desk_rows.record_text` and is a
data migration under `AGENTS.md`: it needs its own authorization.

### Acceptance

- No desk row's `record_text` contains its own `row_key`; corpus count goes
  14,550 → **0**.
- A turn over attached rows emits `ref:` handles and persists a non-empty
  `sources` array, with bubbles rendering.
- Parity test between `src/lib/sourceUrls.js` and `_shared/deskRows.ts` passes.

### Vacuity

Restore `id` to the serialised output and the new test must fail. A test that
passes with the leak restored is asserting nothing.

---

## R2 — a greeting produces a full brief

**Severity: medium. A deviation from the E2 acceptance scenario.**

`"hi"` returned 2,342 characters and **three follow-up chips**. The E2 runbook's
first paid scenario is explicitly *"greeting (no retrieval, no follow-up
chips)"*. With four attachments and an evidence-first persona, the model read a
bare greeting as an instruction to summarise everything it had been handed.

The turn is not wrong — it is grounded and accurate — but it is not the specified
behaviour, and it spends $0.0045 answering a greeting.

### Fix

A conversational turn with no question should be recognised before the research
phase and answered briefly, with no follow-ups, regardless of attachments.

### Acceptance

`"hi"` with attachments present returns a short greeting, `follow_ups = []`, and
at most one model call. A substantive question with the same attachments still
produces the full grounded brief.

### Vacuity

Remove the greeting branch and the test must fail with the long answer returning.

---

## R3 — the UI attaches the same feature repeatedly

**Severity: medium, cost-bearing.**

The panel showed **four identical "Open Fronts" attachments**, each labelled with
the feature name rather than a distinct row title. Duplicates are sent to the
model and inflate the prompt; at 8.6k prompt tokens per call, duplicated context
is paid for on every turn of the conversation.

### Fix

Deduplicate attachments by their identity before sending, and label a row
attachment with the row's title rather than its feature.

### Acceptance

Attaching the same feature or row twice yields one attachment. Two different rows
of the same feature yield two, distinctly labelled.

---

## R4 — activity labels report work that did not happen

**Severity: low, but it is the UI telling the user something untrue.**

The turn displayed *"Searching relevant sources."* and *"thought 9.9s"*. Neither
is accurate:

- No search ran. `chat_turn_traces` holds one `answer` step and `search_ms = 0`.
  The label is emitted per **attempt phase** in `handler.ts`, not per tool call,
  so the research phase announces searching even when it calls no tool.
- `reasoning_tokens` is **0**. The 9.9 seconds were the research phase deciding
  not to search. The UI presents latency as thinking.

### Fix

Emit the searching label when a search tool actually starts. Report reasoning
time only when reasoning tokens were produced; otherwise label it as elapsed
time.

### Acceptance

A turn that calls no tool never displays "Searching relevant sources." A turn
with `reasoning_tokens = 0` does not claim thinking time. A turn that does search
still shows both.

---

## Order

R1 first and alone — it is the only one that breaks a stated product promise, and
its data-migration half needs owner authorization before anything is regenerated.
R4 is nearly free and makes the next diagnosis honest. R2 and R3 are ordinary
product work.

R1's code change and its `record_text` regeneration should be separate commits:
the first is reviewable in isolation, the second rewrites 34,184 stored rows.

---

## Execution record — 2026-09-22

All four executed. Gates after: **549 Vitest**, **331 Deno**, build passes.

| | Commits | Deployed |
| --- | --- | --- |
| **R1** code | f57ef84 | — |
| **R1** data | eca4c11, d3fce0a | 34,184 rows rewritten |
| **R4** | ab48f1c | `research-chat` |
| **R3** | cf35631 | browser only |
| **R2** | e81ae49 | `research-chat` |

### R1 — closed, three doors not one

`renderDeskRows` printed the `row_key` beside the handle; `rowRecordText` omitted
`id` from its skip set in both the client copy and the Deno mirror; and the
stored column carried the line on every row. Live now reads **0** rows with an
`id`/`record_id`/`uuid`/`row_key` line and **0** leaking their own key, across
34,184 rows, 34 features, 0 blank.

Safety was established before any write: all 34,184 keys are pin-derived from the
row's `id` **field**, `hash_derived_keys = 0`, so the text cannot influence
identity. The fixture confirmed it independently — 9 of 12 cases changed
`record_text` with every `row_key` and `document_key` unchanged.

**Two defects in the migration script itself, both found by running it.** Writes
were one PATCH per row: 5.4% in ten minutes, about three hours projected. And
pagination ordered by `row_key` alone, which is unique only within
`(tier, feature)` — 34,184 rows share 22,998 keys — so ties reshuffled between
offset pages and **five rows were never visited**. The script reported
`still_leaking_after: 0` truthfully and uselessly: it had not looked at them. Only
an independent database query caught it. A self-report can only speak about what
the code looked at.

### R2 — the contract existed; it was not enforced

`prompt.ts` already instructs, twice: *"For greetings and small talk, do not call
a tool and return `"sources": [], "follow_up_questions": []`."* The model obeyed
the no-tool half — one `answer` step, `search_ms` 0 — and returned three chips and
a 2,342-character brief anyway. Not a missing feature: a small model not
following an instruction, with four attachments dominating its context.

The server now decides what it can: a greeting carries no attachments into the
prompt, and persists no follow-ups whatever the model returns. Detection is
exact-match against a short list after normalising case, whitespace and
surrounding punctuation, bounded by word and character count, with anything
containing `?` excluded — because a false positive answers a real question as
small talk, which is far worse than a greeting getting the full treatment.

### R3 — dedupe that could never match

Both stores built the "already attached" set from `a.id` while keying incoming
items on content. Every stored attachment is given a generated id on insert, so
the two sides never matched: dedupe worked **within** a drop and never **across**
drops. Identity is now content — kind, title, tab, feature, url, text length —
shared by both stores.

### R4 — the ticker no longer claims work

The searching label was emitted per attempt phase, so the research phase
announced searching even when it called no tool; it now says "Reviewing the
question." and the searching label is emitted when a search actually starts.
`reasoning_ms` is residual time and was labelled "thought" unconditionally; it now
says "thought" only when the model reported reasoning tokens, "waited" otherwise.

### Checked and not a defect

`aiDrop.js` creates `kind: 'feature'` and `'tab'`, which `validate.ts` does not
accept. `AiPanel.jsx` maps them: `kind === 'row' || kind === 'record' ? kind :
'file'`. Nothing is dropped.

### Still open

E2 phase 3 (the admin promotion and the five paid scenarios), C4's sliced-commit
path for the last document, and E1.

---

## R5 — invented citation markers are never stripped

Found by the owner's Sudan test, 2026-09-21 19:32:56Z. The turn completed, was
accurately grounded, and still rendered no bubbles — citing
`[open-fronts:south-sudan-instability:0]` throughout.

### R1 held; this is a different defect

The database row's key is `open-fronts:south-sudan-instability:**40**`. The model
cited `:**0**`. It did not copy from the corpus: the stored `record_text` is clean
and carries no `id:` line, verified directly. **The key was minted in the browser.**

`src/lib/recordChecklist.js` synthesises one when a row lacks an id:

```js
out.id = `${feature-slug}:${title-slug}:${index}`;
issues.push({ code: 'synthetic_id', message: 'Id was generated in the app' });
```

Index 0 in the browser's list, 40 in the database's load order. So there is a
**third** source of the identifier beyond `record_text` and the tool block, and it
is generated at render time — no data fix can reach it.

### Attachments are not citable, by design

`buildUserTurn` labels every attachment without a verified server handle:

```
User-supplied attachment (untrusted context; not a source)
```

**An attachment-only turn can never produce citations.** That is the intended
contract, not a bug: citations resolve from handles issued by `search_documents`
or `search_desk_rows`, and this turn ran neither — `search_ms` 0, two `answer`
steps, `search_desk_rows` still **never executed in production, ever**.

So the Sudan test could not have produced bubbles whatever R1 did. The tool path
R1 fixed remains unexercised.

### The actual defect

`_shared/citations.ts` strips markers that resolve to nothing — but only numeric
ones:

```js
export const MARKER_RE = /\[([0-9](?:[0-9\s,–-]*[0-9])?)\](?!\()/g;
```

`[open-fronts:south-sudan-instability:0]` is not numeric, so the ladder never sees
it, the repair pass never considers it, and it reaches the reader verbatim. The
system correctly issued no sources; it simply let the model's invented brackets
through untouched.

This is the more general statement of R1: **the answer must contain no citation
marker that did not resolve, whatever its shape.** R1 removed one way the model
learns a plausible identifier. R5 removes the consequence for every other way,
including identifiers generated in the app that no migration can reach.

### Fix

After the ladder resolves, strip any remaining bracketed token that is neither a
resolved numeric marker nor a markdown link. Bracket-with-colons is the shape to
target; ordinary prose brackets must survive.

### Acceptance

- An answer citing `[feature:slug:0]` with no issued handles renders that text
  with the brackets removed and `sources` empty.
- An answer citing resolved `[1]` markers keeps them and its sources.
- Prose brackets such as `[sic]` and markdown links are untouched.

### Vacuity

Remove the strip and an answer carrying a non-numeric bracketed token must fail
the test.

### Note for whoever runs the next confirmation

Citations need retrieval. Set focus to **broad** (not "Attached only") and ask a
question the corpus can answer, so handles are issued. Dragging a row in and
expecting bubbles tests a path the system deliberately does not offer.

---

## R1 CONFIRMED end to end — 2026-09-21 19:44:04Z

The first production turn ever to run a retrieval tool and resolve citations.
Focus broad, no attachments, `anthropic/claude-sonnet-5`, effort low.

> "Can you tell me about the popular conflicts that are happening right now? Or
> that have happened in the past and have caused significant damage to India"

| | |
| --- | --- |
| `search_desk_rows` | **ran** — `{tier: global, feature: "Open Fronts", query: "India"}`, 7 rows, 130 ms |
| `search_documents` | **did not run** |
| `sources` | **7**, every one `kind: "row"` |
| Markers emitted | `[1]`…`[7]` — proper numeric, **no invented keys** |
| Cost | $0.0763, 29,606 tokens, 3 attempts |
| `reasoning_tokens` | 47 |

**R1 is proven.** With a clean `record_text` and no `row_key` in the tool block,
the model cited the issued handles and the ladder renumbered them 1–7. The
`[open-fronts:slug:n]` behaviour is gone from this path.

### What the citations actually point at

Desk rows, not document chunks. Each source carries `row_key`, `feature`, `tier`,
`snapshot_at` and a full `row_snapshot`. The owner's two screenshots check out
exactly:

| Bubble | Source | `row_key` |
| --- | --- | --- |
| 5 | India — Naxalite (Maoist) | `open-fronts:india-naxalite-maoist:53` |
| 7 | India–Pakistan LoC Tensions | `open-fronts:india-pakistan-loc-tensions:48` |

Both match `sources[4]` and `sources[6]` byte for byte, and the claims in the
prose match those rows' `latest_development` verbatim. The reader panel is
showing the right record.

### The corpus was not consulted, and probably correctly

`search_documents` has **still never executed in production**. The 2,336
documents and 51,064 chunks have never been retrieved from by a live turn.

For this question that is likely the right call rather than a defect: the corpus
is legislative — Bill Passage Probability Index, Regulatory Body Watch,
Parliamentary Question Database, Industry Updates, Budget Utilisation. It holds
no conflict documents. Open Fronts is a desk tracker, and the desk-row tool is
where that answer lives.

So two of the three retrieval paths are now proven in production:

| Path | Status |
| --- | --- |
| Attachments (context, never citable) | proven |
| `search_desk_rows` → structured rows | **proven 2026-09-21** |
| `search_documents` → pgvector chunks | **never run** |

Confirming the third needs a legislative question — a bill, a gazette, a
parliamentary answer — where `match_documents` has something to find. Until then
the corpus ingest, the embeddings, the HNSW index and migration 0014's
`indexed_at` guard remain unexercised by any live turn.

### Cost note

$0.0763 for one Sonnet turn against $0.0046 for the same shape on Gemini Lite —
roughly 17×. Worth knowing before the picker's tier-3 models become a default.

---

## Corpus retrieval proved without a paid turn — 2026-09-22

`search_documents` has still never run in a live turn, but the question it would
answer — does retrieval over the corpus work — did not need one. Taking an
existing chunk's own embedding as the query vector exercises
`match_documents`, the HNSW index and the stored embeddings end to end, at no
cost and with no model call.

Probe: a chunk of *The Finance Bill, 2014*.

| Rank | Document | Similarity | Span |
| ---: | --- | ---: | --- |
| 1 | The Finance Bill, **2014** | **1.0000** | 0–1000 |
| 2 | The Finance Bill, 2019 | 0.8624 | 0–985 |
| 3 | The Finance Bill, 2013 | 0.8377 | 699–1690 |
| 4 | The Finance Bill, 2010 | 0.8209 | 792–1671 |
| 5 | The Finance Bill, 2025 | 0.7874 | 6258–7092 |

Rank 1 at exactly 1.0000 is the probe finding itself, which is the sanity check:
the index returns the vector it was given. Ranks 2–5 are semantically adjacent
documents in descending order with real character offsets. **The corpus, its
embeddings and the vector index all work.**

What this does *not* prove: the agent choosing to call `search_documents`, the
citation ladder over chunk sources, and the reader opening a document at a chunk
span. Those still need one legislative question through the panel.

Migration 0014's `indexed_at` guard is present in the deployed function
(`position('indexed_at' in prosrc) > 0`), and no chunk currently belongs to an
unindexed document, so the guard cannot be exercised live without creating that
state deliberately. It is proved non-vacuously instead by
`corpus_revision_integrity.sql`, which fails when 0014 is removed from its
bootstrap.

### Checked, and already correct

`is_default` is set on exactly one model, `google/gemini-3.5-flash-lite`, tier 1.
No tier-3 model is a default, so the earlier recommendation to turn them off was
already satisfied.

## The citation reader proved against the live corpus — 2026-09-22

`scripts/verify-source-reader.mjs`, read-only, no model call, no cost. Builds a
faithful `TextCitation` from a real chunk — `text_hash` computed the way
`retrieval.ts` computes it, `sha256Hex(normalise(content))` — and runs the
reader's own `loadSource` against the live project.

```
The Finance Bill, 2014
  chunk   0  0-1000     -> 0-1000     exact  slice==content:true
  chunk   1  801-1729   -> 801-1729   exact  slice==content:true
  chunk   2  1530-2497  -> 1530-2497  exact  slice==content:true
  drifted text_hash -> changed  (must not be "exact")

The Finance Bill, 2011.
  chunk   0  0-492      -> 0-492      exact
  chunk   1  301-1291   -> 301-1291   exact
  chunk   2  1098-2066  -> 1098-2066  exact
```

`exact` means the SHA-256 of the normalised slice at the cited offsets equals the
citation's hash — so ingest, the chunk offsets, the normaliser and the reader all
agree on the live corpus. Deliberately overlapping spans (801 begins inside
0-1000) resolve correctly, which is the chunker's overlap working as designed.

The drift case is the non-vacuity check: a citation whose hash no longer matches
is reported `changed`, not shown silently at the wrong place.

**This answers "which part of the document?"** — the exact characters, verified
by hash, with a notice when the text has moved or changed.

### Why the panel looked uninformative

Nothing was wrong with it. `WorkSurface.jsx:42` routes by kind:

| `source.kind` | Panel |
| --- | --- |
| `text` | `SourceReader` — document, scrolled to the span, highlighted, drift notice |
| `row` | `RowSource` — the record card |

Every citation produced in production so far has been `kind: "row"`, and for a
row the whole record **is** the citation; there is no sub-part to point at. The
reader that highlights a passage has never been reached because
`search_documents` has never run in a live turn.

### What remains genuinely unproven

| | |
| --- | --- |
| `match_documents`, HNSW, embeddings | proved by probe |
| chunk offsets ↔ reader ↔ hash | proved by this script |
| citation ladder over chunk sources | covered by `citations_test.ts` |
| handler drives `search_documents`, persists traces | covered by `handler_test.ts:315` |
| **the agent choosing `search_documents` on a real question** | **only a live turn shows this** |
| **the browser rendering a highlighted span** | **only a live turn shows this** |

Both remaining items need an authenticated browser session, which is the owner's
to perform. Every component beneath them is now verified against production data.
