# National corpus mapping study

**Date:** 2026-09-21
> **Status:** Historical (dated). Measurements from the owner's local
> snapshot `NTER-Complete-Processed-Data` (packaged 2026-09-18) and the
> workbook `NIYANTRAN_Corrected_Function_Data_Architecture_2026-09-10.xlsx`.
> Nothing here is estimated unless marked so.

## Why

Before the full corpus is ingested (`document-rag-and-citations` is built
and proven on ten documents), three questions decide the ingest plan: what
the corpus actually contains, how much of it should go in first, and how
OCR files can be linked to their source URLs and to the desk rows the user
drags into a chat.

## 1. What the snapshot is

`NTER-Complete-Processed-Data/` (10 GB unpacked; 1,039 original files):

| Path | Contents |
|---|---|
| `01_original_corpus/documents.jsonl.gz` | 1,876,044 current records: `dataset` 1,840,686, `pdf_text` 18,071, `ocr` 12,830, `html` 4,079, `doc` 367, `text` 11 |
| `01_original_corpus/chunks.jsonl.gz` | their own retrieval chunks (4,000-char target); not reused — different chunker, no embeddings |
| `03_individual_ocr/<id>/<text_sha256>/` | one Markdown + one metadata JSON per OCR text version (15,093 ids, 17,443 versions) |
| `04_indexes/OCR_FILES.csv` | the index of those versions: id, file name, source path, feature, pages, chars, integrity, retrieval flag, text hash, paths |
| `04_indexes/OCR_OCCURRENCES.jsonl` | every OCR record → its export and corpus line |
| `02_ingestion_outputs/` | staging output, logbook, reports of the NTER-Ingest tool |

Record fields (every record): `id`, `text`, `source_path`, `doc_type`,
`source_host`, `licence_class`, `section`, `feature`, `title`, `n_pages`,
`n_chars`, `extraction`, `as_of`, `file_bytes`, `file_mtime`; OCR records
add `ocr_lang`, `ocr_quality`, `integrity`, `retrieval_excluded`. **No
record carries a URL field.** URLs appear only inside the `text` of dataset
records (see §4).

OCR engines: `paddleocr-vl` 11,606 of 12,830 current OCR records, `eng`
1,207, `tesseract-5` 13, `eng+hin` 4. `ocr_quality` is the pipeline's own
heuristic, not measured accuracy.

## 2. The OCR set by feature (current corpus, 12,830 records)

| Feature | Docs | Characters | Est. tokens (chars/4) | Est. cost at USD 0.02/M |
|---|---:|---:|---:|---:|
| Candidate Affidavit Database (Structured + API) | 10,492 | 808,836,898 | 202 M | USD 4.04 |
| Bill Passage Probability Index | 1,743 | 35,311,288 | 8.8 M | USD 0.18 |
| Regulatory Body Watch (RBI SEBI TRAI CCI) | 506 | 7,383,427 | 1.8 M | USD 0.04 |
| Parliamentary Question Database | 82 | 738,933 | 0.2 M | < USD 0.01 |
| Industry Updates (Ministry Data) | 6 | 26,871 | | |
| Budget Utilisation & Schemes | 1 | 3,718 | | |
| **Total** | **12,830** | **852,301,135** | **213 M** | **USD 4.26** |

Flags on the OCR set: `retrieval_excluded = True` on 5,399 records (all
affidavits); `integrity` other than ok on 2,221 (affidavit name checks).

Storage estimate (marked estimate): at ~1,000 characters per chunk plus
overlap, bills + regulatory + questions ≈ 45,000 chunks ≈ 0.3 GB of vectors
and index; affidavits alone ≈ 0.9 M chunks ≈ 6 GB. Cost is not the
constraint; disk and HNSW build time are, and only for affidavits.

Beyond OCR, `pdf_text` (18,071 records) and `html` (4,079) are also citable
text the same pipeline can take; their size was not measured here.

## 3. The ten-smallest export checks out

All ten ids of `ten-smallest-ocr-documents.zip` exist in `OCR_FILES.csv`,
each Markdown's SHA-256 equals the current corpus record's `text_sha256`,
and each feature matches. One document (`184_AU172_5LFTB7.pdf`) belongs to
Parliamentary Question Database; the export's README table listed it under
bills, the metadata was right and the ingest followed the metadata.

## 4. Linking OCR files to URLs and to rows

The workbook's **Source Register** names the upstream source per function,
not per document. For bills it is the Digital Sansad bills API
(`https://sansad.in/api_rs/legislation/getBills`); for questions the Lok
Sabha and Rajya Sabha question APIs; for regulators the RBI/SEBI/TRAI/CCI
feeds. The corpus's `dataset` records are the saved output of exactly
those APIs, and the bill records carry file links in their text
(`billIntroducedFile: https://sansad.in/getFile/…`).

Measured joins:

| Feature | OCR files | Name found in a dataset-record URL | Ambiguous |
|---|---:|---:|---:|
| Bill Passage Probability Index | 1,743 | **1,620** | 0 |
| Regulatory Body Watch | 506 | 2 | 0 |
| Parliamentary Question Database | 82 | 0 | — |
| Candidate Affidavit Database | 10,492 | 0 | — |

For bills the link also yields the bill record itself (number, year,
house, title, status), so an OCR file resolves to a URL **and** to a bill.
Joining OCR file names to the terminal's bill pack (9,819 rows) on year and
bill number: `YYYY-N-gaz` names 284 of 287, `N_YYYY_house` names 184 of
186; the remaining 1,270 bill files use other patterns (Roman numerals,
corrigenda) and match through the bill record instead.

Questions: the question records (650,614 with links) name their PDFs
differently from the OCR file names (`184_AU172_5LFTB7.pdf` carries the
question number `AU172`); a join on question number and session is the
next thing to measure. Affidavits come from MyNeta, not sansad; a separate
key.

Sample URLs were fetched: `GET` with a range returns `206 application/pdf`
for both a gazette notification and an as-introduced bill text; `HEAD`
returns 403, so link checks must use `GET`.

## 5. Backfill performed

Eight of the ten ingested documents received their `file_url` and their
bill title from the corpus's bill records (the file-name stem kept in
`metadata.title_stem`). Not linkable: `coori 33_2020_h.pdf` (no record
names it) and the one Parliamentary Question file.

## 6. Decisions this study supports

1. **First ingest pass:** bills, regulatory, questions — 2,331 documents,
   ~11 M tokens, ~USD 0.22, ~45 k chunks. Affidavits deferred to a separate
   decision on disk and on their `retrieval_excluded` flags.
2. **URL source for bills:** the corpus's own bill records; no external
   mapping sheet needed. Questions and regulators need their own keys.
3. **Row-to-document key:** for bills, `(year, bill_number)` from the bill
   record, carried on `desk_rows` and on `documents.metadata`, so a dragged
   bill row scopes `search_documents` to its document.
4. **Ingest input:** `OCR_FILES.csv` + the per-id Markdown, filtered to
   `in_current_corpus = True`, staged by feature; the ingest script gains
   a `--corpus <dir>` mode.
