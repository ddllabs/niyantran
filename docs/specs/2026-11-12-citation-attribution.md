# Citation attribution: who published a cited document (F332, proposed)

> **Status: Living (draft for the developer, 2026-11-12, revision 2 after independent review).** Not approved. First
> draft committed as `f3b2aff5`; code read at `main` `4535abab` (F331 built and merged, not deployed). Why now:
> [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md) Decision 6 admits every licence class "as public
> government records with attribution", and its Consequences say attribution must show in citations for every licence
> class. The next collection, Regulatory (RBI, SEBI, TRAI, CCI), needs it before its live load: owner gate O2 / task TA
> of the Regulatory screen draft (`docs/specs/2026-11-12-regulatory-screen.md` on branch `task/regulatory-screen-spec`,
> `0e628f30`, not on `main`). Related: [F331](2026-11-12-bill-metadata-in-chat.md); F330 (Regulatory has no admission
> path). Tracker: F332; the supervisor adds the line to `open-work.md`.

Evidence marks: **read** = seen in this checkout at `4535abab` (file:line); **inferred** = reasoned from read code, not
executed; **measured** = read-only counts (counts only) by the developer or supervisor on 2026-11-11/12 on NTER or on
the cached v1.1 pack. Nothing here was executed by this spec's author against NTER, a deployed function or a browser.

## Summary

- **Attribution in v1 = the publisher's name**, carried on a text citation as one new optional field, `publisher` (a
  plain string, at most 80 characters). It is absent when the publisher cannot be determined: never a guess.
- **v1 covers Regulatory only.** The name comes from a fixed table of four regulators, chosen from
  `metadata.citation.regulator` and the hosts of `source_host` and `file_url`. An unknown regulator code, or two
  different regulators among the candidates, gives no name. Live: all 474 Regulatory documents carry a `source_host`
  on one of three regulator domains, so **474 of 474 must resolve** (acceptance bar).
- **Whether the name is enough is the owner's question** (OQ1). Every pack record also carries `citation_text`, the pack
  author's own citation wording, which may be what the owner means by attribution. The owner's answer gates the
  Regulatory **live load**, not this build. `citation_text` is already stored in `metadata` by the supplied-text
  adapter, so showing it later needs no re-ingest.
- **The Regulatory screen must use the same resolver** and hold a record that resolves to nothing, so no Regulatory
  document is loaded without a publisher. The resolver lives in `supabase/functions/_shared/`, which the runner already
  imports from.
- **Browser:** the source list chip, the source-list bubbles' tooltip and label, the evidence bar (second line under the
  title) and copy-as-text show "Published by <name>". The label is one constant per language.
- **Model:** a `publisher:` field in each Regulatory passage header (after `version:`, before page and section), with
  one citation rule worded on the `version:` precedent. Titles and features have `|` escaped so a title cannot forge
  the field; no live title or feature contains `|` today.
- **No schema, frame or column change;** either deploy order works; old saved messages show no publisher.
- **No licence class is shown.**
- **Rollout:** after F331's deploy and its 48-hour watch, not inside it. A gate after the first small Regulatory batch
  checks one admitted record per regulator in a cited answer.

## Current state

### The citation path

