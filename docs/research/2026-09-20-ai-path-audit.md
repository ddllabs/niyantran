# The Ask AI path as it stands — audit

> **Status:** Historical (dated 2026-09-20) — a record of what the code did on
> this date. Not maintained. Later changes are recorded in specs and plans, not
> here.

**Evidence class:** this is a **code reading**, not an execution. The AI path
cannot be executed in this checkout: no provider key is configured (see §4), so
every request to `/api/ai/chat` fails before any model is called. Every claim
below cites the file and line it was read from at `main` = `0edd853`.

## 1. Shape of the path

Browser → `src/lib/aiClient.js` `sendAiChat()` → one `fetch('/api/ai/chat')`
→ `runAiChat()` in `server/aiApi.mjs` (mounted as a Vite middleware in
development, and imported by the Vercel function `api/ai/chat.js` in
production) → one provider call → one JSON response.

- **No tool calling exists.** A search for `tools`, `function_call`,
  `tool_call` and `functionDeclarations` across `server/aiApi.mjs` and
  `api/ai/*.js` returns nothing. `runAiChat()` assembles a single message
  array (`server/aiApi.mjs:415-430`) and calls exactly one of `geminiChat`,
  `openrouterChat` or `deepseekChat` (`server/aiApi.mjs:431-436`). The model
  cannot query anything; it can only read what was placed in front of it.
- **No streaming.** `aiClient.js` awaits `res.json()` (`src/lib/aiClient.js:66`).
  While waiting, the panel renders a static placeholder, "Reading attached
  sources…" (`src/ai/AiPanel.jsx:827-832`). Reasoning tokens, tool steps and
  partial text are never shown because none exist on the wire.
- **Chat state lives in the browser.** `src/lib/aiChatStore.js` keeps up to 40
  chats and 12 attachments per chat under the `localStorage` key
  `niyantranAiChats`. `src/lib/userPrefsSync.js` mirrors it to a local SQLite
  `user_prefs` table through `server/userPrefsApi.mjs`, which is a Vite plugin
  and therefore does not exist in production (see §6).

## 2. What the model is shown: a sample presented as the record

The grounding block is built by `contextBlock()` (`server/aiApi.mjs:143-213`)
from four inputs: pinned attachments, hydrated files, the selected row, and an
optional "desk context". Every path that carries table rows is capped:

| Path | Cap | Where |
|---|---|---|
| desk context, server side | **8 rows** | `server/aiApi.mjs:205` — `deskContext.rows.slice(0, 8)` |
| desk context, client side | **8 rows** | `src/ai/AiPanel.jsx:122` — `.slice(0, 8).map(slimRow)` |
| feed attachment | **6 rows** | `src/lib/aiDrop.js:253` — `slimRows(extras.feed.rows, 6)` |
| feature attachment | **28 rows** | `src/lib/aiDrop.js:130` — `slimRows` default cap |

Desk context is only sent at all when the focus selector is on "Desk sample"
or "Broad context" (`src/ai/AiPanel.jsx:546-547`). The selector labels the
option honestly — "A few rows from the open module plus pins"
(`src/ai/AiPanel.jsx:26`). The system prompt does not: it instructs the model
to "Use ONLY facts present in the attached terminal data for this turn. That
block is the record." (`server/aiApi.mjs:24`). The model is never told that the
block is a sample.

Against the data actually behind those desks (`public/data/embedded_csv/`,
counted 2026-09-20; 74 data files, 32,989 rows, 47 files with more than 8 rows):

| File | Rows | Shown at "Desk sample" |
|---|---|---|
| `national_bill_tracker.json` | 9,819 | 8 (0.08 %) |
| `national_question_database.json` | 8,000 | 8 (0.10 %) |
| `geo_local_results.json` (and five sibling `geo_local_*` files) | 1,731 | 8 |
| `national_mp_report_card.json` | 782 | 8 |
| `finance_manifold_markets.json` | 500 | 8 |
| `national_candidate_affidavit.json` | 483 | 8 |

**Consequence (inferred, not observed):** any question whose answer depends on
more than the first eight rows — a count, a filter, a comparison across the
desk — will be answered confidently from eight rows, because the prompt says
those rows are the record. This is the failure mode the project's own prompt
rules exist to prevent. It could not be observed because the path does not
run; it should be the first thing exercised once a key exists.

## 3. What is well built and must be preserved

The **selected-row** path is solid and is the reason the assistant feels
grounded to a user who clicks a row and asks about it:

- `materializeAiDrop({ kind: 'row' })` (`src/lib/aiDrop.js:170-216`) carries
  the row's columns (up to 32, each value capped at 500 chars), a flattened
  `record_text`, related records and a timeline from the same feed
  (`relatedPacket`, `aiDrop.js:95-128`), and up to three extractable document
  URLs whose text is fetched through `/api/ai/source-extract`
  (`hydrateDocumentFiles`, `aiDrop.js:134-163`).
- `src/lib/sourceUrls.js` separates **registry hub** URLs (provenance only)
  from **extractable** documents with per-site rules for `sansad.in`,
  `sci.gov.in`, `rbi.org.in`, `pib.gov.in` and others (`sourceUrls.js:33-67`),
  ranks extractable URLs PDF-first (`scoreUrl`, `:106-115`), and marks hubs in
  the flattened record as "registry hub — provenance only, not document body"
  (`:198-201`).
