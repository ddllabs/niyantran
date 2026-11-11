# Citation attribution: who published a cited document (proposed)

> **Status: Living (draft for the developer, 2026-11-12).** Not approved. Baseline `main` at `4535abab` (F331 built
> and merged, not deployed). Why now: [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md) Decision 6 admits
> every licence class "as public government records with attribution", and its Consequences say attribution must show
> in citations for every licence class. The next collection, Regulatory (RBI, SEBI, TRAI, CCI), needs it before its
> live load: it is owner gate O2 / task TA of the Regulatory screen draft (`docs/specs/2026-11-12-regulatory-screen.md`
> on branch `task/regulatory-screen-spec`, `0e628f30`, not on `main`). Related: [F331](2026-11-12-bill-metadata-in-chat.md),
> F330 (Regulatory has no admission path). Tracker line: not yet in `open-work.md`; the supervisor adds it (F332 is the
> next free number).

Evidence marks: **read** = seen in this checkout at `4535abab` (file:line); **inferred** = reasoned from read code, not
executed; **measured** = the developer's read-only live counts of 2026-11-11/12, or the T0 pack counts in the
Regulatory screen draft (counts only). Nothing here was executed against NTER, a deployed function or a browser.

## Summary

- **Attribution = the publisher's name**, carried on a text citation as one new optional field, `publisher` (a plain
  string, at most 80 characters). It is absent when the publisher cannot be determined: never a guess.
- **v1 covers Regulatory only.** The name comes from a closed table of four regulators, chosen by
  `metadata.citation.regulator` (admitted shape) or by the host of `metadata.source_host` or the document's `file_url`
  (older shape and fallback). Any disagreement between those gives no name. The pack's free-text `regulator_name` and
  `attribution` fields are not read. Bills, Parliamentary Questions and Law are follow-ups (none is reliable enough
  without a count or an owner wording; see D1).
- **Shown in three places in the browser:** the source list under the answer, the citation's hover and screen-reader
  label, and the evidence bar above the reader (text and page viewer alike). Label text is one constant
  (`Published by`), pending the owner's wording (A2), which does not block the build.
- **Also shown to the model**, as a `publisher:` field in each passage header, with one citation rule: the model may
  name the publisher of a passage it cites, with that passage's marker; it is not a catalogue field (F331) and not
  passage text. Left out of the reply-size measure, so the passages kept are exactly today's.
- **No schema, frame or column change.** The field rides in the existing `sources` frame and the `chat_messages.sources`
  JSON. Old client and new server, and the reverse, both work. Old saved messages show no publisher.
- **No licence class is shown.** `govt_material_confirm_counsel` is an internal admission label; it stays internal.
- **Rollout:** one PR; the web app deploys from `main` after CI (harmless alone: no server sends the field yet); then a
  `research-chat` deploy (A5). The Regulatory live load waits for the production spot-check to pass.

## Current state

### The citation path

