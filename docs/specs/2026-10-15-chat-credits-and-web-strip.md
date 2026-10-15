# Chat credits notices in the header, and the web source strip (F193)

> **Status: Living.** Owner request 2026-10-15, UI only. Built on `task/chat-credits-strip`.

## Current state

- Under the chat box, `CreditBalance` shows a ring, the balance, a "Credits" link, a low-balance
  warning, and, when research-chat refuses a turn, the refusal with Upgrade and Buy credits (402
  `credits_exhausted`), "credits in use" (402 with `held`), or "could not be checked" with Try again
  (503 `credits_unavailable`).
- The header's balance pill (F184) shows the same balance and a glance popover with no messages.
- The web strip above an answer reads "From the web · unofficial  1 search · 5 sources" in a
  bordered capsule, with site icons overlapping each other.

## Owner decisions (2026-10-15)

1. The credits line under the chat box goes. "We already have a dedicated place at the top next to
   the profile icon to show any kind of credit-related message, notification, or warning."
2. Strip option A: site icons side by side in their own small pill, no outer border.
3. The label is "Web sources"; the "not Niyantran records" note stays in the list that opens.
4. The model's citation instructions are unchanged (it links only the pages it relies on).

## Expected outcome

- **No credit line under the chat box.** `CreditBalance`'s component is removed; its exports
  (`useCredits`, `openPlanBilling`, `OPEN_BILLING_EVENT`, `watchCredits`) stay.
- **The chat panel announces its refusal** through a small store (`chatCreditNotice.js`):
  `{ block, held, retry }`, cleared when the refusal clears or the panel unmounts.
- **The header pill carries every message.** The glance popover starts with the messages:
  - the refusal: "You have no AI credits left…" with Upgrade and Buy credits, or "Your credits are
    in use by an answer that is still running…", or "AI credits could not be checked…" with Try
    again (which retries the turn);
  - then F184's `statusMessages` (overdrawn, empty, low, held, renews), without repeating the
    refusal.
- **A refusal opens the popover by itself,** without taking focus from the chat box, so the reader
  sees why the answer did not start. The pill shows a dot while a warning or refusal stands.
- **The ring** stays as built: the share of the period's credits left, amber when low, red when none.
- **The strip:** icon pill (no overlap), "Web sources", "5 pages", caret; no outer border, a soft
  background on hover. While searching it still says "Searching the web…" and counts pages. The
  search count moves to the list: "1 search · 5 pages · 1 cited".

## Acceptance evidence

- Unit tests for the notice store, the pill's messages (refusal kinds, no duplicate empty message,
  Try again calls the retry), the strip's words and accessible name, the list's count line.
- A wiring test: AiPanel no longer renders `CreditBalance` and publishes the notice.
- Browser check on a local preview: no line under the chat box; the strip; the pill popover.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.

## Exclusions

No backend, prompt or Edge Function change. No change to how credits are read or charged.
