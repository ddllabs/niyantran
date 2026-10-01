# Plan: RAG v2 — admin-upload Amendment A (records-first document management)

> **Status: Living (2026-10-01).** Implements Amendment A (revision 3, approved) of
> `docs/specs/2026-10-01-rag-v2-admin-upload.md`. Tracked as open-work R8.
> Historical when C6 lands.

## Ground rules

These are R8's rules, plus:
- **Every link change** goes through a SQL function that writes its audit row in the same
  transaction.
- **Compare-and-set** applies to link, unlink and swap.
- **Legacy documents are never modified.**
- **Refusals carry a token** in the message, `<function>: <token>: <detail>`, and `admin-ingest`
  maps the token to a code. The D2 unique violation maps by constraint name.
- **Worktrees:** an agent fast-forwards its worktree to the branch tip first.

## Fixed interfaces

**`supabase/functions/admin-ingest/contract.ts`** (C0, done) holds:
- the new actions `records`, `unlinked`, `link`, `unlink`, `swap` and `delete`;
- `register`'s new fields `document_key`, `replaces` and `no_public_source`;
- the types `RecordStatus`, `DeskRecord`, `RecordsResult`, `UnlinkedDocument`, `LinkResult`,
  `SwapResult` and `DeleteResult`;
- the codes `key_held`, `stale`, `not_deletable` and `hub_url`.

**SQL** (migration `20261001180000_corpus_records.sql`). Write functions are security definer,
service_role only, with only `search_path` set. The read functions are security invoker, granted
to service_role.

| Function | Returns | Refusal tokens |
| --- | --- | --- |
| `admin_desk_records(p_tier text, p_feature text, p_query text, p_status text, p_limit int, p_offset int)` | jsonb shaped as `RecordsResult` minus `ok` | — |
| `admin_unlinked_documents(p_tier text, p_feature text, p_query text, p_limit int, p_offset int)` | jsonb shaped as `UnlinkedResult` minus `ok` | — |
| `ingest_link(p_document uuid, p_key text, p_expected_key text, p_actor uuid)` | jsonb `{document_id, document_key}` | `not_found`, `legacy`, `wrong_desk`, `key_held`, `stale` |
| `ingest_unlink(p_document uuid, p_expected_key text, p_actor uuid)` | jsonb `{document_id, document_key: null}` | `not_found`, `legacy`, `stale` |
| `ingest_swap(p_new uuid, p_expected_old uuid, p_actor uuid)` | jsonb `{document_id, document_key, old_document_id}` | `not_found`, `not_replacement`, `not_live`, `key_held`, `stale` |
| `ingest_delete(p_document uuid, p_actor uuid)` | jsonb `{deleted: true}` | `not_found`, `not_deletable` |
| `ingest_discard(p_document uuid, p_actor uuid default null)` | as today; now writes an audit row | as today |

**`ingest_register(p jsonb)` new keys:**
- `document_key`, with `key_check = 'desk'` (the admin path) to apply the desk check and refuse
  `key_held`;
- `link_target` and `replaces` (D5);
- `no_public_source`;
- `actor`.
- Scripts omit `key_check`. A key that is held then registers unlinked, with `link_target` set,
  and the result says so.
- **Resume** applies the new fields under the same checks, or refuses with `conflict`.

**The desk check (D8, D10):** the key exists in `desk_rows` for the given desk. For either bill
feature, it may exist under either one.

**Table `corpus_admin_actions`:** `id`, `at`, `actor` uuid (no FK), `action`, `document_id`,
`key`, `old_key` and `detail` jsonb. RLS on; service_role may only SELECT; the functions above
are its only writers.

**Indexes:**
- `documents_v2_document_key_unique` on `(metadata->>'document_key')` where `storage_path is not
  null and metadata ? 'document_key'`, after a pre-check that lists any duplicates;
- `ingest_jobs (document_id, created_at desc)`.

