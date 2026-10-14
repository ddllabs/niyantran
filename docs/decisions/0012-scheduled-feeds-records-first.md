# ADR 0012: Module data is fetched on a schedule and kept as records

> **Status: Normative.** Owner decisions of 2026-10-14 and 2026-10-15 (F160, F169 phase 4, F170
> rules 1–3). Spec: [scheduled module data](../specs/2026-10-14-scheduled-module-data.md), amended by
> its Amendment A. Plan: [next work](../plans/2026-10-15-next-work.md), Part C.

## Context

A reader who opens a module waits on its outside sources, with a 4-second limit. If a source is
slow or down, the module shows stored records or nothing. Live answers are never kept, so
Niyantran cannot be a research record of what it has shown.

The owner asked for a platform where every listed item is stored and can be researched. The
owner also chose a 5-minute timer, not every minute.

## Decision

1. **The schedule runs in Supabase.**
   - A `pg_cron` job in NTER, every 5 minutes, posts through `pg_net` to `POST /api/feeds/refresh`
     on the Vercel function.
   - The function reuses the existing loaders (`server/featureFeed.mjs`) and refreshes the modules
     that are due, within 55 s.
   - A shared secret (Vault and Vercel, production only) protects the route.
2. **Items are kept as records, not as one snapshot per module.**
   - **`feed_items`**: one row per listed item, keyed by module and a stable item key: the corpus
     identity for bills, else the link, else a hash of title and date (`server/feedSchedule.mjs`
     `itemKeyFor`). A refresh updates an item in place.
   - **`feed_state`**: the schedule, health, last answer notes and a `serve` switch per module.
   - **`feed_runs`**: one row per attempt, kept 30 days.
   - **`feed_daily`**: one summary a day for measurement modules.
3. **How long items are kept depends on their kind** (`FEED_CLASSES`):

   | Kind | Kept |
   |---|---|
   | Official records, events | Forever |
   | News | Headline, link, date and excerpt |
   | Measurements | Latest value, daily summary, detail for 30 days |
   | Charts | Current list only |
   | Reference sets | Replaced each run |

4. **Pages read the records.** A scheduled module is served from `feed_items`, newest first. If the
   store is empty or unavailable, the module falls back to today's live path.
5. **Not part of this decision:** chunking, OCR, full-text fetching and embeddings (F170 rules 4–9).
   New items stay separate from `desk_rows`, the AI's citable records, until that is decided.

## Consequences

- Pages stop waiting on outside sources, and a source outage shows the last stored items with
  their age.
- The database grows. The estimate is about 3 GB a year at 2,000 new items a day; it is measured
  in the first week and shown on the admin screen with a warning at 5 GB.
- The Vercel function runs about 3,000 short refreshes a day. Vercel's Hobby plan does not allow
  commercial use, so the job is switched on only after the owner upgrades.
- Rollback: switch `serve` off for a module or all, then disable the job; the tables can stay.
