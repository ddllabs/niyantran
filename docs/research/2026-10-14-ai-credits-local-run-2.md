# AI credits: local run 2 in the browser (F111 checkpoint C)

> **Status:** Historical (dated 2026-10-14). Browser evidence for checkpoint C
> of the [plan](../plans/2026-10-14-ai-credits.md), on `task/ai-credits` at
> `46bdc33`, after review R.
>
> **Setup** (local only; nothing touched NTER):
> - **Stack.** A fresh scratch stack (`niyantran-credits-local`) with all 48
>   migrations, seeded with the two Gemini models' rows (copied read-only
>   earlier the same day).
> - **Function.** `research-chat` served with a mode-600 env file (the
>   OpenRouter key, origin `http://localhost:5176`, `CREDITS_ENFORCED=1`).
> - **App.** The worktree's Vite app on :5176, pointed at the local stack by
>   a mode-600 worktree `.env.local` holding local keys only. The app's
>   client URL was checked: `http://127.0.0.1:54321`.
> - **Accounts.** Two local test accounts, a reader and an admin (role set in
>   the local database), with generated passwords.
> - **Admin origin.** The admin page was opened on `127.0.0.1:5176`, so its
>   session stayed separate from the reader's.
> - **Teardown.** Everything was deleted afterwards and the stack stopped
>   with `--no-backup`.
>
> **Cost:** $0.0238 of AI spend.

## Results

| Step | What the browser showed | As specified |
|---|---|---|
| First use (Free, confirmed email) | Chip under the composer: "1,000 credits · ≈ ₹100" | yes |
| One answer (Gemini 3.8 Flash, broad context) | Footer "22.6 credits"; chip "977 credits · ≈ ₹97.74"; the database charge equals logged cost × 950; ledger = balance | yes |
| Admin: remove 900 with a reason | "Removed 900 credits … Balance 77.3558"; Credits column updated | yes |
| Reader after a reload | Answer still shows "22.6 credits" (from `my_conversation_credits`); chip "77.4 credits · ≈ ₹7.74" and "Running low: 77.4 credits left" | yes |
| Admin: remove the rest | "Balance 0" | yes |
| Reader asks at 0 | Blocked notice: "You have no AI credits left to start an answer.", "0 credits · ≈ ₹0", Upgrade and Buy credits; no answer created | yes |
| Upgrade | Plan & billing opened (shell listener): "0 credits", sign-up credits valid until 13 Nov 2026, "Used this cycle: 22.6 credits", recent answer listed, "Top-ups coming soon" | yes |
| Admin: top-up 500, then Plus (open-ended) | "Granted a top-up of 500 … Balance 500"; Plus minted the 2,000 monthly lot at once: Credits 2,500 | yes |
| Reader's Plan & billing on Plus | "2,500 credits ≈ ₹250"; "Monthly allowance 2,000 credits ≈ ₹200, this month ends 14 Nov 2026"; "Used this cycle: 0"; by expiry: Monthly 2,000 (14 Nov 2026), Top-up 500 (14 Oct 2027) | yes |
| Phone width (375 × 812) | Plan & billing and the chat (footer credits, chip "2,500 credits · ≈ ₹250") fit with no horizontal scroll | yes |

At the end, every wallet's balance equalled its ledger sum.

## Not covered in the browser

- **Rollover across a cycle.** This needs a month to pass. It is covered by
  the SQL fixtures (10% of the leftover, next cycle only, never rolled
  again).
- **Dark mode.** Not checked in this run. The task 4 agent rendered the
  chat's credit elements in dark mode in headless Chrome. Plan & billing has
  no dark styles today (all of its existing classes are light only).