| # | Fact | Where | Mark |
|---|---|---|---|
| 1 | A text citation is built only by `textCitation`: id, kind, chunk and document ids, `title`, `file_name`, `file_url`, `desk_tier`, `desk_feature`, char span, `text_hash`, `source_kind`, `page_number`; optional `extract_hash`, `boxes`, `images`, `section`, `document_role`, each added only when present. No publisher. | `_shared/citations.ts:229-255`; type `_shared/citation.types.ts:27-52` | read |
| 2 | The answer's sources use the same function. | `research-chat/sources.ts:71-88` | read |
| 3 | After the RPC ranks rows, `hydrateDocumentRoles` reads `documents.id, metadata` (caller's client, indexed only) for every retrieved document and attaches `document_role` and F331's `document_facts`, discarding any RPC-supplied value. The formatter call is total. | `_shared/retrieval.ts:30-62`; caller `research-chat/index.ts:623-626` | read |
| 4 | `rowToChunk` copies a fixed field set (including `file_url`) and re-validates `document_facts`; unknown fields are dropped. | `_shared/retrieval.ts:191-221` | read |
| 5 | Law context passages are rebuilt from an exemplar chunk, copying title, file, desk and role only. | `_shared/lawContext.ts:54-56`, `101-102` | read |
| 6 | The model sees `handle \| title \| feature [\| version: …] [\| page n] [\| section]`, then (F331) the catalogue line for Bills, then Law's argument-attribution warning, then content. | `research-chat/agent.ts:411-416`, `438-452` (Law warning `449`) | read |
| 7 | The prompt forbids "according to…" attributions not in the retrieved material. Citation rules end with F331's catalogue bullet. | `research-chat/prompt.ts:29`, `71-75` | read |
| 8 | Sources reach the browser in one `{ sources: CitationSource[] }` frame, are replayed from the saved row, and are saved with the message. | `_shared/chatStream.ts:31`; `research-chat/handler.ts:742`, `1630`, `1779-1782` | read |
| 9 | `chat_messages.sources` is JSON; the save function checks only that it is an array. | `supabase/migrations/20261013140000_web_search.sql:82-89` | read |
| 10 | The browser passes the frame's array through unchanged. | `src/lib/researchChat.js:638` | read |
| 11 | `isReadableCitation` checks named fields only; `sanitizeCitation` copies every key and strips malformed optional ones. An unknown key is kept and ignored. | `src/ai/CitationBubble.jsx:15-28`, `46-66` | read |
| 12 | Bubble label: "title — desk feature"; with context, role, page and section are added to the tooltip. | `CitationBubble.jsx:82-91` | read |
| 13 | Source list: chips grouped by tidied title + feature; meta line shows version, feature, pages. | `src/ai/SourceList.jsx:11-61`, `108-113` | read |
| 14 | Evidence bar: title and version label; one bar above both the text reader and the page viewer. The bar's source list shows version and file name or feature. | `src/ai/WorkSurface.jsx:119-121`, `128-133`, `141` | read |
| 15 | "Open file ↗" only with a safe http(s) URL from the document row or the citation. | `src/ai/SourceReader.jsx:81`, `99-110`; `ai/page-viewer/PageViewer.jsx:620` | read |
| 16 | Web pages show a site icon and the **domain** on the entry's meta line; they are never citations. | `src/ai/WebSourcesList.jsx:105-120`; `chatStream.ts:32` | read |
| 17 | `citationMarkers.js` is the marker grammar only, mirrored on a shared fixture. Attribution does not touch it. | `src/lib/citationMarkers.js:1-47`; `src/lib/__fixtures__/citations.json` | read |
| 18 | `document-file` signs stored PDF parts of live page-aware documents; it never links an original URL. Supplied-text documents are stored as `text/plain`, so a loaded Regulatory record opens in the text reader. | `document-file/handler.ts:1-24`; `20261107120000_bills_adapter.sql:295-296` | read; reader choice inferred |

### Metadata that could name a publisher

| Desk | Older shape (first corpus pass, 2026-09-21) | Admitted shape (packs) | Mark |
|---|---|---|---|
| Regulatory | Top-level `source_host`, `licence_class`, `doc_type` …; no `citation` object (`scripts/ingest-national-desk.mjs:237-255`; `_shared/chunkHeader.ts:15-18`). 474 live, 472 without `file_url`. | Not admissible yet (F330: `suppliedText.ts:92`, `100-106`). The pack's 3,319 records carry `citation.regulator` (TRAI 1,837, CCI 1,361, RBI 96, SEBI 25), `citation.regulator_name`, `citation.source`, top-level `source_host`, `licence_class` `govt_material_confirm_counsel`; 121 carry `file_url` (hosts `rbidocs.rbi.org.in` 78, `www.rbi.org.in` 18, `www.sebi.gov.in` 25). `file_url`'s host equals `source_host`, ignoring `www.`, on 43 of 121. Stored feature spelling: `Regulatory Body Watch (RBI SEBI TRAI CCI)`; catalogue: `(RBI/SEBI/TRAI/CCI)`. | read; measured |
| Bills | Top-level `bill_number`, `bill_year`, `house`, `status` on some. | `citation.house` etc.; admission requires a `sansad.in` `file_url` (`suppliedText.ts:20`, `110`). House is the listing row's House, not necessarily the body that issued that version (F331 Q1); role `gazette_notification` is issued by government, not Parliament (`retrieval.ts:16`). | read; inferred |
| Parliamentary Questions | Mixed. | Admitted only with a Lok Sabha `sansad.in` answer URL (`suppliedText.ts:58-63`, `120-126`). | read |
| Law | `forum`, `bench` (NCLT), unvalidated free text (`chunkHeader.ts:114-125`). | `citation` per pack. | read |
| Any admitted | — | The adapter copies a top-level `attribution`, `licence` and `citation_text` string (≤ 4,000) into `metadata` when a pack has them (`suppliedText.ts:232-256`; `bills_adapter.sql:288-290`). How many stored documents carry them: not counted. | read |

`chunkHeader.ts:95-100` maps four **exact** hosts (`rbi.org.in` …) to codes; `rbidocs.rbi.org.in` and `www.` forms do not
match there (inferred). That module belongs to the held embedding path (F289) and is not reused here.

## Problem

A reader who opens a Regulatory citation sees a title, the desk name and the text; for 472 of 474 live documents and for
every TRAI and CCI pack record there is no link to the official source either (facts 1, 12-15). Nothing tells the
reader that the text is, for example, a TRAI document. ADR 0014 makes that a condition of loading these classes.

## Expected outcome

- A citation of a Regulatory document whose publisher resolves (D1) carries `publisher`, and the browser shows
  "Published by <name>" in the source list, the bubble's tooltip and label, and the evidence bar.
- Every other citation, and every Regulatory citation that does not resolve, is byte-identical to today on the server
  and renders identically in the browser.
- The model sees the publisher in the passage header and may write "the Reserve Bank of India's circular states … [2]".
- Old saved messages render as today.

## Design

### D1. What the publisher is, per desk

| Desk | v1 | Value | Source of the value | When unknown |
|---|---|---|---|---|
| Regulatory (`national`, folded feature `regulatory body watch rbi sebi trai cci`, both spellings) | **yes** | One of four constants (table below) | Candidates: (a) `metadata.citation.regulator`; (b) the host of `metadata.source_host`; (c) the host of the document's `file_url` | nothing |
| Bills | no (follow-up) | Proposed "Parliament of India", not for `gazette_notification` | desk + validated `sansad.in` URL | — |
| Parliamentary Questions | no (follow-up) | Proposed "Lok Sabha" | the admitted answer-URL rule | — |
| Law (court or tribunal) | no (follow-up) | Proposed from an allowlist of forums | `forum` mapped through an allowlist, never printed raw | — |

**Regulator table** (the only values v1 can emit; wording per A2):

| Code | Name shown | Registrable domain |
|---|---|---|
| RBI | Reserve Bank of India (RBI) | `rbi.org.in` |
| SEBI | Securities and Exchange Board of India (SEBI) | `sebi.gov.in` |
| TRAI | Telecom Regulatory Authority of India (TRAI) | `trai.gov.in` |
| CCI | Competition Commission of India (CCI) | `cci.gov.in` |

**Resolution rule (Regulatory).**

1. (a) `citation.regulator`: a string, trimmed, upper-cased, exactly a table code. A present but unknown value (for
   example `IRDAI`) makes the result empty: the pack names a publisher we cannot name.
2. (b) `source_host` (top level, then `citation.source_host`): lower-cased, one trailing dot removed, must match
   `^[a-z0-9.-]{1,253}$`; it names a code when it equals a domain or ends with `.` + domain. (c) `file_url`: parsed,
   http or https, no credentials; its host by the same rule. An unrecognised host is not a candidate.
3. The distinct codes from (a)-(c): exactly one gives its name; none, or two different ones, gives nothing.

`regulator_name`, `citation.source`, `attribution`, `licence` and `citation_text` are not read in v1: they are pack free
text. The output is therefore always one of four constants.

**Why not the other desks now.** Bills: the House field is not the issuing body of a version, and gazette documents are
not Parliament's (fact table). Questions: older documents' shape is uncounted. Law: `forum` is free text and Law loads
are on hold (ADR 0014 Decision 1). Each follow-up needs a count, an owner wording and its own tests (Q3).

### D2. Wording is one constant

- Server: the table above, in the new module. Client: `PUBLISHER_LABEL = { en: 'Published by', hi: 'प्रकाशक' }` in
  `src/types/citation.js`, with `publisherLine(source, lang)` returning `'Published by <name>'` or `''`.
- The owner's answer (open in a message not yet answered) changes only these constants and their goldens. The build
  ships the proposed wording; A2 records the owner's confirmation.

### D3. Where it appears: display field for the reader, header field for the model

| Surface | v1 | How |
|---|---|---|
| Source list chip (under each answer) | yes | A `<span className="ai-source-publisher">` in `ai-source-meta`, before the feature, like a web entry's domain. A group whose documents disagree on publisher shows none; the group key gains the publisher only when present, so two publishers never share a card. |
| Bubble tooltip and `aria-label` | yes | Appended to the label: "title — feature · Published by …". |
| Evidence bar | yes | A `<small className="ai-work-publisher">` after the version label; covers the text reader and page viewer. The bar's source list `<small>` gains it too. |
| Reader body, file line | no | Unchanged; "Open file ↗" still only with a URL. |
| Model, passage header | yes | `\| publisher: <name>` after `version:`, before `page`. |
| Catalogue line (F331) | no | Different rule: catalogue facts are never cited; the publisher describes the cited passage's own document. |
| Repair prompt, `found`, activity, traces | no | Unchanged. |

**The model rule** (one bullet appended to `CITATIONS`, `prompt.ts:71-75`): "- A `publisher:` field in a passage header
names who published that document. You may name the publisher when you cite a passage of that document, with that
passage's marker. It is not passage text; never name a publisher a header does not give." This satisfies
`prompt.ts:29` (the attribution is in the retrieved material). The static prompt changes once (one cache miss per
conversation after deploy; none extra if deployed together with F331).

**Reply size.** `withinReply` and `retainLawReview` measure with the field left out (`renderChunk(…, { facts: false,
publisher: false })`), so the kept set is today's. Overflow is at most 40 passages × 59 characters = 2,360 characters
per reply.

### D4. Data flow and compatibility

| Stage | Change |
|---|---|
| `_shared/publisher.ts` (new) | `documentPublisher(tier, feature, metadata, fileUrl): string`, total (any throw gives `''`); `PUBLISHER_MAX_CHARS = 80`. |
| `hydrateDocumentRoles` | Also attaches `publisher` from the metadata it already reads and the row's `desk_tier`, `desk_feature`, `file_url`; discards an RPC-supplied value. No new query. |
| `Chunk`, `rowToChunk` | `publisher?: string`, copied only when a string of 1-80 characters with no line break or control or format character. |
| `TextCitation`, `textCitation` | `publisher?: string`, added as the **last** key only when present. |
| Stream frame, saved column | None: same `sources` frame, same JSON column. |
| Client | `sanitizeCitation` deletes a `publisher` that is not a string of 1-80 characters, or that holds a control or format character or a `ref:` handle; `isReadableCitation` ignores it. |
| Law context passages | Unchanged in v1; when Law gets a publisher, `lawContext.ts` must copy it from the exemplar (noted for the follow-up). |

**Sanitising.** v1 values are constants; a test asserts each passes F331's `cleanFreeText(name, 80)` unchanged. Any
future free-text source must pass `cleanFreeText` before it can be emitted.

**Deploy order.** New server, old client: the key is kept by `sanitizeCitation` and rendered nowhere (fact 11); old
client shows today's UI. Old server, new client: no key, nothing shown. Old saved messages: no key, nothing shown; no
backfill (Q4). Saved messages that carry the key keep it after a server rollback; that value was true when saved.

### D5. Documents with no file_url, and the licence class

- No URL (472 of 474 live; 3,198 TRAI and CCI pack records): the bar shows "Published by …" and no link. The text is
  the stored text, as today.
- The licence class is not shown. `govt_material_confirm_counsel` is an internal admission label: it means nothing to
  a reader, its "confirm counsel" reads as legal doubt the owner did not express, and ADR 0014 already decided these are
  public government records. A reader-facing note such as "Public government record" is the owner's wording, not in
  v1 (Q2).

## Privacy

The publisher is a public body's name. The model provider sees it in tool replies (about 59 characters a passage). No
user data is added anywhere; nothing new is logged or stored except the name inside saved `sources`.

## Tests (written first; each seen failing before the code)

| File | Test | Must fail when (mutation) |
|---|---|---|
| `_shared/publisher_test.ts` (new) | Admitted shape: each code gives its name. Older shape: `source_host` `rbi.org.in`, `www.rbi.org.in`, `rbidocs.rbi.org.in`, `RBI.ORG.IN.` give RBI; `file_url` only gives its host's regulator. Both feature spellings; tier `law` or another feature give `''`. | module absent; subdomain rule removed; fold removed |
| same | Disagreement: regulator SEBI with host `rbi.org.in` gives `''`; unknown regulator `IRDAI` with host `rbi.org.in` gives `''`; unrecognised host alone gives `''`; `evilrbi.org.in`, `rbi.org.in.example.com`, `rbi.org.in/x`, `http://user@rbi.org.in` give `''`. | suffix match without the dot; first candidate wins |
| same | Hostile and odd values: `regulator_name` set to text with a newline or handle is never read; objects, arrays, numbers, a getter that throws, 10,000 seeded random JSON values: never throws, output is `''` or a table name. Each table name passes `cleanFreeText` unchanged and is at most 80. | a throwing path; reading `regulator_name` |
| `_shared/retrieval_test.ts` | `hydrateDocumentRoles` attaches `publisher` for Regulatory only, discards an RPC value, keeps order; an injected throwing resolver still returns rows. `rowToChunk` drops a non-string, an 81-character value, a value with `\n` or U+202E. | wrapper removed; RPC value kept |
| `_shared/citations_test.ts` | A chunk without `publisher` gives a citation whose `JSON.stringify` equals a golden recorded on `4535abab` (key order included); with it, the only difference is a last `publisher` key. | key always written; key order changed |
| `research-chat/agent_test.ts` | Goldens at `agent_test.ts:1092-1098` unchanged. A Regulatory chunk with a publisher: header ends `\| publisher: Reserve Bank of India (RBI)` before `page`. Kept set at `toolReplyChars: 24_000` identical with and without publishers. | field printed in the measure |
| `research-chat/handler_test.ts` | Saved and streamed `sources` of a Regulatory turn carry `publisher`; a Bills turn's sources are byte-identical to today's; no `tool` frame, activity entry or repair prompt contains "publisher:". | field leaks into `found` or repair |
| `research-chat/prompt_test.ts` | `CITATIONS` holds the D3 bullet; persona sync test unchanged. | bullet removed |
| `src/types/citation.test.js` (new) | `publisherLine` for en and hi; `''` for absent or invalid. | label not from the constant |
| `src/ai/SourceComponents.test.jsx` | Chip shows "Published by …"; two documents with the same title and feature but different publishers are two cards; a saved message without the key renders the same markup as a golden recorded on `4535abab`. | group key ignores publisher; markup changed for old messages |
| `src/ai/WorkSurface.test.jsx` | Bar shows the publisher for text and page readers; no URL means no "Open file" and the publisher still shows; a malformed `publisher` (object, 500 characters, `ref:abc123-1`) is dropped and the citation stays readable. | sanitiser removed; readability depends on the field |
| `src/lib/citationMarkers.test.js` and `_shared/citations_test.ts` fixture parity | Unchanged; run as a guard. | — |

**Browser check** (after the `research-chat` deploy, because a Vercel preview calls the live functions,
`src/lib/aiClient.js:47`): on production with the developer's account, one turn that cites a Regulatory document (one
of the 474 with a resolvable publisher, picked by T0), one that cites a Bills document, and one with web on. At 1280×800
and 375×812: the publisher shows in the chip, tooltip and bar for the Regulatory citation only; the Bills chip and the
web strip look as before; no horizontal scroll. Record pass or fail only. Before deploy, the Vercel preview of the PR
is checked at both widths on an old saved conversation: unchanged.

