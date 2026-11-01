# Corpus inventory, November 2026 (Task B): report

> **Status: Historical (dated 2026-11-01).** Read-only inventory of every corpus pack under the owner's Google Drive folder
> `Data Handover`, all versions. This is the corrected re-run. It replaces the first run of 2026-10-31, which missed the
> legal high courts and tribunals and the per-document OCR files. That run's outputs are kept on Drive, renamed
> `summary-2026-10-31-incomplete.json` and `keys-2026-10-31-incomplete/`. Nothing was ingested and no token was used.

## Result in one paragraph

The nine packs hold **30,420,131 records (30,312,063 distinct keys)**, of which **21,516,062 have
supplied text**. That is 116,917,765,052 characters, **166,233,378 chunks** with the repository chunker (**118,150,237**
when identical texts are counted once) and 36,337,205,122 estimated tokens. The legal pack is most of it: 19,336,772 records,
19,325,351 distinct sources and 150,729,046 chunks. **Every legal figure equals the 23 October reconciliation**
(`docs/research/2026-10-23-corpus-reconciliation.md`): high courts 18,980,736 distinct sources, tribunals 172,868, acts 10,029,
regulations 12,066, Supreme Court 38,358, regional 111,294. So the "18 million" is the high courts inside the legal pack. The tender
side archive adds 8,874,151 structured rows with no text, all `servable=false`. No line in any member failed to parse.

## Run

| Item | Value |
|---|---|
| Scripts | `discover-colab.py` (pass 1, structure), `inventory-colab.py` + `inventory-records.mjs` (pass 2) and `test-inventory.py` (synthetic test), this folder |
| Launch commit | `e4c261ad885b530e13eee707277c75f4f4be8a03` (branch `task/client-corpus-claude-2026-10-29`); `inventory-colab.py` sha256 `cc369ad87098efa109cd33db219aa996b92b54ddfb0489e43dd8e8bcebba998d`, printed and asserted in Colab before `exec` |
| Test | `test-inventory.py`, 18 checks: nested high-court and tribunal folders, nested per-document OCR files, line numbers of unparsable lines, raw carriage returns, the v1.2 stand-ins and boolean personal-data flags. Fails 14 of 18 on the first run's scripts (`78219dda`); passes 18 of 18 on the launch commit |
| Chunker | `supabase/functions/_shared/chunking.ts` with `textNormalise.ts` and `pageText.ts`, byte-identical to main at `ea34b555` (checked in the run; sha256 `240a6a7c…`, `6a7a1587…`, `b2c2dd0d…`). Per record: `chunkUnit({unitKey: 'document', text, sourceKind: 'document'})` with the CHUNK defaults (target 1,000, overlap 200, min 200, max 6,000 tokens); tokens are the sum of `estimateTokens` per chunk |
| Runner | Colab notebook under the owner's Google account, fresh runtime, 2 CPUs, 4 workers; 2026-11-01 11:40–15:34 UTC (14,048 s) |
| Limits kept | No token, no request to nter.pro or Supabase, no database access. Writes only to `Data Handover/_inventory-2026-11/` |
| Output | `summary.json` here (sha256 `4cda94ade30010167df7e6ab94ce631e7e564c44ec09aff2902f53f503c40f2c`; counts, hashes, field and collection names only). On Drive only: `_inventory-2026-11/keys/<pack>/<collection>.tsv.gz` (key, text sha256, characters, chunks, state per record) |
| Result | All 87,830 files and members have a result. 0 member errors; node exit 0 on all four workers; 0 unparsable lines; 0 records needing the lenient parse |

Definitions:
- **Record**: one JSON line in a document member, or one per-document OCR Markdown file.
- **Supplied text**: non-empty `text`.
- **OCR needed**: no text, but a file or URL is named (`file_url`, `url`, `source_path`, `tender_document_url`, …).
- **No text**: neither.
- **Distinct texts / chunks over distinct texts**: identical texts (same sha256) are counted once.
- **Personal data**: the largest of three counts:
  - licence class containing `PERSONAL`;
  - affidavit and MP-profile collections;
  - records with a non-empty value in a personal field (by field name only; a `true`/`false` flag does not count).

## Packs

