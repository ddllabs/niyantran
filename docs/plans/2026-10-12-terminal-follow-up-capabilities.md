# Terminal follow-up capability map

> **Status: Living.** Scope boundaries and order approved by the owner on
> 2026-10-12. Owner subsequently authorized all three specs and their implementation.
> Completed locally on task/terminal-follow-up; acceptance remains pending.

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| desk-module-discovery | Restore original V6 selected-sector explorer below picture cards; direct links throughout | Existing presentation groups and canonical routing | [Spec](../specs/2026-10-12-desk-module-discovery.md) |
| terminal-header-controls | Remove disabled bell, hide ineffective landing refresh, clarify theme toggle | Existing shell route and theme state | [Spec](../specs/2026-10-12-terminal-header-controls.md) |
| free-desk-access | All signed-in users get all desks, modules, rows, copy and export; remove upgrade interruptions and signup plan selection | Existing session/authentication boundaries | [Spec](../specs/2026-10-12-free-desk-access.md) |

Build order: desk-module-discovery → terminal-header-controls → free-desk-access.
This is a sequencing choice, not a runtime dependency between modules. Work is
sequential because header and access tasks share TerminalShell.jsx.

Owner also approved including copying and exporting. Authentication and AI
usage limits remain unchanged. Implementation was separately authorized and completed on the task branch.
No publication or deployment is authorized. [Implementation plan](2026-10-12-terminal-follow-up.md).

## Verified Git inventory

Commands executed: `git fetch origin`, `git ls-remote --heads origin`,
`git worktree list --porcelain`, `git branch -vv`, and per-ref
`git rev-list --left-right --count main...<ref>` / `git merge-base --is-ancestor`.
Missing checkout directories were independently checked with filesystem reads.

Pre-implementation inventory on 2026-10-12 (before creating the new task branch):

- Current checkout: main at 7c38800; origin/main at 66e955e. Main is ahead three,
  behind zero. Cleanup 69595a5 and UI 9fe245e are already included.
- Four registered local worktrees: one existing checkout and three stale
  registrations at /private/tmp/niyantran-desk-v6-{assets,frame,national-data}.
  All three directories are absent; all associated branch tips are in main.
- Nine local branches: main and eight task branches. Seven task branches are
  ancestors of main. task/desk-reference-v6-preview alone has unmerged work:
  two unique commits, with main having 39 commits absent from that branch.
- Origin has four branches: main and three task branches. The integration and
  state task tips are included in local main; the reference preview is not.
  Git does not expose remote worktrees: this is a remote branch inventory, not
  an inventory of checkouts on other machines.
- No attached app-managed worktrees were reported during this review.

Decision implemented: no extra merge. Created task/terminal-follow-up
from local main 7c38800, carrying existing dirty work
without stashing or modifying it. Keep the reference preview separate; its
deployment configuration is the existing F94 decision. Optional removal of
three stale registrations and seven merged local / two merged remote task
branches requires a separate exact-target cleanup decision. Nothing was
pruned, deleted, pushed or deployed.

Corpus safeguard: 94 pre-existing dirty files were hashed before planning.
Only the shared tracker receives additive planning entries; every other
pre-existing file must retain its hash. Existing tracker content must also be
preserved verbatim.

Owner preview correction: the accordion design is superseded by [F100 restoration](2026-10-12-v6-explorer-restoration.md); header/free-access boundaries remain unchanged.
