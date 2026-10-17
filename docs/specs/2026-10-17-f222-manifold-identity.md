# F222: Preserve Manifold market IDs

> **Status: Normative.** Owner approved local implementation on 2026-10-17.
> Production writes, push and deployment require separate approval for this change.

## Current state and problem

The two Manifold loaders receive upstream market IDs and use them to deduplicate
search results, but `src/lib/econPack.js` drops them from mapped rows. The feed
store consequently retains URLs and questions without the provider's ID. This
makes later source inspection harder when URLs or creators change.

Read-only upstream checks returned HTTP 200 for all four `/_deleted_/` market
URLs found in daily history: each had an ID, an unresolved status and a future
close time. The creator username was `_deleted_`. These are not grounds to
remove the markets. Empty variants identify default feeds; the repeated BJP
rows are valid daily observations. Existing board columns already say CLOSES.

## Outcome and interface

Preserve the upstream `id` as optional `market_id` on mapped rows for Political
Odds and Election Forecast. Accept only string IDs of 1–200 ASCII letters,
digits, underscores or hyphens; omit invalid or absent IDs without inventing
one from a URL or question. Keep the existing snake_case row convention.

`market_id` is source metadata, not a storage key. Keep `item_key`, all current
filters, variant semantics, closing dates and displayed columns unchanged.
Rows without IDs remain readable and retain their old shape. The generic JSON
store carries the new field without a database migration. After a separately
approved deployment, ordinary scheduled refreshes can enrich existing records
under their current keys and today's daily observation. Older daily snapshots
remain unchanged. A changed JSON payload legitimately changes its content hash.

## Scope and acceptance

- Map valid IDs through both real loader paths. Retain separate upstream IDs
  for separate markets with identical questions, including deleted creators.
- Prove mapped rows reach the existing store serializer and reader with IDs
  intact; adding an ID preserves item keys and updates the content hash.
- Prove legacy rows and invalid IDs do not gain fabricated identifiers.

Write scope: `src/lib/econPack.js`,
`src/lib/manifoldIdentity.test.js`, this spec,
`docs/plans/2026-10-17-f222-manifold-identity.md`,
`docs/research/2026-10-17-f222-manifold-identity-evidence.md` and the sole tracker
`docs/plans/open-work.md`. No new dependencies.

## Verification and boundaries

Vitest tests use synthetic provider responses, the real loaders, serializer and
reader, and injected network/database boundaries. Show new ID assertions fail
before changing runtime code. Run the focused suite, full `npm test`,
`deno test -A --config supabase/functions/deno.json supabase/functions`,
`npm run lint`, `npm run build`, `npm run check:bundle` and
`node -e "import('./api/router.js').then(() => console.log('router import ok'))"`.
Node commands use the existing external no-dotenv preload guard.

No schema or SQL changes, key migration, historical backfill, deletion, forced
refresh, timers/serve changes, live database tests, model calls, ingestion or
payment work. No Docker is needed. Existing F221 test-isolation work is separate.
Rollback is reverting the additive mapper change; stored metadata can remain.
