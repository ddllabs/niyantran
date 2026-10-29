# Production changes made by the corpus client agent

> **Status: Historical (dated 2026-10-29).** Required by the owner's 2026-10-29 handoff, step (a). It lists every production
> change this agent made on NTER (`vfgcppstyzjarlzyqdac`) from its branch `task/client-law-ingestion-claude-2026-10-23`
> (first commit 2026-10-23 22:23 UTC) to the pause on 2026-10-28 00:19 IST. Times are UTC unless marked IST.
>
> **Sources and limits.** The branch's committed receipts, NTER's `schema_migrations`, and live read-only queries. The
> agent's session transcripts before 2026-10-27 18:59 UTC are no longer available, so an action that no receipt records
> would be missing here. I know of none. Read-only `SELECT`s are not listed. Work recorded on `main` before this branch
> existed (the five-document Law pilot, Law cohort-2, the Law listing release) is not attributed here.

## 1. Migrations

| Date (UTC) | Migration | What | Status now |
|---|---|---|---|
| 2026-10-27 11:08:36 | `20261027110836 supplied_text_national_questions` (repo file `20261027120000_supplied_text_national_questions.sql` on the old branch) | Replaced `ingest_register_text_unmapped` to admit Lok Sabha answers by sansad.in URL with a desk-row check; revoked the inner function from `service_role`. Owner-approved route, 2026-10-27 ("option 1 but check it doesn't break anything"), after CI passed on `3e72673` | **Superseded** by F266 `20261028185850 pq_admission_links` (supervisor). The history row stays on NTER with no file on `main`. Do not re-apply |

No other migration on NTER is from this agent.

## 2. Edge Function deploys

| Date (UTC) | Function | How | Status now |
|---|---|---|---|
| 2026-10-27, between 10:56 (CI-passing commit `3e72673`) and 11:09 (batch 1 start) | `admin-ingest` v8 | Supabase dashboard code editor; only `_shared/suppliedText.ts` changed, fetched from GitHub raw at the pinned commit, deployed file sha256 `ccd69fbe…9488`; every other file compared with the repo, unchanged | **Superseded**: `admin-ingest` v10 from `main` (F266) |
| same window | `ingest-worker` v6 | same | **Superseded**: `ingest-worker` v7 from `main` (F266) |

The exact minute of each deploy was not recorded.

## 3. Direct SQL that changed something

| Date (UTC) | Statement | Purpose |
|---|---|---|
| 2026-10-27, decision 14:56 IST; receipt 09:30 UTC | One transaction, service SQL: `law_records.visible = false` on 3 records; `law_publications` for 3 documents set `status = 'held'` with decision `owner-authorized-20261027-law-retire-contained-orders` | Retire three contained Law orders (owner: "Keep the longer orders as you listed"). Reversible; receipt and reversal SQL in `docs/operations/law-retire-contained-orders/README.md` (old branch, `1cb9d0f`). **Rule 6 now makes this kind of change a reviewed operation, never direct SQL** |
| 2026-10-24 (next-100, next-1,000), 2026-10-26 (Law batches 5–8), 2026-10-27 (Law batches 9–11; PQ batch 1, about 14:15) | `analyze` on the touched tables (the receipts say "the touched tables"; for PQ batch 1: `documents`, `document_chunks`, `desk_rows`) | Planner statistics after each bulk load, as AGENTS.md then required. No data change. Not run after PQ batches 2–6. **Since 2026-10-29 rule 6 forbids this too; the developer runs `ANALYZE` (done 2026-10-29)** |

## 4. Ingestion registrations (through `admin-ingest`, not SQL)

Each registration creates a document, its text input and an index job, and starts paid embedding work. Law registrations also create or link a Law listing record (`law_reconcile`).

| Date (UTC) | Decision | Documents | Spend (US$) | Receipt (old branch) |
|---|---|---|---|---|
| 2026-10-24 | `owner-authorized-20261024-law-next-100` | 100 | 0.0201 | `law-next-100-release/` |
| 2026-10-24 | `owner-authorized-20261024-law-next-1000` | 1,000 | 0.2050 | `law-next-1000-release/` |
| 2026-10-26 | `owner-authorized-20261026-law-batch-5` | 1,000 | 0.1620 | `law-batch-5-release/` |
| 2026-10-26 | `owner-authorized-20261026-law-batch-6` | 1,000 | 0.1443 | `law-batch-6-release/` |
| 2026-10-26 to 27 | `owner-authorized-20261026-law-auto-b07` … `b11` (autopilot) | 4,439 | 0.5155 | `law-batch-7-release/` … `law-batch-11-release/`, `law-autopilot/` |
| 2026-10-27 11:09–11:32 | `owner-authorized-20261027-national-pq-b01` | 1,000 | 0.0482 | `national-pq-batch/README.md` |
| 2026-10-27 15:47–18:49 | `owner-authorized-20261027-national-pq-b02` … `b06` | 4,865 | 0.2089 | `receipts/b02.md` … `b06.md` (this branch) |

Totals: Law 7,539 documents, US$1.0469; Lok Sabha answers 5,865 documents, US$0.2571.

## 5. Things the owner should act on

- **Stored password.** The Law autopilot and the PQ section driver signed in as the ingestion account with a password
  kept in Colab Secrets (`NTER_INGEST_EMAIL`, `NTER_INGEST_PASSWORD`). Rule 7 now forbids this. Please delete those
  secrets from the Colab notebook and rotate the account's password. New client scripts take only a short-lived token
  that the owner issues for each run.
- **Autopilot and section approvals.** Law batches 7–11 and PQ batches 2–6 ran from one owner instruction each,
  without a per-manifest approval. Rules 1 and 2 now forbid this. The receipts say so; nothing was changed retroactively.
- **Not done by me:** the F257 and F266 links, the six `ingest_retry` re-runs, the F266 migration and deploys. These
  were the supervisor's, under their own decisions.