**`src/lib/corpusUpload.js` additions** (C3 provides them, C4 uses them):
- `createAdminIngestApi()` gains `records`, `unlinked`, `link`, `unlink`, `swap` and `delete`
  (the `delete` method is named `remove` in JavaScript);
- `uploadPlan(plan, meta)` passes `document_key`, `replaces` and `no_public_source` through;
- a new export, `isHubUrl(url, hints)`, for the form's check.

**`src/lib/corpusCoverage.js`** (C3, D9):
- answers expire after `COVERAGE_TTL_MS = 60_000`;
- a new export, `refreshCoverage(keys)`, re-queries the given keys now. The panel calls it when
  a key is attached.

## Tasks

**C0. Interfaces** (supervisor, done): `contract.ts` and this plan.

**C1. Migration and fixture** (agent, L). Files:
`supabase/migrations/20261001180000_corpus_records.sql`, `supabase/tests/corpus_records.sql`,
`supabase/tests/run.sh` (a new chain ending with this migration, applied as a non-superuser).
- **Acceptance:** every refusal token; swap atomicity, including the old document deleted in
  between; the unique index and its pre-check; register and resume with the link fields; cascades
  that keep storage objects; an audit row per action and none on refusal; privileges; the Down
  section (executed); each assertion red on its own; the full `npm run test:sql` green.

**C2. `admin-ingest`** (agent, M), in parallel with C1. Files:
`supabase/functions/admin-ingest/{handler,index}.ts` and their tests.
- **Acceptance:**
  - the new actions;
  - token-to-code mapping, with the D2 violation mapped by constraint name;
  - the hub-URL refusal, using the desk's distinct `source_url` values;
  - the D6 source-URL rule;
  - `prepare` reports a key holder;
  - `register` sends `key_check: 'desk'`, and passes `document_key`, `replaces` and
    `no_public_source` through;
  - every action logged with `user_id`;
  - each test red first.

**C3. Client libraries** (agent, S), in parallel with C1 and C2. Files: `src/lib/corpusUpload.js`,
`src/lib/corpusCoverage.js` and their tests.
- **Acceptance:** the new API methods; the link fields passed through; `isHubUrl`; the coverage
  lifetime and `refreshCoverage`; the panel's call site (the agent names it; editing it belongs
  to C4). Each test red first.

**C4. The Documents page** (agent, M–L), after C3. Files: `src/admin/DocumentsPage.jsx` (split
into components under `src/admin/documents/`), its tests, and `src/ai/AiPanel.jsx` (only the
`refreshCoverage` call on attach).
- **Acceptance:** the Records view (desk picker with keyed desks first, coverage and
  orphaned-links line, search, status chips, paging, per-record actions with in-page
  confirmation); "Documents without a record"; the upload panel's pre-fill and source-URL rule
  with its warnings; the jobs Record column; the main bundle unchanged apart from the lazy chunk;
  each test red first.

**Checkpoint H.** Lint, build, both test suites, `npm run test:sql`, and a review of every diff.

**C5. Local end to end** (supervisor): the spec's local list, on the local stack in the built-in
browser, written up in `docs/research/<date>-admin-records-local-run.md`.

**Checkpoint I.** The owner reads that report.

**C6. NTER**, a go-ahead per step:
1. apply the migration and verify it;
2. deploy `admin-ingest`;
3. push the frontend;
4. the owner's three checks;
5. the record, and R8 marked done.

## Order

```
C0 ─┬─ C1 (SQL) ───────────┐
    ├─ C2 (admin-ingest) ──┤
    └─ C3 (client libs) ─ C4 (page) ┴─ H ─ C5 ─ I ─ C6
```

## Risks

| Risk | Mitigation |
| --- | --- |
| The `admin_desk_records` join is slow over 9,817 rows | The trigram index, the new job index and a 50-row page; measured in C5 on a copy of NTER's bill rows |
| A link is orphaned by a loader reload | The orphaned count and list, and a re-link |
| An existing linked bill (I8) trips the new unique index | The pre-check; I8 is the only ingestion-v2 document, so no duplicate is possible |
