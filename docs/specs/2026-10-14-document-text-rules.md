# Spec: storage, chunking and OCR rules for a research platform (F170)

> **Status: Living.** Recorded 2026-10-14 at the owner's request: "Let's just record all this as a
> plan and not do the OCR and chunking bit, because I still have a 10 GB corpus and a corpus linking
> file with pre-contained OCR within it. As long as we can map it, we'll be able to save the costs,
> and only when things are left out will we be able to do it." **Not scheduled.** Only rules 1 to 3
> (records) feed into current work, through F169 phase 4. Rules 4 to 9 (chunking and OCR) wait
> for the corpus mapping (R7) to show what is left out.
>
> **Evidence.**
> - "Measured" means read-only SQL on NTER on 2026-10-14.
> - "Read" means read from the code at `d70d753`.
> - "Estimated" means worked out from measured numbers.

## In plain words

Niyantran is meant to be a research platform: readers drag an item into chat and ask about it. That
needs every listed item stored, not just shown. But storing everything must not bloat the database,
and turning documents into searchable passages ("chunks") must not run up OCR bills. This spec
sets three things:
- which items are kept, and for how long;
- which items are cut into passages;
- how a PDF's text is obtained at the lowest cost.

The owner's 10 GB corpus, which already contains OCR text, is mapped first. Paid OCR is used only
for what the corpus does not cover.

## 1. Current state

**Database size (measured):**

| What | Size | Share |
|---|---|---|
| `document_chunks` (99,225 chunks) | 1,296 MB, about 13 KB each | 86% |
| `desk_rows` (34,184 rows) | 133 MB, about 4 KB each | 9% |
| `documents` (3,379) | 34 MB | 2% |
| Whole database | 1.5 GB | Supabase Pro includes 8 GB |
| Storage bucket | 0.7 MB | Pro includes 100 GB |

**The shared library (read: `20260921000003_corpus_and_desk.sql`):**
- `documents.source_key` is unique.
- `document_chunks` is unique on `(document_id, chunk_hash)`.
- The library is global, read by every user, so a document is never chunked twice.

**Embedding cost (read: `_shared/embed.ts`):** USD 0.00000002 a token. A 50-page bill costs
about ₹0.04.

**OCR (read: `ingest-worker/ocr.ts`, `mistral.ts`):**
- Every page of every PDF goes to Mistral OCR at USD 4 per 1,000 pages (`OCR_USD_PER_1000_PAGES`).
  There is no check for an existing text layer.