| Pack | File | Bytes | sha256 | Members (read / counted / hashed / listed only) | Repeated member names |
|---|---|---|---|---|---|
| `legal_v1.1_full` | `NTER_legal_pack_v1.1_FULL_2026-10-18.zip` | 79,418,376,315 | `aab23dedfd60b593c98702127fcb3246daaed3e6689fc6c699eb167c4712ebf4` | 17,059 (8,547 / 0 / 22 / 8,490) | 8 |
| `citation_v1.1` | `NTER_citation_pack_v1.1_2026-10-05.zip` | 252,355,253 | `459b354cb64360655877187c42566b07a21de579e8b97beb49df9117b16dc9b8` | 14 (9 / 1 / 4 / 0) | 0 |
| `citation_v1.2_delta` | `NTER_citation_pack_v1.2_DELTA_2026-10-06.zip` | 171,703,858 | `0cc3853f463ecd493e27528a64a961b981c61fd97689a43bd218a870abe3611e` | 15 (5 / 1 / 9 / 0) | 0 |
| `citation_v1.3_delta` | `NTER_citation_pack_v1.3_DELTA_2026-10-08.zip` | 212,125,590 | `88e4143a66b7418727cc066c2480757f07b9a1106a7f6d43be1a4b550fdb4d60` | 12 (5 / 4 / 3 / 0) | 0 |
| `citation_v1.4_delta` | `NTER_citation_pack_v1.4_DELTA_2026-10-13.zip` | 2,517,464,571 | `405701a2b0942fe1a5b206b9b755dea4ccd61f1710597c5c056057bc96908043` | 38 (25 / 10 / 3 / 0) | 0 |
| `citation_v1.5_delta` | `NTER_citation_pack_v1.5_DELTA_2026-10-17.zip` | 4,252,899,181 | `e6070b87ad1479b79fc679d8a24b86dcd1f15f412c70e400a4c276a6ef2658f5` | 136 (30 / 10 / 96 / 0) | 0 |
| `processed_2026-09-18` | `NTER-Complete-Processed-Data-2026-09-18.zip` | 6,686,224,418 | `3c01406606158d164fc25fcc737aca0c28cb655a49630424f020bf13198af515` | 35,932 (17,446 / 2 / 18,357 / 127) | 0 |
| `tenders_v1.6_side` | `NTER_v1.6_side_archive_tenders_aoc` | 1,537,766,741 | folder; file-list hash `fc4517a6e55c795d…` | 38 (36 / 0 / 2 / 0) | 0 |
| `citation_v1.1_companion` | `NTER_citation_pack_v1.1_2026-10-05` | 2,376,822,246 | folder; file-list hash `94740cbcaee50548…` | 1,968 (5 / 0 / 1,963 / 0) | 0 |

The "listed only" members are covered by the pack hash but not read:
- the legal page-box sidecars (`*.boxes.jsonl.gz`, 29.0 GB);
- the historical backups inside the processed zip (`backup_*`, 4.2 GB).

The two folder packs have no single hash. Their file-list hash is the sha256 of the sorted list of (path, file sha256).

**Extracted copies.** The unzipped folders `NTER_citation_pack_v1.3_DELTA_2026-10-08` (12 files), `…v1.4_DELTA_2026-10-13` (38) and
`…v1.5_DELTA_2026-10-17` (136) are byte-identical, file for file, to their zips. They add nothing.

**Unreadable files, counted through their v1.2 copies** (developers, 2026-11-01). Two files in the v1.1 companion folder do not
decompress ("invalid block type"). They are hashed as they are, and the v1.2 delta's readable members of the same name are counted
instead. The bytes differ, so whether the content was identical cannot be known.

| Unreadable file (v1.1 companion folder) | Counted instead |
|---|---|
| `gapfill/out/bills_recovered.jsonl.gz` (863,621 bytes, sha256 `2671c2bf578561f8…`) | `citation_v1.2_delta` / `citation_pack_v1/documents/bills_recovered.jsonl.gz` (sha256 `ca234dbd83399f52…`) |
| `gapfill/out/ocr_repaged.jsonl.gz` (34,193,760 bytes, sha256 `e509f99ad5ec95ec…`) | `citation_v1.2_delta` / `citation_pack_v1/documents/ocr_repaged.jsonl.gz` (sha256 `e6f46c561e83e0f8…`) |

## Per collection (packs)

`processed_2026-09-18` documents and `ocr_raw` are split by their `feature` field. `individual_ocr` is one record per Markdown file
under `03_individual_ocr/<document>/`.

