# F351 plan: accept a verdict whose reply leaves out the word "LABEL"

> **Status: Living (2026-11-18).** Written 2026-11-18 on branch `task/f351-plan`. Tracker: F351 in
> [open-work](open-work.md). This file is the spec and the plan together, because the change is one function and its
> tests. Built and reviewed 2026-11-18 on branch `task/f351-check-reply-label` (see "Build record"); not merged, not
> deployed. Each statement below says whether it was executed or read from code.

## Current state

The check step sends one claim to `perplexity/sonar` and asks for exactly two lines, `LABEL: <one of five labels>` and
`REASON: <one sentence>` (`CHECK_SYSTEM` in `supabase/functions/factcheck/prompts.ts`). The reply is plain text because
Sonar does not accept a structured-output request through OpenRouter (F344 spec, G2b).

`readLabels` in `supabase/functions/factcheck/check.ts` looks only for lines that begin with `LABEL:`. A reply with no
such line is stored as `error` with `fail_reason` `no_label`, the panel shows "Check failed", and "Check again" costs
100 credits (read from code).

## Problem

Executed 2026-11-18, read-only, on NTER: of 78 check calls so far, 69 succeeded, 8 were `unusable: no_label` and 1 failed
before reaching the provider (see F353). The 8 rejected replies were 30 to 65 completion tokens long, the same range as
the accepted ones (32 to 75), so they were not empty and not cut off. All 8 re-checks that have been run succeeded.
(The tracker's first figure, 9 of 48, covered the first three sessions only and counted the F353 call as a ninth.)

Executed 2026-11-18: the 9 distinct claims whose checks had failed were sent again 5 times each (45 calls, US$0.24) with
the repository's own prompt, model, temperature and reader. 14 of the 45 replies were rejected as `no_label`. Every one
of the 14 was a well-formed verdict in a slightly different layout:

| Layout of the rejected reply | Count |
|---|---|
| First line is the label alone, then a `REASON:` line | 8 |
| First line is `<label>: <reason>`, nothing else | 4 |
| First line is the label alone, then the reason with no `REASON:` | 2 |

The label was sometimes in capitals (`PARTLY TRUE`, `SUPPORTED`). The other 31 replies had the asked-for layout. No reply
was empty, cut off (`finish_reason` was `stop` in all 45) or without sources (8 sources in all 45).

So the cause is established: Sonar sometimes drops the word `LABEL:`, and the reader requires it. The tracker's earlier
guess that "Check again" would repeat the same reply is wrong: the same claim gave both layouts across runs at
temperature 0.

The raw replies are kept outside the repository, with the script that produced them.

## Expected outcome

A reply that opens with one of the five labels is accepted as that verdict. The owner stops seeing "Check failed" for a
check that in fact succeeded, and stops paying 100 credits to retry it.

## Decisions

- **S1. Read a bare opening label.** Only when the reply has no `LABEL:` line at all, the first non-empty line is read.
  The same line prefix that `readLabels` allows today (spaces, `*`, `_`, `#`, `>`, `-`) is skipped, so "## Supported"
  and "> Supported" count. The line is accepted when what remains, after the existing normalisation (case, markdown
  marks, a trailing full stop), is exactly one of the five labels, or one of the five labels followed by a colon and
  then anything. Bold marks may sit on either side of the colon. A colon with nothing after it is the label alone.
  Anything else stays `no_label`.
- **S2. A `LABEL:` line still wins.** When the reply has one or more `LABEL:` lines, today's rules apply unchanged
  (`bad_label`, `label_conflict`). The new rule cannot change the outcome of a reply that is accepted or rejected for
  those reasons today. This includes a reply whose first line is a bare label and whose later `LABEL:` line names a
  different one: the `LABEL:` line is used, as today, and the bare line is ignored.
- **S3. The label must stand alone.** A first line such as "Supported by three sources, the claim..." is not a label and
  stays `no_label`. The only separator after the label is a colon. A dash is not accepted: no reply in the replay used
  one, and a dash would let "Supported-by official data" through.
- **S4. The reason.** The `REASON:` line when there is one. Otherwise the text after the label: the rest of the first
  line after the colon, or else the following lines up to a `SOURCES:` or `LABEL:` line, the same stop rule as today.
  Cleaned and clipped to 400 characters as today.
- **S5. Bold marks are removed from the reason.** Replies in the replay contained `**11.63%**`. The panel shows the
  reason as plain text (`FactCheckPanel.jsx`, read from code), so the asterisks would be visible. `**` is removed from
  the reason in both the old and the new path. Whether a stored reason already shows asterisks was not looked up.
- **S6. One reader.** `replyFailure` and `parseVerdict` must keep agreeing, so both use the same label reader. The source
  rule (a label other than "No evidence found" needs at least one source) is unchanged.
- **S7. No prompt change and no second model call.** The prompt decides the verdicts; changing it would need a new
  accuracy measurement. A second call would add about 3 seconds and US$0.005 to cover a case S1 already covers.
- **S8. Nothing else is logged.** The reply text is still never stored or logged.

Security note: the claim is untrusted speech. A spoken sentence that could make the model answer with a bare label could
equally make it answer with a `LABEL:` line today, so S1 opens nothing new. The reason is still clipped and shown as
plain text.

## Owner decision

- **OD1. Should "Check again" stay at 100 credits when the failure was only the reply's layout?** Recommendation: leave
  the price alone now. After S1 the layout failures seen so far all become verdicts, so there may be nothing left to
  price. Look at the failure count after the next sessions and decide then. Making a retry free would change billing
  code, which is a sensitive scope.

## Not in this plan

- Verdicts that differ between runs of the same claim (F352).
- The check call that failed in 3 ms before reaching the provider (F353).
- Any browser change, migration, flag change or price change.
- Changing the model, the prompt, the temperature or the token limit.

## Fixed interface

No signature changes. `replyFailure(reply, sourceCount)` and `parseVerdict(reply)` keep their types; `verdictFor`,
`checkAction` and `recheck.ts` are not edited. `FailReason` keeps its four values.

## Tasks

Sequential, one builder, one write scope.

### T1. Bare-label reading (builder)

- **Write scope:** `supabase/functions/factcheck/check.ts`, `supabase/functions/factcheck/check_test.ts`.
- **Tests first, seen failing before the change:**
  - label alone on line 1, `REASON:` on line 2: accepted, reason from the `REASON:` line;
  - `<label>: <reason>` on one line: accepted, reason is the text after the colon;
  - label alone on line 1, reason on line 2 with no `REASON:`: accepted, reason is line 2;
  - capitals, bold marks, a trailing full stop and trailing spaces on the bare label: accepted;
  - each of the five labels in bare form, including "No evidence found" with zero sources (accepted) and "Supported"
    with zero sources (`no_sources`);
  - `**Supported:** reason`, `**Supported**: reason`, `## Supported` and `> Supported`: accepted;
  - `Supported:` with nothing after it, reason on the next line: accepted;
  - a bare label followed by reason lines and then a `SOURCES:` line: the reason stops before `SOURCES:`;
  - `[1]` citation marks and `**` removed from the reason in both paths.
- **Tests that must stay rejected (`no_label`):** prose that begins with a label word ("Supported by ...", "Opinion
  polls show ..."); a dash or a hyphen after the label (`Supported - reason`, `Supported — reason`, `Supported-by ...`,
  `Opinion-based ...`); a label on the second non-empty line only; an empty reply; `null`.
- **Tests that must not change:** a reply with a `LABEL:` line naming no label stays `bad_label` even when its first
  line is a bare label; a bare "Supported" first line with a later `LABEL: Contradicted` is Contradicted; two `LABEL:` lines that differ stay `label_conflict`; every existing test in
  `check_test.ts` and `recheck_test.ts` passes unedited, apart from additions.
- **Agreement test:** for every string in the test table, `replyFailure(s, 1) === null` exactly when
  `parseVerdict(s)` is defined.
- **Acceptance:** all of the above, and no line of `check.ts` outside the label reader, the reason reader and their
  comments is changed.
- **Verify:** `deno test -A --config supabase/functions/deno.json supabase/functions`.

### T2. Replay against the saved replies (supervisor)

- Run the real patched `replyFailure` and `parseVerdict`, imported from the checkout, over the 45 saved replies with a
  script kept beside them outside the repository (the earlier `shapes.ts` there used a prototype rule, not the reader).
- **Acceptance:** the 14 rejected replies are accepted with the label a person reads in them; the verdicts of the 31
  accepted replies are identical before and after; reasons are non-empty for all 45.

### T3. Review (independent reviewer, then supervisor)

- Review T1 for correctness and for any way S1 could turn prose into a verdict. Findings fixed and re-verified.
- **Gates (supervisor reproduces):** `npm run lint`, `npm run build`, `npm test` and the Deno suite above. No SQL changed, so the SQL
  fixtures run in CI only.

### T4. Tracker and pull request (supervisor)

- Record the result in this file and in F351. Open the pull request. Merge only on the owner's yes naming the number.

## Release

Needs the owner's exact yes for each: merging the pull request, then deploying function `factcheck` (version 6) from
`main`. No migration. Deploy only when no session is active. Rollback: redeploy the previous commit of the function;
no stored data changes shape.

## Acceptance evidence after release

- Outside checks on the function as before (405, 401, 401, 403).
- One real session on the live site. Afterwards, read from the log: count of `unusable: no_label` among the check
  calls of that session. Expected 0; any that remain are looked at with the replay script, and OD1 is decided on the
  figure.

## Risks

| Risk | Effect | Handling |
|---|---|---|
| A prose reply that opens with a label word is taken as a verdict | A wrong verdict is shown | S3 and the rejection tests; every label but "No evidence found" still needs a source |
| The model writes "Opinion: I cannot verify this" or "No evidence found: but reports suggest ..." as ordinary English | Shown as Opinion or No evidence found, which need no source | Accepted: both are the cautious labels, and the same words after `LABEL:` are accepted today |
| Sonar starts using a third layout | Some checks still fail | Counted after release; the replay script shows the layout |
| The fix hides the instability in F352 | A verdict looks more certain than it is | F352 is tracked separately and is not closed by this plan |

## Build record (2026-11-18)

Executed by the supervisor unless stated.

- **T1.** Built by a task agent in `check.ts` and `check_test.ts` only. Five tests added, none edited. Two failed
  before the change (a bare label is a verdict; a bare label and the source rule); three passed before it by design,
  because they guard what must not change (the rejection table, "a LABEL line still wins", the agreement test).
- **T2.** The real `replyFailure` and `parseVerdict` over the 45 saved replies: all 14 rejected replies are accepted
  (10 Partly true or Supported with a label alone, 4 with `Supported: reason`), the 31 accepted replies keep their
  verdicts, and no reason is empty.
- **T3.** Independent review: accept, with one fix. The first form of the bare-label pattern took 1.9 s on a first
  line of a label, 50,000 spaces and one letter (a reply is capped at 700 tokens, so not reachable in practice). The
  pattern was simplified; the same input now takes under 1 ms, and T2 was run again with the same result. The reviewer
  tried about 40 hostile strings; none became a verdict outside S1, and the two functions never disagreed.
- **Known and accepted:** `Supported: but actually contradicted` reads as Supported, as the same words after `LABEL:`
  do today. A single `*` or `_` stays in a reason; only `**` is removed (S5).
- **Gates:** `npm run lint` clean; `npm run build` and `npm run check:bundle` pass; `npm test` 8,104 passed;
  the Deno suite 1,874 passed (1,869 before).
- **Not done:** merge, deploy of function `factcheck`, and the real session after release.

## Part 2: ask again when a reply cannot be read (added 2026-11-18)

Part 1 was merged on 2026-11-18 in pull requests 171 and 170 (`71aca0f9`); it is not deployed. The owner asked the same
day that a failed check be retried on our side, up to three times, before the panel says "Check failed", and approved
building this before the deploy so that one deploy carries both parts.

### Current state (read from code)

- A call that fails outright (network, timeout, server error) is already tried three times by the browser, waiting
  0.5 s and 1 s (`retriesTransient` in `src/lib/factcheck/session.js`).
- A reply that arrives but cannot be read as a verdict is stored as an error at once, with no second attempt
  (`verdictFor` in `check.ts`). Part 1 removes the one layout seen so far; any other unreadable reply still fails
  on the first attempt.

### Decisions

- **R1. Where.** In `verdictFor`, which the first check and the paid "Check again" share.
- **R2. When.** Only when the reply cannot be read: `no_label`, `bad_label` or `label_conflict`. Not for `no_sources`:
  the owner decided on 2026-11-17 (F349, D1) that it is shown as "No sources found", and the panel treats it as an
  answer.
- **R3. How many.** At most 3 model calls for one check: the first and up to 2 more. The same prompt each time; the
  replay showed the layout varies between runs of the same prompt.
- **R4. Time limit.** A further call starts only if less than 15 seconds have passed since the first one began. A call
  can take up to 25 seconds, so the whole check stays under 40 seconds, inside the browser's 45-second limit and the
  90-second lease. Typical calls take about 3 seconds.
- **R5. Provider failures are not retried here.** A call that fails outright still ends the check as today, and the
  browser's own three tries cover it. Retrying in both places would multiply to nine.
- **R6. What is stored.** The first readable reply. If none of the attempts can be read, the error of the last attempt.
- **R7. Cost and charges.** Each extra call costs us about US$0.005. The user is charged nothing extra: the first check
  is part of the session, and "Check again" is still one charge of 100 credits however many calls it makes.
- **R8. Logging.** Each call already writes its own row in the model-call log (an unreadable one as
  `unusable: <code>`), so the number of re-asks can be counted there. The `factcheck.check` log line gains `attempts`.
  No reply text is logged.

### Fixed interface

`verdictFor` returns `{ result, citations, attempts }`; nothing else changes shape. `checkAction` logs `attempts`.
`recheck.ts` is not edited unless its log line needs the new field.

### Tasks

- **T5. Build (builder).** Write scope: `supabase/functions/factcheck/check.ts`, `check_test.ts`, and additions only
  to `recheck_test.ts`. Tests first, seen failing:
  - unreadable then readable: 2 provider calls, the verdict is stored, the claim is `checked`;
  - unreadable three times: exactly 3 calls, stored as `error` with the last reason;
  - readable first time: exactly 1 call (as today);
  - `no_sources`: exactly 1 call;
  - a provider failure on the first or the second call: no further call, the same 502 as today, the claim released;
  - the clock past 15 seconds after the first call: no further call;
  - a paid "Check again" with an unreadable then a readable reply: 2 calls, one charge of 100 credits;
  - one model-call log row per call.
- **T6. Review (independent), then the supervisor's gates** as in T3.
- **T7. Tracker and pull request.** Merge only on the owner's yes naming the number.

### Release

One deploy of function `factcheck` from `main` carries Part 1 and Part 2. No migration. The owner's exact yes is
needed for the merge and for the deploy.

### Build record for Part 2 (2026-11-18)

Executed by the supervisor unless stated.

- **T5.** Built by a task agent in `check.ts`, with seven tests added (six in `check_test.ts`, one in
  `recheck_test.ts`), all failing before the change. The builder stopped at three older assertions that expected one
  model-call log row for an unreadable reply; three is now correct (R3, R8), and the supervisor changed those three
  counts. `recheck.ts` is not edited.
- **T6.** Independent review: accept, no required change. It removed or altered the rule seven ways in a scratch copy
  (no re-ask, four calls, the 15-second boundary, no time limit, re-asking `no_sources`, skipping `label_conflict`,
  keeping the first error) and each was caught by a test. Charging: one charge, only for a saved verdict, checked by
  test. The lease and release behaviour is unchanged.
- **Known and accepted:**
  - worst case about 40 seconds of model calls against the browser's 45-second limit for a first check; typical
    calls take 3 seconds, so three fit in about 9;
  - if unreadable replies are followed by an outright provider failure, the browser's own retries start again, so one
    check can reach about nine model calls (about US$0.05) in that rare combination;
  - a paid "Check again" does not log `attempts` in its own log line; the model-call log has one row per call.
- **Gates:** `npm run lint` clean; `npm run build` and `npm run check:bundle` pass; `npm test` 8,104 passed; the Deno
  suite 1,882 passed.
- **Not done:** merge, the deploy of function `factcheck`, and the real session after release.
