# Cabinet filter (F125) and MP house and parties (F126)

> **Status: Living.** Owner request 2026-10-13 ("push it and start F125 and F126"), after the owner
> asked that none of this change the truth of the app. Each change only shows more precisely what
> the source itself says. Branch `task/cabinet-filter-mp-house`.
> Context: [National record panels spec](2026-10-13-national-record-panels.md) (owner decision 3).

## F125: Cabinet Decisions shows only Cabinet decisions

**Current state.** The National module serves the latest PIB press releases from every ministry
(`server/nationalFeed.mjs`, Cabinet branch, `PIB_RSS`), and labels every row with the publisher
"Press Information Bureau" as its ministry.

**What the source says (checked read-only, 2026-10-13):**
- **RSS:** PIB's RSS items hold only a title and a link.
- **Release page:** each release page names its issuing body in a `MinistryName` field. The stored
  CCEA decision on MSP (PRID 2260617) reads "Cabinet Committee on Economic Affairs (CCEA)".
- **Today's feed:** all 20 releases carry the field, and none is a Cabinet decision.
- **Consequence:** the PIB feed holds only the latest ~20 releases across all ministries, so on most
  days it contains no Cabinet decision.

**Change:**
1. **Read the issuing body.** The server's PIB step, which already opens each release page to
   resolve English titles, also reads the `MinistryName` field into the row's `ministry`. It prefers
   the English page.
2. **Recognise the Cabinet bodies.** A shared predicate, `isCabinetBody` in `src/lib/national.js`, is
   true for:
   - "Cabinet";
   - "Cabinet Committee on …" (for example CCEA);
   - "Appointments Committee of the Cabinet";
   - the Hindi "मंत्रिमंडल" forms (unverified fallback).

   It is never true for "Cabinet Secretariat".
3. **Filter the feed.** The Cabinet branch keeps only rows whose issuing body passes the predicate,
   applied to both live and stored rows. When the live window has none, the module shows the stored
   Cabinet decisions and says so. Nothing is inferred from titles at the server.
4. **Update the record panel.** It treats an issuing body that passes the predicate as a Cabinet
   decision, shows that body as the ministry, and drops the "not yet filtered" wording.

**Not changed:**
- the State desk's own "Cabinet Decisions" module;
- the Policy Pipeline Tracker, which shares the PIB feed;
- no extra PIB pages are fetched beyond the release pages already opened.

## F126: MP register house and party names

**Current state.** `national_mp_report_card` has no house column: 540 rows link to `sansad.in/ls/`
and 242 to `sansad.in/rs/`. The desk labels the whole register "18th Lok Sabha". Party names differ
by house: Lok Sabha rows use abbreviations ("BJP"), Rajya Sabha rows full names ("Bharatiya Janata
Party").

**Change (client shaping, `prepareDeskFeed`, so the live and stored paths agree):**
1. **House.** Each row gets `house` from its own `sansad.in` link: `/ls/` gives Lok Sabha, `/rs/` gives
   Rajya Sabha, and anything else is left empty.
2. **Party.** Each row gets `party` set to the abbreviation the Lok Sabha rows already use, with the
   original kept in `party_raw`. A name is mapped only when it is unambiguous:
   - "Shiv Sena" and "Nationalist Congress Party" both split into two parties, so they stay as held;
   - "Independent & Others" stays as held.
3. **Labels.** The desk and server labels say the register covers both houses.
4. **Record panel.** It reads `house` and shows the original party name when it differs.

**Acceptance:**
- every row's house matches its link;
- every mapped party has an unambiguous pair;
- the ambiguous names are untouched;
- the Lok Sabha seat-share chart's party filter now also finds the same party's Rajya Sabha members;
- tests fail on the old behaviour.

## Verification

`npm run lint`, `npm test`, `npm run build`. The router import check applies, because `server/`
changes:

```bash
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
```

Also a browser check of both modules.
