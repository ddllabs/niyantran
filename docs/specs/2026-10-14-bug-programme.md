# Spec: the bug programme (F171)

> **Status: Living.** Owner, 2026-10-14: "You have complete authority … We can fix everything that
> is under your control. For the things that I need to do, you can note it down … Regarding the
> bugs, I'll follow your order. Ideally, we need to fix all of it." Plan:
> [bug programme plan](../plans/2026-10-14-bug-programme.md).
>
> **Evidence.**
> - "Read" means read from the code at `4bac399` by three read-only investigations on 2026-10-14.
> - "Measured" means a command was run the same day.

## In plain words

Twenty-one open bugs were found outside the live-data repair (F169), plus one serious new one: files
uploaded into AI chat never reach the AI. Each bug is fixed the same way:
1. reproduce it with a test that fails;
2. fix it;
3. show the test fails without the fix;
4. run every check;
5. push.

Some bugs turned out to be already fixed, or to need something only the owner can do. Those are
marked below.

## Order and status

Items are worked in this order. "Owner" marks a step only the owner can take; it is listed in the
plan's owner list and never blocks the items around it.

| # | Bug | Status found (read or measured) | Fix | Size |
|---|---|---|---|---|
| B1 | **F89** dead source links on National | Measured: eProcure answers 200 now; GDELT still refuses; `ipm.mospi.gov.in` certificate expired | Remove the IPM link (`server/nationalFeed.mjs:655`) until it works; never show a raw GDELT API address as a source link; eProcure needs no change | S |
| B2 | **F172 (new)** files uploaded into chat never reach the AI | Read: `requestAttachments` (`src/ai/AiPanel.jsx:171-186`) keeps only attachments with top-level `text`; uploaded files carry text under `files[]`, so every file is dropped without a word; the chip still shows "attached" | Send the file's extracted text; text, CSV and spreadsheet files are read in the browser, and PDFs through the PDF library already used by the viewer, page by page; a file with no readable text says "not sent: no readable text" on its chip | M |
| B3 | **F66** chat after a dropped connection | Read: shows the browser's "Failed to fetch", keeps a Stop button, hides the partly written answer, checks the saved answer only once | Plain message; Stop only while something is running; keep the partial answer; re-check the saved answer every few seconds until its deadline | S–M |
| B4 | **F62** chat file size | Read: files are read whole before any check; file contents are saved in browser storage, so one large file stops every chip from being saved | Refuse a file over 25 MB (or 50 MB in total) before reading it; keep file contents out of browser storage (metadata and extracted text only) | S |
| B5 | **F108** legal page edits are per-browser | Read: the admin Privacy and Terms editors save to `localStorage` only; visitors always see the defaults | Remove the two editors; the pages render the published text in `src/lib/legalPolicies.js`, as the other policy pages do | S–M |
| B6 | **P12** security advisories | Measured: `npm audit --omit=dev` reports one high (`xlsx` 0.18.5, prototype pollution and ReDoS; no npm fix) | Install SheetJS 0.20.3 from SheetJS's own distribution (`cdn.sheetjs.com`), the vendor's documented source; cap the input size before parsing. Development-only advisories (Vite 5, Vitest 3) are a separate major upgrade, B6b | S |
| B7 | **F44** preview address rule | Read: `supabase/functions/_shared/cors.ts:21-36` lets any `niyantran-*-ddl-labs.vercel.app` call the functions. Already an accepted risk (`open-work.md` section 7): the functions take a bearer token, not cookies, so a matching site gains nothing | Closed into the accepted risk; no code change | — |
| B8 | **F7 / O7** Live TV invented content | Read: hand-written transcripts labelled "Verified Record", invented archive entries and schedules, placeholder programmes, hard-coded "LIVE" status | Remove invented content; show "Schedule not published", "No archived broadcasts", "No transcript available"; no "LIVE" badge until liveness is checked | S |
| B9 | **F173 (new)** four unbuilt modules not marked planned | Read: Sports Governance & Policy, Election Forecast Aggregator, State Fiscal Deep-Dive and Municipal & Panchayat Tender Aggregator show news rows or empty states instead of the "Module planned" state the other 15 show | Mark all 19 planned (`configured: false`); the server answers a planned module with the planned state instead of fetching news nobody sees | S |
| B10 | **F30** hand-typed marketing figures | Read: "9,819", "211+" and "99.9%" are gone (F142); the homepage still says "12 Desks" while pricing says "Eight desks" | The desk count comes from the desk list. The preview cards' sample figures stay on the client list (F144) | S |
| B11 | **F67** reasoning usage shown as zero when unknown | Read: `research-chat/handler.ts:701` turns "unknown" into 0; nothing shows it today, but live and reloaded turns disagree | Send null when unknown and the partial count when partial, as the saved row does | S (Edge deploy) |
| B12 | **F36** server logs hide harmless numbers | Read: `_shared/logging.ts:4` hides any field whose name contains "token" or "key" | Redact an exact list of secret names and secret-shaped values; look inside arrays | S (Edge deploy) |
| B13 | **F39** chat's desk filter misses alternate spellings | Read: `featureScopeOf` (`research-chat/handler.ts:730-741`) keeps the first spelling | First measure whether the library holds two spellings (read-only SQL); fix only if it does (a migration and a deploy) | S–M |
| B14 | **F52** malformed document titles | Read: no display-time tidy; 73 of 9,819 bill names have unbalanced brackets and 352 have no space before the year | A display-only tidy for the safe cases; titles are never changed in the database | S |
| B15 | **F61** tab keyboard behaviour | Read: Nuclear's tab component no longer exists; Live TV's category pills claim to be tabs without behaving like them | Live TV categories become pressed buttons; the lower tabs get the keyboard pattern used elsewhere | S |
| B16 | **F80** trivia band overflow on phones | Read: fixed in `3717f95` at 768 px and below, not re-measured at 320 px | Measure at 320, 768 and 1440 px; apply the rule at every width; close | XS |
| B17 | **F47** phone header avatar cut | Read: probably fixed by the newer header; not measured | Measure at 320 px; close or fix | XS |
| B18 | **F31** stale `deno.lock` | Read: nothing reads it (`"lock": false`) | Delete it | XS |
| B19 | **F35** whole-library search misses documents | Recorded: 157 of 184 found in the top 10, against 170 for exact search | Measure a higher `hnsw.ef_search` for unscoped searches on a local replica, then decide | M |
| B20 | **F41** wide chat answers are slow | Recorded: 65 s on one bill question | Already capped once; next is the measured provider-preference trial in the F41 plan | M |
| B21 | **F37** indexing redoes the whole document | Read: each claim recomposes and rewrites every page | Parked with chunking and OCR (F170); only matters above about 3,000 pages | — |
| B22 | **F59** occasional viewer stutter | Recorded: cause not found | Measure first; close if it does not reproduce | S |

## Acceptance evidence

- **Tests:** each fixed bug has a test that fails without its fix (shown in the plan's log).
- **Checks:** `npm run lint`, `npm test`, the Edge tests, `npm run build`, `npm run check:bundle`
  and the router import pass before each push.
- **Visible fixes:** checked in the browser on a local copy where signing in is not needed;
  otherwise by tests, because agents do not sign in to production.
- **After deploys:** a post-deploy check on production for each server-side fix.

## Exclusions

- Payments (O6, P2), chunking and OCR (F170, F37), and the corpus work (R7, L1, L2).
- New data sources for the 19 unbuilt modules (they are marked planned, not built).
- The client's 15 open preview questions (F144).

## Owner decisions taken as recommended (2026-10-14, "proceed ahead with all your recommendations")

- IPM link removed until its certificate is renewed.
- Legal pages are not editable in the admin.
- SheetJS installed from its own distribution.
- Live TV shows only what is real.
- File limit 25 MB per file and 50 MB per message.
- Unbuilt modules marked planned.