| Pack | Collection | Records | Distinct keys | Repeated keys | Supplied text | OCR needed | No text | Characters | Chunks | Chunks, distinct texts | servable=false | Personal data | Duplicate-text records |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `citation_v1.1` | `bill_corrigenda` | 365 | 365 | 0 | 365 | 0 | 0 | 1,405,679 | 2,017 | 2,017 | 0 | 0 | 0 |
| `citation_v1.1` | `bills` | 9,709 | 9,709 | 0 | 9,709 | 0 | 0 | 313,090,539 | 439,943 | 438,970 | 0 | 0 | 35 |
| `citation_v1.1` | `budget_documents` | 486 | 486 | 0 | 486 | 0 | 0 | 30,075,840 | 38,340 | 38,269 | 0 | 0 | 6 |
| `citation_v1.1` | `cabinet_decisions` | 868 | 868 | 0 | 868 | 0 | 0 | 1,996,968 | 2,964 | 2,964 | 0 | 0 | 0 |
| `citation_v1.1` | `industry_documents` | 28 | 28 | 0 | 28 | 0 | 0 | 2,585,903 | 3,622 | 3,622 | 0 | 0 | 0 |
| `citation_v1.1` | `mp_profiles` | 3,157 | 3,157 | 0 | 3,157 | 0 | 0 | 4,856,900 | 7,406 | 7,212 | 0 | 3,157 | 194 |
| `citation_v1.1` | `parliamentary_questions` | 6,840 | 6,840 | 0 | 6,840 | 0 | 0 | 55,250,820 | 71,473 | 71,473 | 0 | 0 | 0 |
| `citation_v1.1` | `regulatory` | 3,319 | 3,319 | 0 | 3,319 | 0 | 0 | 174,680,029 | 227,344 | 224,401 | 0 | 0 | 96 |
| `citation_v1.1` | `transfer_orders` | 29 | 29 | 0 | 29 | 0 | 0 | 67,949 | 116 | 116 | 0 | 0 | 0 |
| `citation_v1.1_companion` | `gapfill:boxes_textlayer` | 14,959 | 14,959 | 0 | 0 | 14,959 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `citation_v1.1_companion` | `gapfill:redo` | 29 | 29 | 0 | 29 | 0 | 0 | 556,617 | 736 | 733 | 0 | 0 | 1 |
| `citation_v1.2_delta` | `affidavits_eci` | 10,492 | 10,492 | 0 | 10,492 | 0 | 0 | 808,839,953 | 616,643 | 616,185 | 1,354 | 10,492 | 11 |
| `citation_v1.2_delta` | `bills_links_fixed` | 100 | 100 | 0 | 100 | 0 | 0 | 1,533,716 | 2,246 | 2,246 | 0 | 0 | 0 |
| `citation_v1.2_delta` | `bills_recovered` | 55 | 55 | 0 | 55 | 0 | 0 | 807,091 | 1,103 | 1,103 | 0 | 0 | 0 |
| `citation_v1.2_delta` | `mp_profiles_current` | 565 | 565 | 0 | 565 | 0 | 0 | 315,220 | 565 | 565 | 0 | 565 | 0 |
| `citation_v1.2_delta` | `ocr_repaged` | 1,819 | 1,819 | 0 | 1,819 | 0 | 0 | 29,421,130 | 42,219 | 41,428 | 0 | 0 | 24 |
| `citation_v1.3_delta` | `boxes_textlayer` | 14,959 | 14,959 | 0 | 0 | 14,959 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `citation_v1.3_delta` | `industry_updates` | 37 | 37 | 0 | 37 | 0 | 0 | 1,300,003 | 1,678 | 1,640 | 0 | 0 | 2 |
| `citation_v1.3_delta` | `refresh_agmut` | 11 | 11 | 0 | 11 | 0 | 0 | 13,500 | 22 | 22 | 0 | 0 | 0 |
| `citation_v1.3_delta` | `refresh_sebi` | 50 | 50 | 0 | 50 | 0 | 0 | 358,353 | 432 | 432 | 0 | 0 | 0 |
| `citation_v1.3_delta` | `regulators_archive` | 8,261 | 8,261 | 0 | 8,261 | 0 | 0 | 35,830,009 | 52,774 | 52,774 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `agmut_civil_lists` | 367 | 367 | 0 | 367 | 0 | 0 | 7,063,379 | 9,758 | 9,050 | 0 | 0 | 13 |
| `citation_v1.4_delta` | `agmut_orders` | 319 | 319 | 0 | 319 | 0 | 0 | 506,748 | 723 | 721 | 0 | 0 | 1 |
| `citation_v1.4_delta` | `budget_cga_monthly_accounts` | 123 | 123 | 0 | 123 | 0 | 0 | 1,092,315 | 1,406 | 1,406 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `budget_economic_surveys` | 784 | 784 | 0 | 784 | 0 | 0 | 53,420,525 | 46,583 | 46,567 | 0 | 0 | 2 |
| `citation_v1.4_delta` | `budget_union_2014_2026` | 6,184 | 6,184 | 0 | 6,184 | 0 | 0 | 222,417,673 | 263,386 | 205,199 | 0 | 0 | 842 |
| `citation_v1.4_delta` | `cabinet_pib_archive_2004_2017` | 4,015 | 4,015 | 0 | 4,015 | 0 | 0 | 7,748,737 | 12,126 | 12,126 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `delimitation_sources` | 1 | 1 | 0 | 1 | 0 | 0 | 471,308 | 149 | 149 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `industry_gst` | 2 | 2 | 0 | 2 | 0 | 0 | 59,656 | 69 | 69 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `industry_oea` | 329 | 329 | 0 | 329 | 0 | 0 | 4,701,407 | 5,623 | 5,623 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `manifestos_ls` | 9 | 9 | 0 | 9 | 0 | 0 | 692,762 | 680 | 680 | 9 | 0 | 0 |
| `citation_v1.4_delta` | `parliament_library_bills` | 1,104 | 1,104 | 0 | 1,104 | 0 | 0 | 48,252,738 | 68,336 | 66,861 | 1,104 | 0 | 25 |
| `citation_v1.4_delta` | `parliament_library_bulletins` | 40 | 40 | 0 | 40 | 0 | 0 | 19,502,861 | 27,728 | 27,728 | 40 | 0 | 0 |
| `citation_v1.4_delta` | `parliament_library_committee_reports` | 6,312 | 6,312 | 0 | 6,312 | 0 | 0 | 684,588,643 | 968,339 | 876,079 | 6,312 | 0 | 564 |
| `citation_v1.4_delta` | `parliament_library_debates` | 762 | 762 | 0 | 762 | 0 | 0 | 420,430,080 | 532,681 | 520,084 | 762 | 0 | 7 |
| `citation_v1.4_delta` | `parliament_library_debates_uncorrected` | 191 | 191 | 0 | 191 | 0 | 0 | 59,051,723 | 81,830 | 72,417 | 191 | 0 | 15 |
| `citation_v1.4_delta` | `parliament_questions_ls18` | 22,461 | 22,461 | 0 | 22,461 | 0 | 0 | 113,970,409 | 159,620 | 159,608 | 0 | 0 | 2 |
| `citation_v1.4_delta` | `parliament_questions_rs` | 26,869 | 26,869 | 0 | 26,869 | 0 | 0 | 124,649,048 | 172,372 | 172,340 | 0 | 0 | 5 |
| `citation_v1.4_delta` | `pib_releases_2026` | 9,120 | 9,120 | 0 | 9,120 | 0 | 0 | 35,672,679 | 56,196 | 56,196 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `regulators_rbi_2014_2023` | 18,846 | 18,846 | 0 | 18,846 | 0 | 0 | 65,153,814 | 97,067 | 97,067 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `regulators_rbi_master_directions` | 382 | 382 | 0 | 382 | 0 | 0 | 11,430,963 | 16,689 | 16,689 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `regulators_rbi_textfix` | 7,801 | 7,801 | 0 | 7,801 | 0 | 0 | 32,121,868 | 47,422 | 47,422 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `regulators_sebi` | 16,693 | 16,693 | 0 | 16,693 | 0 | 0 | 242,017,848 | 308,320 | 306,485 | 0 | 0 | 38 |
| `citation_v1.4_delta` | `regulators_trai` | 2,170 | 2,170 | 0 | 2,170 | 0 | 0 | 107,636,383 | 144,185 | 143,281 | 0 | 0 | 29 |
| `citation_v1.4_delta` | `statements_pm_speeches` | 6 | 6 | 0 | 6 | 0 | 0 | 55,005 | 81 | 81 | 0 | 0 | 0 |
| `citation_v1.4_delta` | `statements_president_speeches` | 542 | 542 | 0 | 542 | 0 | 0 | 3,381,760 | 4,648 | 4,631 | 0 | 0 | 2 |
| `citation_v1.5_delta` | `affidavits_ge2024` | 5,248 | 5,248 | 0 | 5,248 | 0 | 0 | 137,129,615 | 189,384 | 189,217 | 893 | 5,248 | 4 |
| `citation_v1.5_delta` | `agmut_orders` | 3 | 3 | 0 | 3 | 0 | 0 | 3,918 | 6 | 6 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `budget_cag_audit_reports` | 369 | 369 | 0 | 369 | 0 | 0 | 110,278,095 | 145,327 | 143,368 | 0 | 0 | 5 |
| `citation_v1.5_delta` | `budget_union_2014_2026` | 13 | 13 | 0 | 13 | 0 | 0 | 1,616,575 | 2,044 | 2,044 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `cabinet_pib_archive_2004_2017` | 18 | 18 | 0 | 18 | 0 | 0 | 26,807 | 43 | 43 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `delimitation_2008_orders` | 37 | 37 | 0 | 37 | 0 | 0 | 14,019,566 | 19,012 | 19,012 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `elections_eci_reports` | 286 | 286 | 0 | 286 | 0 | 0 | 49,807,485 | 55,535 | 55,476 | 0 | 0 | 1 |
| `citation_v1.5_delta` | `industry_oea` | 80 | 80 | 0 | 80 | 0 | 0 | 1,253,852 | 1,527 | 1,527 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `parliament_library_bills` | 616 | 616 | 0 | 616 | 0 | 0 | 13,227,265 | 18,416 | 17,897 | 616 | 0 | 29 |
| `citation_v1.5_delta` | `parliament_library_committee_reports` | 5 | 5 | 0 | 5 | 0 | 0 | 305 | 5 | 1 | 5 | 0 | 4 |
| `citation_v1.5_delta` | `parliament_library_committee_reports_1952_2003` | 6,552 | 6,552 | 0 | 6,552 | 0 | 0 | 754,524,885 | 1,079,630 | 1,071,029 | 6,552 | 0 | 53 |
| `citation_v1.5_delta` | `parliament_library_debates_1952_2013` | 3,052 | 3,052 | 0 | 3,052 | 0 | 0 | 1,401,727,461 | 1,948,950 | 1,948,950 | 3,052 | 0 | 0 |
| `citation_v1.5_delta` | `parliament_library_member_items` | 19,541 | 19,541 | 0 | 19,541 | 0 | 0 | 125,229,348 | 176,845 | 169,972 | 19,541 | 0 | 218 |
| `citation_v1.5_delta` | `parliament_rs_committee_reports` | 5,539 | 5,539 | 0 | 5,539 | 0 | 0 | 660,180,472 | 818,929 | 816,912 | 0 | 0 | 18 |
| `citation_v1.5_delta` | `parliament_rs_debates_2014_2026` | 12,315 | 12,315 | 0 | 12,315 | 0 | 0 | 91,660,636 | 121,458 | 117,362 | 12,315 | 0 | 946 |
| `citation_v1.5_delta` | `pib_releases_2026` | 12,760 | 12,760 | 0 | 12,760 | 0 | 0 | 46,947,151 | 74,728 | 74,726 | 0 | 0 | 2 |
| `citation_v1.5_delta` | `regulators_ibbi_insolvency_orders` | 10,056 | 10,056 | 0 | 10,056 | 0 | 0 | 236,279,364 | 341,063 | 329,790 | 0 | 0 | 320 |
| `citation_v1.5_delta` | `regulators_rbi_press_releases_2014_2017` | 11,553 | 11,553 | 0 | 11,553 | 0 | 0 | 14,012,415 | 22,452 | 22,443 | 0 | 0 | 8 |
| `citation_v1.5_delta` | `regulators_rbi_speeches` | 752 | 752 | 0 | 752 | 0 | 0 | 13,084,855 | 18,773 | 18,652 | 0 | 0 | 121 |
| `citation_v1.5_delta` | `regulators_sebi` | 13,710 | 13,710 | 0 | 13,710 | 0 | 0 | 187,101,918 | 273,788 | 273,257 | 0 | 0 | 20 |
| `citation_v1.5_delta` | `statements_mea_briefings` | 3,215 | 3,215 | 0 | 3,215 | 0 | 0 | 37,792,380 | 58,090 | 58,090 | 0 | 0 | 0 |
| `citation_v1.5_delta` | `statements_pm_speeches` | 2,497 | 2,497 | 0 | 2,497 | 0 | 0 | 36,622,157 | 54,748 | 54,748 | 0 | 0 | 0 |
| `legal_v1.1_full` | `acts` | 10,029 | 10,029 | 0 | 10,029 | 0 | 0 | 427,194,278 | 629,163 | 629,163 | 0 | 0 | 0 |
| `legal_v1.1_full` | `high_courts` | 18,992,024 | 18,980,736 | 11,288 | 18,992,024 | 0 | 0 | 96,595,582,081 | 139,638,757 | 95,320,401 | 0 | 0 | 1,136,032 |
| `legal_v1.1_full` | `regulations` | 12,066 | 12,066 | 0 | 12,066 | 0 | 0 | 487,476,525 | 712,833 | 712,833 | 0 | 0 | 0 |
| `legal_v1.1_full` | `sc_judgments` | 38,358 | 38,358 | 0 | 38,358 | 0 | 0 | 1,334,165,995 | 1,914,563 | 1,914,171 | 0 | 0 | 12 |
| `legal_v1.1_full` | `sc_judgments_regional` | 111,294 | 111,294 | 0 | 111,294 | 0 | 0 | 2,993,811,973 | 4,257,844 | 4,246,462 | 0 | 0 | 383 |
| `legal_v1.1_full` | `tribunals` | 173,001 | 172,868 | 133 | 173,001 | 0 | 0 | 2,501,639,280 | 3,575,886 | 2,487,600 | 0 | 0 | 15,650 |
| `processed_2026-09-18` | `documents:(root)` | 1 | 1 | 0 | 1 | 0 | 0 | 2,749 | 4 | 4 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Bill Passage Probability Index` | 29,326 | 29,326 | 0 | 29,326 | 0 | 0 | 324,471,925 | 461,805 | 460,832 | 0 | 0 | 35 |
| `processed_2026-09-18` | `documents:Budget Utilisation & Schemes` | 34,119 | 34,119 | 0 | 34,119 | 0 | 0 | 37,412,272 | 73,590 | 73,519 | 0 | 0 | 6 |
| `processed_2026-09-18` | `documents:Bureaucratic Transfers - AGMUT Cadre` | 87 | 87 | 0 | 87 | 0 | 0 | 86,036 | 174 | 174 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Cabinet Decisions` | 868 | 868 | 0 | 868 | 0 | 0 | 1,996,968 | 2,964 | 2,964 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Candidate Affidavit Database (Structured + API)` | 29,582 | 29,582 | 0 | 29,582 | 0 | 0 | 812,507,423 | 635,733 | 635,275 | 0 | 29,582 | 11 |
| `processed_2026-09-18` | `documents:Central Tender Aggregator + Constituency Filter` | 1,104,252 | 1,104,252 | 0 | 1,104,252 | 0 | 0 | 1,082,727,156 | 1,396,239 | 1,394,123 | 0 | 0 | 2,029 |
| `processed_2026-09-18` | `documents:Centre-sanctioned Projects - Completion Rate` | 6,993 | 6,993 | 0 | 6,993 | 0 | 0 | 2,356,116 | 6,993 | 6,993 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Delimitation Impact Simulator` | 1 | 1 | 0 | 1 | 0 | 0 | 225 | 1 | 1 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Industry Updates (Ministry Data)` | 700 | 700 | 0 | 700 | 0 | 0 | 3,279,404 | 4,607 | 4,607 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:LS Manifestos & Promises Tracker` | 1 | 1 | 0 | 1 | 0 | 0 | 228 | 1 | 1 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:MP Profiles & Performance (MPLAD attendance debates)` | 122,776 | 122,776 | 0 | 122,776 | 0 | 0 | 52,347,846 | 127,857 | 127,612 | 0 | 0 | 245 |
| `processed_2026-09-18` | `documents:NTER_National_Data_Log.xlsx` | 249 | 249 | 0 | 249 | 0 | 0 | 58,862 | 249 | 249 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:NTER_National_Download_Log.xlsx` | 188 | 188 | 0 | 188 | 0 | 0 | 53,800 | 189 | 189 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:National Morning Brief (Auto-digest)` | 8 | 8 | 0 | 8 | 0 | 0 | 4,394 | 8 | 4 | 0 | 0 | 4 |
| `processed_2026-09-18` | `documents:Parliamentary Question Database` | 343,767 | 343,767 | 0 | 343,767 | 0 | 0 | 787,001,639 | 1,171,528 | 1,163,898 | 0 | 0 | 7,630 |
| `processed_2026-09-18` | `documents:Policy Intelligence Graph` | 9,152 | 9,152 | 0 | 9,152 | 0 | 0 | 3,909,116 | 9,152 | 9,152 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Policy Pipeline Tracker (Draft-to-Gazette)` | 16 | 16 | 0 | 16 | 0 | 0 | 13,017 | 20 | 20 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:Regulatory Body Watch (RBI SEBI TRAI CCI)` | 3,561 | 3,561 | 0 | 3,561 | 0 | 0 | 174,803,546 | 227,586 | 224,523 | 0 | 0 | 216 |
| `processed_2026-09-18` | `documents:Statement & Quote Tracker with Contradiction Detection` | 1 | 1 | 0 | 1 | 0 | 0 | 250 | 1 | 1 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:UNFETCHED_and_fetched_pdf_urls.txt` | 1 | 1 | 0 | 1 | 0 | 0 | 588,210 | 99 | 99 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:log.json` | 20 | 20 | 0 | 20 | 0 | 0 | 3,924 | 20 | 20 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:ontology.json` | 37 | 37 | 0 | 37 | 0 | 0 | 7,028 | 37 | 37 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:registry_all_169_features.json` | 169 | 169 | 0 | 169 | 0 | 0 | 124,126 | 171 | 171 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:registry_national_17_features.json` | 17 | 17 | 0 | 17 | 0 | 0 | 13,096 | 17 | 17 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:sansad_pdf_urls_TODO.txt` | 1 | 1 | 0 | 1 | 0 | 0 | 579,135 | 97 | 97 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:sansad_question_urls_FIXED.txt` | 1 | 1 | 0 | 1 | 0 | 0 | 633,855 | 106 | 106 | 0 | 0 | 0 |
| `processed_2026-09-18` | `documents:zenodo_parliament` | 190,150 | 190,150 | 0 | 190,150 | 0 | 0 | 143,650,277 | 243,660 | 243,660 | 0 | 0 | 0 |
| `processed_2026-09-18` | `individual_ocr` | 17,443 | 15,093 | 2,301 | 17,443 | 0 | 0 | 1,227,357,746 | 937,013 | 935,460 | 0 | 0 | 77 |
| `processed_2026-09-18` | `ocr_raw:Bill Passage Probability Index` | 2,854 | 1,737 | 1,117 | 2,854 | 0 | 0 | 67,871,728 | 80,204 | 41,900 | 0 | 0 | 1,139 |
| `processed_2026-09-18` | `ocr_raw:Candidate Affidavit Database (Structured + API)` | 2,413 | 1,124 | 1,123 | 2,413 | 0 | 0 | 182,224,967 | 150,621 | 79,903 | 0 | 2,413 | 1,130 |
| `processed_2026-09-18` | `ocr_raw:Parliamentary Question Database` | 82 | 82 | 0 | 82 | 0 | 0 | 738,933 | 1,090 | 1,090 | 0 | 0 | 0 |
| `processed_2026-09-18` | `ocr_raw:Regulatory Body Watch (RBI SEBI TRAI CCI)` | 585 | 506 | 79 | 585 | 0 | 0 | 9,465,847 | 14,083 | 11,117 | 0 | 0 | 83 |
| `tenders_v1.6_side` | `awards` | 4,921,960 | 4,921,960 | 0 | 0 | 4,450,324 | 471,636 | 0 | 0 | 0 | 4,921,960 | 0 | 0 |
| `tenders_v1.6_side` | `notices` | 3,952,191 | 3,952,191 | 0 | 0 | 3,178,484 | 773,707 | 0 | 0 | 0 | 3,952,191 | 0 | 0 |

