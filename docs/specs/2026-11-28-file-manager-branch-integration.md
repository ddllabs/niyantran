# Spec: bringing the `file-manager` branch into `main` — V1 (F418)

> **Status: Historical (2026-11-28).** Approved by the developer on 2026-11-28, with the recommended answer to each
> open question (recorded under Decisions), and delivered in PR #250 (`f5255529`). Plan:
> `docs/plans/2026-11-28-file-manager-integration.md`. What is still open is in `docs/plans/open-work.md` (F419, F421,
> F422).

## Assumptions

1. **"Mobile UI" is UI work.** The contributor is building phone-sized UI in parallel, and none of it is a released phone
   app today. The branch holds it in two forms; see the capability map.
2. **The contributor keeps working.** `origin/file-manager` will keep moving, so the integration takes a fixed commit
   (`a4a09d84`, 2026-11-23) and leaves the contributor's branch untouched. Later work arrives as ordinary pull requests.
3. **Main is the authority for the database.** F410 to F413 describe what NTER runs. The branch's own migrations are
   older drafts of the same schema and are not merged.
4. **Merging is shipping.** Vercel deploys `main`, so what merges goes live on nter.pro for signed-in users. AI indexing
   stays off: the client switch `IS_INDEXING_BILLING_DEPLOYED` is `false` and the `file_indexing_billing` row is absent.

## Current state (read 2026-11-28; the merge was tried in a throwaway worktree, which was then removed)

- `origin/file-manager` is not merged.
  - It has 23 commits not on `main`, all by one contributor (Nawajish). The last is `a4a09d84`, 2026-11-23.
  - It forked from `main` at `67946477` (2026-11-13); `main` is now 434 commits ahead.
  - It touches 768 files, with 86,496 lines added.
- **CI on its last commit failed**, with two Deno tests:
  - `research-chat/prompt_test.ts:128`. The branch reworded the attachment-safety line in `prompt.ts`: it now covers
    retrieved personal documents as well. The test still expects the old text. The guard itself is still present.
  - `document-file/handler_test.ts:528`, which covers viewing a private-file citation.
- **A trial merge into current `main`** stops on 8 conflicts:
  - `docs/plans/open-work.md`;
  - `scripts/build-terminal-styles.mjs`;
  - `src/ai/AiPanel.jsx`;
  - `src/shell/TerminalShell.jsx` and `src/shell/liveTv.css`;
  - `src/shell/LiveTvModal.jsx`, which `main` deleted when Live TV became a page (F359) and the branch modified;
  - `supabase/functions/_shared/retrieval.ts` and `retrieval_test.ts`.
- **The branch's migrations** are `20261115000001_private_file_manager.sql`, `20261118000001_file_indexing_billing.sql`,
  `20261121000001_user_file_chunks_metadata.sql` and `supabase_dashboard_storage_setup.sql`. Each would redefine objects
  that F410 to F413 fixed.
- **The branch's SQL fixtures** are eight `user_files_*.sql` files, chained to those migrations in its own `run.sh`. It
  also changes `bootstrap_storage.sql` and adds `bootstrap_entitlements.sql`.
- **The branch's tracker numbers** are F341 to F346, which are taken on `main` by other items.
- **Sign-in:** `src/App.jsx` changes sign-in. In dev builds only, a signed-in test session is kept when Supabase reports
  signed out.
- **Credential check:** no credential file was found. `nter-mobile/.env.example` holds only commented placeholders and
  the public publishable key.

## Capability map