| # | Fact | Where | Mark |
|---|---|---|---|
| 1 | A text citation is built only by `textCitation`: ids, `title`, `file_name`, `file_url`, `desk_tier`, `desk_feature`, char span, `text_hash`, `source_kind`, `page_number`; optional `extract_hash`, `boxes`, `images`, `section`, `document_role`, each added only when present. No publisher. | `_shared/citations.ts:229-255`; `_shared/citation.types.ts:27-52` | read |
| 2 | The answer's sources use the same function. | `research-chat/sources.ts:71-88` | read |
| 3 | After the RPC ranks rows, `hydrateDocumentRoles` reads `documents.id, metadata` for every retrieved document and attaches `document_role` and `document_facts`, discarding RPC-supplied values; the formatter call is total. The RPC row carries `desk_tier`, `desk_feature` and `file_url`. | `_shared/retrieval.ts:30-62`, `191-221`; caller `research-chat/index.ts:623-626` | read |
| 4 | Law context passages are rebuilt from an exemplar, copying title, file, desk and role only. | `_shared/lawContext.ts:54-56`, `101-102` | read |
| 5 | The model sees `handle \| title \| feature [\| version: …] [\| page n] [\| section]`, then F331's catalogue line, then Law's warning, then content. Section text has `\|` escaped (`sectionText`); title and feature are flattened to one line but `\|` is printed raw. | `research-chat/agent.ts:392-394`, `411-416`, `438-452` | read |
| 6 | The reply budget is measured with `renderChunk(HANDLE_ROOM, c, { facts: false })`; 24,000 characters on high efforts, no limit otherwise. | `agent.ts:462-478`, `484-495`; `handler.ts:1356` | read |
| 7 | Prompt precedents: "Respect each passage's version label … Attribute provisions to their retrieved version" (`prompt.ts:16`); no "according to…" attributions that are not in the retrieved material (`:29`); F331's catalogue bullet ends `CITATIONS` (`:75`). The static prompt is one string for every desk. | `prompt.ts:16`, `29`, `71-75`, `113-124` | read |
| 8 | Sources reach the browser in one `{ sources }` frame, are replayed from the saved row and saved with the message; the save function checks only that `sources` is an array. The browser passes it through. | `_shared/chatStream.ts:31`; `handler.ts:742`, `1630`, `1779-1782`; `migrations/20261013140000_web_search.sql:82-89`; `src/lib/researchChat.js:638` | read |
| 9 | `isReadableCitation` checks named fields only; `sanitizeCitation` copies every key and strips malformed optional ones, so an unknown key is kept and ignored. | `src/ai/CitationBubble.jsx:15-28`, `46-66` | read |
| 10 | Bubble: `title` attribute is the label, plus role, page and section only when `showContext`; `aria-label` is "Source n: label" always. Source-list bubbles pass `showContext`; inline answer markers do not. | `CitationBubble.jsx:82-91`; `SourceList.jsx:121`; `AiMarkdown.jsx:68` | read |
| 11 | Source list groups documents by tidied title + feature (bill versions share a card); the meta line shows version, feature, pages. | `src/ai/SourceList.jsx:11-61`, `108-113` | read |
| 12 | Evidence bar: Back, title, version label, "Ask about this document", close. Title `min-width: 0`, ellipsis, nowrap; Back, version and Ask are `flex: none`, Ask takes `margin-left: auto`; close is `flex: none`, 28 px. Under 480 px the gap is 8 px. | `WorkSurface.jsx:114-125`; `research.css:50-55`, `75-77`; `src/shell/panel-overlay.css:55-71` | read |
| 13 | "Open file ↗" only with a safe http(s) URL. | `SourceReader.jsx:81`, `99-110`; `page-viewer/PageViewer.jsx:620` | read |
| 14 | Copy-as-text: `answerForCopy(m, hi)` writes one line per source, `[n] title · p. n — url`. | `src/ai/MessageActions.jsx:6-15` | read |
| 15 | Language reaches `SourceList` and `MessageActions` only. `AiMarkdown` (inline bubbles) and `WorkSurface` get no `lang`. | `MessageRow.jsx:55-56`, `65-66`; `AiPanel.jsx:760` | read |
| 16 | Web pages show a site icon and the domain on the entry's meta line; never citations. | `src/ai/WebSourcesList.jsx:105-120`; `chatStream.ts:32` | read |
| 17 | `citationMarkers.js` holds the marker grammar only. | `src/lib/citationMarkers.js:1-47` | read |
| 18 | `document-file` signs stored PDF parts of live page-aware documents; it never links an original URL. Supplied text is stored as `text/plain`, so a loaded Regulatory record opens in the text reader. | `document-file/handler.ts:1-24`; `20261107120000_bills_adapter.sql:295-296` | read; reader inferred |
| 19 | The bulk runner already imports pure modules from `supabase/functions/_shared/` (`suppliedText.ts`, `textNormalise.ts`). | e.g. `scripts/bulk-runner/prepare.ts`, `screens/*` imports | read |

### Regulatory metadata (measured)

| | Live, NTER (474 documents) | Pack v1.1 (3,319 records) |
|---|---|---|
| Tier / feature | all `national` / `Regulatory Body Watch (RBI SEBI TRAI CCI)` | same (catalogue spells it `(RBI/SEBI/TRAI/CCI)`) |
| `citation` | none; no `regulator`, no `attribution` | `citation.regulator` on all; `citation.source` = that regulator's bare domain on all (TRAI/`trai.gov.in` 1,837, CCI/`cci.gov.in` 1,361, RBI/`rbi.org.in` 96, SEBI/`sebi.gov.in` 25); `citation.regulator_name` the full name, one value per regulator; `citation.kind` `regulatory`; `citation.action_type` on the 121 RBI and SEBI records only |
| `source_host` | on all: `trai.gov.in` 283, `cci.gov.in` 189, `rbi.org.in` 2 | not counted in these counts (screen draft: equals the `file_url` host, ignoring `www.`, on 43 of 121) |
| `file_url` | 2, both on `rbidocs.rbi.org.in` | 121: `rbidocs.rbi.org.in` 78, `www.rbi.org.in` 18, `www.sebi.gov.in` 25 |
| Other | — | `attribution` and `licence` absent on all; `citation_text` on all (82-255 characters; contents not read out); `doc_type` `regulatory`; `licence_class` `govt_material_confirm_counsel` |
| Pipes | 0 of 23,289 live document titles and 0 features contain `\|` | — |