**Commands:** `deno test -A --config supabase/functions/deno.json supabase/functions`; `npm test`; `npm run lint`;
`npm run build`; `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`; `git diff --check`.
No SQL change, so no `npm run test:sql`.

## Rollout

1. **T0 counts first** (read-only, counts only). Offline on the cached v1.1 pack: per record, the codes from (a), (b),
   (c) and how many resolve, conflict or are empty. On NTER (A3): for the 474 live Regulatory documents, distinct
   `source_host` values with counts, and how many resolve under D1; per desk, how many documents carry a top-level
   `attribution`, `licence` or `citation_text`. Stop and revise D1 if more than a handful of the 474 do not resolve.
2. **Build** on `task/citation-publisher` from `main`, test first; supervisor review and commit; PR after A4; CI both
   jobs.
3. **Merge** → Vercel deploys the web app from `main` after CI. Safe alone (D4).
4. **`research-chat` deploy** (A5), by the deploy runbook §3 as in F331's rollout: record the live version and its
   commit first (rollback point; stop if it is later than the last recorded one without a commit). This deploy also
   ships whatever of F331 and F288 is not yet live: one combined decision with them.
5. **Spot-check** at once (browser check above). The Regulatory live load (F330/F307) may proceed only after it passes.
6. **Rollback.** Server: redeploy the recorded version; new citations lose the field, nothing breaks. Web app: promote
   the previous Vercel deployment; the old client ignores the field. The halves roll back independently.