| Module id | What it is | Files on the branch | Depends on |
| --- | --- | --- | --- |
| `fm-schema` | The private file-manager database | Already on `main`, as F410 to F413, applied to NTER | — |
| `fm-ui` | The file manager in the website: drive, uploads, jobs drawer, artifacts | `src/fileManager/` (21 files), `src/types/fileManager.ts` | `fm-schema` |
| `fm-ai` | Private files in the AI panel: attaching files, citations, the source reader | `src/ai/` (10 files) | `fm-ui`, `fm-functions` |
| `fm-functions` | Private-file retrieval and indexing on the server | `supabase/functions/{_shared,document-file,ingest-worker,research-chat}` (21 files) | `fm-schema` |
| `web-mobile-ui` | The website's own phone layout (F342): mobile header, bottom nav, phone-width styles | `src/shell/`, `src/marketing/`, `src/index.css`, `src/desks/` (26 files, about 1,700 lines) | — |
| `mobile-client` | `nter-mobile/`: a separate React + Vite app (Capacitor, app id `pro.nter.app`; web build `dist-web`), with its own CI, `AGENTS.md` and lockfile | 508 files, about 52,000 lines, 337 binaries, and client PDFs at its top level | none in this repository |
| `branch-docs` | The branch's reports, QA notes and screenshots | `docs/reports/` (35), `docs/qa/` (29), `docs/screenshots/` (76) | — |

**Build order:** `fm-functions`, then `fm-ui`, then `fm-ai`. `web-mobile-ui` is independent and can come in with them
or separately. `mobile-client` stays out of V1.

The two mobile modules are separate. `web-mobile-ui` is how nter.pro itself looks on a phone, and it lives inside the
website. `mobile-client` is a second app with its own build, and nothing in the website depends on it: the only
mentions of `nter-mobile` outside its folder are a CSS class name, `nter-mobile-header`, and reports.

## Objective

Bring the contributor's file manager onto `main`: the drive and uploads in the website, private files in the AI panel
with citations, and the server functions behind them. Do it without undoing F410 to F413, and with CI green. The
contributor's parallel mobile UI work must keep a clear path in through pull requests.

Success means a signed-in user on nter.pro (desktop or phone width) can:
- upload, browse, trash, restore and empty-trash their own files;
- attach a file to a question;
- open a citation to their own file.

Signed-out users and other users see none of it. Indexing stays off until a separate decision turns it on.

## Commands

```
npm ci
npm run build
npm run lint                       # 0 warnings
npm test                           # Vitest
npm run test:scripts
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions
./supabase/tests/run.sh            # all SQL fixtures, each with its vacuity check (local disposable Postgres)
```

## Project structure (after V1)

- `src/fileManager/`: the file manager UI, and its tests next to it.
- `src/ai/`, `src/shell/`: the integration points, edited in place.
- `supabase/functions/`: the four touched functions, and their `_test.ts` files.
- `supabase/tests/`: the branch's `user_files_*.sql` fixtures, chained to `main`'s F410 to F413 migrations.
- `supabase/migrations/`: unchanged. None of the branch's migration files is added.
- `docs/reports/`: only the reports for modules that came in.

## Code style

The repository's existing conventions, as `eslint.config.js` and the neighbouring files show them. The integration
resolves conflicts; it does not restyle the contributor's code. Where both sides changed a file, the result keeps
`main`'s behaviour and adds the branch's. Example, `retrieval.ts`: `main`'s F369 web-text work stays, and the branch's
private-file search (`match_user_files` when private file ids are given) is added beside it.

## Testing strategy

- **Every existing suite stays green:** Vitest, script tests, Deno, the SQL fixtures and the build.
- **The branch's tests come in with its code:**
  - Vitest: `src/fileManager/*.test.*`, `mobileHeader.test.jsx`, `mobileBottomNav.test.jsx`,
    `hamburgerInteraction.test.jsx`.
  - Deno: the touched functions' tests.
  - SQL: the eight `user_files_*` fixtures.
- **Where a branch test encodes behaviour `main` deliberately changed,** the test is updated to `main`'s behaviour, and
  each such change is listed in the PR. Examples:
  - anon refused (F412);
  - one active job per file;
  - settling a job once per attempt;
  - a running job can't be cancelled (F413);
  - a user reading only their own storage figures (F410).
- **No test is skipped or deleted to get green.** Each new SQL fixture must pass its vacuity check.
- **The two failing Deno tests are fixed in the code or the test, whichever is wrong,** with the reason stated:
  - For `prompt_test.ts`, the expected text follows the reworded, wider guard.
  - For `document-file`, the cause is found first.
