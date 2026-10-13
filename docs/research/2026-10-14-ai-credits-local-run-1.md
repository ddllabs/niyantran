# AI credits: local run 1 (F111 checkpoint B)

> **Status:** Historical (dated 2026-10-14). Execution evidence for
> checkpoint B of the [plan](../plans/2026-10-14-ai-credits.md), on
> `task/ai-credits` at `119581d`. No browser UI yet: the run drove
> `research-chat` over HTTP the way the browser does.
>
> **Setup** (local only; nothing touched NTER except read-only copies of the
> two models' `ai_models`, `ai_roles` and `model_pricing` rows):
> - **Stack.** A scratch copy of `supabase/` (`niyantran-credits-local`) with
>   the auth schema first and migration 0007 cut before its NTER cron job.
>   All 48 migrations applied, including `20261014200000_ai_credits`, on the
>   real Supabase Postgres image.
> - **Function.** `research-chat`, served with a mode-600 env file holding
>   the OpenRouter key, the local origin and `CREDITS_ENFORCED=1`; it was
>   deleted afterwards.
> - **Account.** One confirmed test account with a generated password, kept
>   in a mode-600 state file and deleted afterwards.
> - **Teardown.** `supabase stop --no-backup`.
> - **Hold.** `hold_minutes` was set to 1 on this stack only, so the sweep
>   could be seen without waiting 5 minutes.
> - **Models.** Gemini Flash-Lite and Gemini 3.8 Flash. A broken model id
>   was used to force a provider error.
>
> **Cost:** $0.0305 of AI spend (sum of `model_call_logs.cost_usd`).

## Results

| Case | What happened | Expected |
|---|---|---|
| First use | The wallet was created and the 1,000-credit signup lot minted (confirmed email) | yes |
| Normal answer (Flash-Lite) | `complete`; charged 5.1443 credits = logged cost × 950, exactly; `{credits: 5.14}` frame after `done`; 13 log rows, all charged once | yes |
| Stop at 12.6 s (Gemini 3.8 Flash) | `cancelled`; the 4 finished rounds were charged 11.8028 at settle; the cut-off round had no cost | yes |
| Stop: background cost | Within ~40 s the cut-off round's row got `cost_usd 0.003943`, `cost_source: generation` | yes |
| Stop: sweep | After the hold expired, the next reserve's sweep charged that row: the turn total became 15.5487, equal to all its logged cost × 950 | yes |
| Forced provider error, no text | `error`; 0 credits; frame `{credits: 0}` | yes (free) |
| Two turns at once on 1.307 credits | One answered 402 `credits_exhausted` (balance 1.307); the other ran and cost 3.54, leaving −2.2327 as debt | yes |
| A request at −2.2327 (enforced) | 402 with `balance: -2.2327`, no message created | yes |
| Admin top-up of 1,000 | A top-up lot valid to 2027-10-13; the debt was repaid from it: balance 997.7673, debt 0 | yes |
| Shadow mode at 0 credits | The turn ran (`complete`), was charged 4.7738 and left −4.7738 as debt; `research_chat.credits_shadow_blocked` was logged once | yes |

**Invariants at the end** (SQL over the whole stack): every wallet's
balance equals its ledger sum; for every lot, granted − remaining = draws +
expiry; no log row was charged twice; no `chat_messages.usage` holds a cost
key; no stream frame contained `cost_usd`.

## Notes

- **Charges match logged cost exactly.** Every charge equalled `cost_usd ×
  950` to 4 decimals. Embedding rows cost 0 but are still recorded as
  charged rows.
- **Sweep timing.** The first refresh after Stop did not sweep, because the
  hold had not expired yet; this is as designed. With the production hold of
  5 minutes, the background cost (here about 40 s) always lands before the
  sweep.
- **Not covered here.** The browser UI (tasks 4–6) is covered by checkpoint C.
