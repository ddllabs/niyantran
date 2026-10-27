# Admin persona implementation

> **Status: Living.** Approved implementation, 2026-10-27.

Spec: [editable personas](../specs/2026-10-27-admin-persona-prompts.md). Branch: task/admin-persona-prompts. Sequential implementation; no delegated scopes.

1. Storage/API: additive migration, service-only atomic revision RPCs, pilot settings and immutable audit history; admin-personas handler/index; disposable authorization fixture and API tests. Verify unauthorized access, stale saves and rollback before proceeding.
2. Main chat: shared pilot policy, validated admin current-text override, exact persona resolution, prompt source/hash diagnostics and fallback. Write failing resolver/validation tests first; preserve replay fingerprinting and specialist prompts.
3. Admin UI: server client, saved/published/editor states, explicit local import, history/rollback, fresh probe conversations after changes. UI tests and actual browser reproduction.
4. Verification/release: both suites, lint/build/bundle and SQL negative controls. Review diff, verify deployed bundle parity and owner UUID, commit/push preview through required CI. Add storage and backend with pilot disabled, then enable only verified owner after browser checks. No global activation. Rollback disables pilot resolution and retains history.

Write scope: persona admin UI/client/tests, research-chat persona integration/tests, new shared persona policy, new admin-personas function, additive migration and fixture/runner mapping, supabase function config, and this task's docs/open-work entry. No protected data files.

Release evidence, unresolved access prerequisites and exact deployed commits will be appended here. No production mutation until the deployed baseline and pilot identity are verified.

## Local evidence (2026-10-27)

- Branch created from origin/main dc2b4118; initial tree clean. Owner subsequently supplied the exact pilot email. A single-account lookup verified an active admin; the UUID remains in operational state, not application source. An initial broad admin-ID query was rejected by automatic review; no enumeration was performed.
- Downloaded deployed research-chat to a temporary directory using `supabase functions download research-chat --use-api`. Every downloaded research-chat/shared source matched origin/main; all six bundled persona texts matched byte-for-byte.
- Regression control: all four new pilot resolver tests failed against bundled-only behavior, then passed with the resolver. The exact-system-block test also failed with the old `.trim()` behavior, then passed after restoration. Customer resolution still trims bundled text before composition, preserving its previous prompt bytes.
- `npm test`: 435 files / 6,632 tests passed. Later editor-only recovery wording/retry adjustment passed focused UI checks. `deno test -A --config supabase/functions/deno.json supabase/functions`: 1,427 tests passed, including runtime active-pointer refresh, exact override transport and pre-credit authorization.
- New disposable SQL persona fixture passes; removing its migration fails the fixture. Full fixture run: all 58 fixtures passed, including migration-removal negative controls and existing concurrency/down checks. Lint, production build and bundle checks passed again after the editor adjustment (181,761 bytes initial JavaScript gzip; limit 182,446). No standalone type-check exists; `deno check` succeeded for both affected Edge Function entrypoints.
- Browser connection unavailable: initial inventory reported locked desktop, later calls timed out. Therefore the original live typing complaint and real signed-in pilot acceptance remain unverified. No claim of browser acceptance.
- Migration history has existing local/remote timestamp differences, including an unrelated live 20261027110836 entry. Do not run a blanket db push or repair those histories. This task may apply only its reviewed additive migration using the established exact-file release procedure after prerequisites pass.

## Release state

No hosted migration, Edge Function deployment, pilot enablement, prompt initialization/publication or customer activation has occurred. Browser verification remains required before enabling the live pilot. All existing corpus/user-role/billing records and shipped persona source files remain untouched. The owner has been asked to restore the browser connection while verification/preview preparation continues.