## Tasks

| # | Task | Size | Write scope | Verification | Depends on |
|---|---|---|---|---|---|
| T0 | Counts (Rollout 1); results as counts in this spec | XS | this spec (supervisor) | queries and counts recorded | A3 |
| T1 | Resolver, test first (fuzz included) | S | `supabase/functions/_shared/publisher.ts`, `publisher_test.ts` (new) | `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/publisher_test.ts` | A1, T0 |
| T2 | Hydrate and carry `publisher` | XS | `_shared/retrieval.ts`, `_shared/retrieval_test.ts` | retrieval tests; full Deno suite | T1 |
| T3 | Citation field and type | XS | `_shared/citation.types.ts`, `_shared/citations.ts`, `_shared/citations_test.ts` | citation tests | T2 |
| T4 | Header field, measurement, prompt bullet, handler leak tests | S | `research-chat/agent.ts`, `agent_test.ts`, `prompt.ts`, `prompt_test.ts`, `handler_test.ts` | Deno suite | T3 |
| T5 | Client: constant, sanitiser, chip, bubble, bar | S | `src/types/citation.js`, `src/types/citation.test.js` (new), `src/ai/CitationBubble.jsx`, `src/ai/SourceList.jsx`, `src/ai/WorkSurface.jsx`, `src/ai/research.css`, `src/ai/SourceComponents.test.jsx`, `src/ai/WorkSurface.test.jsx` | `npm test`; `npm run lint`; `npm run build` | T3 (field name fixed) |
| T6 | Full verification, independent review, commit, PR | S | none (supervisor) | commands above; CI | T1-T5, A4 |
| T7 | Deploy, spot-check | S | none (supervisor and developer) | Rollout 4-5 | T6 merged; A5, A6 |

