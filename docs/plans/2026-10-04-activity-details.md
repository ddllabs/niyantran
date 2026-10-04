# F64 implementation plan

> **Status: Historical (2026-10-04).** Branch `task/f64-activity-details`, based on `1cb50aa`.
> Spec: [activity details](../specs/2026-10-04-activity-details.md).

Sequential supervisor implementation; no delegation required.

1. Red guards in `src/ai/ActivityTicker.test.jsx`, `AiPanel.test.jsx`,
   `supabase/functions/_shared/retrieval_test.ts`, research-chat agent/handler
   tests. Questions: which model/effort, what each action did, where search time
   went, and whether a measurement is absent?
2. Retrieval measurement callback in `_shared/retrieval.ts`, forwarded through
   research-chat `index.ts`, `handler.ts`, `agent.ts`. Additive public metadata,
   no change to queries or results. Persist and stream the same allowlisted fields.
3. `ActivityTicker.jsx`, `MessageRow.jsx`, `AiPanel.jsx` and scoped CSS: model
   inside accordion, explicit action states and definition-list measurements.
   Legacy compatibility, honest unavailable reasoning, requested effort label.
4. Focused red/green, full `npm test`, `deno test -A --config
   supabase/functions/deno.json supabase/functions`, `npm run lint`, `npm run
   build`, router import and `git diff --check`. SQL unchanged.
5. Offline browser fixture verifies expandable actual panel and narrow layout;
   no user session/model calls. Record results, commit locally. Do not deploy.

## Evidence

Implemented locally in `8d0ba3d`; awaiting owner review/landing and separate publication
authorization. Existing development server at `http://127.0.0.1:5173/` serves
this branch. No production or database changes performed.

- Red: three new frontend guards failed for missing summary/state/measurement
  behavior. Retrieval timing guard first failed for the missing callback
  contract. Removing the new live fields made the handler parity guard fail
  (`latencyMs` missing); restoring them passed. No guards disabled or skipped.
- `npm test -- src/ai/ActivityTicker.test.jsx src/ai/AiPanel.test.jsx
  src/ai/AgentComponents.test.jsx src/ai/MessageRow.test.jsx`: 79 passed.
- Final `npm test`: 128 files, 2,079 tests passed, 32.28 seconds.
- Full `deno test -A --config supabase/functions/deno.json supabase/functions`:
  856 passed. Injected-clock guards cover embedding/RPC boundaries and measured
  zero, agent guards cover success/failure/cancellation, handler guard compares
  live fields with saved activity, telemetry guard checks cancellation marking.
- `npm run lint`: passed without errors/warnings. `npm run build`: passed,
  4.29 seconds. Existing `deskBrief` static/dynamic import and >500 kB chunk
  warnings remain. Router import passed. `git diff --check` passed.
  SQL unchanged; no SQL fixtures needed. No standalone type-check claimed.
- Offline actual-component browser fixture verified summary model/Low effort,
  zero standalone assistant model labels, expansion, exact model ID, requested
  top-K versus returned passages, per-action and aggregate ms, and unavailable
  reasoning duration. At 1416×977 and 375×900, detail content had no horizontal
  overflow. Expanded-panel rendering checked. Viewport reset and temporary tab
  closed; no user tabs or conversation modified by verification.
- Fixture uses fake thread data and no production/model calls; measurements
  in its screenshot are fixture values. Actual production telemetry requires
  deployment, and older answers cannot retroactively obtain new measurements.
  Preview saved to `/private/tmp/f64-activity-details.jpg` (temporary artifact).
- Read-only review of the final diff confirms numeric/state metadata only,
  no passage text or raw provider error added to public events; query/results,
  authorization, billing, schema and deployment configuration are unchanged.

Changed scopes: `src/ai/ActivityTicker.jsx`, message/panel wiring and tests,
scoped chat stylesheet; `_shared/retrieval.ts`, stream frame type and tests;
research-chat agent, handler, dependency wiring, cancellation telemetry and
tests; F64 spec/plan/tracker and an amendment to the thinking-display spec.

## Integration

Owner authorized main integration/publication on 2026-10-04. Combined code
through `0638dbd` passed 2,088 frontend and 856 Edge Function tests plus
lint/build/router import. Earlier local-only statements describe verification
at the time. See [main consolidation](2026-10-04-main-consolidation.md).
Supabase function deployment remains a separate action (open-work F69).