- `src/lib/citationGuard.js` drops rows whose only citation is a placeholder
  or non-absolute URL rather than blanking the link and keeping the row.
- The system prompt's honesty rules (`server/aiApi.mjs:22-46`): answer only
  from attached data; say **Not in record** rather than invent; never invent
  citations, case names, bill numbers or URLs; never give buy/sell/hold advice;
  never claim to have read a document when only a hub URL was attached.
- Guard D6: a key supplied in the request body is ignored; keys are read from
  the server environment only (`server/aiApi.mjs:374-380`).
- Guard A-07: live chats use the shipped persona files under
  `src/data/personas/*.md` via `server/personas.mjs`; browser-edited persona
  text is honoured only when `probe: true` (admin probe).
- `server/sourceExtract.mjs` extracts PDF text with `pdfjs-dist` (up to 40
  pages), spreadsheets with `xlsx`, and HTML by tag stripping, with size and
  time caps. No OCR: an image-only PDF yields an error field, not text.

## 4. Nothing runs: no key is configured

- `.env` is absent from the checkout (verified with `ls`; it is gitignored at
  `.gitignore:36`). `.env.example` lists `GEMINI_API_KEY`, `OPENROUTER_API_KEY`
  and the Razorpay/GST variables, all empty.
- `runAiChat()` resolves the key from `GEMINI_API_KEY` / `GOOGLE_API_KEY`,
  `OPENROUTER_API_KEY` or `DEEPSEEK_API_KEY`, each with `NIYANTRAN_AI_KEY` as an
  alias (`server/aiApi.mjs:375-380`), and throws `API key missing on the
  server` when none is set (`:381-386`) — before any file is loaded or any
  context is built.

## 5. Model identifiers are placeholders

`src/lib/aiModelsStore.js` ships five providers:

| id | model | provider | enabled |
|---|---|---|---|
| `gemini-lite` | `gemini-3.5-flash-lite` | gemini | yes |
| `gemini-flash` | `gemini-3.7-flash` | gemini | yes |
| `gpt-astra` | `openai/gpt-6-astra` | openrouter | yes |
| `deepseek-flash` | `deepseek-v4-flash` | deepseek | no ("key not connected on the server yet") |
| `deepseek-pro` | `deepseek-v4-pro` | deepseek | no |

The server retries each primary id through a fallback chain — for example
`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-lite-latest`
→ `gemini-3.5-flash` → `gemini-2.0-flash` (`server/aiApi.mjs:267`), and
`openai/gpt-6-astra` → `~openai/gpt-astra-latest` (`:304`). Whether any
primary id is served by its provider is **unverified**; the chains suggest the
author expected some not to be. There is no server-side registry: the client
sends `model` and `provider` and the server trusts them after a keyword sniff
(`:363-372`).

The admin page `src/admin/AiModelsPage.jsx` lets an admin edit the four role →
model mappings, but saves to `localStorage` only (`saveAiModels`,
`aiModelsStore.js:152-157`).

## 6. Development and production are different systems

`vite.config.js` mounts thirteen server plugins from `server/` — feeds, users,
billing, analytics, user prefs, AI. `vercel.json` ships **four** functions:
`api/ai/chat.js`, `api/ai/desk-brief.js`, `api/ai/fetch.js`,
`api/ai/source-extract.js`, each a thin wrapper importing from `server/*.mjs`.
Everything else — including `/api/users` and `/api/user-prefs` — exists only
in development. `src/lib/apiMode.js` gates the client on `VITE_LIVE_API`,
defaulting to live only under `import.meta.env.DEV`.

## 7. Authentication is not Supabase

A case-insensitive search for `supabase` across `package.json`, `src/`,
`server/` and `api/` returns **nothing**. Login is `src/lib/userStore.js`:
seeded demo accounts with fixed passwords (`userStore.js:13, 26, 88-114`),
persisted in `sessionStorage` / `localStorage`, optionally synced to the local
SQLite `users` table through `/api/users` (`userStore.js:121-135`) — a Vite
plugin, so absent in production. **No user in this application holds a
Supabase session or JWT today.** The nine accounts present in the Supabase
project on this date (see `2026-09-20-supabase-baseline.md`) were created
outside this codebase.

## 8. Implications carried into the specs

1. The tabular grounding needs a real tool, not a bigger sample. See
   `docs/specs/2026-09-20-desk-row-grounding-design.md`.
2. Streaming is a rewrite of `AiPanel.jsx`'s send path, not an endpoint swap.
   See `docs/specs/2026-09-20-streaming-research-agent-design.md`.
3. The selected-row path, `sourceUrls.js`, `citationGuard.js` and the honesty
   rules are kept and re-used, not replaced.
4. Before any edge function can authenticate a caller, the application must
   obtain Supabase sessions. See the auth boundary in
   `docs/specs/2026-09-20-ai-backend-foundation-design.md`.
5. The first execution once a key exists should be a counting question on the
   Bill Passage desk, to turn §2's inference into an observation.