T1-T4 are sequential. T5 may run beside T2-T4 (disjoint scope; the interface is fixed here: `publisher?: string`).

## Approvals

| # | Decision | Who | Status |
|---|---|---|---|
| A1 | Scope: v1 Regulatory only; field `publisher`; shown to the model as a header field with the D3 rule; no licence shown | developer | pending |
| A2 | Wording: "Published by" / "प्रकाशक" and the four names. Approval line: "Citations of Regulatory documents read 'Published by <name>' with the names in D1." Confirmed: ____ (date) ____ | owner | asked, not answered; does not block the build |
| A3 | Read-only NTER counts (T0) | developer | pending |
| A4 | Push the branch and open the PR | developer | pending |
| A5 | Production `research-chat` deploy, combined with undeployed F331/F288 code, and its rollback if needed | developer | pending |
| A6 | Production spot-check turns on the developer's account | developer | pending |

## Scope and exclusions

**In:** the T1-T5 write scopes, this spec, and its tracker line (supervisor).

**Out:** Bills, Parliamentary Questions and Law publishers (Q3); any licence note (Q2); backfilling old messages (Q4);
`chunkHeader.ts` and anything embedded; the Regulatory admission path itself (F330) and its screen; `document-file`;
web-source display; `citationMarkers.js`.