## Totals

| Pack | Records | Supplied text | OCR needed | No text | Characters | Chunks | Chunks over distinct texts | Tokens |
|---|---|---|---|---|---|---|---|---|
| `citation_v1.1` | 24,801 | 24,801 | 0 | 0 | 584,010,627 | 793,225 | 789,037 | 183,735,546 |
| `citation_v1.1_companion` | 14,988 | 29 | 14,959 | 0 | 556,617 | 736 | 733 | 173,880 |
| `citation_v1.2_delta` | 13,031 | 13,031 | 0 | 0 | 840,917,110 | 662,776 | 661,527 | 240,479,061 |
| `citation_v1.3_delta` | 23,318 | 8,359 | 14,959 | 0 | 37,501,865 | 54,906 | 54,492 | 11,667,770 |
| `citation_v1.4_delta` | 125,432 | 125,432 | 0 | 0 | 2,266,090,332 | 3,026,017 | 2,802,158 | 708,342,138 |
| `citation_v1.5_delta` | 108,217 | 108,217 | 0 | 0 | 3,932,526,525 | 5,420,753 | 5,384,522 | 1,244,379,640 |
| `legal_v1.1_full` | 19,336,772 | 19,336,772 | 0 | 0 | 104,339,870,132 | 150,729,046 | 105,306,629 | 32,558,038,046 |
| `processed_2026-09-18` | 1,899,421 | 1,899,421 | 0 | 0 | 4,916,291,844 | 5,545,919 | 4,607,500 | 1,390,389,041 |
| `tenders_v1.6_side` | 8,874,151 | 0 | 7,628,808 | 1,245,343 | 0 | 0 | 0 | 0 |
| **packs** | 30,420,131 | 21,516,062 | 7,658,726 | 1,245,343 | 116,917,765,052 | 166,233,378 | 118,150,237 | 36,337,205,122 |
| **working folders** | 555,194 | 500,099 | 47,270 | 7,825 | 10,163,991,322 | 13,980,024 | 11,798,305 | 3,203,415,808 |
| **everything** | 30,975,325 | 22,016,161 | 7,705,996 | 1,253,168 | 127,081,756,374 | 180,213,402 | 123,156,079 | 39,540,620,930 |

