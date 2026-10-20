# Branch cleanup execution plan

Status: Historical (2026-10-20).

Spec: [branch cleanup](../specs/2026-10-20-branch-cleanup.md).

1. Coordinate with Orient on Niyantran Terminal (Razorpay), inspect refs/worktrees and fetch origin.
2. Save verified pre-cleanup Git bundle; create task/branch-cleanup-20261020 in /private/tmp/nter-branch-cleanup-20261020. Shared checkout is excluded from all writes.
3. Fast-forward production verification docs; consolidate frontend release evidence and missing historical closure observations. Preserve original commits as merge parents, intentionally superseding stale open-work snapshots with current tracker entries. Write scope: this spec/plan, isolated docs/plans/open-work.md, the two frontend release plans, new historical observation appendix.
4. Verify content/provenance, docs-only diff, links, whitespace and payment ref invariants. Remove only the missing /private/tmp/niyantran-rag-production worktree registration, then fast-forward local main to reviewed cleanup commit.
5. Detach clean old frontend checkouts at their existing commits (preserving every file), delete merged non-payment branches, and delete only exact-tip merged remote branches. No main publication/deployment.
6. Record counts and hashes; inform payments chat of local main and preserved work.

Backup: /private/tmp/nter-pre-cleanup-20261020.bundle; git bundle verify passed before mutation. Production baseline origin/main=4a0c98109da97caba1fe312c8e9db056dfde7df5; original local main=87de929056979b99f69cd181a4a01f308e454407.

## Exact cleanup inventory

Local targets after documentation integration (18):

| Branch | Expected tip |
|---|---|
| task/authenticated-browser-fixes | `f73e7d94635fe88e216b710a343b4d556c07651d` |
| task/bundle-node-warnings | `db5793f19cf07edd9447a1ad2715234e85e06474` |
| task/closure-observation-20261018-1154 | `c2dba2b8a3f77bf72fe0d852a85d6cb51ae18e33` |
| task/closure-observation-20261018-1254 | `b56ceb0917a2a166de2220d6500dafc49522414e` |
| task/closure-observation-20261018-1514 | `3ccdf8a343070d5365a6093c84230afaf0e1e441` |
| task/f221-diagnosis | `fbf3c07d18cf19f3e4d45d7a2d93b5633ae51d4a` |
| task/f221-test-isolation | `162192447ad37479ff184938410b9b0cb9270313` |
| task/f223-state-summaries | `731428f4110850bdb008ef354dfaa9a1490e41f6` |
| task/f224-growth-budget | `54c24c4146552ea1ac3099f5c3197df093706951` |
| task/frontend-browser-issues | `61594ea7efb487616421de3847e3dff85c946a36` |
| task/frontend-icons | `506c9615533f73473c9a2dbd7700b2f81acd80cb` |
| task/login-logout-race | `3ccdf8a343070d5365a6093c84230afaf0e1e441` |
| task/m1-m2-cleanup | `dbaa4150cadd7894b3e31cbad7ea7147136c5868` |
| task/m1-m2-cleanup-plan | `b8d9e519ae16a9600fa60b00a7ea8f82746363a4` |
| task/m1-m2-closure-observations | `8be55b596aa285418a24e3bbcc256490637b3ae0` |
| task/nter-domain-launch | `6c08b48ac527524a04a8b102eea8d2ce86c2db52` |
| task/rag-citation-web-recovery | `87de929056979b99f69cd181a4a01f308e454407` |
| task/rag-production-recovery | `8f7241824d32e0d09c243395ae92b4d0cf470018` |

Remote targets already merged in origin/main (8):

| Branch | Expected tip |
|---|---|
| origin/task/bundle-node-warnings | `db5793f19cf07edd9447a1ad2715234e85e06474` |
| origin/task/f221-test-isolation | `389dbed8fdcee9f11963540c747c33cddb255953` |
| origin/task/f223-state-summaries | `0c1319c056b1198c182bd16f032920a47e687771` |
| origin/task/f224-growth-budget | `0074991c65d839416fcfadb6799cb6a72e31d54b` |
| origin/task/login-logout-race | `3ccdf8a343070d5365a6093c84230afaf0e1e441` |
| origin/task/m1-m2-cleanup | `dd05adf9104c41c035d50671bec998d6c912f49d` |
| origin/task/nter-domain-launch | `6c08b48ac527524a04a8b102eea8d2ce86c2db52` |
| origin/task/rag-citation-web-recovery | `87de929056979b99f69cd181a4a01f308e454407` |

Payment branches preserved: `task/credit-paise-plan`, `task/credit-paise-release`, `task/razorpay-plan`, `task/top-up-price-approval`. Remote Razorpay and credit-paise-release also preserved.

Validation: all unique historical research additions (including the duplicate 11:54 source) occur verbatim in the appendix; both release-plan source versions occur intact in the consolidated files. All incoming unique commits touch only docs. No historical tracker snapshot is replayed over newer state. Original source commits will remain ancestors via an explicit documentation-history merge. Code/tests/config/data tree remains exactly origin/main.

## Completion evidence

Payment chat confirmed no non-payment branch dependency before ref deletion. Its requested existing working files were preserved; the previously registered `/private/tmp/niyantran-rag-production` directory was confirmed absent, and only its stale registration was pruned.

Documentation consolidation: `e11eae0`; reviewed original documentation histories retained by merge `cef7849`. Local main fast-forwarded to that merge, followed by this execution record. No code, configuration, data or production changes; origin/main remains `4a0c98109da97caba1fe312c8e9db056dfde7df5`. Local documentation is not published.

Deleted exactly the 18 local and eight remote targets above. Remote deletion passed a dry run and an atomic push with exact expected-tip leases. Removed the temporary cleanup branch after integration. Five local branches remain (main plus four payment branches); three actual remote branches remain (main, Razorpay and credit-paise-release). The shared checkout remains on task/razorpay-plan; both existing frontend checkouts are detached at their original commits with all files preserved. Main is checked out in `/private/tmp/nter-branch-cleanup-20261020`.

Verification: pre-cleanup bundle verified; exact target tips and ancestor checks passed; original observation content and release-plan evidence preserved; documentation links/status and diff whitespace checked; non-document tree matches origin/main exactly; payment refs unchanged. Application, Edge Function, lint, build and SQL suites were not rerun because this task changes only documentation and Git references. Existing billing verification and its unfinished work remain owned by the payment chat.
