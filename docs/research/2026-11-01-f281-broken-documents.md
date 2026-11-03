# F281: eleven broken corpus documents, causes and fix proposal

> **Status: Living (2026-11-01).** Read-only investigation. Nothing was changed in any database, function or
> data file, and no paid API was called. It proposes fixes; it does not authorise any of them. Overwriting an
> existing source needs its own authorization (`docs/operations/corpus-jobs.md`, "Existing stubs, partial
> writes, page-OCR documents and existing-source overwrite/deletion require separate recovery review").
>
> **Evidence labels.** "Executed" means a command was run and its output observed. "Read" means read from code
> or a document without running it. Where a statement is an inference, it says so.
>
> **Open-work note.** F281 is not yet a line in `docs/plans/open-work.md` in this checkout (it still says
> "F281 is next"). The supervisor should add it, and the extra findings in section 6, there.

## 1. Result in one table

All Bill documents are in the feature "Bill Passage Probability Index"; the rest in "Regulatory Body Watch
(RBI SEBI TRAI CCI)". "Source" means the official file at the regulator or Parliament, fetched on 2026-11-01.

| id | Stored under | What is wrong (executed) | What the source has (executed) | Proposed fix | Confidence |
|---|---|---|---|---|---|
| `e4a7d7d2` | The Climate Change Bill, 2012 (`bill:2012:74`) | Text is The National Child Welfare Board Bill, 2005 | The PDF itself is that 2005 bill (Bill No. 96 of 2005). sansad lists the same URL for both bills, so the source is mis-linked, not our text | Re-key and re-title to the 2005 bill (`bill:2005:96`); the 2012 record is left without a document until a true copy is found | High on identity; medium on desk wiring |
| `98abd091` | Central Universities (Amendment) Bill, 2011 (`bill:2011:116`) | Text is The Buy Indian Bill, 2004 | The PDF is that 2004 bill (Bill No. 88 of 2004); sansad lists the same URL for both | Re-key and re-title to the Buy Indian Bill 2004 (`bill:2004:88`); true 2011 text needed | High / medium |
| `7e43d403` | Constitution (Amendment) Bill, 1999, art. 16A (`bill:1999:I`) | Text is The Semiconductor Integrated Circuits Layout-Design Bill, 1999 (Bill No. L of 1999) | The PDF is that bill. sansad's own Semiconductor record (RS L, introduced 1999-12-20, Act 37 of 2000) points at `L_2000.pdf` instead, which is a different bill (see `ca1b65ba`); the two files are crossed | Re-key and re-title to the Semiconductor bill (`bill:2000:L`, sansad's key); true art. 16A text needed | High / medium |
| `7fd68cf2` | Passport (Entry into India) Amendment Bill, 2000 | First 164 characters are another bill's cover page (Multimodal Transportation of Goods Act amendment) | The PDF's page 1 is that cover; pages 2 to 5 are the Passport bill. The body is intact | Strip the 164-character cover from the stored text; re-index | High |
| `fb64d5ac` | Taxation Laws (Amendment) Bill 2025, as passed | Body text is shifted by a constant 29 (glyph IDs, not characters): 1,356 of 10,361 stored characters are control codes | The PDF's own text layer is shifted the same way (no ToUnicode map); the PDF has the bill in clean type | Re-extract from the PDF with a font-aware decode (+29); no OCR | High |
| `1f1ce52a` | Manipur GST (Amendment) Bill 2025, as passed | Same: 6,276 of 39,584 characters are control codes | Same cause, same PDF family | Same | High |
| `3f6669d6` | TRAI press release 104/2026 | OCR garbage (6,899 characters for 25 pages; 45% of words in a dictionary) | Complete, clean rendering, 25 pages, image only (no text layer) at the TRAI site | Re-OCR the official PDF | Medium-high |
| `712b7dab` | TRAI TCEPF (Amendment) Regulations 2011, gazette notice | The Hindi column is read as Latin gibberish; the English column is readable | 3-page bilingual gazette scan at the TRAI site, image only | Re-OCR with a Devanagari-capable model, or strip the Hindi noise | Medium-high |
| `0c47142d` | CCI order, Case No. 04/2009 (majority order) | Only paragraphs 7.2.2 to about 8.9 of a 30-page order are stored (9,913 characters) | Complete 30-page scan at the CCI site, image only | Re-OCR the official PDF | High |
| `e3dd1af0` | CCI order, Case No. 04/2009 (dissenting order) | Only paragraphs 8.2 to 10.4 of 30 pages stored (7,018 characters) | Complete 30-page scan, image only (a different, noisier scan than the majority order) | Re-OCR | High |
| `e77b7df8` | CCI order, Case No. 40/2010 | Only paragraphs 6.6 to 7.2 of 32 pages stored (6,680 characters) | Complete 32-page scan, image only | Re-OCR | High |
| `ca1b65ba` (extra) | Semiconductor Integrated Circuits Layout Design Bill, 2000 (`bill:2000:L`) | Text is the Population Control Bill, 2000 (Rajya Sabha Bill L of 2000) | `L_2000.pdf` is that bill | Re-key and re-title to the Population Control Bill, 2000 (Rajya Sabha) | High on identity |