## Risks

| Risk | Mitigation |
|---|---|
| A wrong regulator is shown | Closed table; disagreement shows nothing; T0 counts conflicts first; spot-check |
| Many of the 474 show nothing (unrecognised `source_host`) | T0 stop rule; the host rule accepts subdomains and `www.` |
| The model states a publisher as a cited fact about content | D3 rule; prompt test; spot-check reads one answer for pass/fail |
| A malformed value breaks the reader | Server closed set; client sanitiser; readability never depends on the field |
| Deploy ships F331/F288 code with it | A5 is one combined decision |

## Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Is the regulator's name enough, or does the owner want other wording (for example a source or licence line)? | Ship the name with "Published by"; change the constant on the owner's answer (A2). |
| Q2 | Show a "Public government record" note? | Not in v1. If the owner asks, key it from an allowlist of `licence_class` values, never print the class. |
| Q3 | Publishers for Bills, Questions, Law? | Separate follow-ups, each after a count: Bills "Parliament of India" except gazette notifications; admitted Questions "Lok Sabha"; Law from a forum allowlist when legal resumes. |
| Q4 | Backfill old saved messages in the browser from desk and `file_url`? | No: the saved citation lacks the metadata, and a browser-side guess breaks "never a guess". |
| Q5 | Use the pack's `regulator_name` or `attribution` text instead of the table? | No in v1 (free text from a third party). Revisit after T0 shows what they hold. |
| Q6 | Show the publisher's host beside the name, as web entries show a domain? | No: most documents have no URL; the name is what ADR 0014 asks for. |