Storage: the supplied-text adapter copies a record's top-level `source_host`, `licence`, `attribution` and
`citation_text` (each a string ≤ 4,000) and the whole `citation` object into the prepared input
(`suppliedText.ts:208`, `232-256`), and registration stores the input minus text, pages, sections, key, title and desk
as `metadata` (`bills_adapter.sql:288-290`). Regulatory has no admission branch yet (F330); the screen draft's
search-only branch reuses this copy (inferred from that draft), so `citation_text` will be in `metadata`.

Other desks (not in v1): Bills keep `house` from the listing row, not the issuing body (F331 Q1), and include gazette
notifications (`retrieval.ts:16`); admitted Questions require a Lok Sabha `sansad.in` answer URL
(`suppliedText.ts:58-63`, `120-126`); Law's `forum` and `bench` are unvalidated free text (`chunkHeader.ts:114-125`).

## Problem

A reader who opens a Regulatory citation sees a title, the desk name and the text; for 472 of 474 live documents and
for every TRAI and CCI pack record there is no link to the official source either (facts 1, 10-13). Nothing says who
published it. ADR 0014 makes that a condition of loading these classes. Separately, a title holding `|` could add a
header field (fact 5), so a printed `publisher:` field must not be forgeable.

## Expected outcome

- 474 of 474 live Regulatory documents, and every admitted Regulatory record, resolve to a publisher.
- A citation of such a document carries `publisher`; the browser shows "Published by <name>" in the places of D3.
- Every non-Regulatory citation is byte-identical to today on the server and renders identically.
- Model headers are byte-identical to today for every live document except the added Regulatory field (no live title
  or feature has a `|`).
- Old saved messages render as today.

## Design

### D1. What the publisher is

| Desk | v1 | Value | Source |
|---|---|---|---|
| Regulatory (`national`; folded feature `regulatory body watch rbi sebi trai cci`, either spelling) | **yes** | one of four constants | the resolution rule below |
| Bills, Parliamentary Questions, Law | no | — | follow-ups (FU1-FU3) |

**Regulator table** (the only values v1 can emit; wording per OQ1):

| Code | Name shown | Domain |
|---|---|---|
| RBI | Reserve Bank of India | `rbi.org.in` |
| SEBI | Securities and Exchange Board of India | `sebi.gov.in` |
| TRAI | Telecom Regulatory Authority of India | `trai.gov.in` |
| CCI | Competition Commission of India | `cci.gov.in` |

The full name is used everywhere in v1 (simpler than a short code on the chip; OQ-D3). `citation.regulator_name` holds
the same names in the pack (measured), but it is not read: the shown value stays server-controlled.

**Resolution rule.** Candidates, each giving a code or nothing:

1. **Regulator:** `metadata.citation.regulator`, only when a non-empty string after trimming. Upper-cased, it must be a
   table code; any other value **blocks** (result empty: the pack names a publisher we cannot name).
2. **Hosts:** every one of `metadata.source_host`, `metadata.citation.source_host`, and the document's `file_url` host
   is its own candidate (not first-wins). A host is lower-cased, one trailing dot removed, and must be ASCII labels of
   1-63 characters matching `[a-z0-9]([a-z0-9-]*[a-z0-9])?`, at most 253 characters, no empty label. A
   `source_host` must be a bare host (no scheme, port, path or `@`). A `file_url` must parse, be http or https, and
   have no username or password (otherwise it is not a candidate); its port is ignored. A host names a code when it
   equals a domain or ends with `.` + domain.
3. A host that is invalid or outside the four domains is **not a candidate and does not block**: an archived copy or a
   gazette copy of a regulator's document is a legitimate `file_url` and says nothing against the publisher.
4. The distinct codes from all candidates: exactly one gives its name; none gives nothing; two different codes
   **block**.

`citation.source`, `regulator_name`, `attribution`, `licence` and `citation_text` are not read.

**Where it lives.** `supabase/functions/_shared/publisher.ts`: pure, no imports except `documentFacts.ts`
(`cleanFreeText`), total. The chat imports it from `_shared/retrieval.ts`; the Regulatory screen imports it from
`scripts/bulk-runner/screens/`, as the runner already imports `_shared/suppliedText.ts` (fact 19). The chat never
imports runner code. One implementation, so no shared test table is needed.

### D2. The screen holds what does not resolve (requirement on the Regulatory screen)

The Regulatory screen (draft spec above; being built) runs `documentPublisher('national', record.desk_feature,
storedMetadataOf(record), record.file_url)` on each candidate, using the metadata the record would be stored with, and
holds a record whose result is empty with reason `publisher_unresolved` (check group: identity). Follow-up task in
that spec (TS below): the check, its tests (one record per regulator passes; unknown regulator, disagreeing hosts and
no candidate are held), and its file in `rules_sha256`. Expected on v1.1: 0 held (every record has a known
`citation.regulator`; the hosts measured are subdomains of the same domains), inferred.

