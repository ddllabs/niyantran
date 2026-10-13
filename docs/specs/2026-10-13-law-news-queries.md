# Law news searches: forum-specific queries (F84)

> **Status: Living.** Owner request 2026-10-13 ("fix the broad news searches (F84)"). Branch
> `task/law-news-queries`. Context:
> [Law record panels spec](2026-10-13-law-record-panels.md),
> [Law record panels research](../research/2026-10-13-law-record-panels.md).

## Current state

Nine Law modules have no stored docket and serve live news coverage (`server/featureFeed.mjs`,
judiciary branch). That branch used the source registry's Google News URL whenever there was one.
Those URLs hold product-name searches built from the module title, for example
`India ("ICC" OR "Proceedings")` and `India ("Sector" OR "Tribunals")`. As a result:

- the curated queries in `FEATURE_TOPIC_Q` were never used for these modules;
- ICC, ICJ, WTO, Judge Profiles and Sector Tribunals had no curated query at all.

## Problem

Checked live on 2026-10-13, the product-name searches return unrelated stories:

- **ICC Proceedings:** cricket's ICC.
- **Sector Tribunals:** real-estate and tourism "sector" news.
- **CAT & NCDRC:** badminton streaming ("Watch").
- **Allahabad High Court and District Court:** opposition marches to the Supreme Court.

The record panel already warns that a wire item may not concern the forum, but most items did not.

## Change

1. **Queries.** Each of the nine modules gets a curated query in `FEATURE_TOPIC_Q`: the forum's own
   name (for example "National Green Tribunal", "Income Tax Appellate Tribunal") combined with legal
   terms (order, judgment, appeal, ruling).
   - The international forums (ICC, ICJ, WTO) carry no "India" filter.
   - The ICC and ICJ queries exclude "cricket".
2. **Query choice.** In the judiciary branch, a curated query wins over the registry URL
   (`hasCuratedTopic`). Modules without one still use the registry URL. The GDELT fallback already
   reads the same curated query.
3. **Callout wording.** The record panel's callout no longer says "broad". It now says the item was
   found by a keyword search for the forum and may still not concern it.

Only the nine Law modules match the new keys; no other feature's query changes (checked over the
whole feature map).

## Evidence (live Google News, 2026-10-13, first results)

| Module | Before | After |
|---|---|---|
| ICC | 100 items, cricket (ICC World Cup, selectors) | 100 items: US sanctions on the International Criminal Court |
| Allahabad HC | opposition marches, DW, NPR | 68 items: Allahabad High Court orders (Live Law, Bar and Bench) |
| District Court | Supreme Court protests | 57 items: sessions and magistrate court orders |
| NGT | data-centre protests, cosmetics | 49 items: "NGT directs…", "NGT issues notice…" |
| CAT & NCDRC | badminton streaming, consumer brands | 55 items: NCDRC and consumer commission orders |
| Judge Profiles | cricket "bench strength" | 62 items: appointments, swearing-in, collegium |
| ICJ | Indian court "proceedings" | 47 items: ICJ news (the Navi Pillay Nobel, the Libya application) |
| WTO | settlements, a Tata feud | 8 items: WTO dispute panels (Russia v EU CBAM) |
| Sector Tribunals | office real estate, tourism | 95 items: ITAT rulings |

WTO returns fewer items. The query was kept strict on purpose: eight items about disputes serve a
practitioner better than a hundred about trade in general.

## Acceptance

- `src/lib/lawWireFeed.test.js` asserts, for each of the nine modules, that the Google News request
  carries the forum query and not the product-name pattern. All nine fail on the old code.
- `npm run lint`, `npm test` and `npm run build` pass; the router import passes.
- A browser check of the ICC module on live data.

## Not changed

- The source registry file (`src/data/source-registry.json`).
- Other desks' queries.
- The stored Law tables (Supreme Court, Topic, NCLT).
