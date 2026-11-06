# NTER disk plan for National v1.1

> **Status: Living (2026-11-06).** Applies the [F287 results](../research/2026-11-06-ingestion-load-proof.md) to NTER. Options
> are costed and **no choice is made**; the developer decides ([F294](../plans/open-work.md)). Nothing here has been done.

## Where NTER stands

Read on 2026-11-06 in a read-only transaction, except the disk size, read on 2026-11-05.

| Item | Value |
|---|---|
| Disk provisioned | 20 GB |
| Database size | 12.47 GB |
| `document_chunks_unpartitioned`, the Phase B backup | 5.56 GB with indexes |
| `ingest_text_inputs` | 0.40 GB |
| `max_wal_size` | 4 GB |
| `archive_mode` | on |
| Replication slots | none |

The "about 8 GB free" quoted so far is disk minus database. It leaves out WAL at rest and logs, so the true figure is lower.
The Database Settings page shows it.

## What v1.1 needs

| Item | GB | Source |
|---|---|---|
| Today | 12.47 | read from NTER |
| 630,000 chunks at 13,970 bytes all-in | 8.80 | E3 |
| Hybrid GIN on today's corpus | 0.14 | 141 MB on the real rehearsal copy |
| Hybrid GIN on the new chunks, at about 460 bytes | 0.29 | E5 |
| **Database after v1.1** | **21.70** | |
| WAL on disk at `max_wal_size`, a soft limit | 4.00 | NTER setting |
| **Peak disk** | **25.70** | |

Measured WAL through the system for v1.1 is 18 to 24 GB, and up to 53 GB at the worst rate seen. The GIN adds 50% or more. Most
of that passes through archiving and does not stay on disk, as long as archiving keeps up. That has not been tested on NTER.

## Supabase's rules

From the [disk documentation](https://supabase.com/docs/guides/platform/database-size), read 2026-11-06:

- A paid project's disk grows by 50% when usage reaches 90%.
- Four changes are allowed in a rolling 24 hours. At 95% with that quota spent, the project goes read-only.
- Inserts then fail. The live product depends on this database.
- Importing a lot of data is called out as a case for expanding by hand first.
- [Price](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size): US$0.125 per GB a month on general purpose
  disk, US$0.195 on high performance. NTER's disk type was not read; the table uses general purpose.

So at 20 GB, auto-scaling fires at 18 GB, about 5.5 GB into the load. One step to 30 GB covers the peak.

## Options

| Option | Monthly cost | Peak use | What it risks |
|---|---|---|---|
| **A.** Expand to 30 GB by hand before the batch | US$1.25 more | 86% | Close to the 90% trigger at the WAL limit. A further step would then fire on its own |
| **B.** Expand to 40 GB by hand before the batch | US$2.50 more | 64% | The extra capacity may sit unused until v1.2 |
| **C.** Leave it to auto-scaling | US$1.25 more, once it fires | 86% after it fires | The resize lands mid-write and is unmeasured. Depends on the spend cap, not read here |
| **D.** Drop the backup table after a clean validation batch | none, and no saving unless the disk also shrinks | 20.14 GB against 20 GB | Removes the only quick rollback of Phase B. **The developer has said not yet.** Alone it does not avoid expansion, because 20.14 GB is past the 18 GB trigger |
| **E.** Delete `ingest_text_inputs` rows after activation | engineering work | saves 0.40 GB now and about 0.66 GB on v1.1 | Registration reads those rows on a rerun, so this needs a design |
| **F.** Apply hybrid after the bulk load | none | saves nothing in final size, and about a third of the load's WAL | Hybrid waits, and the GIN then builds on the whole corpus. Interacts with T9 |

D, E and F combine with A, B or C. None of them replaces an expansion.

**Dollars do not separate these options.** The difference is whether the resize happens before a bulk write or during one.

## Checks before the first validation batch

1. Read true disk use on the Database Settings page.
2. Confirm the disk type, and that the spend cap allows growth.
3. Read `pg_stat_archiver` before and during the batch; a failing archiver holds WAL on disk.
4. Set a stop rule in the runner on disk use, below the 90% trigger.
5. Measure bytes per chunk on the validation batch, since real vectors differ from synthetic ones.