### D3. Where it appears

| Surface | v1 | How |
|---|---|---|
| Source list chip | yes | `<span className="ai-source-publisher">` in `ai-source-meta`, before the feature, as a web entry shows its domain. Grouping is unchanged (by title + feature, as today); the publisher is a property of each document. A card shows it when every document on the card has the same publisher, else none. |
| Source-list bubble (`showContext`) | yes | Tooltip and `aria-label` gain "· Published by <name>". |
| Inline answer marker (no `showContext`) | no | Unchanged: keeps prose markers short for screen readers (OQ-D2). |
| Evidence bar | yes | Title and publisher become a two-line column: `<span className="ai-work-heading">` (`flex: 1 1 auto; min-width: 0; display: grid`) holding the existing `.ai-work-title` and a new `.ai-work-publisher` (12 px, muted, `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`). No new `flex: none` item, so the close control keeps its room. The bar's source list `<small>` gains the publisher. |
| Copy as text | yes | `answerForCopy` appends ` · Published by <name>` (Hindi: ` · प्रकाशक: <name>`) after the page, before the URL. |
| Reader body | no | Unchanged; "Open file ↗" still only with a URL. |
| Model header | yes, Regulatory only | `\| publisher: <name>` after `version:`, before page and section (D5). |

**Language.** `PUBLISHER_LABEL = { en: 'Published by', hi: 'प्रकाशक:' }` and `publisherLine(source, lang)` in
`src/types/citation.js`. Localised in v1 only where a language is already passed: the source list chip and copy-as-text
(fact 15). The bubble label and the evidence bar are English in v1; localising them needs `lang` passed to
`CitationBubble` (from `SourceList` and `AiMarkdown`) and to `WorkSurface` (from `AiPanel.jsx:760`): follow-up FU5.
The name itself is not translated in v1.

### D4. Data flow and compatibility

| Stage | Change |
|---|---|
| `_shared/publisher.ts` (new) | `documentPublisher(tier, feature, metadata, fileUrl): string`; `PUBLISHER_MAX_CHARS = 80`; `isRegulatoryFeature(tier, feature)`. |
| `hydrateDocumentRoles` | Attaches `publisher` from the metadata it already reads and the row's tier, feature and `file_url`; discards an RPC-supplied value; a throwing resolver gives none. No new query. |
| `Chunk`, `rowToChunk` | `publisher?: string`, copied only when a string of 1-80 characters with no line break, control or format character. |
| `TextCitation`, `textCitation` | `publisher?: string`, the **last** key, only when present. |
| Stream frame, saved column | None. |
| Client | `sanitizeCitation` keeps a valid `publisher` and deletes one that is not a string, is empty or over 80, or holds a control or format character or a `ref:` handle; `isReadableCitation` ignores it. |
| Law context passages | Unchanged in v1; FU3 must copy `publisher` from the exemplar. |

v1 values are constants; a test asserts each passes `cleanFreeText(name, 80)` unchanged. Any later free-text source
must pass `cleanFreeText` before it can be emitted.

**Deploy order.** New server, old client: the key is kept and rendered nowhere (fact 9). Old server, new client: no
key, nothing shown. Old saved messages: nothing shown, no backfill (OQ-D4). Saved messages freeze the wording of the
day they were saved; a later wording change does not alter them (accepted, OQ-D4).

### D5. The model's view

**Header.** `renderChunk` prints `| publisher: <name>` after `version:` and before `page` and the section, only when
`isRegulatoryFeature(c.desk_tier, c.desk_feature)` holds at render time and the value is one of the table's names (as
`catalogueLine` re-checks Bills, `agent.ts:411-416`). A chunk of any other desk carrying `publisher` prints nothing.

**Forgery.** `renderChunk` escapes `|` as `\|` in the title and feature, as `sectionText` does (`agent.ts:392-394`),
after the F331 one-line flattening. A title `X | publisher: Reserve Bank of India` then prints as one field. No live
title or feature contains `|` (0 of 23,289), so no live header changes. F331's test that pins `'A | B'` as byte-identical
(`agent_test.ts:2609-2617`) is updated on purpose.

**Measure.** `withinReply` and `retainLawReview` measure with `{ facts: false, publisher: false }`, so the kept set is
today's.

**The rule** (appended to `CITATIONS`). Final sentences side by side:

| Existing (F331, `prompt.ts:75`) | New |
|---|---|
| "A line that starts 'Catalogue fields' under a passage lists the document's catalogue data. It is not passage text: do not quote it as the passage, and do not cite a passage for a fact that only that line states." | "A passage header's 'publisher:' label names the body that published that document, as its 'version:' label names the version. You may state it with that passage's citation. It is not passage text. Publishing a document does not make its contents that body's finding, decision or view. Do not name a publisher a header does not give, unless the passage text itself states it." |

