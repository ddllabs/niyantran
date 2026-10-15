# The record brief shows "writing" only while it is written (F209)

> **Status: Living.** Owner 2026-10-16 ("go"), before the client's new writing animation is added.
> Built on `task/brief-read`.

## Measured (production, read-only, 2026-10-16)

- 50 stored briefs, none failed, all `anthropic/claude-haiku-5.5`. Model call: mean 2,304 ms, median
  2,221 ms, p90 2,537 ms, max 5,091 ms; claim to written: mean 2,533 ms. About 833 prompt and 230
  completion tokens. No web search, no tools, reasoning off (`recordRequestBody`): the model reads
  the record's own fields only (the desk_rows copy, or the browser's row when desk_rows lacks it).
- Opening Open Fronts records A, B, A on the live site wrote nothing (50 briefs before and after), yet
  A showed the writing look both times: the stored read took 1.1-2.5 s (request 0.6-1.5 s, plus
  0.5-1 s of account and profile checks before it), past F205's 1.2 s guess. Nothing remembered a
  brief already seen.

## Change

1. **Read mode** (Edge Function `desk-brief`, scope `record`): `mode: 'read'` never claims or calls
   the model. `peekDecision` mirrors `record_brief_claim`'s "not claimable" test (migration
   20261015240000): it answers the stored brief, `pending` (another request is writing it),
   `failed`, or `missing` (a claim would generate). Without `mode` the request reads or writes in one
   call, as before, so an older browser keeps working.
2. **Browser flow** (`useRecordBrief`): read first; a stored brief shows as it arrives with the plain
   skeleton, never as writing. `missing` switches to `writing` and asks for the write; `pending`
   shows `writing` and reads again every two seconds (about a minute at most). The 1.2 s guess is
   gone.
3. **Session memory**: a brief seen this session (up to 300) shows at once, with no request.
4. **Faster reads** (`deskBrief.js`): the verified identity is reused while its session is unchanged
   (`localIdentityIsCurrent`, a local check) instead of the account and profile round trips on every
   brief; the function still verifies the bearer.

## Evidence

Deno tests for `peekDecision` (each claim rule) and read mode (no claim, no model call); Vitest for
the request (mode, `missing`, identity reuse) and the hook (read first, writing only on `missing` or
`pending`, never for a slow stored read, session memory). Both full suites, lint, build, bundle check.
Deployed function, then browser check on the live site.