- **Runtime check on the Vercel preview of the integration branch,** at desktop and phone width (390 px):
  - signed in, upload, browse, trash and restore, and attach a file to a question;
  - signed out, no file-manager surface is reachable.

## Boundaries

- **Always:**
  - Keep the contributor's commits and authorship by merging, not squashing their history.
  - Pin the integration to `a4a09d84`.
  - Give the branch's tracker items free numbers (F418 onward).
  - List every test expectation changed, and why.
- **Ask first:**
  - The `App.jsx` sign-in change.
  - Including `web-mobile-ui` in V1.
  - Each Edge Function deploy.
  - Turning indexing on.
  - Anything under `nter-mobile/`.
  - Adding the branch's screenshots.
- **Never:**
  - Merge the branch's migrations, or change NTER from this work.
  - Push to or rewrite `origin/file-manager`.
  - Bypass CI.
  - Bring in client or planning PDFs without a decision.
  - Turn the billing flag on as part of the merge.

## Success criteria

1. **One integration PR from `task/file-manager-integration`.** It contains `fm-ui`, `fm-ai` and `fm-functions`, plus
   `web-mobile-ui` if approved. It contains no branch migration, no `nter-mobile/`, and no unapproved screenshots.
2. **Both required CI jobs pass on its head**, and every SQL fixture passes its vacuity check.
3. **`supabase/migrations/` is identical to `main`'s.**
4. **The behaviour fixed by F410 to F413 is unchanged.** The existing `user_storage_own_user`, `file_manager_schema`,
   `file_manager_grants` and `file_manager_credit_fixes` fixtures still pass.
5. **The preview passes the runtime check above,** and no file-manager data is reachable signed out.
6. **The tracker is updated:**
   - F418 (this work);
   - the branch's items, renumbered;
   - a deferred item for `mobile-client`;
   - F415's Cancel-button half closed, if it is done in this work.
7. **The PR lists each conflict resolved, each test expectation changed, and what was left out.**

## Out of scope (deferred)

- **`mobile-client` (`nter-mobile/`).** It's a separate app. Whether it lives in this repository, and how its CI runs
  from the root workflow, is its own decision when that work becomes current.
- **Edge Function deploys and turning indexing on.** These are production steps after the merge, each with its own yes.
- **F414 (the declared file size) and F415's hold-lapse half.** Separate changes.
- **The branch's screenshots** (`docs/screenshots/`, `docs/qa/screenshots/`, `nter-mobile/docs/screenshots/`), unless
  approved.

## Decisions (developer, 2026-11-28)

1. **Mobile UI.** Both forms are the contributor's parallel UI work, and neither is a released phone app. The website's
   phone layout (`web-mobile-ui`) comes in with V1. The separate `nter-mobile/` app (`mobile-client`) stays on the
   contributor's branch and is deferred.
2. **`web-mobile-ui` is in V1.**
3. **The `App.jsx` dev-only sign-in bypass is dropped.** The rest of `App.jsx`'s changes stay if they belong to modules
   that come in.
4. **Reports:** only those for modules that come in.
5. **After V1, the contributor works in `task/<slug>` branches from `main`, through pull requests.** They don't keep
   pushing to `file-manager`. Telling them is the developer's step.

## Open questions (answered above)

1. **Which mobile UI is in progress?** Is the contributor's ongoing work `web-mobile-ui` (the website's phone layout), or
   `mobile-client` (`nter-mobile/`), or both? This decides whether `web-mobile-ui` is in V1, and how their next PRs
   should be shaped.
2. **Should `web-mobile-ui` come in with V1?** I recommend yes: it's part of the website, about 1,700 lines with its own
   tests, and three of the eight conflicts are in it.
3. **The `App.jsx` sign-in change:** keep it, drop it, or fix it? I recommend dropping it. A dev-only bypass of
   Supabase's signed-out state belongs in a test helper, not in the app.
4. **The branch's reports in `docs/reports/`:** bring them in, or only those for modules that come in? I recommend the
   second.
5. **The contributor:** will they stop pushing to `file-manager` and send further work as `task/<slug>` pull requests
   from `main` once V1 merges? AGENTS.md keeps `main` as the only long-lived branch.