- Pages are stored per file hash and never requested twice, even after a crash.
- Each call names its pages (`pages`, 0-based), so page-level OCR needs no new API.
- Measured: the pipeline has run 2 jobs, 34 pages, USD 0.14. The other documents came in with
  their text already extracted (R7's existing-text path).

**Chat uploads (read: `server/sourceExtract.mjs`):**
- Uploads use the free PDF text layer (pdf.js), but test the whole file at once (40 characters
  or more counts as "has text").
- A scanned PDF with one typed page therefore passes, and its scanned pages come out empty. This
  is a known gap, not fixed here.

**Drag-to-chat (read: `src/lib/aiDrop.js`):** sends the row's record text and document key only.
Nothing is fetched, stored or indexed.

## 2. Rules

### Records (feed into F169 phase 4)

1. **One copy per item, updated in place.** Every listed item is stored under a stable key; a
   repeat fetch updates it and only new items add rows.
   - Where an item is a document the corpus also holds (bills first), its key uses the corpus's
     identity (for example `bill:2025:113`), so the corpus mapping links up without a rewrite.
2. **Keep by kind:**

   | Kind | Examples | Kept |
   |---|---|---|
   | Official records | Bills, hearings, Acts, gazette notices, circulars, judgments, Cabinet decisions, questions | Forever |
   | News | Headlines | Headline, link, date and short excerpt kept; full text only on drag (rule 7) |
   | Measurements | Prices, air quality, weather, markets | Latest value plus one summary a day; detailed points deleted after 30 days |
   | Live state | Scores, trending lists | Latest only |
   | Run logs | Feed runs | 30 days |

3. **Large files live in the storage bucket, not the database.** The admin status screen (F169
   T10) shows the database size and warns at 5 GB.

### Chunking (not scheduled)

4. **Chunk any item with a body of text, at any length.** A 5-page hearing is as worth searching
   as a 50-page bill, and the number of chunks already grows with length. Data points (prices,
   scores, register entries, bare headlines) are never chunked; ordinary word search covers them.
5. **Chunking runs in a background queue after the item is stored**, never inside a fetch or a
   page load. Official documents are queued automatically, bills first.
6. **One chunking per document, shared by every user.** If a second request arrives while the
   first is still working, it waits for the first (a lock on `source_key`) instead of starting
   again.
7. **Chunk on demand.** An item with a body that is not indexed yet is fetched and chunked the
   first time anyone drags it into chat. The result is kept for everyone, subject to open
   question 1 for news.
8. **The platform pays for indexing.** Users' credits pay only for the AI answer. Charging the
   first user would penalise the readers who find new material.

### PDF text and OCR (not scheduled)

9. **The corpus comes first, OCR last.** Each document's text is taken in this order:
   1. the owner's corpus and its linking file, which already hold OCR text (R7's existing-text
      path, no OCR spend);
   2. for what is left, a free page-by-page triage;
   3. Mistral OCR only for the pages the triage flags, sent as a page list.

   | Page | How it is recognised | Text from | Cost |
   |---|---|---|---|
   | Machine-readable English | Enough text, reads cleanly | PDF text layer | Free |
   | Hindi or any other non-Latin script (owner, 2026-10-14) | Any Devanagari text, or legacy-font gibberish | OCR | USD 0.004 |
   | Scanned | Little or no text, full-page image | OCR | USD 0.004 |
   | Mixed | Text plus a large image area (scanned table, stamp) | OCR | USD 0.004 |
   | Garbled | Broken characters, missing spaces | OCR | USD 0.004 |

   The triage is only as good as its quality check, so the check is tested on known machine-readable,
   scanned, mixed and Hindi samples before any paid run.
   - The step that builds page text (`_shared/pageText.ts`) expects Mistral's format, so it must
     learn to take a text-layer page too. This is real work, sized when scheduled.
   - Before any paid batch, the admin screen shows the flagged page count × USD 0.004. A daily
     OCR spending cap, set by the owner, stops the queue when reached. Every paid page stays
     logged, as now.

## 3. Cost (estimated)

**The 5,327 linked bills (R7):** at the 17 pages a bill seen so far (a sample of 2, so rough),
that is about 90,000 pages. If all of it were OCR'd, it would cost:

| Machine-readable share | Cost |
|---|---|
| 0% | About USD 360 |
| 70% | About USD 110 |
| 90% | About USD 36 |

Mapping the corpus first should take most of this to zero. Only unmatched documents reach the
triage.

**Records:** about 2,000 new items a day at 4 KB each is about 3 GB a year. Chunking every one of
them as well would be about 10 GB a year, which is why rule 4 excludes data points.

## 4. Order

1. **F169 phases 1 to 3** (live feeds). Not affected.
2. **F169 phase 4** stores records under rules 1 to 3. No chunking, OCR or full-text fetching;
   drag-to-chat is unchanged.
3. **R7** maps the 10 GB corpus and its linking file onto the stored records. This measures what is
   left out.
4. **This spec's rules 4 to 9**, for the leftovers only. Before any download or spend:
   - the triage is built and tested locally;
   - a sample of about 200 bill PDFs is downloaded, with the owner's go-ahead, and triaged for free
     to measure the real split;
   - then OCR runs on the owner's go-ahead, within the cap.

## 5. Exclusions

- No OCR, chunking, embedding, download or ingestion is authorised by this spec.
- The 2,338 legacy documents, completed ingestion manifests and R7 holds stay as recorded in
  `open-work.md`.
- Fixing chat uploads' whole-file text check is a separate item if the owner wants it.

## 6. Open questions for the owner

1. **News full text.** Keeping publishers' full articles in the shared library is a copyright
   question.
   - **Recommendation:** keep the full text only for the chat that asked for it. Share just the
     headline and excerpt with everyone else.
2. **Daily OCR cap.** The amount is for the owner to set when OCR is scheduled.
