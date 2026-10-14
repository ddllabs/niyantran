# Plan: the bug programme (F171)

> **Status: Living.** The working log for the [bug programme spec](../specs/2026-10-14-bug-programme.md).
> Starts after F169 phases 2 and 3 (the live-data repair), in the spec's order.

## How each task runs

**Workflow:**
1. Branch `task/<slug>` from `main`, in its own worktree.
2. Write a test that reproduces the bug and fails.
3. Fix the bug.
4. Show the test fails without the fix (mutation check).
5. Run the standard checks.
6. Independent review for anything under `api/`, `server/`, `supabase/` or a security fix.
7. Commit, fast-forward `main`, push.
8. Post-deploy check.
9. Record the result in `open-work.md`, and in `docs/agents/coordination.md` for production changes.

**Standard checks:**
- `npm run lint`
- `npm test`
- `deno test -A --config supabase/functions/deno.json supabase/functions`
- `npm run build`
- `npm run check:bundle`
- the router import

**Edge Function changes** (B11, B12, B13) are deployed with the Supabase tools after their checks
and recorded in `coordination.md`.

## Tasks

| Task | Bug | Write scope | Verification | Depends on |
|---|---|---|---|---|
| T1 | B1 source links | `server/nationalFeed.mjs` (IPM link), the link list shown for GDELT-only modules, tests | A test that no shown link is an `api.gdeltproject.org/api/` address or `ipm.mospi.gov.in`; probe | — |
| T2 | B2 chat uploads | `src/lib/aiDrop.js` (`filesFromDrop` extracts text), `src/ai/AiPanel.jsx` (`requestAttachments` sends it; chip says when nothing was sent), a lazy PDF text helper, tests | `requestAttachments` test (fails today: returns `[]`); a PDF fixture with a typed and a scanned page; `check:bundle` (PDF library stays lazy) | — |
| T3 | B4 file size | `src/lib/aiDrop.js`, `src/lib/aiConversations.js` (`writePins` without file contents), tests | A 50 MB fake file is refused before it is read; pins with a file are saved | T2 |
| T4 | B3 dropped connection | `src/lib/researchChat.js`, `src/ai/useResearchThread.js`, `src/ai/AiPanel.jsx`, tests | Tests: no "Failed to fetch" on screen; no Stop when nothing runs; partial answer kept | — |
| T5 | B5 legal pages | `src/marketing/PrivacyPage.jsx`, `TermsPage.jsx`, `src/admin/AdminApp.jsx`, `AdminSitePages.jsx`, `privacyStore.js`, `termsStore.js` (removed), tests | A stored edit in `localStorage` does not change the page | — |
| T6 | B6 SheetJS | `package.json`, `package-lock.json`, `server/sourceExtract.mjs` (size cap), tests | `npm audit --omit=dev` clean; `budgetStat1` and backup-pack tests pass | — |
| T8 | B8 Live TV | `server/liveTvApi.mjs`, `src/shell/LiveTvModal.jsx`, `src/lib/liveTv.test.js`, `src/lib/apiVerification.test.js` | No "Verified Record", no Unsplash thumbnails, empty schedule says so | — |
| T9 | B9 planned modules | the four desk presentation files, `server/featureFeed.mjs` (planned answer), `deskCatalogue.test.js` | All 19 have `configured: false`; the server fetches nothing for them | — |
| T10 | B10 desk count | `src/marketing/HomePage.jsx`, test | The proof card's count equals the desk list | — |
| T11 | B11, B12 | `research-chat/handler.ts`, `_shared/chatStream.ts`, `_shared/logging.ts`, tests | Deno tests; deploy `research-chat` and every function that bundles `_shared/logging.ts` | — |
| T12 | B13 | Read-only SQL first; a migration and `research-chat` only if two spellings exist | Count of distinct `desk_feature` spellings | — |
| T13 | B14 titles | `src/lib/docTitle.js` (new), the five render sites, tests | The spec's title cases | — |
| T14 | B15–B18 | `LiveTvModal.jsx`, `marketing.css`, `deno.lock` (deleted) | Browser measurements at 320, 768 and 1440 px; keyboard tests | T8 |
| T15 | B19, B20, B22 | Measurements only, then a decision recorded here | Local replica and the `eval` harness | — |

## Owner list (things only the owner can do)

1. **Vercel upgrade** before F169 phase 4 goes live (Hobby does not allow commercial use, and the
   timer needs about 2.8 hours of function time a day).
2. **Signed-in checks on production** (agents do not sign in): the 27 items in `open-work.md`
   marked "waiting for the owner's check".
3. **NSE price feed:** ask NSE Data & Analytics for a quote, or keep the stored prices with their date.
4. **MoSPI IPM:** nothing to do unless a replacement source is wanted; the link returns when its
   certificate is renewed.

## Log

(Each task records its commit, the failing-first evidence and the post-deploy check here.)
