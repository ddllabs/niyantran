# No-rollover credit policy

> **Status: Normative.** Owner requested backend removal and a bounded Test account reset on 2026-10-21. Supersedes the rollover clauses in the 2026-10-20 billing-cycle spec; all other billing rules remain.

Monthly credits expire at their recorded cycle end. Closing any lot must never create a rollover grant, including previously expired lots processed lazily after activation. Keep exact expiry ledger entries, row locking, idempotency, debt accounting, proration, manual renewal and top-up expiry. Set the compatibility policy field to zero and constrain it to zero. Retain historical rollover kinds, provenance and refund paths so existing records remain explainable; do not rewrite migration history.

Reset only shukla.vighnesh@gmail.com's frozen five Test orders and their linked graph after a local rehearsal. Preserve auth, signup lots, usage, chats, invoice sequence and unrelated accounts. Abort on changed inventory, Live orders, active holds, debt, purchased-credit draws, unlinked paid grants or unreconciled wallet. Late provider events must not recreate deleted purchases. Provider records remain untouched.

Acceptance: causal local SQL expiry tests fail without the new migration; expiry/renewal/upgrade/downgrade/lapse and historical refund tests pass with it. Reset SQL is rehearsed with synthetic target and bystander records, proves abort/rollback on inventory drift, and reconciles both ledger and wallet. Full SQL, application and Edge suites, lint and build pass. Shared NTER activation is an explicitly identified shared-policy action; Production web/settings and Live keys are excluded. Preview publication uses only task/razorpay-plan.

Write scope: new migration and SQL fixtures/reset script, supabase/tests/run.sh, this spec, rollover-retirement plan and open-work tracker. No frontend changes are needed for the already-deployed no-rollover UI.
