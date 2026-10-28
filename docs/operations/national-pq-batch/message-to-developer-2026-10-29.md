# Message to the developer (supervisor), from the corpus client agent, 2026-10-29

I have read the handoff in full, including "Rules for every ingestion run". That section is only in `73f999d` on
`task/f266-release-handoff`; main's copy of the handoff doesn't have it yet. Please merge it, so the rules agents read on main are the binding ones.
I confirmed that `origin/main` contains `498152f` (PR #70).

**Branch.** All work is on a new branch from main, `task/client-corpus-claude-2026-10-29`: commits `1bbff81`, `ac4f771`,
`0478de2` and the plan commit after them. It is **not pushed**; the owner has not yet authorized the push. The old branch
`task/client-law-ingestion-claude-2026-10-23` is untouched. My migration `20261027120000` and `suppliedText.ts` change are
not carried over: they are superseded by F266, and `git diff 498152f HEAD -- scripts supabase` is empty.

**Done (read-only; nothing in production changed):**
1. **Receipts** for National questions batches 2–6, in `docs/operations/national-pq-batch/receipts/`. They record honestly
   that those batches ran on a section-level instruction, not on a per-manifest approval.
2. **Every production change I made**, with dates, in `production-changes.md`:
   - migration `20261027110836`, superseded;
   - `admin-ingest` v8 and `ingest-worker` v6, superseded;
   - the direct-SQL retirement of three Law orders (27 Oct);
   - `ANALYZE` runs;
   - ingestion registrations: Law 7,539 documents, Lok Sabha 5,865.
3. **Live reconciliation**, in `reconciliation-2026-10-29.md`, with its queries in `reconcile.sql`:
   - **Your F257 and F266 work:** 5,865 documents indexed (59,503 chunks and vectors) and linked (6,845 links: 5,638 F257 + 1,207 F266), all visible as `authenticated`. Every linked row resolves `full`.
   - **Hashes:** per-batch fingerprints equal the plans; batch 6's 865 equal the plan subset.
   - **Website-accepted:** 0. Rule 5 is outstanding for those batches.
4. **Validation cohort 1**, in `validation-cohort-1/`: 100 Lok Sabha answers, manifest `a3525a9d…f29c`, 829 chunks, ceiling US$0.0465.
   - **Dry run:** main's importer, offline: 100 ready, 0 held.
   - **Live pre-check:** no holder; all 114 listing rows pass F266 under the server's `pq_norm` / `pq_date`.
   - **Run script:** one submission, a token typed at a prompt, and it refuses unless `scripts/` and `supabase/` equal main.
   - **Review:** an independent reviewer found no blocking defect; its four findings are fixed.
   - **Status:** awaiting the owner's approval of the hash.

**Please review** the client-script diff:
- `pq-validation-cohort.py`;
- `pq-cohort-ceilings.mjs`, which gives the importer's exact per-document chunks and ceiling;
- `test_pq_validation_cohort_offline.py` (9 tests, including the real importer; the hold test was shown to fail with the hold disabled);
- `validation-cohort-1/run-validation-cohort-1.py`.

**For you to decide or note:**
- **Reading production.** I used read-only `SELECT`s through the Supabase connector for the reconciliation and the
  pre-submit check. Visibility was checked as `authenticated` inside `begin read only … rollback`. If rule 6 should also
  exclude reads, tell me, and I'll use `corpus-readiness-export.mjs` with an owner token instead.
- **Stored password.** The old Law autopilot and the PQ section driver signed in with a password stored in Colab Secrets.
  I've asked the owner to delete it and rotate it. The new run script uses only a short-lived token.
- **Validation cohort sizing.** The importer's conservative ceiling (byte-based, ×3) is about 13× actual spend. Under the
  US$0.05 limit, 100 average Lok Sabha answers barely fit, and 100 average Law orders (about 31 chunks each) won't fit
  under 2,000 chunks. Law validation cohorts will need small orders unless the limits are revisited.
- **Search capacity.** The Lok Sabha feature has about 59,500 chunks and would reach about 64,600 after the planned cohorts. The 100,000-chunk recovery bound is not near yet, but please confirm capacity before any feature approaches it.
- **Row keys.** `row_key` is still positional (F266 §4.4), so every link depends on the shipped file's order.
- **The 82 September imports** stay held. F266 refuses a second document for the same answer, so they need an owner decision.
- **No new platform defects** found in this pass.

The plan for further ingestion is in `ingestion-plan-2026-10-29.md`: cohort 1, then review, then the Lok Sabha remainder
(about 520), then owner decisions on about 270 held answers, then a Law validation cohort. Every other collection stays held.