The five Bill documents that hold another bill's text are not corrupted: the stored text is a faithful copy of
the PDF that sansad serves. The defect is at the source, and the corpus built its title and key from the
sansad listing record while taking the text from the file behind its link.

## 2. What is stored, per document (executed on the local replica)

Text was rebuilt from `document_chunks` by `char_from`; the rebuilt length equals `metadata.n_chars` for every
document and the overlaps agree (no gaps, no mismatches). Every chunk has an embedding and a null
`page_number`. `source_key` is a 40-character hex value for all eleven, and none starts with `upload:`.

| id | `file_name` | `file_url` host | chunks | characters | `chunker_version` | opens with / ends with (short) |
|---|---|---|---|---|---|---|
| `e4a7d7d2` | `1748LS.pdf` | sansad.in (as-introduced LS) | 8 | 5,964 | 1 | "THE NATIONAL CHILD WELFARE BOARD BILL, 2005" / "to provide for the establishment of a National Child Welfare Board" |
| `98abd091` | `2833LS.pdf` | sansad.in | 19 | 12,215 | 1 | "THE BUY INDIAN BILL, 2004" / "...incidental thereto." |
| `7e43d403` | `I_1999.pdf` | sansad.in (RS as-introduced) | 181 | 119,423 | 1 | "THE SEMICONDUCTOR INTEGRATED CIRCUITS LAYOUT-DESIGN BILL, 1999 ARRANGEMENT OF CLAUSES" / "to provide for the protection of the semiconductor integrated circuits layout-designs" |
| `7fd68cf2` | `LI_2000.pdf` | sansad.in (RS) | 6 | 4,183 | 1 | "RAJYA SABHA A BILL to amend the Multimodal Transportation of Goods Act, 1993." / "* * * * 4" |
| `fb64d5ac` | `Tax828202552938PM.pdf` | sansad.in (passed both houses) | 6 | 10,361 | 2 | "Bill No. 105-F of 2025 THE TAXATION LAWS (AMENDMENT) BILL, 2025" / `$V\x03SDVVHG\x03E\\...` (glyph codes) |
| `1f1ce52a` | `101828202550643PM.pdf` | sansad.in (passed both houses) | 16 | 39,584 | 2 | "Bill No. 101-F of 2025 THE MANIPUR GOODS AND SERVICES TAX" / glyph codes |
| `3f6669d6` | `TRAI_press-release__PR_No104of2026.pdf` | none | 11 | 6,899 | 1 | "@ =' @~TZ sargferat TRAI" / "Digitally signed ... 28-07-2026" |
| `712b7dab` | `TRAI_regulations__201209030252173016627TCEPF-Regulation[1].pdf` | none | 12 | 8,469 | 1 | "Gazette of India EXTRAORDINARY ..." / "Published by the Controller of Publications, Delhi" |
| `0c47142d` | `CCI__antitrustorder__en__0420091652345968.pdf` | none | 16 | 9,913 | 1 | para "7.2.2" / para "8.9" cut off by scan noise |
| `e3dd1af0` | `CCI__antitrustorder__en__0420091652345995.pdf` | none | 10 | 7,018 | 1 | para "8.2" / "10.4" and a Member's signature block |
| `e77b7df8` | `CCI__antitrustorder__en__4020101652435911.pdf` | none | 11 | 6,680 | 1 | para "6.6" / para "7.2" |

`metadata.n_pages` (page counts of the source PDFs, matching the files fetched): `e4a7d7d2` 6, `98abd091` 7,
`7e43d403` 48, `7fd68cf2` 5, `0c47142d` 30, `e3dd1af0` 30, `e77b7df8` 32, `3f6669d6` 25, `712b7dab` 3. The two
shifted Bills each have two sibling versions (introduced, passed by Lok Sabha) under the same key that are not
affected. A query for control characters (`\x03`) across all 17,609 replica documents found them in every
chunk of only these two documents (plus one chunk of the nuclear-energy bill `410ebf75`, not investigated).

## 3. The Bill documents with wrong text (questions 2 and 4)

