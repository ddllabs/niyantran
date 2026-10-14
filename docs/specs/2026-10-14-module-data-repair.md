# Spec: module data repair (F169)

> **Status: Living.** Proposed 2026-10-14 after the [module audit](../research/2026-10-14-module-audit/README.md);
> awaiting the owner's approval. Plan: [module data repair plan](../plans/2026-10-14-module-data-repair.md).
> F160 (scheduled module data) is the last phase of this work and keeps its own
> [spec](2026-10-14-scheduled-module-data.md).

## In plain words

The audit found that the terminal's modules fall into five groups: 44 work live, 10 work live but
often miss the 4-second limit, 4 have a broken live source, 46 have only stored data, and 19 were
never built. Most of what looks wrong to a reader (one listing, counts that jump, a month-old news
wire, a page that cannot load) comes from a short list of causes, and most of those are small,
separate fixes.

The proposal, in the order it should happen:

1. **Stop showing the wrong data.** The live site now serves every backup Excel file, and some of
   them hold a different kind of record from their module (Box Office shows news headlines). Turn
   that off.
2. **Repair the broken and thin sources.** Fix the addresses, parameters and source order that the
   audit pinned down (PIB, ISL, Regulatory Watch, Geopolitics, Manifold, Wikidata, Morning Brief,
   Statement Tracker).
3. **Tell the truth about freshness.** Every stored module shows its "as of" date, and the admin
   API status screen shows what readers actually receive.
4. **Serve from the database on a schedule (F160)**, seeded with the larger registers that exist
   today only in backup files (158 Cabinet decisions, 4,104 MLAs, 14,123 constituencies). This ends
   the flipping counts and the slow first visits for good.

Phases 1 to 3 are small code changes, each shippable on its own, about a week of work in all.
Phase 4 is the F160 project.

## What you'll notice

- After phase 1: no module shows a different kind of data from its title. A few modules that
  relied on a backup file may show fewer rows until phase 4, and say so plainly.
- After phase 2: AI & Tech, Morning Brief and Statement Tracker work on the live site; ISL Tracker
  shows the season (about 154 matches), Regulatory Watch shows RBI and SEBI together, Geopolitics
  News Wire is current, and Prediction Markets stops jumping between 31 and 250 rows.
- After phase 3: every stored table says how old it is ("As of 7 Sep 2026"); the admin screen's
  "Live" count drops from 130 to the real figure (about 70) and says why each other source is not
  live.
- After phase 4: modules open in well under a second every time, show "Updated 12 min ago", and
  Cabinet Decisions keeps every decision instead of PIB's last 20.

## 1. Current state (measured 2026-10-14)

Details for every module are in the [audit](../research/2026-10-14-module-audit/README.md).

| Verdict | Modules | Examples |
|---|---|---|
| Live and working | 44 | World Constitutions, Growth Indicators, Law news searches, Fixtures |
| Live, often over 4 s | 10 | Prediction Markets, Athlete Index, Box Office, Celebrity Index, MLA Directory, District Performance, Geopolitics News Wire |
| Live source broken | 4 | AI & Tech (PIB redirect), Top Financial & Business Players (Wikidata timeout), Morning Brief and Statement Tracker (`/api/rss` 404) |
| Stored only | 46 | Bills, Questions, Goa electoral modules, most Global registers, Carbon tables, Supreme Court and NCLT tables |
| Planned or never built | 19 | 17 State modules, Election Forecast, Sports Governance |

The causes, grouped:

1. **Backup files on the live function.** Vercel's file tracing packages the whole 82 MB
   `backup/` folder because `server/backupFeed.mjs` reads it at run time; the four-file
   `includeFiles` list from F156 restricts nothing. Since F156 the router calls the backup
   fallback, so every pack is in use. Some packs are a different kind of record from their module:
   Box Office → news headlines, OTT → a TV schedule, Sports Governance (never built) → month-old
   headlines, Satellite Infrastructure → a satellite catalogue instead of launches, Growth and
   Trade → 500 World Bank rows instead of 20 economies.
2. **The 4-second limit (F154) against slow sources.** Ten modules answer live on one request and
   stored or empty on the next, depending on the server instance. GDELT refuses every request
   (429 after about 11 s), and Geopolitics News Wire waits for it before trying BBC.
3. **Broken addresses and parameters.** PIB's English RSS now redirects to the Hindi feed unless
   `reg=3` is given (`server/featureFeed.mjs` PIB URL constant, shared by AI & Tech, Cabinet and
   Policy Pipeline). ISL asks ESPN for today only. Regulatory Watch stops at the first feed that
   answers. The Top Business Players Wikidata query times out. Morning Brief and Statement Tracker
   call `/api/rss`, which only the local server has (F166).
4. **Old stored data, larger registers unused.** Stored copies date from 2025 to September 2026
   (Supreme Court orders to 2 July, NCLT to 8 August, tenders with July deadlines still "Open",
   NSE quotes frozen 15 July without the date shown). Larger registers sit in backup files only.
5. **Labels that overstate what is live.** The admin API status screen marks 130 of 138 sources
   "Live" from a hand-written list (`src/lib/apiStatus.js`); about 71 are. Several notes promise
   live connections that do not exist.

## 2. Expected outcome and acceptance

Each phase is accepted by re-running the audit's production probe (task T0) for the modules it
touches, and comparing with the 2026-10-14 baseline.

