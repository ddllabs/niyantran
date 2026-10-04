# Main consolidation, 2026-10-04

> **Status: Historical (2026-10-04).** Owner authorized consolidation, push and safe cleanup with
> “go” after the proposed integration of F63–F65 into main.

## Scope and acceptance

Local main equals origin/main before integration. F65 contains all F63/F64
commits (24 beyond main). Integrate that verified chain, push main to origin,
confirm its Vercel production deployment and leave the primary checkout on main.
No Supabase function deployment, database/data/billing changes or unrelated
worktree integration. Historical agent commits are patch-equivalent to main.

## Ordered plan

1. Audit branch ancestry, patch equivalence and every worktree's status.
2. Review outgoing source diff; run full npm and Deno suites, lint/build,
   router import and diff check. No SQL changes; no SQL fixture run required.
3. Preserve branch history in a verified local Git bundle. Archive ignored
   non-build files before removing clean, unlocked, redundant worktrees.
   Keep dirty and locked worktrees/branches in place. Delete only merged or
   proven patch-equivalent completed branch refs after preservation.
4. Record F63–F65 landing and preservation exceptions in open-work.md.
   Fast-forward main after a fresh fetch and clean-tree check; push main.
5. Confirm matching local/remote commit and Vercel READY for that exact SHA.
   Record remaining backend-deployment scope separately.

## Verification

- npm test: 129 files, 2,088 passed.
- deno test -A --config supabase/functions/deno.json supabase/functions:
  856 passed, no failures.
- npm run lint: passed without warnings/errors.
- npm run build: passed; existing deskBrief mixed-import and >500 kB chunk
  warnings. Router import passed; git diff --check passed.
- Existing F63–F65 browser evidence applies to the exact reviewed code,
  including 375px joined composer geometry and keyboard model selection.
- Audit: 15 dirty worktrees and one locked worktree preserved. Eight old
  commits have Git patch-equivalent changes already integrated in main.
- No backend function deployment implied by the GitHub/Vercel push.

## Review correction and cleanup

Review identified a missing `max` effort label in ResearchFlow.jsx, although
ModelPicker already supports max. A focused guard failed with “Not available”;
add localized Max/अधिकतम labels. This is a release-review correction in
src/ai/ResearchFlow.jsx and its existing test file, with no provider change.

Removed 22 redundant branch refs and 11 clean unlocked worktrees. All branch
history is recoverable from a verified local Git bundle under
`.git/local-archives/2026-10-04-consolidation/`; ignored non-build files from
removed worktrees were archived there with content-hash checks. Fifteen dirty
worktrees and one locked worktree remain intact. No force-removal of worktrees.
The F63/F64/F65 branch refs were removed after integration: 25 local branches
removed in total. Seventeen remain: main and the branches attached to the
15 dirty and one locked worktrees.

Final correction verification: full npm test passes 129 files / 2,089 tests;
lint and build pass again with the same baseline warnings. Edge Function
sources are unchanged since the 856-test passing run. No credential-pattern
matches or env/security/generated paths in the outgoing diff.

## Publication outcome

Main fast-forwarded from `f974ece` to `75b521d` and was pushed to origin.
The primary checkout was clean and matched origin/main. Vercel deployment
`dpl_7DTVuMeuzACX28VRoLnaapijN76j` reached READY for exact commit
`75b521d84bd44ce7c41179b84978fda23bc5f4d6`, with production alias
`niyantran-six.vercel.app` and no alias error. This is deployment API evidence;
an additional production browser smoke check was unavailable in this session.
Supabase's deployed function remains unchanged; F69 tracks that separate action.