**Commands.** Executed: `curl` GETs of the six Bill PDFs plus `L_2000.pdf`; `GET https://sansad.in/api_rs/legislation/getBills?billName=...`
(the JSON API that the repository's own feed already calls, `server/nationalFeed.mjs:301`) for the title
searches below. `pdftotext`, `pdftoppm`, `mutool`, `gs` and `tesseract` are not installed. Text was extracted
with pdf.js (`pdfjs-dist` 4.10.38 from the main checkout's `node_modules`, run under Node, read-only), and
pages were rendered with macOS `sips` (CoreGraphics) after splitting one page out with `pdf-lib`.

- `1748LS.pdf` (6 pages), `2833LS.pdf` (7), `I_1999.pdf` (48) and `LI_2000.pdf` (5) have no text layer: pdf.js
  returned 83, 97, 710 and 69 characters, which are page markers only. The pages are JPEG 2000 (the first two)
  or CCITT G4 scans (the last two). So the stored text came from OCR of these images, and the OCR is
  faithful to what is on the page.
- I rendered and read page 1 of each. `1748LS` reads "As introduced in Lok Sabha ... Bill No. 96 of 2005 ...
  THE NATIONAL CHILD WELFARE BOARD BILL, 2005". `2833LS` reads "Bill No. 88 of 2004 ... THE BUY INDIAN BILL,
  2004". `I_1999` reads "Bill No. L of 1999 ... THE SEMICONDUCTOR INTEGRATED CIRCUITS LAYOUT-DESIGN BILL, 1999
  ARRANGEMENT OF CLAUSES". `LI_2000` page 1 is a cover for a Multimodal Transportation of Goods Act
  amendment bill (a minister's name and a printer's line); the Passport bill starts on page 2.
  I read page 1 only; the later pages were not compared with the stored text by eye.
- sansad's own listing records (executed, one request per title):

  | sansad record | file it links |
  |---|---|
  | Lok Sabha 74, The Climate Change Bill, 2012 (Lapsed) | `LSBillTexts/Asintroduced/1748LS.pdf` |
  | Lok Sabha 96, The National Child Welfare Board Bill, 2005 (Lapsed) | `LSBillTexts/Asintroduced/1748LS.pdf` (same file) |
  | Lok Sabha 116, The Central Universities (Amendment) Bill, 2011 (Lapsed) | `LSBillTexts/Asintroduced/2833LS.pdf` |
  | Lok Sabha 88, The Buy Indian Bill, 2004 (Lapsed) | `LSBillTexts/Asintroduced/2833LS.pdf` (same file) |
  | Rajya Sabha I, Constitution (Amendment) Bill, 1999, art. 16A (Lapsed, introduced 1999-09-26) | `RSBillTexts/Asintroduced/I_1999.pdf` |
  | Rajya Sabha L, Semiconductor Integrated Circuits Layout Design Bill, 2000 (Assented, introduced 1999-12-20, Act 37 of 2000) | `RSBillTexts/Asintroduced/L_2000.pdf` |
  | Rajya Sabha LI, Passport (Entry into India) Amendment Bill, 2000 | `RSBillTexts/Asintroduced/LI_2000.pdf` |

  `L_2000.pdf` (7 pages, fetched and page 1 read) is "THE POPULATION CONTROL BILL, 2000", Bill No. L of 2000,
  introduced in the Rajya Sabha. That is the text stored in `ca1b65ba`. So at sansad the Semiconductor record
  and the art. 16A record point at each other's file, or at least the Semiconductor file is missing and the
  art. 16A file holds the Semiconductor bill. (The listing shows no Rajya Sabha Population Control Bill, 2000
  record at all, only the Lok Sabha one, bill 36, file `3577LS.pdf`, which the corpus holds as `d8f4106f`.)
- **Does the corpus already hold the other bill?** (executed: title and `document_key` searches in the replica)
  - National Child Welfare Board Bill, 2005 (`bill:2005:96`): no. Only the 1999 one (`dea60a5b`, LS 111) exists.
  - Buy Indian Bill, 2004 (`bill:2004:88`): no.
  - Semiconductor bill: only as `7e43d403` (mis-titled). `ca1b65ba` carries the title but not the text.
  - Population Control Bill, 2000, Rajya Sabha: only as `ca1b65ba` (mis-titled). `d8f4106f` is the different Lok Sabha bill.
  - Multimodal Transportation of Goods (Amendment) Bill, 2000 (`40b1cec9`): yes, 32 chunks. Its own first chunk
    opens with a cover for a different bill (an All-India Institute of Medical Sciences Act amendment), the
    same stray-cover pattern as `7fd68cf2`.
- **Where is the correct text for the stated titles?** Not at any other sansad URL that the listing gives: each
  of those records has one file field, and it is the file above. I did not look on other hosts (not permitted
  in this task). For the Climate Change Bill 2012, the Central Universities (Amendment) Bill 2011 and the
  Constitution (Amendment) Bill 1999 art. 16A, a true copy is **not found** and has to come from the owner,
  the client or another official source.

**Proposal for the four re-keyings.** Each is a relabel of a document that is a true copy of another bill,
which is more accurate than hiding it. After it, the stated-title records (`bill:2012:74`, `bill:2011:116`,
`bill:1999:I`) hold no document and read as "record only", which is the truth. Before doing it, check that desk
rows exist for the new keys (`bill:2005:96`, `bill:2004:88`, `bill:2000:L`, and a key for the Rajya Sabha
Population Control Bill, which sansad does not list); the replica has no `desk_rows` table, so I could not
check this. Saved chats that cite these documents keep working (the document id and chunk text are unchanged
when only title and key change) but will show the new title.

## 4. The shifted-text bills (question 3, executed)

- **Not a three-character offset: it is 29.** Stored `7+(\x037$;$7,21\x03/$:6` is "THE TAXATION LAWS" with
  every letter 29 code points too low (`T` 0x54 becomes 0x37 `7`, `H` becomes `+`, and the space, 0x20, becomes
  0x03). The "three" in the report is the space glyph. This is the glyph-ID numbering of a TrueType Times New
  Roman font (glyph ID = ASCII code minus 29), which is what extractors print when a font has no ToUnicode map.
- **The PDF's own text layer is shifted.** `Tax828202552938PM.pdf` and `101828202550643PM.pdf` were produced by
  Word and Acrobat Distiller 25. Scanning every object (flate streams decompressed) shows seven and four
  `Type0 / Identity-H` fonts and zero `/ToUnicode` entries. pdf.js, run over the PDF, returns exactly the same
  control-code characters as the stored text (1,356 and 6,276, equal to the stored counts). So re-extracting
  with a normal extractor reproduces the defect. Decoding or OCR is needed.
- **Reversal.** With pdf.js I decoded per font: the Identity-H fonts (`g_d0_f4` to `f10` in the Taxation
  PDF, `f4` to `f7` in the Manipur PDF) get +29 per character, spaces kept; the plain `WinAnsi` fonts
  (`f1` to `f3`) are left alone. Result: 6,055 and 28,728 characters decoded, every printable ASCII code
  resolved, and sample text reads correctly ("further to amend the Income-tax Act, 1961 and to amend the
  Finance Act, 2025", "BE it enacted by Parliament in the Seventy-sixth Year of the Republic of India as
  follows"). Dictionary-word coverage of words of four letters or more: stored text 11 of 512 (2%) and 11 of
  2,501; after decoding, 497 of 548 (91%) and 2,344 of 2,563 (91%).
- **Not everything decodes.** Seven non-ASCII glyph codes remain (`±`, `²` for the long dash, `³` and `´` as
  the opening and closing double quotation mark, `µ`/`μ` and `¶` for single quotes and similar, `ʊ`): these
  follow the Mac glyph order, not +29, so they need a small table (my reading of the contexts, not
  verified against the font). Round brackets in the title line come out as spaces in the PDF's own text layer
  and are lost in both extractions.
- **Reversing the stored text instead of the PDF** (executed, run-level heuristic: decode any whitespace-
  delimited token that contains a control code) gives 492 of 541 and 2,319 of 2,548 words (91%), with zero
  control codes left, but it misses tokens made only of printable shifted characters (for example the
  `$0(1'0(17` of "AMENDMENT"). It is good enough to prove the offset and not good enough to replace the text.
  Prefer a font-aware re-extraction from the PDF.

## 5. The Regulatory documents (question 2, executed)

All five official files were fetched by public GET and are **complete but image-only**: pdf.js returned page
markers only. No `file_url` is stored for them; `metadata.source_host` and the file name were enough to find
the files.

| id | Official file | Pages | Producer |
|---|---|---|---|
| `0c47142d` | `https://www.cci.gov.in/images/antitrustorder/en/0420091652345968.pdf` | 30 | scanner |
| `e3dd1af0` | `.../en/0420091652345995.pdf` | 30 | scanner |
| `e77b7df8` | `.../en/4020101652435911.pdf` | 32 | scanner |
| `3f6669d6` | `https://www.trai.gov.in/sites/default/files/2026-07/PR_No104of2026.pdf` | 25 (388 image fragments) | "Print To PDF" |
| `712b7dab` | `https://www.trai.gov.in/sites/default/files/2024-10/201209030252173016627TCEPF-Regulation%5B1%5D.pdf` | 3 | OmniPage |

- The CCI path is the client's pack file name with the `CCI__antitrustorder__en__` prefix turned into
  `/images/antitrustorder/en/`; the first guess worked for all three. The TRAI press release is in the
  press-release listing's date folders (the listing shows `2026-09` and `2026-10`; the 104 file was in
  `2026-07`). The 2011 regulation was found by paging the regulations listing (12 pages) to "Telecommunication
  Consumers Education and Protection Fund (Amendment) Regulations, 2011".
- **CCI orders.** Pages rendered and read: majority order page 1 ("Case No. 04/2009 ... FINAL ORDER", date of
  decision 2011-08-11), page 15 (paragraph 5.5.15), page 20 (7.1.8 to 7.2.1) and page 30 (8.15 and the
  signature block); dissent page 1 ("Order under Section 27 ... dissenting"); `40/2010` page 1 ("Case No.
  40/2010 ... Order under section 27", 25 April 2012). So `0c47142d` is the majority order and `e3dd1af0` is
  the dissent of one Member in the same case, two different documents (different hashes). Stored text for the
  majority starts at paragraph 7.2.2, which is on page 21, and stops around 8.9, so roughly pages 21 to 27 of
  30 survive and pages 1 to 20 and the last pages are missing. For the other two I matched only paragraph
  numbers and did not map them to pages. The cause of the loss is not established (an OCR page cap or a
  partial export would both fit); the pack's PDF was not available to compare with the official one, so I
  cannot say the official file and the client's file are identical.
- **TRAI press release 104/2026** (28 July 2026): page 1 is a clean, high-contrast table, so a modern OCR
  should read it well. The stored text is mostly chart-label debris. The press release carries state-wise
  tables and charts, which OCR flattens; expect table cells, not prose.
- **TCEPF gazette notice**: page 1 is a Hindi column beside an English column. The stored text has the English
  column intact ("Telecommunication Consumers Education and Protection Fund (Amendment) Regulations, 2011
  (2 of 2011)") and the Hindi column as Latin noise.
- **Not a one-off class.** Executed on the replica: Regulatory documents of 5 or more pages with under 600
  characters per page number 45 (36 under 400), of which CCI orders are the large majority (38 and 30), plus
  TRAI recommendation, consultation, regulation and press-release files. Scale is in section 6.

## 6. Related findings outside this scope (reported, not fixed)

Per `AGENTS.md`, these are recorded, not repaired. The supervisor should give them `F` numbers.

1. `ca1b65ba` (above): a twelfth wrong-text Bill, discovered while checking `L_2000.pdf`.
2. **Wrong-text-under-title is a class, not three documents.** Executed heuristic on all 2,893 Bill Passage
   documents: 261 do not contain the title stem in their first two chunks, and 104 contain none of the title's
   significant words. Many of those 104 are false alarms (a file name used as the title, or a misspelt title
   such as "Appropropriation"), and three are OCR hallucination in other languages (`0c258b6d`, `e777c56d`,
   `9611101e`). Of the 104, 62 have a sansad-style file name (LS/RS number, year-numbered RS file, Synopsis or
   gazette); the pattern in the ones I read (`1485LS`, `2353LS`, `5333LS`, `1657LS`, `3245LS`, `1307LS`,
   `2783LS`, `5255LS`, `107LS`, `116LS`, `363LS`, `941LS`, `929LS` and others) is the same: an LS file number
   reused for a different bill. Candidate ids (heuristic, unverified, to be checked one by one against the
   file): `0485a5ac 0cfda1b0 0e4cbb57 144dc8ae 1a3b0519 24c09071 335d3607 390311bf 4530253a 4a665c8b 6393d754
   671bcf49 77ffa7df 8777b653 914ff767 99250d51 a8403f6d afd4f0e8 b8b00f0c c2983b6c c4472f57 d17c2b49 d4f8c709
   def92dc3 e81c044c f5ddf657` (introduced bills), plus synopsis documents `11c3c210 32db3696 3d51552f 5202ba18
   5fca207d 6f94685d a17e769c b2d4bfff ba18ba5c bf323633 c0d26ca8 cbd4dbc1 fb695d96`.
3. **Stray covers.** `40b1cec9` (Multimodal, 32 chunks) also begins with another bill's cover page.
4. **Scanned Regulatory orders with partial text**: 45 documents (36 under 400 characters per page). Their
   official PDFs are likely at the same predictable CCI path; I fetched only three.
5. `410ebf75` has one chunk with a shifted-font span.

## 7. The replace route (read; nothing was run against a database)

**Short answer.** There is exactly one path that replaces the text of an existing legacy document, and it is
not in the admin UI. The admin Documents page cannot touch these eleven documents.

1. **Admin Documents page and `admin-ingest`: not usable for these documents.** The page says "Legacy text is
   read-only here" (`src/admin/DocumentsPage.jsx:284`). `documentActions` returns no Replace, Unlink, Re-link or
   Delete for a legacy document (`src/admin/documents/model.js:158-163`; legacy is `storage_path is null`,
   computed in `admin_desk_records`, `supabase/migrations/20261001180000_corpus_records.sql:831`). The SQL
   behind it refuses legacy documents: `ingest_link` (570, refusal at 585), `ingest_unlink` (616, 630),
   `ingest_swap` (649, 672: "not_replacement") and `ingest_delete` and `ingest_discard` (713, 729; 755, 769:
   both only for `upload:` sources). The replace flow there (register a new PDF with `replaces`, then swap) is
   a new ingestion-v2 document beside the old one. On a record with legacy text it only adds a second
   document and both are searched (`LEGACY_WARNING`, `model.js:32`). Evidence that the eleven are legacy:
   40-character hex `source_key`, no `upload:` prefix, indexed by the 2026-09-21 and 2026-10-08 script
   passes. The replica has no `storage_path` column, so this is an inference, not an observation.
   Also: the admin Bill management is for the Bill desk's records; Regulatory has only "standalone uploads".
2. **`ingest_register_text` (supplied-text connection): not usable.** It only accepts `source_key like
   'law:%'` and `desk_tier = 'law'` (`supabase/migrations/20261022230537_supplied_text_connection.sql:29-31`),
   and a repeat of the same source with a different payload or chunk plan raises "existing source is immutable"
   (line 44). Neither Bills nor Regulatory can use it. The rename in `20261023184450_law_listing_publication.sql:207-209`
   keeps the Law-only restriction.
3. **`ingest-documents` (service key, script `scripts/ingest-national-desk.mjs`): the one real replace path.**
   `ingestOne` (`supabase/functions/ingest-documents/handler.ts:258`) looks the document up by `source_key`.
   It refuses only a page-aware or ingestion-v2 document (`extract_hash` or `storage_path` set, lines 267-269),
   a supplied-text document (270) and a version-4 section-context document without the explicit mode (272-274).
   The eleven fall under none of these (inferred for `storage_path`; `chunker_version` is 1 or 2, observed).
   When the text differs it calls `upsertDocument` (309), which updates `title`, `file_name`, `file_url`,
   `desk_*`, `content_sha256`, `ocr_text` and `metadata` on the same row and sets `chunker_version` and
   `indexed_at` to null
   (`supabase/functions/ingest-documents/index.ts:19`). It then rechunks, embeds only chunks whose hash is
   new, and `chunk_commit` deletes every chunk of that document whose hash is not kept
   (`handler.ts:377`; `supabase/migrations/20261001120000_page_contract.sql:169-195`), and last it sets
   `indexed_at` again (`handler.ts:384`). Effects:
   - **Chunks and embeddings:** old chunk ids are deleted unless the same chunk text recurs; new chunks and
     vectors are created and charged to `model_call_logs` (embedding only, about 20 microdollars per 1,000
     tokens by the spec; a bill of this size is a fraction of a rupee).
   - **Retrieval:** the document drops out of search while the replacement runs (`indexed_at` is null) and
     returns when it finishes; a failed run leaves it out until re-run, with the missing chunks only re-embedded.
   - **Citations in saved chats:** a citation carries `document_id`, `chunk_id`, a character span and a text
     hash. After a replacement the reader loads the document by id, tries the span, then searches for the cited
     text, and otherwise shows "This passage has changed since it was cited" (`src/ai/sourceReader.js:32-45`,
     `src/ai/SourceReader.jsx:18-30`). A deleted chunk makes the cited text unknown, so a changed passage ends
     as "changed". It never shows a wrong passage silently. A deleted document shows "no longer available".
   - **Desk-record links:** Bills link by `documents.metadata.document_key`, with `metadata.links` on some.
     `mergeDocumentMetadata` (`handler.ts:202-219`) is built for this: when the incoming `document_key`
     differs, it removes the old key fields (`document_key`, `bill_number`, `bill_year`, `house`, `status`,
     `file_url_source`) and writes the new ones. A re-key and a re-title therefore need no new function. There
     is no key-in-desk check on this route (the admin path has one, `corpus_key_in_desk`), so the new keys
     must be checked by the caller. `record_document_links` (F257) refuses Bills outright
     (`supabase/migrations/20261027185747_record_document_associations.sql:42`) and Regulatory documents have
     no `file_url`, which that mapping requires (line 45), so no reviewed association is affected.
   - **Guard that applies:** the staged National job tooling treats any existing source as an error
     (`scripts/corpus-stage-job.mjs:107` and `:148`: "unexpected existing source"), and
     `docs/operations/corpus-jobs.md:41` requires a separate recovery review and authorization for any
     existing-source overwrite. So this route is available technically but is not authorised.
4. **Direct SQL (service role):** `delete from documents where id = ...` cascades to chunks
   (`document_chunks_document_id_fkey ... on delete cascade`), but `record_document_links.document_id` and
   `law_document_links.document_id` reference `documents(id)` without a cascade, and no legacy-delete function
   exists. There is no retire, hide or version flag on documents. The only way to hide a document from search is to null `indexed_at`
   (every retrieval function requires it, for example
   `supabase/migrations/20261027185840_feature_search_recovery.sql:46`), and the reader would still show the
   document by id.
5. **Does not exist:** a versioned or superseding document, a retire flag, a "replace text in place" admin action.

**Which route suits which fix.**

| Fix | Route |
|---|---|
| Decode the shifted Bills | `ingest-documents` with the same `source_key` and the decoded text; `section_context_v1` is not needed (they are version 2, which is `CHUNK.version`, `supabase/functions/_shared/chunking.ts:29`). The text changes, so every chunk is replaced |
| Strip the stray cover (`7fd68cf2`) | `ingest-documents`, same `source_key`. Chunk boundaries move, so expect most or all chunks to be replaced (inference from how the chunker splits by size) |
| Re-key and re-title (4 Bills) | `ingest-documents` with the same `source_key`, same text, a new `title` and a new `document_key` in metadata. The "unchanged" shortcut (title and key refreshed, nothing re-embedded, `handler.ts:282-297`) needs the stored `chunker_version` to equal the current one (2). All four of these are at version 1 (observed), so the run re-chunks and re-embeds them in full: new chunk ids, a few thousandths of a rupee of embedding cost. The Manipur and Taxation documents (version 2) would take the shortcut if only their metadata changed |
| Re-OCR Regulatory (5) | OCR the official PDF, then `ingest-documents` with the same `source_key` (keeps the id and the metadata). The alternative, a standalone admin upload through `admin-ingest` and the Mistral path, creates a **second** `upload:` document with page numbers, leaves the legacy one in place and searchable, and the UI cannot remove the legacy one |

The re-key row is the cheapest: same text, same `source_key`, no OCR. Run it as a dry run first
(`dry_run: true`, supported by `handleIngest`), which reports the chunks it would insert and delete, then read
back the title, `document_key` and `n_chars` after the real run.

## 8. Fix plan (ordered)

**Gate 0 (owner).** Authorise overwrite of existing legacy sources through `ingest-documents` for named
documents only, with a dry run first and a readback after. `corpus-jobs.md:41` requires this. Everything below
depends on it. Also decide whether to do the Regulatory OCR with Mistral (USD 4 per 1,000 pages by the spec,
so about 120 pages = USD 0.48; an earlier project note (2026-09-30) recorded the Mistral probe as blocked
on a subscription, which I did not recheck).

**A. Needs no source we do not have (official files already fetched or public).**

1. Check desk rows exist for the new keys (`bill:2005:96`, `bill:2004:88`, `bill:2000:L`, and a key for the Rajya
   Sabha Population Control Bill, 2000). Needs a read on NTER's `desk_rows`; not possible on the replica.
2. Re-key and re-title: `e4a7d7d2` to the National Child Welfare Board Bill 2005, `98abd091` to the Buy Indian
   Bill 2004, `7e43d403` to the Semiconductor bill, `ca1b65ba` to the Population Control Bill 2000 (Rajya
   Sabha). Text unchanged; these four are at chunker version 1, so the run re-embeds them (negligible cost) and their
   chunk ids change. Afterwards the Climate Change 2012, Central Universities 2011 and
   Constitution 1999 art. 16A records read "record only". Confidence: high on the text identity, medium that
   the desk records are keyed as assumed.
3. Decode and replace: `fb64d5ac` and `1f1ce52a` from the PDF text layer with the +29 per-font decode and a
   small table for the dash and quote glyphs. Add a guard that fails if control codes remain. Prove the
   guard against the stored text first (it must fail on it), as `AGENTS.md` asks. Confidence: high. Risk: the
   decode keeps the layout whitespace of the extractor; compare chunk results on one before the other.
4. Strip the foreign cover from `7fd68cf2` (the first 164 characters up to "AS INIRODUCED"; the OCR also
   misreads that heading). Confidence: high. Low value, since the cover is harmless to search; fold it into
   the same pass as step 3 or skip it.
5. Re-OCR the five Regulatory files from the official PDFs (about 120 pages) and replace the text by
   `source_key`. Check each result by eye: for the CCI orders the first and last paragraph numbers should be
   1 and the last one on the signature page; for the TCEPF notice the Hindi must be real Devanagari or absent;
   for PR 104/2026 compare the headline table with the page-1 image. Confidence: high for the CCI orders,
   medium-high for the other two.

**B. Needs a source from the owner or client.**

6. True texts for the Climate Change Bill 2012 (LS 74), the Central Universities (Amendment) Bill 2011 (LS 116)
   and the Constitution (Amendment) Bill 1999 art. 16A (RS I). sansad's listing does not hold them. Ask the
   client whether the pack has other files; the pack's `1748LS.pdf` and `2833LS.pdf` are probably the same
   mis-linked files (the pack's source path is the same name, the content was not compared). Any other host
   (the Lok Sabha library, PRS) needs the owner's go-ahead. Until then these three records stay "record only".

**C. Follow-ups to record (section 6).** The wrong-bill class (62 candidates), the 45 scanned Regulatory
documents with partial text, the `40b1cec9` cover, and a guard at ingestion that checks that a Bill's title
words occur in its first chunks (it would have caught all five wrong-text Bills here).

## 9. What I executed and what I only read

- **Executed.**
  - Read-only SQL on the local replica (`niyantran-corpus-test-db`, `niyantran_retrieval_replica`,
    `default_transaction_read_only=on`).
  - Public GETs: the sansad JSON listing API (about 12 requests), seven Bill PDFs, three CCI PDFs, the TRAI
    press-release and regulation listing pages (about 17 requests), two TRAI PDFs and three TRAI 404 probes.
    At most one request a second.
  - pdf.js text extraction under Node and `pdf-lib` page splitting; `sips` page rendering; `python3 -I` analysis.
  - Nothing downloaded was executed. Everything is in `/var/folders/cx/dtk_m4j9523frvy3rrq3s1dh0000gn/T/f281`
    (scratch, outside the repository).
- **Read only.** The migrations, Edge Function handlers, admin UI, scripts and docs cited in section 7.
  Not executed: every claim about what `ingest-documents`, `chunk_commit` and the admin functions would do.
- **Not done.** No OCR (no OCR tool installed, no paid API called). No comparison of the pack's PDFs with the
  official ones (the pack is outside what I may read). No check of `desk_rows` or `storage_path` (not in the
  replica). Page mapping of the CCI stored text was done for one order only, by reading three rendered pages.

## 10. Desk records for the new keys (supervisor, NTER read-only, 2026-11-01)

Executed in `begin transaction read only` on NTER; nothing changed. All twelve documents are legacy (`storage_path`
null).

| Key | Desk rows | Desk record names | Document holding the key today |
|---|---|---|---|
| `bill:2005:96` | 2 | The National Child Welfare Board Bill, 2005 | none |
| `bill:2004:88` | 2 | The Buy Indian Bill, 2004 | none |
| `bill:2000:L` | 2 | The Semiconductor Integrated Circuits Layout Design Bill, 2000 | `ca1b65ba` (which holds the Population Control Bill) |
| `bill:2012:74` | 4 | The Climate Change Bill, 2012 and a Constitution (Amendment) Bill, 2011 | `e4a7d7d2` |
| `bill:2011:116` | 2 | a Constitution (Amendment) Bill, 2010 | `98abd091` |
| `bill:1999:I` | 2 | The Constitution (Amendment) Bill, 1999 (art. 16A) | `7e43d403` |

- The re-keys of `e4a7d7d2` to `bill:2005:96` and `98abd091` to `bill:2004:88` land on desk records that exist and
  have no document.
- `7e43d403` to `bill:2000:L` matches that key's desk record, but `ca1b65ba` holds the key today, so the two must
  move together. No desk record exists for the Rajya Sabha Population Control Bill, 2000 (searched by name); the
  Lok Sabha one (`bill:2000:36`) already has its own document. So `ca1b65ba` would be re-titled and left without a
  desk link.
- The key space itself collides: `bill:2012:74` names two different bills, and the desk record under
  `bill:2011:116` names a 2010 bill. That is a Bills key problem for the Bills adapter (F275), not something to
  patch per document here.