They do not conflict: the catalogue line carries facts no passage states and must not be cited; the publisher label
describes the cited passage's own document and is stated only alongside that passage's citation, as `prompt.ts:16`
allows for the version. It also satisfies `prompt.ts:29` (the attribution is in the retrieved material).

**Cost** (estimates; about 4 characters a token).

| Item | Size |
|---|---|
| Rule sentence | about 75 tokens, in the static prompt of **every desk and every call**, though only Regulatory passages carry the field. Each conversation's cached prefix misses once after deploy (estimate); after that it is cached like the rest of the prompt (estimate). |
| Header field | at most 52 characters (` \| publisher: Securities and Exchange Board of India`), about 13 tokens a Regulatory passage |
| Per reply | at most 40 passages: about 520 tokens |
| Per turn | replies stay in context for later rounds. Worst case, 10 searches each with 40 Regulatory passages: about 5,200 tokens in the final call and about 34,000 summed over the turn's calls. A confined turn (1-3 searches, a few passages): under 1,000 summed. |
| Budget overshoot (high efforts) | at most 40 × 52 = 2,080 characters over 24,000 per reply. With F331's Bills line in the same broad reply, the two together stay under F331's 5,160-character bound, since a document is either Bills or Regulatory (inferred). |
| Credits | settled from provider cost, so they rise with the tokens above. |

### D6. Licence class and no-URL documents

- No URL (472 of 474 live; all TRAI and CCI pack records): the bar shows the publisher and no link.
- The licence class is not shown: `govt_material_confirm_counsel` is an internal admission label. It means nothing to a
  reader, its "confirm counsel" reads as legal doubt the owner did not express, and ADR 0014 already calls these public
  government records. A reader-facing note is the owner's wording (OQ2).

## Privacy

The publisher is a public body's name. The model provider sees it in tool replies. No user data is added; nothing new
is logged; the name is stored only inside saved `sources`.

## Tests (written first; each seen failing before the code)

| File | Test | Must fail when (mutation) |
|---|---|---|
| `_shared/publisher_test.ts` (new) | Pack shape: each code gives its name. Live shape: `source_host` `trai.gov.in`, `cci.gov.in`, `rbi.org.in` give their names; `file_url` on `rbidocs.rbi.org.in` alone gives RBI. Both feature spellings. `RBI` under tier `law`, or another feature, gives `''`. | module absent; subdomain rule removed; fold removed; tier check removed |
| same | Precision: `RBI.ORG.IN`; `rbi.org.in.` and `https://rbi.org.in.:443/x.pdf` (trailing dot with port) give RBI. `https://rbi.org.in@evil.example/`, `https://user:pw@rbi.org.in/` are not candidates. `evilrbi.org.in`, `rbi.org.in.example.com`, `-rbi.org.in`, `rbi..org.in`, `rbі.org.in` (Cyrillic і), `xn--rb-xyz.org.in`, `203.0.113.7`, `rbi.org.in/x`, `rbi.org.in:80` as `source_host` are not candidates. `xn--abc.rbi.org.in` is RBI (a subdomain). | dot dropped from the suffix rule; label rule loosened; userinfo accepted |
| same | Blocking: regulator SEBI + host `rbi.org.in` → `''`; `source_host` `trai.gov.in` + `citation.source_host` `cci.gov.in` → `''` (both are candidates); regulator `IRDAI` + host `rbi.org.in` → `''`; regulator `''` or `  ` is no candidate (host decides); `file_url` on `archive.org` + regulator RBI → RBI. | first-wins; empty regulator blocks; outside host blocks |
| same | Hostile values: `regulator_name`, `attribution`, `citation_text` set to text with a newline or handle are never read; objects, arrays, numbers, a throwing getter, 10,000 seeded random JSON values: never throws, output `''` or a table name; each name passes `cleanFreeText` unchanged and is ≤ 80. | a throwing path; a free-text field read |
| `_shared/retrieval_test.ts` | `hydrateDocumentRoles` attaches `publisher` for both feature spellings, for Regulatory only; discards an RPC value; keeps order; an injected throwing resolver still returns rows. `rowToChunk` keeps a valid value and drops a non-string, an 81-character value, `\n`, U+202E. | wrapper removed; RPC value kept |
| `_shared/citations_test.ts` | Without `publisher`: `JSON.stringify` equals a golden recorded on `4535abab`. With it: the only difference is a last `publisher` key. | key always written; order changed |
| `research-chat/agent_test.ts` | Goldens at `agent_test.ts:1092-1098` unchanged. Regulatory chunk: header `… \| version: … \| publisher: Reserve Bank of India \| page 4 \| <section>` order. A Bills chunk carrying `publisher` prints none. A forged title `X \| publisher: Reserve Bank of India` on a non-Regulatory chunk prints `X \\| publisher: …` and splits into the same field count as a plain title. | render-time desk check removed; escape removed |
| same | Kept set at the boundary: `toolReplyChars: 24_000`, passages sized so passage k ends within 30 characters of the limit without the field; with `publisher` on every passage the kept ids are identical. (Measuring with the field drops passage k, so the test can fail.) | field included in the measure |
| `research-chat/handler_test.ts` | Saved and streamed `sources` of a Regulatory turn carry `publisher`; a Bills turn's sources are byte-identical to today's; no `tool` frame, activity entry or repair prompt contains `publisher:`. | leak into `found` or repair |
| `research-chat/prompt_test.ts` | `CITATIONS` ends with the D5 sentence after F331's; persona sync test unchanged. | sentence removed or reordered |
| `src/types/citation.test.js` (new) | `publisherLine` for en and hi (`प्रकाशक: <name>`); `''` for absent or invalid. | label not from the constant |
| `src/ai/SourceComponents.test.jsx` | Chip shows "Published by …"; a two-version card with one publisher shows it, with two publishers shows none; source-list bubble `aria-label` is "Source 1: title — feature · Published by …"; inline bubble `aria-label` unchanged; a saved message without the key renders the markup of a golden recorded on `4535abab`. | label leaks to inline markers; old markup changed |
| `src/ai/WorkSurface.test.jsx` | Bar shows the publisher on its second line for text and page readers; no URL means no "Open file" and the publisher still shows; `sanitizeCitation` keeps `'Reserve Bank of India'` and drops `{}`, a number, 500 characters, `ref:abc123-1`; the citation stays readable. | sanitiser removed; readability depends on the field |
| `src/ai/MessageActions.test.jsx` | `answerForCopy` line `[1] title · p. 4 · Published by … — https://…` (en) and with `प्रकाशक:` (hi); a source without it is unchanged. | publisher omitted or placed after the URL |
| `src/lib/citationMarkers.test.js` | Unchanged; guard. | — |

