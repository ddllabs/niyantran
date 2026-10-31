# B0: read-only report on the National v1.2 delta pack

> **Status: Living (2026-10-31).** Developers' operating procedure of 2026-10-31, stage 5b.
>
> **Nothing was loaded, submitted or written to production.** No token was used, no loader ran, and no SQL write was made. Production was read once, inside `begin transaction read only; … rollback;` (query below). Everything else is offline in Colab.
>
> **Every v1.2 decision below is held for the developers (F275).**

## Pack identity

| Item | Value |
|---|---|
| File | `Data Handover/National/v1.2/file to ingest/NTER_citation_pack_v1.2_DELTA_2026-10-06.zip` |
| Size | 171,703,858 bytes |
| sha256 | `0cc3853f463ecd493e27528a64a961b981c61fd97689a43bd218a870abe3611e` |
| Manifest | `citation_pack_v1/manifest_delta.json`, schema `nter.citation_pack/1.2-delta`, built 2026-10-06T08:04:32Z |
| Applies on top of | `NTER_citation_pack_v1.1_2026-10-05.zip` (252,355,253 B) |
| Equals after merge | `NTER_citation_pack_v1.2_2026-10-06.zip` (sha256 `d9f9072e…565c5b`), except gzip timestamps and the 100 changed bills / corrigenda records |
| Member check | All five document members match `manifest_delta.json` sha256 (checked in Colab before reading) |
| Also in the zip (not read) | `load_v1.2_delta.sql`, `load_citation_pack.sql`, `links/desk_row_links.csv` (6.0 MB), `gapfill/*`, `README.md`, `SOP-v1.2-DELTA-on-top-of-v1.1.md` |

## Counts, overlap and chunk estimates

**Sources:**
- Records: `b0-collect-colab.py` at `dfd02b9`, giving `b0-records.tsv` on Drive (`staging/v1.2-b0/`; 13,031 rows; no text; sha256 `86dc149c…3397`).
- Live documents: a read-only export of all 9,424 National documents (key, text hash, URL, feature, chunk count, link count).
- Per-member figures: `b0-summary.json`.

| Member | Records | Collection (desk feature) | Live by source_key | Live by text hash | Live by URL | servable = false | Chunk estimate |
|---|---:|---|---:|---:|---:|---:|---:|
| `affidavits_eci` | **10,492** | Candidate Affidavit Database (new collection) | 0 | 0 | 0 (no URLs) | **1,354** (1,331 also `retrieval_excluded`) | **616,643** |
| `ocr_repaged` | **1,819** | Bills 1,732 · Lok Sabha answers 82 · Budget 3 · Regulatory 2 | 1,796 | 1 | 1,601 | 0 | 42,219 |
| `mp_profiles_current` | 565 | MP Profiles & Performance (new) | 0 | 0 | 0 | 0 | 565 |
| `bills_links_fixed` | 100 | Bills (89 bills, 11 corrigenda): link fixes to v1.1 records | 16 | 13 | 8 | 0 | 2,246 |
| `bills_recovered` | 55 | Bills (gap-filled; `replaces_text` false) | 0 | 0 | 0 | 0 | 1,103 |
| **Total** | **13,031** | | | | | **1,354** | **662,776** |

**New versus replacement:**
- **New:** 11,112 records (affidavits 10,492, MP profiles 565, recovered bills 55).
- **Patches:** 100 v1.1 bill/corrigendum records (`delta_patch`).
- **Replacement texts:** 1,819 (`ocr_repaged`, all `replaces_text`).

**How the chunk estimates were made:** offline, with the shared whole-document chunker (`chunkUnit`, `CHUNK` defaults) through `b0-chunk-estimate.mjs`. It is not the importer, whose adapter only accepts Lok Sabha answers among National features. At cohort 1's measured rate (about 217 tokens and US$0.0000043 per chunk), 662,776 chunks is about **144 M tokens and US$2.9** of embedding. The affidavits are 93% of that.

The estimator's `tokens_est` column in this first run is void: it sliced the text by undefined offsets. That is fixed in the committed script; chunk counts are unaffected.

## The 1,819 replacements (`b0-replacements.tsv`)

One row each: source key, feature, how it was matched, live document id, live chunk count, live link count, and whether the pack's `old_content_sha256` equals the live text hash.

| Matched to a live document by | Count | Notes |
|---|---:|---|
| source_key | 1,796 | 1,711 bills, 82 Lok Sabha answers, 2 regulatory, 1 budget. Every one has `old_content_sha256` = the live text hash |
| `old_content_sha256` only (unique) | 21 | Bills whose live source key differs |
| none | 2 | Budget documents not in production |

**The 1,817 matched live documents hold 42,920 chunks and 0 record links.** Replacing their text deletes those chunks (the pack's own SOP), and v1.2 would re-chunk them to about 42,219.

**The 82 Lok Sabha replacements are the 82 September 2026 imports.** The owner decided to keep them held and unlinked. A replacement re-OCRs them (exact page split); whether that changes the decision is for the owner.

## Which collections have a reviewed adapter

- **Lok Sabha answers (F266):** the only reviewed adapter. In v1.2 it covers only the 82 replacements, and those are owner-held.
- **Bills:** no reviewed adapter yet; held (F275). This covers the replacements, patches and recovered bills.
- **Candidate Affidavits:** no adapter. The licence class is `eci_govt_PERSONAL_DATA_G02` (personal data), and 1,354 records are not servable.
- **MP profiles:** no adapter; personal data.
- **Budget and Regulatory:** no adapter.

## Decisions needed from the developers (F275)

1. **The 1,819 replacements.** Replacing text deletes 42,920 live chunks. Which path, and when? The pack's SQL loader is not allowed for the client; it is a production change.
2. **The 82 Lok Sabha replacements.** Do they reopen the owner's decision to keep the September imports held?
3. **Affidavits (10,492; about 617 k chunks).**
   - **Personal data:** whether and how to serve them.
   - **`servable=false` (1,354):** today no read policy enforces it.
   - **Size:** one section would be about 6× the F272 search bound of 100,000 chunks.
4. **MP profiles (565): personal data.** Whether to serve them, and how they relate to the existing MP listing.
5. **Bills.** A Bills adapter must exist before the 100 patches, 55 recovered bills and 1,732 replacements can go in.
6. **`links/desk_row_links.csv`.** It is not read here; it carries the delta's listing links, which is listing data, and the developers decide.
7. **Load order.** v1.2 is "on top of v1.1". Only Lok Sabha answers of v1.1 are loaded through the reviewed path.

## Production read used

```sql
begin transaction read only;
select coalesce(json_agg(x order by x.source_key), '[]'::json) docs from (
  select d.id, d.source_key, d.content_sha256 sha, d.file_url url, d.desk_feature f,
         (select count(*) from public.document_chunks k where k.document_id = d.id) chunks,
         (select count(*) from public.record_document_links l where l.document_id = d.id) links
  from public.documents d where d.desk_tier = 'national') x;
rollback;
```

The result was 9,424 rows (2026-10-31 ~00:57 IST): Lok Sabha 6,047, Bills 2,896, Regulatory 474, Industry 6, Budget 1. It is kept off the repository; only the derived counts are committed.

## Files

- `b0-inspect-colab.py`: structure; wrote `b0-structure.json` on Drive.
- `b0-collect-colab.py` and `b0-chunk-estimate.mjs`: per-record facts.
- `b0-summary.json`.
- `b0-replacements.tsv`: no text.