| Phase | Accepted when (measured on production) |
|---|---|
| 1. Wrong data off | No module serves a `backup-pack` answer unless it is on the allow-list, and every allow-listed pack has a test proving it holds the module's kind of record. Box Office, OTT, Sports Governance, Satellite, Growth and Trade never show another dataset. |
| 2. Sources repaired | AI & Tech returns English PIB rows; Morning Brief and Statement Tracker show items on the live site; ISL Tracker ≥ 100 matches; Regulatory Watch includes RBI press releases and SEBI; Geopolitics News Wire's newest story is under 24 h old on 9 of 10 requests; Prediction Markets answers live within 4 s on 9 of 10 requests; Top Business Players shows rows. `/api/home/refresh` refuses unauthenticated calls (F167); a pending answer is `no-store` (F168). |
| 3. Honest status | Every module whose answer is stored shows an "As of" date taken from the data; the admin API status screen's verdict for each source equals what `/api/feature-feed` returns for it (served, rows, newest, reason), with no hand-written statuses left. |
| 4. Scheduled data | As in the [F160 spec](2026-10-14-scheduled-module-data.md) section 6, plus: Cabinet Decisions shows the 158-decision register with live decisions added on top. |

Every code task also passes `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle` and
the router import, with each new test shown to fail without its fix.

## 3. Design decisions

1. **Backup files on the live site: off by default.** `server/backupFeed.mjs` reads a pack on the
   live function only when the module is on an explicit allow-list kept in code
   (`LIVE_BACKUP_PACKS`), and the list starts empty. `vercel.json` adds
   `"excludeFiles": "backup/**"` to the router so the bundle drops about 82 MB; whether a pack can
   still be included by name is checked on the first deploy (Vercel's documentation does not say
   whether `includeFiles` overrides `excludeFiles`). The local dev server keeps every pack, as
   today. Reason: the code-level allow-list works whatever the bundler does, and none of the four
   packs chosen in F156 turned out to match its module's record kind.
2. **Fix sources one at a time, inside the existing feed code.** No new framework: each fix is a
   change to the loader that already serves the module, with a test against a recorded upstream
   response.
3. **GDELT is dropped from the request path.** It refuses every request and costs 11 s before
   failing. Modules that used it as a first choice go to their second source (BBC, Google News).
   Owner decision (open question 3).
4. **No bot-detection workarounds.** NSE stalls our server's requests; the audit noted it answers
   a browser user agent. Pretending to be a browser to get past a site's blocking is not an
   option. NSE quotes stay stored, with their date shown, until a licensed or official feed is
   chosen.
5. **"As of" comes from the data, not the deploy.** The date is the newest row date or the
   snapshot date recorded in the stored file; when neither exists the page says "Date not
   recorded" rather than guessing.
6. **The admin API status screen and F160 share one source of truth.** Phase 3 makes the screen
   read what `/api/feature-feed` returns; in phase 4 it reads F160's run log. There is never a
   second health screen.
7. **Larger registers go into the F160 tables, not into `public/data/`.** Seeding F160's stored
   copies from the backup workbooks avoids regenerating shipped data files (which needs its own
   approval) and gives each register a date and a refresh path.

## 4. Scope

- Server: `server/backupFeed.mjs`, `server/featureFeed.mjs`, `server/nationalFeed.mjs`,
  `server/financeApi.mjs`, `server/sportsApi.mjs`, `server/homeApi.mjs`, `api/router.js`,
  `vercel.json` (`excludeFiles`).
- Browser: `src/desks/MorningBriefDesk.jsx`, `src/desks/StatementsDesk.jsx`, `src/desks/DeskView.jsx`
  ("As of"), `src/admin/AdminPages.jsx`, `src/lib/apiStatus.js`, `src/lib/refreshFeeds.js`,
  `src/data/source-registry.json` (labels only).
- A read-only production probe script, `scripts/module-probe.mjs`, from the audit.
- Phase 4: everything in the F160 spec.

## 5. Exclusions

- Building the 19 planned modules.
- Regenerating or deleting anything in `backup/` or `public/data/`.
- Bot-detection workarounds of any kind (NSE).
- Paid data sources; choosing one is a separate owner decision.
- AI search (`desk_rows`) changes; F160 keeps them separate.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Turning backups off empties a few modules that only had a backup | The audit lists them; each shows a plain "No stored records yet" until phase 4 seeds it. Measured before and after. |
| `excludeFiles` also removes allow-listed packs | The allow-list starts empty, so nothing depends on it; checked on the first deploy. |
| An upstream changes again (PIB already did) | Each repaired loader gets a test on a recorded response, and the probe script (T0) is re-run after each phase; phase 4 adds alerts. |
| Prediction Markets or Wikidata are still slow after the fixes | Their answers are kept as a stored snapshot until phase 4 schedules them. |

## 7. Open questions for the owner

1. **Turn off backup files on the live site?**
   - **Recommendation:** yes, all of them, with an empty allow-list. None of the four chosen in
     F156 matches its module's kind of record.
2. **Cabinet Decisions: does a "Cabinet approves…" release that PIB files under a ministry count?**
   - **Recommendation:** yes, when the title starts "Cabinet approves" or "Cabinet apprises" and
     the release is on pib.gov.in. The F125 rule (no judging by title) was meant to keep general
     news out, and this keeps it out while recovering the 41% of decisions it drops.
3. **Drop GDELT from the request path?**
   - **Recommendation:** yes. It refuses every request and only adds 11 s of waiting.
4. **Which registers to load first in phase 4?**
   - **Recommendation:** Cabinet's 158 decisions, the 4,104 MLAs and the 14,123 constituencies
     first; the court judgment sets (43,547 Supreme Court, 661,267 High Court) after, because of
     their size.
5. **Order against Razorpay (O6).**
   - **Recommendation:** phases 1 to 3 first (about a week, and they fix what readers see now),
     then O6, then phase 4. Phase 4's groundwork can run alongside O6.
