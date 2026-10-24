# Repository cleanup and next-chat handoff

> **Status: Historical (2026-10-25).** Snapshot, not a new work backlog.

## Scope and verification

Owner requested branch cleanup, a common starting point, and deferral of F252.
The cleanup fetched origin, checked every branch against main ancestry or an
exact merged-PR head, and retained unmatched work. No open PRs existed at audit.
Removed 54 local and 50 remote merged branch refs. Remote deletion used an
atomic push with expected-SHA leases. Pruned three registrations whose worktree
paths no longer existed. No corpus, database, credentials or runtime code changed.
The starting main was 5d095b0118764096721c99993f33b910183370e7.

## Preserved work requiring separate review

- Remote `task/client-law-ingestion-claude-2026-10-23` at
  `fa74c9b811167a04c1622e0cfcb292c2327f52f9`: six commits beyond main,
  including next-100 and next-1,000 receipts and audit-ledger tooling.
  The old local branch at c9533bf was merged and removed; remote work is retained.
  These receipts are claims to reconcile, not authorization for another batch.
- Local `task/credit-paise-plan` at f12aa681, `task/top-up-price-approval`
  at 0bab1fc6 and `task/rag-fallback-reliability` at ca35c4c0 retain commits
  not proven merged by this audit. Do not delete or blindly merge them.
- Managed `law-listing-backend` and `law-listing-ui` worktrees contain
  uncommitted historical implementation diffs. They remain untouched.
- Clean detached `law-screener-fix` and `frontend-icons` worktrees remain;
  the latter belongs to separate work. No worktree files were deleted.

## Starting another chat

Use the primary checkout on current main. Read AGENTS.md,
docs/agents/onboarding.md, docs/agents/coordination.md and docs/plans/open-work.md.
Confirm a clean checkout and fetch origin before creating a fresh task/<slug>
branch. Do not reuse old task branches or edit the same checkout concurrently.
F254/F255/F256 are complete; F252 is explicitly deferred future work in the
sole tracker. No larger ingestion batch or re-ingestion is authorized here.
The last verified research-chat deployment is v104; this cleanup changes no
Edge Function. Follow required CI gates for any new PR.