"everything" = packs + working folders, without the extracted copies.

| | Packs | Everything |
|---|---|---|
| Distinct keys overall | 30,312,063 | 30,510,393 |
| Distinct texts overall | 20,281,075 | 20,483,627 |
| servable=false | 8,926,897 | 8,926,897 |
| Sensitivity-flagged keys (legal) | 647,057 | 647,057 |
| Dedupe alias keys, `keep=0` (legal) | 1,271,630 | 1,271,630 |

Reading the totals:
- **Records with text: 21,516,062**, of which 19,336,772 are legal. The 2.33 million in the first report excluded the
  high courts, tribunals and per-document OCR files.
- **Legal high courts**:
  - 18,992,024 records; 18,980,736 distinct sources;
  - 11,288 repeated keys, including the 10,351 records in `__full` replacement members;
  - 17,855,992 distinct texts;
  - 139,638,757 chunks, or 95,320,401 when identical texts are counted once;
  - 30.1 billion estimated tokens.
- **The tender side archive dominates the "OCR needed" count.** It holds 8,874,151 structured rows (awards 4,921,960, notices
  3,952,191), all `servable=false` and with no text. Their "OCR needed" figure (7,628,808) counts rows that link a tender document; it
  is not a backlog of scanned pages.
- **Box text layers** (14,959 records in v1.3 and the identical set in the v1.1 companion folder) carry their text outside `text`, so
  they show as "OCR needed". They are the same keys as v1.1 bills and questions.
