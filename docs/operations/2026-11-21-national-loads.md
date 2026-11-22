# National loads on NTER (F374)

> **Status: Historical (2026-11-21).** Budget parts 001 to 003, MP Profiles (36 parts), Industry (v1.1 and v1.3), and
> the screen of Bills v1.2 (nothing loaded from it). Specs: [corpus and search completion](../specs/2026-11-20-corpus-and-search-completion.md)
> and [hands-off loads](../specs/2026-11-20-hands-off-loads.md). Open work: F374 (Transfers and held Budget records
> remain), F394 and F403. Earlier record: [Cabinet remainder load](2026-11-20-cabinet-remainder-load.md).

All times are UTC on 2026-11-21. Figures were read back on NTER unless marked as arithmetic. Counts only; no document
text or personal data is recorded here.

## Worker and limits

- `ingest-worker` version 15 was deployed from main `1da7398c` (F397, embedding time limit) at about 01:52. `verify_jwt`
  stayed off.
- At 01:54 `ingest_settings` was raised from max running 1 and claim batch 2 to max running 16 and claim batch 8
  (decision `F374-overnight-national-2026-11-21`).
- At 16:03, with the queue empty, the limits went back to max running 1 and claim batch 2 (decision
  `F374-overnight-national-revert-2026-11-21`).

## Budget (national-budget)

- Parts 001 and 002, 100 records each: accepted at 01:39.
- Part 003: 46 documents, 7,687 planned chunks. Registered with `--register-only` at 01:54, indexed 46 of 46 by 01:58 on
  the new worker, and accepted by 02:02.
- `analyze` ran 02:02 to 02:04.
- Search check: a new document was first at rank 1, in 503 ms.
- The desk ends at 347 documents and 15,751 chunks.
- 140 records stay held: 116 `control_codes_excess` (F391) and 24 other screen holds.

## MP profiles (national-mp-profiles)

- Policy sha `43c706cb…`, decision `F374-mp-profiles-2026-11-21`. US$1 budget, chunk ceiling 10,000, `min_decided` 40,
  `require_page_count` false.
- Screens:
  - v1.1: 3,157 read, 2,950 admitted, 207 held as `too_short`. 194 of the 207 also held as `duplicate_text`.
  - v1.2: 565 read, 565 admitted.
  - The two packs share no record.
- 36 parts, 7,754 planned chunks.
- Rehearsed on the local load copy first: 3 parts, all accepted.
- On NTER:
  - Part 000 was registered attended at 02:10.
  - The operator's session restarted at about 02:11. That ended the watch and the acceptance step. Nothing ran on the
    operator's side until about 08:58.
  - Part 000 still indexed 100 of 100. It was accepted from 08:58 to 09:02 (50 of 50 sampled).
  - The other 35 parts were registered from 09:02 to 09:16, with every gate OK.
  - All 3,515 jobs succeeded. None failed.
  - `accept --all` passed 35 of 35.
- Search check: a new document was first at rank 1, in 600 ms.

## Industry (national-industry)

- Policy sha `8911d011…`, decision `F374-industry-2026-11-21`, licence classes `govt_public_record_cite_only` and
  `govt_material_confirm_counsel`. US$1 budget, chunk ceiling 10,000.
- v1.1: 28 read. 6 were already live, 1 was held as too long, and 21 were admitted. Loaded attended and accepted at 09:19.
- v1.3, first screen: 37 read, 6 admitted. Registered at 09:19 and accepted at 12:47.
- 26 more v1.3 records were held as `pdf_unavailable`. The cause was the page-check defect F401, fixed in pull request
  212 (`8ac0d489`). Re-screened from `8ac0d489`, all 26 passed.
- Registered as batch `6d13945e` at 13:42: 406 planned chunks.
- At 13:44 the batch stopped itself on `spend_ceiling` after 24 of 26 jobs. The real embedding token count was 193,724,
  which is 58% above the estimate of 122,326. Spend was US$0.00387 against a ceiling of US$0.00306.
- With the developer's yes, the batch was resumed through `ingest_batch_resume` with its ceiling raised to US$0.01
  (decision `F374-industry-v13b-resume-2026-11-21`). It indexed 26 of 26 by 16:02 and was accepted.
- Still held from v1.3: 5. Two because the source site's TLS chain is incomplete, 2 as duplicates, and 1 as too long.
- The desk ends at 59 documents.
- Search check: a new document was first at rank 1, in 529 ms.

## Bills v1.2 (national-bills)

- 155 read: 40 were already live and 115 are new. None is loadable yet.
- 111 held by the screen:
  - 58 `pdf_unavailable` (the source site answered HTTP 500 for 50 and HTTP 400 for 8)
  - 11 `bad_shape`
  - 11 `link_disagrees`
  - 9 `bill_role_held_live`
  - 7 `no_live_row`
  - 6 `corrigendum_unmapped`
  - 4 `pdf_unreadable`
  - 2 `unverified_empty_pages`
  - 1 `bill_role_collision`
  - 1 `listing_name_mismatch`
  - 1 `page_split`
- 4 passed the screen but were held by the plan as `text_identity_failed`.
- Nothing was registered.

## After the day

- `analyze` ran 16:03 to 16:05.
- NTER holds 30,655 documents, 23,106 of them National.
- Partition chunks: Bills 356,093; default 97,845; NCLT 225,215; Regulatory 183,805.
- 0 failed jobs across the day.

## Still open

- Transfers: open under F390.
- Budget: 140 records held under F391.
- Industry: 5 v1.3 records held (two on the TLS chain, two duplicates, one too long).
- Bills v1.2: 115 new records not loaded.

## Lessons

1. A session restart stops every operator-side watch and acceptance. The registered work still finished on Supabase.
2. Agents started before a restart cannot be resumed. Their partial work was saved as patches and handed to new agents.
3. One shell watcher received all its batch ids as a single argument, because zsh does not split a variable. It watched
   nothing for about four hours. Shell scripts are now run with `bash`.
4. A batch's spend ceiling equals its estimate, with no headroom. The runner's token estimate was also low on the
   Industry v1.3 PDF text. See F403.

## Rollback

The worker limits are back at max running 1 and claim batch 2. Removing any loaded document would need a separate step,
approved on its own.