**Commands:** `deno test -A --config supabase/functions/deno.json supabase/functions`; `npm test`; `npm run lint`;
`npm run build`; `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`; `git diff --check`.
No SQL change.

**Browser checks.** A Vercel preview calls the live functions (`src/lib/aiClient.js:47`), so before deploy only the
client is checkable: on the PR preview, an old saved conversation at 1280×800 and 375×812 looks as before. After the
`research-chat` deploy, on production (A6): one cited Regulatory document (one of the 474), one Bills document and one
web source, at both widths. Pass: the publisher shows in the chip, the source-list bubble's tooltip, the bar and the
copied text for the Regulatory citation only; at 375 px the bar's title and publisher truncate with an ellipsis and
the close control (✕) stays fully visible and clickable; no horizontal scroll; the Bills chip and the web strip look as
before. Pass or fail only.

## Rollout

1. **Counts, done (T0).** See "Regulatory metadata". Remaining read-only check (A3): run the resolver over the 474
   rows' tier, feature, `metadata` and `file_url` (counts only): must give 474 resolved, by code. This also confirms the
   two `file_url` documents agree with their `source_host`.
2. **Build** on `task/citation-publisher` from `main`, test first; supervisor review and commit; PR after A4; CI both
   jobs.
3. **Merge** → Vercel deploys the web app from `main` after CI. Safe alone (D4).
4. **`research-chat` deploy (A5), after F331.** F331 deploys first under its own approvals and its 48-hour watch; this
   deploy follows when that watch ends. Before deploying, record the live version and its commit (rollback point).
   Combining the two is the developer's choice (A7) at the cost of the clean watch.
5. **Spot-checks** at once (A6).
6. **Before the Regulatory live load:** the owner's answer on wording (OQ1, A2) and the screen's `publisher_unresolved`
   check (TS).