- **The processed September handover** (1,899,421 records) holds:
  - 1,104,252 tender-aggregator records and 190,150 Zenodo parliament records;
  - 17,443 per-document OCR files covering 15,093 documents;
  - small log and registry files read as documents (`documents:log.json` and similar).

## Working folders, staging and other files (not packs)

| Folder | Files | Bytes | Read | Records | Supplied text | Chunks |
|---|---|---|---|---|---|---|
| `_v14_work/records` | 1,358 | 10,183,589,705 | yes | 500,038 | 500,038 | 13,979,570 |
| `_v15_mac/ocr16` | 1,239 | 445,516,679 | yes | 47,270 | 0 | 0 |
| `_refresh/runs` | 5 | 1,575,558 | yes | 7,886 | 61 | 454 |
| `_v14_work` | 535 | 1,072,398,933 | listed only | – | – | – |
| `_v15_mac` | 19,342 | 3,733,486,797 | listed only | – | – | – |
| `_national_raw_new` | 8,919 | 1,196,872,116 | listed only | – | – | – |
| `Legal/v1.1/staging` | 727 | 757,718,283 | listed only | – | – | – |
| `National/v1.1/staging` | 291 | 289,345,453 | listed only | – | – | – |
| `Legal/v1.1` | 16 | 11,278,249 | listed only | – | – | – |