## Conflicts found

- **C1. Citation fields and lines.** The brief placed `textCitation` at about 228-245 and said it carries title, file
  name, URL and desk only. It is at `citations.ts:229-255` and also carries ids, span, hash, kind, page and the optional
  page evidence, section and role. The substance holds: no publisher.
- **C2. Law "attribution" lines moved.** The Law warning is at `agent.ts:449`, not 413-415 (F331 shifted it). There are
  more "attribution" rules than that one: `prompt.ts:21-22` (Law) and `prompt.ts:29`, which forbids un-retrieved
  "according to…" attributions and is why D3 gives the model the publisher in the header.
- **C3. A field named `attribution` may already be stored.** The supplied-text adapter copies a pack's top-level
  `attribution`, `licence` and `citation_text` into `metadata` (`suppliedText.ts:232-256`). Not counted; not read in
  v1; T0 counts it.
- **C4. Two spellings of the Regulatory feature.** Stored documents use `Regulatory Body Watch (RBI SEBI TRAI CCI)`;
  the catalogue uses `(RBI/SEBI/TRAI/CCI)` (Regulatory screen draft; F330). D1 folds both.
- **C5. `source_host` is not the file host.** It matches `file_url`'s host, ignoring `www.`, on 43 of 121 pack records
  (Regulatory screen draft, T0), likely because of `rbidocs.` (inferred). D1 matches registrable domains and refuses
  disagreement; T0 measures it.
- **C6. Regulatory cannot be loaded yet regardless** (F330): attribution is one of three owner gates on that load, not
  the only blocker.
- **C7. `citationMarkers` needs no change.** It holds the marker grammar only; its mirror test stays as a guard.

## Not determined

- The `source_host` values of the 474 live Regulatory documents, and so how many resolve (T0, A3).
- What `citation.source` and `regulator_name` hold in the pack, and whether any pack record has `attribution`.
- Whether `research-chat` was redeployed after its last recorded version (F331 C4).
