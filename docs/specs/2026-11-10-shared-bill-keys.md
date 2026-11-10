# Bills records on a shared bill key (F314)

> **Status: Living (2026-11-10).** The developer chose option 1 of F314 on 2026-11-10 ("go ahead with option 1"):
> the resolver also requires the row's bill to match the document. Open work: F314, F312. In this spec "the
> developer" is DDL Labs.

## Current state

- A Bills row's key is `bill:<title year>:<number>` (`billDocumentKey`, `src/lib/deskRows.js`). It has no house and no
  introduction date, so two bills can share it.
- `record_resolve_document_keys` gives a `bill:` row every document whose `metadata.document_key` is the row's key.
  The record panel and research chat's selected record (a `desk-record:` key) read it. A bill dropped into the chat
  as an attachment carries its `bill:` key instead, which research-chat looks up in `documents` directly (F315).
- Read on NTER on 2026-11-10:
  - 396 of 9,415 keys name two or three different bills (796 rows).
  - 374 rows resolve to a document titled as the other bill on their key.
  - 538 documents are involved, 499 of them from the F307 load.
  - On the shared keys, each indexed document's title is the name of exactly one row's bill.

## Problem

A record can show, cite and ground a chat on another bill's document. For example, the State Bank of India
(Amendment) Bill's record shows the Constitution (Tenth Amendment) Bill, 1956.

## Change

Migration `20261110180000_record_resolver_shared_bill_keys.sql` replaces the one function, in its bill branch only:

- A key is **shared** when another row on it (same tier and feature) names a different, non-empty bill.
- On a shared key, a document belongs to a row only when its title is the row's bill. Names compare as
  `public.bill_norm` compares them: the closing year removed, then letters and digits only. The expression is written
  out because signed-in callers may not execute `bill_norm`.
- A row with no name on a shared key gets no document.
- Names only, not house or date. One bill spans both Houses, so the house cannot decide. The cost: two bills with the
  same name on one key stay merged, and on a shared key a bill's document titled otherwise (an Act, a changed short
  title, a Hindi title) is not shown to it. On NTER every indexed document on a shared key is titled as one of its
  rows; the dry run checks that, so a later load that breaks it is seen.
- A key that only one bill uses resolves exactly as before, titles aside: a gazette Act still belongs to its bill.
  So do `document-id:` keys, `law-record:` keys and explicit record links.
- Signature, volatility, security invoker, search path and grants are unchanged.

## Acceptance evidence

1. **Fixture** `supabase/tests/record_resolver_shared_bill_keys.sql`, on the `ingest_bills_admission_rules` chain,
   applied as a non-superuser. It fails without the migration (the vacuity check).
2. **Dry run on NTER**, in one transaction that is rolled back:
   - Rows on shared keys resolving to a document titled as another bill: 374 before, 0 after.
   - Every row on an unshared key resolves to the same documents with the same coverage as before.
   - No indexed document on a shared key is titled as none of its rows (0).
   - The Bills of Lading row reads `full`; the Constitution (130th Amendment) row reads `registered`, its own held
     document.
3. **Apply** with the dry run's checks and the `schema_migrations` row, as with the admission rules. Then:
   - re-run acceptance, read-only, on the rescued Bills' last file: 50 of 50 expected;
   - check that the live definition is the repository's.

## Rollback

Re-create the previous definition, saved before the apply (it is the body of
`20261027185747_record_document_associations.sql`), and delete the history row.

## Not in this change

- **A key with house and introduction date** (option 2): that re-keys the app, the rows and the documents.
- **Chat attachments (F315).** A bill dropped into the chat carries `bill:<year>:<number>` (`documentKey` in
  `src/lib/deskRows.js`), and research-chat finds documents by that key without this function, so its scope still
  takes in both bills on a shared key.
- **Admin pages and functions that read `document_key` themselves**, for example `admin_desk_records` and
  `admin_corpus_readiness`. They may still group a shared key's documents together; recorded under F314.
- **Why the screen and admission let documents onto shared keys.** Not yet read in code.
- **Any change to documents, chunks or rows.** Nothing is deleted.