`_v14_work/records` holds 412,507 distinct keys within its collections (13.98 M chunks): the vendor's build records for v1.4/v1.5.
Most reappear in the v1.4 and v1.5 deltas (overlaps below). `_v15_mac/ocr16` holds 47,270 OCR job lines (no text).

Two folders under `Data Handover` were outside this pass's folder list and are not counted:
- **`_national_raw_v14`** has one sub-folder per v1.4 source: `elib_*`, `sebi_*`, `rbi_*`, `rs_*`, `pib_*`, `cci_orders`,
  `ibbi_orders`, `union_budgets` and others. These are the vendor's raw downloads behind `_v14_work`.
- **`_aff_ge2024`** holds one folder, `PDFs`: the 2024 candidate affidavit PDFs, which are personal data.

Pass 1 found no zip or JSONL files in either. They hold source files, not records, and their sizes were not measured.

## Duplicates

**Within collections** (table above): repeated keys and duplicate-text records per collection. The largest are:
- **Legal high courts:** 1,136,032 duplicate-text records. The pack's own dedupe list marks 1,255,412 of these keys as aliases
  (`keep=0`).
- **Legal tribunals:** 15,646 alias keys.

**Across collections and packs.** 227 pairs share keys or texts; all are listed in `summary.json`. The 20 largest:

| A | B | Shared keys | Shared texts |
|---|---|---|---|
| `citation_v1.4_delta / parliament_questions_rs` | `work_v14_records / rs_answers` | 26,869 | 26,864 |
| `citation_v1.4_delta / parliament_questions_ls18` | `work_v14_records / ls18_answers` | 22,461 | 22,459 |
| `citation_v1.5_delta / parliament_library_member_items` | `work_v14_records / elib_part2` | 19,541 | 12,784 |
| `citation_v1.4_delta / regulators_rbi_2014_2023` | `work_v14_records / rbi_history` | 18,846 | 18,846 |
| `work_v14_records / elib_part2` | `work_v15_ocr16_jobs / todo_30_library_hindi_items` | 16,940 | 0 |
| `citation_v1.1_companion / gapfill:boxes_textlayer` | `citation_v1.3_delta / boxes_textlayer` | 14,959 | 0 |
| `citation_v1.5_delta / pib_releases_2026` | `work_v14_records / pib_2026` | 12,760 | 12,757 |
| `citation_v1.5_delta / parliament_rs_debates_2014_2026` | `work_v14_records / rs_debates` | 12,315 | 7,262 |
| `citation_v1.5_delta / regulators_sebi` | `work_v14_records / sebi_orders_ao` | 11,710 | 11,688 |
| `citation_v1.5_delta / regulators_rbi_press_releases_2014_2017` | `work_v14_records / rbi_pr_2014_2017` | 11,553 | 11,545 |
| `citation_v1.2_delta / affidavits_eci` | `processed_2026-09-18 / documents:Candidate Affidavit Database (Structured + API)` | 10,492 | 10,481 |
| `citation_v1.2_delta / affidavits_eci` | `processed_2026-09-18 / individual_ocr` | 10,492 | 10,481 |
| `processed_2026-09-18 / documents:Candidate Affidavit Database (Structured + API)` | `processed_2026-09-18 / individual_ocr` | 10,492 | 10,481 |
| `citation_v1.5_delta / regulators_ibbi_insolvency_orders` | `work_v14_records / ibbi_orders` | 10,056 | 9,729 |
| `citation_v1.1 / bills` | `processed_2026-09-18 / documents:Bill Passage Probability Index` | 9,709 | 9,674 |
| `citation_v1.4_delta / pib_releases_2026` | `work_v14_records / pib_2026` | 9,120 | 9,120 |
| `citation_v1.1 / bills` | `citation_v1.1_companion / gapfill:boxes_textlayer` | 7,786 | 0 |
| `citation_v1.1 / bills` | `citation_v1.3_delta / boxes_textlayer` | 7,786 | 0 |
| `citation_v1.1_companion / gapfill:boxes_textlayer` | `processed_2026-09-18 / documents:Bill Passage Probability Index` | 7,786 | 0 |
| `citation_v1.3_delta / boxes_textlayer` | `processed_2026-09-18 / documents:Bill Passage Probability Index` | 7,786 | 0 |