7. **After the first small Regulatory batch** (the screen draft's 100-document batch): one admitted record per
   regulator (RBI, SEBI, TRAI, CCI) is cited in an answer on production and shows the right publisher, before the rest
   loads (A8). This is the first time the `citation.regulator` path runs on real data.
8. **Rollback.** Server: redeploy the recorded version; new citations lose the field, nothing breaks. Web app: promote
   the previous Vercel deployment; the old client ignores the field. The halves roll back independently.

## Tasks

| # | Task | Size | Write scope | Verification | Depends on |
|---|---|---|---|---|---|
| T0 | Counts | — | done (measured 2026-11-12) | — | — |
| T1 | Resolver, test first (fuzz included) | S | `supabase/functions/_shared/publisher.ts`, `publisher_test.ts` (new) | `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/publisher_test.ts` | A1 |
| T2 | Hydrate and carry `publisher` | XS | `_shared/retrieval.ts`, `_shared/retrieval_test.ts` | retrieval tests; Deno suite | T1 |
| T3 | Citation field and type | XS | `_shared/citation.types.ts`, `_shared/citations.ts`, `_shared/citations_test.ts` | citation tests | T2 |
| T4 | Header field, pipe escape, measure, rule, leak tests | S | `research-chat/agent.ts`, `agent_test.ts`, `prompt.ts`, `prompt_test.ts`, `handler_test.ts` | Deno suite | T3 |
| T5 | Client: constant, sanitiser, chip, bubble, bar, copy | S | `src/types/citation.js`, `src/types/citation.test.js` (new), `src/ai/CitationBubble.jsx`, `src/ai/SourceList.jsx`, `src/ai/WorkSurface.jsx`, `src/ai/MessageActions.jsx`, `src/ai/research.css`, `src/ai/SourceComponents.test.jsx`, `src/ai/WorkSurface.test.jsx`, `src/ai/MessageActions.test.jsx` | `npm test`; `npm run lint`; `npm run build` | interface fixed here (`publisher?: string`) |
| T6 | Resolver check over the 474 (Rollout 1) | XS | none (supervisor; counts in this spec) | 474 resolved | T1, A3 |
| T7 | Verification, independent review, commit, PR | S | none (supervisor) | commands; CI | T1-T6, A4 |
| T8 | Deploy, spot-checks | S | none (supervisor and developer) | Rollout 4-5 | T7 merged; F331's watch ended (or A7); A5, A6 |
| TS | Screen check `publisher_unresolved` (in the Regulatory screen's spec and build, not this scope) | XS | `scripts/bulk-runner/screens/` per that spec | the screen's tests | T1 |
| TB | First-batch gate (Rollout 7) | XS | none | four cited records pass | Regulatory first batch; A8 |

T1-T4 are sequential. T5 may run beside T2-T4 (disjoint scope, fixed interface).

## Approvals

| # | Decision | Who | Status |
|---|---|---|---|
| A1 | Scope: v1 Regulatory only; field `publisher`; D5 header field, pipe escape and rule; no licence shown | developer | pending |
| A2 | Attribution wording (OQ1). Approval line: "Citations of Regulatory documents read 'Published by <name>' with the names in D1, and that is the attribution ADR 0014 asks for." Confirmed: ____ (date) ____. **Gates the Regulatory live load, not this build.** | owner | asked, not answered |
| A3 | Read-only NTER run of the resolver over the 474 (T6) | developer | pending |
| A4 | Push the branch and open the PR | developer | pending |
| A5 | Production `research-chat` deploy after F331's 48-hour watch, and its rollback if needed | developer | pending |
| A6 | Production spot-checks on the developer's account. **They spend AI credits on that account.** | developer | pending |
| A7 | Only if chosen: deploy together with F331. Consequence: one watch covers both, so a regression cannot be attributed to either change without a rollback of both. | developer | not proposed |
| A8 | First-batch gate turns on production (credits on the developer's account) | developer | pending |

## Scope and exclusions

**In:** T1-T5 write scopes, this spec, its tracker line (supervisor); TS is specified here and built in the screen's
scope.

**Out (follow-ups, each needing attribution before its own load or release):**

- FU1 Bills publisher: proposed "Parliament of India", except gazette notifications; after a count and owner wording.
- FU2 Parliamentary Questions publisher: proposed "Lok Sabha" for admitted answers; older shape to be counted.
- FU3 Law publisher (court or tribunal) from a forum allowlist, when legal resumes; `lawContext.ts` copies it.
- FU4 The other licence classes of ADR 0014 Decision 6 (transfer orders, budget, cabinet and press releases, industry):
  each needs its publisher rule before its load.
- FU5 Localise the bubble label and the evidence bar (pass `lang` to `CitationBubble` and `WorkSurface`).
- FU6 Show `citation_text` if the owner asks (OQ1): no re-ingest needed.

Also out: licence notes (OQ2); backfilling old messages; `chunkHeader.ts` and anything embedded; F330's admission path;
`document-file`; web-source display; `citationMarkers.js`.

## Risks

| Risk | Mitigation |
|---|---|
| A wrong regulator is shown | Closed table; unknown code and disagreement show nothing; T6; first-batch gate |
| A Regulatory document is loaded without a publisher | TS holds it at screening; T6 for the 474 |
| A title forges the publisher field | `\|` escaped in title and feature; render-time desk check; tests |
| The model treats a publisher as the author of a finding | D5's "publishing … does not make its contents that body's finding" sentence; spot-check |
| The bar hides the close control at 375 px | No new `flex: none` item; ellipsis column; browser check |
| A malformed value breaks the reader | Closed set on the server; client sanitiser; readability ignores the field |
| Deploy overlaps F331's watch | A5 after the watch; A7 only by explicit choice |

## Build notes (2026-11-12)

T1 to T5 are built and independently reviewed (accept with changes, applied). Where the build or the review corrects
this spec, this section wins.

- **Escape (D5).** In a printed title or feature, `\` is escaped first and `|` second, and the eight pipe lookalikes
  the catalogue-fields cleaner removes become a space (`PIPE_LOOKALIKES` in `agent.ts`, pinned equal to the list in
  `documentFacts.ts` by a test). Section labels keep their old escaping: 544 live chunks carry a backslash or a
  lookalike there, so that is a separate tracker item.
- **The rule sentence (D5).** Its last clause is "Publishing alone does not establish that a statement in it is that
  body's finding; the passage text decides."
- **Where the name is checked (D4, D5).** A publisher is kept only when it is one of the four table names and the row's
  own desk is national Regulatory, at three points: when the chunk is built (`rowToChunk`), when the citation is built
  (`textCitation`) and when the header is rendered.
- **Resolver (D1).** A regulator code that is present but not a string blocks, as an unknown code does. Absent, null or
  empty means no code.
- **Source-list bubbles (D3).** The publisher is in the tooltip only, not in the `aria-label`: the chip already
  announces it once.
- **Known limitation.** The browser displays a saved citation's publisher as stored when it is a clean short string;
  it does not hold its own list of names.
- **Counts (read-only, 2026-11-12).** No live title or feature (23,289 documents) and no title in the v1.1 Regulatory
  pack contains a pipe, a backslash or a lookalike bar, so no existing header changes.
- **Tests.** 1,625 pass in `supabase/functions`; 7,244 in the client suite; lint clean. The build was not run locally.
- **Not proven until a browser check:** that the reader's close control stays visible at a 375 px width. The tests
  assert the stylesheet rules and the markup order only. The reviewer notes the three fixed-width controls of the bar
  take about 270 px today, so a split pane at that width may already overflow without this change.

## Open questions

**Owner**

| # | Question | Recommendation |
|---|---|---|
| OQ1 | Is the publisher's name enough as attribution, or must the pack's `citation_text` (on every record) be shown, or other wording? | The name, labelled "Published by" / "प्रकाशक:"; `citation_text` can be added later without re-ingest (FU6). Answer before the live load. |
| OQ2 | Show a "Public government record" note? | Not in v1; if wanted, keyed from an allowlist of licence classes, never printing the class. |

**Developer**

| # | Question | Recommendation |
|---|---|---|
| OQ-D1 | Deploy after F331's watch, or combined (A7)? | After the watch. |
| OQ-D2 | Inline answer markers' `aria-label`: add the publisher? | No; only source-list bubbles (with context). |
| OQ-D3 | Chip: short code or full name? | Full name everywhere in v1. |
| OQ-D4 | Backfill old saved messages in the browser? | No: the saved citation lacks the metadata; a browser-side guess breaks "never a guess". Saved wording stays frozen (accepted). |
| OQ-D5 | Read `citation.source` as another host candidate? | Not in v1: it equals the regulator's domain on every pack record (measured), so it adds no evidence. |

## Conflicts found

- **C1. Citation fields and lines.** The first brief placed `textCitation` at about 228-245 with title, file name, URL
  and desk only; it is at `citations.ts:229-255` and carries more (fact 1). No publisher either way.
- **C2. Law "attribution" lines moved.** The Law warning is at `agent.ts:449`, not 413-415. `prompt.ts:21-22` and `:29`
  are further attribution rules; `:29` is why the model needs the publisher in the header.
- **C3. F331 pins raw `|` in titles.** `agent_test.ts:2609-2617` asserts `'A | B'` renders byte-identically; D5's escape
  changes that test on purpose. F331's own spec listed raw pipes in titles as an out-of-scope defect.
- **C4. Two spellings of the Regulatory feature** (stored with spaces, catalogue with slashes). D1 folds both.
- **C5. `source_host` versus the file host** (43 of 121 equal, ignoring `www.`, per the screen draft). Under D1's
  subdomain rule the measured hosts all map to the record's regulator (inferred from the host list); the screen check
  confirms it.
- **C6. Regulatory cannot be loaded yet regardless** (F330).
- **C7. `citationMarkers` needs no change.**
- **C8. Review points checked and correct:** `research.css:50-55` and `:77` (the bar's flex rules and its 480 px gap;
  the close control's own rule is in `src/shell/panel-overlay.css:55-71`, not `research.css`); `answerForCopy` at
  `MessageActions.jsx:6-15`; `citation_text` copied by `suppliedText.ts:252`, `255`. No review point was found wrong.

## Not determined

- Whether `research-chat` was redeployed after its last recorded version (F331 C4).
- The pack's top-level `source_host` values (not in the 2026-11-12 counts); the screen check (TS) measures them in effect.
- The contents of `citation_text` (deliberately not read out).
