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

## Pilot release evidence (2026-10-28 IST)

- Push and PR CI both passed on 8f3a813a: runs 40557671643 and 40557757397, both named jobs. PR #60, attached to this task, remains the reviewed release vehicle. Initial Vercel preview dpl_6asqNUU7zUYMycxsDrJcvi29gdPv is built from that exact commit.
- Browser access recovered after directly binding the user's in-app tab. Existing production textarea accepted partial input; keystroke automation timed out. Original text was restored byte-for-byte without Save. A read-only flag could not be reproduced. The confirmed defect was browser-only persistence.
- Isolated fixture with real components verified draft/publish separation, text clearing, SHA-256 diagnostics, rollback, fresh conversations on edits and keyboard Home/End navigation. No production API calls from the fixture. Responsive checks used the actual 687px viewport; no horizontal page overflow. A later fixture check proved the intended 480px minimum editor height after a specificity correction; a desktop override did not change the measured viewport, so desktop visual acceptance is not claimed.
- Applied only migration 20261027175415 and its own ledger entry atomically through an exact-file transaction. Did not repair timestamp differences or run blanket db push. Initially enabled=false and no owner. Baseline namespace was empty before migration.
- Deployed admin-personas v1 and research-chat v105 from reviewed 8f3a813a. Downloaded the resulting chat import graph: exact local-source parity. Existing research-chat v104 baseline retained in temporary operational storage; rollback instructions below. Unauthenticated admin GET and chat POST returned401; chat GET returned405 as expected.
- Enabled only the exact owner UUID obtained from the user-supplied email and active-admin verification. No global activation option exists. Owner initialized six baselines through the signed-in preview. Live hashes/byte counts match all six bundled originals exactly.
- Real preview test: unsaved Corporate text produced source editor_test with expected SHA-256 9a37322a86cbf6a87d7087da60d796718019710540e1917c4ab89e3eeb9ce712. A suggested carbon-border question was submitted in that probe; no claim that it was the intended greeting. Draft save was acknowledged, survived reload, and remained unpublished until explicit Publish.
- Normal signed-in production chat then replied to Hello with the pilot greeting. Persisted persona metadata names published revision ca9e01b2-d3f1-43b5-8489-1f7ed36a44ae and the exact expected hash. Browser rollback restored the initial revision. Original text was then saved/published, leaving draft and active equal. A second turn in the SAME conversation used restored revision113f7829-f80d-4db6-9582-23ea8ba5edc6 and original hash b97e89a9188abf785f1f896ba597733b8993d2f40587985a36f8c6a60ed82cbf. Both turns completed. Test conversations/history remain in the owner's account; nothing was deleted.
- Final live comparison: all six active texts match the bundled originals byte-for-byte; all six draft pointers equal active pointers. Temporary test wording remains only in immutable revision history.
- Verified direct typing in the real preview with a short temporary value and restored the original without saving. No browser console errors on the successful workflow. A kill-switch exercise disabled the pilot, where reload failed with a generic Failed to fetch rather than a confirmed403; re-enabling recovered immediately. Do not claim an observed403 from that browser attempt. Added a red/green client regression to make transport errors actionable while retaining edits. Other-account authorization is covered by disposable SQL/API tests, not a second real account login.
- Found the generic textarea minimum-height rule overrode the existing persona-specific rule. Increased selector specificity to restore the intended editing area; no grid/card layout change.

### Rollback and remaining approval boundary

Disable only the singleton persona_pilot_settings.enabled flag to immediately restore bundled resolution for subsequent pilot turns; retain all revisions/history. If backend rollback is required, deploy the reviewed baseline research-chat source with its existing handler JWT checks. Do not delete the new tables or repair unrelated migration history during rollback.

The new editor is reviewed in the branch preview. Customer prompt activation is NOT authorized and remains disabled by exact-account enforcement. No corpus, billing configuration, user role/profile or shipped persona markdown was changed. Normal test chats consumed the account’s standard AI credits. Another worker created corpus-planning documents and edited open-work.md during final verification; those unowned changes are deliberately excluded from this task's commits.

### Final frontend verification

Publication time is shown from recent immutable events (the response includes the latest120 events; if the active event is outside that window, the UI explicitly says its date is unavailable). The editor height now matches its preexisting intended minimum without changing the page grid. Network failures retain edits and suggest reloading server versions; its regression failed on the raw Failed to fetch behavior and passed with the new message.

Focused post-polish checks passed (16 tests), as did the full1,427-test Edge suite, lint, production build and bundle guard (181,762 bytes initial JavaScript gzip). A local full application rerun encountered two5s timeouts in unchanged deskRowsFeed data tests under resource contention and was interrupted; the same complete8-test file then passed in2.52s with unchanged limits. The earlier full application suite passed6,632 tests; the new transport-error guard adds one. Required full CI remains the release gate for the final head, with the exact result and production receipt reported in the task rather than creating recursive documentation deployments.

### Review correction: account lifecycle

The new audit tables initially referenced Auth users with restrictive foreign keys. A disposable deletion regression failed on that schema. Follow-up migration20261027185300 removes only the two new audit-actor foreign keys (retaining required historical UUIDs) and changes the new pilot-owner reference to ON DELETE SET NULL. The full persona fixture passes, and fails without this follow-up migration. No actual production account is deleted or changed during this verification. This correction changes only the new persona tables and preserves append-only audit history.