## Policy, sensitivity and personal data

| Legal policy file | Rows | Breakdown |
|---|---|---|
| `dedupe/duplicate_documents_v1.csv.gz` | 1,872,280 | keep=0 1,290,582, keep=1 581,698 |
| `flags/sensitive_cases_v1.csv.gz` | 647,241 | tier:statute 533,327, tier:word_only 113,914 |
| `not_in_pack/OCR_NEEDED.csv.gz` | 438,614 | collection:pdf_pages 411,977, collection:pdf_pages_gap 5,067, collection:tribunal_pages 21,570 |
| `not_in_pack/documents_cut_short.csv.gz` | 10,351 | collection:pdf_pages 9,077, collection:pdf_pages_gap 123, collection:pdf_pages_reread 1,151 |
| `not_in_pack/documents_not_in_pack.csv.gz` | 491,858 | collection:pdf_pages 464,304, collection:pdf_pages_gap 5,892, collection:tribunal_pages 21,662 |
| `not_in_pack/still_not_in_pack_v1.csv.gz` | 53,478 | collection:pdf_pages 52,542, collection:pdf_pages_gap 853, collection:tribunal_pages 83 |
| `not_in_pack/summary_by_court.csv` | 324 | collection:pdf_pages 246, collection:pdf_pages_gap 49, collection:tribunal_pages 29 |

- **Legal sensitivity and dedupe**, joined by key:
  - sensitivity-flagged keys: 647,057, of which 643,563 are high courts;
  - alias keys (`keep=0`): 1,271,630.

  Both lists come from the pack's own policy files.
- **Personal data in the National packs:**
  - **By licence class `eci_govt_PERSONAL_DATA_G02`:** affidavits in v1.2 (10,492) and v1.5 (4,355 of 5,248), the processed
    handover (29,099 + 2,413) and `_v14_work` (2,167).
  - **The per-document OCR files** in the processed handover cover 10,492 affidavit documents: the same keys as v1.2
    `affidavits_eci`, with 10,481 identical texts. They are personal data too, although they carry no licence class.
  - **MP profiles:** 3,157 in v1.1 and 565 in v1.2. The processed handover's 122,776 "MP Profiles & Performance" records carry no
    personal-data licence class.
  - **Candidate names** appear in the `_v15_mac/ocr16` affidavit job lists (3,351 lines).
- **Tender awards: settled.** `bidder_address_in_source` is a boolean flag (true on 503,652 awards), not an address. No tender
  record carries a personal-data value in the fields checked.

## Sources not on Drive

- **Legal:** the pack's own `not_in_pack/` lists:
  - 491,858 documents not in the pack, of which 438,614 are in `OCR_NEEDED`;
  - 53,478 still not in the pack at v1;
  - 10,351 documents cut short. These are the same 10,351 records that the `__full` replacement members supersede.

  The lists name PDFs and archive locations, not Drive files. Their rows overlap, so they must not be added together.
- **National:** "OCR needed" records name a URL or the vendor's local path, not a Drive file. The 47,270 `ocr16` job lines point to
  source URLs.
- **Outside `Data Handover`** (same Drive, outside this task's scope; files of 1 MB or more, by name and size only, from pass 1):

| Folder | Files | Bytes |
|---|---|---|
| `NTER_LAW_Corpus/02_Source_Archives` | 2,507 | 1,612,168,545,333 |
| `NTER_LAW_Corpus/04_Text_Corpus` | 2,844 | 132,857,602,520 |
| `NTER_LAW_Corpus/GAP with IK` | 431 | 119,846,266,880 |
| `NTER_LAW_Corpus/06_Legal_Citation_Pack` | 6,597 | 78,258,531,635 |
| `NTER_LAW_Corpus/05_OCR_Queue` | 105 | 48,648,512,112 |
| `NTER-LAW-PDF-CACHE-20260921` | 4 | 39,942,835 |
| `NTER v1.6 OCR - Windows laptop` | 1 | 1,073,782 |
| (unrelated: `Goa Voice Studio`) | 3 | 18,522,570 |

## What changed from the first run, and why

1. **Coverage.** Legal members are now matched at any depth below `documents/<collection>/`. High courts and tribunals sit under
   court folders. Per-document OCR Markdown is likewise matched at any depth below `03_individual_ocr/<document>/`.
2. **Line splitting.** Records are split on newlines only. The first run's reader also split lines at bare carriage returns. That
   cut records into fragments: all 119 "unparsable lines" it reported, and acts showing 10,028 instead of 10,029. With newline-only
   splitting no line is unparsable, and no record needed the lenient parse (raw control characters escaped), which is counted
   separately.
3. **Unparsable lines** are reported by collection, member file and line number, with no content. This run has none.
4. **Personal fields** count values, not boolean flags.
5. **The two unreadable companion files** are hashed and their v1.2 copies counted, as instructed.
