# National landing redesign

> **Status: Normative.** Approved for local implementation by owner “go”, 2026-10-04. Publication remains separately authorized.

## Current state and problem

National has 12 modules backed by a mixture of stored registers, source feeds and curated lists. The current shared landing fetches one flagship and gives counters broader labels than their evidence supports. The supplied HTML offers richer navigation and visual hierarchy but includes unsupported modules, fabricated example totals and ambiguous live/freshness claims. Evidence: [audit](../research/2026-10-04-national-landing-audit.md).

## Expected outcome

A National-only landing using the mockup's Parliament hero, five illustrated groups, compact module rows, restrained motion, discovery filters and bill-sector chart. It exposes the current catalog and honest data availability, and leads into unchanged production module workspaces. Global and State retain their current landing and navigation behavior.

## Data contract

A summary represents one canonical module and one backing resource identity. Proposed fields: canonical feature ID; resource key; count or null; count basis; preparation/version identifier; source mode (stored/feed-backed/curated/unknown); availability (loading/ready/empty/error); source names/links; source as-of or null; retrieval time; actual available columns; explicit coverage limitations. Fields are evidence-backed, not inferred from module titles or `fallback:false`. “Feed-backed” means retrieval capability, not continuous streaming.

1. Counts exclude source-status sentinel rows and match the existing prepared module feed. Use the same display filters, including tender expiry. Preserve legitimate zero, unavailable count and retrieval error separately.
2. Bills and graph share a resource; aggregate records count it once. Other module counts are heterogeneous records, not unique people/documents. Incomplete totals state how many resources have loaded; no count-up may pretend an unknown value is measured.
3. Source dates come from explicit source/snapshot fields. File mtime, current time and database load time cannot substitute. Retrieval time is labelled separately.
4. Available columns reflect populated data and module-specific views. Do not promise attendance, question answer text, project completion, budget utilisation, tender value or full regulator coverage when absent.
5. Source chips identify actual sources. They do not certify every row, imply licences, or use URL counts as publisher counts. Stored source coverage and corpus document coverage are different measures.
6. Runtime summary requests are bounded and abortable; render progressively with per-resource retry. Reuse bill/graph summaries. Do not transfer full bill/question registers into the landing for counters. Server summary must preserve feed/display parity; extraction of shaping code requires tests and review.
7. Offline/static deployments show unknown where summaries cannot be obtained. Do not seed totals from this audit or the HTML. No new database table, data refresh job or published data pack.

## UI and interaction requirements

- Preserve existing topbar, desk navigation, account/session behavior, search, microphone, theme and language controls. No replacement National/Global/Law switch from the HTML.
- Exactly five existing catalog groups and 12 existing National routes. Aliases are presentation only; `onFeature` receives the canonical ID. No unsupported mockup modules or new roadmap promises.
- Hero copy avoids “all”, “verified”, “exhaustive” or “live” claims beyond observed coverage. Counters distinguish stored, curated and feed-backed resources; an empty tender register is not a planned module.
- Sector chart derives from actual bill `sector` values, shows exact counts and count scope, includes Other/missing if applicable, and has loading/error/empty states. Source snapshot appears alongside it. No fake ministry taxonomy or probabilities.
- Module disclosures work with keyboard and touch, announce expanded state and avoid nested interactive controls. Search and source-mode filtering cannot leave invisible/dimmed interactive content in the tab order. Search empty state and clear/reset action are present.
- Shortcuts open existing bill, question and candidate modules. Omit the mockup Ask AI button unless an existing shell integration can be verified without inventing attachment context.
- National styles are namespaced. Provide light/dark styles, Hindi text accommodation, 200% zoom, 360 px phone layout and desktop layout without horizontal page overflow. Reuse current tokens; no new UI dependency required.
- Motion decorates navigation: short entrance/track transitions, no perpetual numeric animation; reduced motion disables tilt/parallax/drift, hidden/offscreen scenes pause, and animations do not block content. Decorative SVG is hidden from assistive technology.

## Observable acceptance evidence

- Summary versus prepared-feed parity for all 12 modules; one shared bill resource, known empty tenders, sample questions, curated budget, missing fields, error and unavailable dates covered.
- An intentional counter/dedup/provenance defect makes the relevant guard fail before it is trusted.
- No full-register rows in summary responses, bounded concurrency and cancellation verified; payload budget of 30 KB uncompressed per summary and no more than three concurrent requests. Slow upstreams cannot prevent other modules or navigation rendering.
- All 12 module links resolve correctly; browser Back and existing locks still work. Search/disclosure keyboard and touch behavior demonstrated.
- Browser evidence at 360, 768 and 1440 px, both themes, reduced motion, loading, error/retry and empty states. Global and State screenshots/routes checked for regression.
- Relevant tests, lint, build and router import pass. Changes under `src/lib` additionally require full Vitest and Deno suites per AGENTS.md. There is no standalone type-check.

## Scope and exclusions

Permitted implementation areas are named in the [plan](../plans/2026-10-04-national-landing-redesign.md); local implementation follows those scopes. Excluded: Global/State/Law redesign, homepage/globe, module table redesign, ingestion/deduplication repair, source licensing decisions, source expansion, AI backend, auth, billing, database changes, data collection replacement and production release. Publication requires later explicit owner authorization.

This spec supersedes the National counter/chart claims in §4 of `2026-09-27-cr12-cr13-desk-landing.md` for this redesign. Other desks and the older document's other capabilities are unaffected. The mockup has arrived for National; visual acceptance remains pending.

## Implementation clarification (2026-10-05)

Artwork is static SVG. Only the initial hero copy has a 240 ms entrance, enabled under `prefers-reduced-motion: no-preference`. There are no perpetual loops, tilt, parallax, cloud drift or count animations, so offscreen/hidden-tab pause machinery is unnecessary. Filtering does not animate or delay module text. Unknown source dates remain explicit rather than using retrieval time as a source snapshot.
