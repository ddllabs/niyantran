# Bulk runner: command line, production connection and acceptance (F285, step 10)

> **Status: Living (2026-11-08; slice B 2026-11-09).** Follows the [bulk runner spec](2026-11-07-bulk-runner.md), whose "Not in this work"
> named these pieces, and step 10 of the [bulk ingestion spec](2026-11-01-bulk-ingestion.md) §10 (acceptance, §5.3).
> Writing nothing to NTER is a rule of this work. In this spec "the developer" is DDL Labs.

## Current state

- The runner's stages (prepare, plan, pre-check, paced run, watch, receipts) are merged (PR #105) behind a `Db` interface
  (`scripts/bulk-runner/db.ts`). The only real `Db` is the proof's PostgREST one (`scripts/load-proof/bulk-proof.ts`).
- There is no command to run it, no connection as `corpus_ingest`, and `accept` has no implementation, so batches cannot
  chain.
- `corpus_ingest` is created `NOLOGIN` by batch registration (not yet on NTER) with `statement_timeout` 60 s,
  `lock_timeout` 5 s and a connection limit of 4. It may execute the eight batch functions and nothing else.

## Problem

The first validation batch needs a command the developer runs from their own terminal, a connection that can be only
`corpus_ingest`, and the §5.3 checks before a second batch may follow.

## Outcome

**Slice A (this change).**

- `scripts/bulk-runner/psql_db.ts`: a `Db` that runs each call through `psql` as `corpus_ingest`. No new dependency: it is
  the client already used for every NTER apply.
  - The connection comes from libpq's own environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, and
    `PGPASSWORD` or a password file) set in the developer's terminal. Nothing is passed in arguments, so it never shows
    in a process list, and the runner never prints it.
  - `session()` refuses unless `current_user` is `corpus_ingest`; each later call sets the session's lock and statement
    timeouts explicitly, so a role's settings are not relied on.
  - Arguments are checked (uuids by pattern) or sent as dollar-quoted literals under a random tag absent from the text.
  - A non-zero exit, a client-side timeout or an empty answer where one is due throws, which the runner already settles
    from the ledger.
- `scripts/bulk-runner/cli.ts`:
  - `plan`: prepare and plan from a records file (JSON lines) and a collection file; prints the batches, holds and cost;
    touches no database;
  - `run`: the same, then the run through `PsqlDb`; receipts go to a directory outside the repository;
  - `status --batch <id>`: the ledger's status for one batch.
  - Amended 2026-11-10 (F309, F310): `plan`, `run` and `split` read a records file only with its receipt, and refuse it
    (`receipt_missing`, `receipt_unreadable`, `receipt_mismatch`) unless the receipt's hash equals the text they parse:
    for a file named `screened.jsonl`, the screen's `screen.receipt.json` beside it (`outputs.screened.sha256`);
    otherwise `<records>.receipt.json` (`output_sha256`), which the pack reader and `split` write.
  - Amended 2026-11-11 (F321): the hash is over the file's bytes as they are on disk; the file must be UTF-8 with no
    byte-order mark. The receipt's count (`lines_written`, or the screen's `outputs.screened.lines`) must equal the
    records parsed, or the file is refused as `receipt_mismatch`. A `<records>.receipt.json` must be the pack
    reader's (`pack`, `entry` and a 64-hex `manifest_sha256`) or a part's (the file is named `part-NNN.jsonl` and
    `source` is well formed and covers at least `lines_written` lines), or it is `receipt_unreadable`.
    `receipt_missing` means the receipt file was not found; any other read error is `receipt_unreadable`. Receipts
    are not signed: the checks catch a wrong or careless receipt, not a forged one.
  - `split --records <file> --lines <n> --out <dir>`: after that check, writes `part-NNN.jsonl` files of at most n
    records, in order and byte for byte, each with a receipt (`output_sha256`, `lines_written`, and `source`: the input's
    path and sha256 and the line range). It refuses an `--out` that already holds parts. Parts replace a hand split.
  - Receipts and `split`'s output go outside every checkout: the module root, the git common directory (so the main
    checkout from a worktree), and any ancestor with `.git` are refused (the pack reader's guard).
- **Acceptance for now:** `--accepted <manifest hashes>`, listing the batches the developer has accepted by hand. With none
  listed, a run stops after its first batch with `awaiting_acceptance`. One batch per run is the intended start.
- **Proof:** the existing full-size proof (`scripts/load-proof/bulk-proof.ts`) run with `PsqlDb` as `corpus_ingest` on the
  load copy, all checks passing and its breaks still caught.

**Slice B (built 2026-11-09).** An `accept` that runs §5.3 on a random sample of each batch, read only, from the
developer's terminal:

- In one read-only transaction, rolled back, as the developer's database login: the stored text hash equals the pack, and
  the chunk count matches the plan with every vector present.
- Then, in the same transaction, `set local role authenticated` with a fixed test subject: each sampled document's links
  resolve `full` through `record_resolve_document_keys`, and a retrieval probe returns the document first.
- No migration is needed: the resolver runs with the caller's rights, and the checks read only.

## Decisions for the developer (slice B): decided 2026-11-09, all as recommended

1. **Retrieval probe.** (a) Search with one of the document's own stored chunk vectors: no spend, deterministic, and it
   tests the index and the access path, but not the embedding model. (b) Embed a passage again: a fraction of a cent a
   batch, and it tests the model too. **Recommended: (a)**; the model is the same one that wrote the vectors.
2. **Sample size.** **Recommended: 50 documents a batch, or all of them below 50, every one passing.** The spec's
   "automated sample 100%" means every sampled check passes.
3. **Connection for acceptance.** It needs a login that can read `documents` and `document_chunks` and switch to
   `authenticated`: the developer's own database login, in a read-only transaction. **Recommended**, since that is how
   production reads are done today; `corpus_ingest` cannot.

## Acceptance evidence (slice A)

- Unit tests of `PsqlDb` with a stand-in for `psql`: quoting (a payload containing every dollar tag it might choose), the
  `current_user` refusal, timeouts set on every call, errors and empty answers thrown, nothing secret in arguments. Each
  guard shown failing first.
- Unit tests of the CLI's argument and file checks.
- The full-size proof through `PsqlDb`: every check passes; the eight breaks are each caught.
- `deno check`, `deno lint` and `deno fmt --check` on the changed files; the runner's tests and `npm run lint`.

**Result (slice A), on the full-size load copy, 2026-11-08.**

- In one sitting, from the same reset each time, with nothing else running: three PostgREST and three `PsqlDb` runs of the
  full proof, alternating; all six passed 21 of 21.
- The eight breaks through `PsqlDb` each fail the check meant to catch them, with the same knock-on failures, in the
  same order, as the PostgREST breaks of 2026-11-07; where both print a count (`resend` 20, `double` 19, `buys` 19 of 21),
  the counts match.
- Unit tests:
  - 12 for `PsqlDb` and 10 for the CLI;
  - each guard was removed in turn and its test failed (a removed session check fails the type check instead);
  - the runner's suite passes, 109 tests.
- A smoke test as `corpus_ingest` on the load copy: the login is checked, a `postgres` login is refused, and a
  database error arrives as a thrown error.
- Two earlier runs that day failed and are not explained (F305): one whose queue did not drain in 5 minutes, during
  unrelated test runs on the same machine, and one stopped by `precheck_disagreement` when started one second after the
  previous run ended.

**Result (slice B), 2026-11-09.**

- **What it is.** `scripts/bulk-runner/acceptance.ts` holds `acceptBatch` and `PsqlAcceptDb`.
  - Checks per sampled document: stored, indexed, text hash, chunk count, every vector present, and a listing link
    that resolves `full` (required when the collection says so).
  - The probe: one of the document's own stored vectors, searched in its feature, must return the document first. A tie
    at the top similarity counts, since the pack's dedupe list keeps a text in one place.
    Amended 2026-11-10 (F313): when every chunk ranked above the document holds the probe chunk's own text word for
    word (spacing aside), the probe cannot tell the documents apart, so the next chunk is tried, up to three; any other
    text ranked above the document fails at once, and three shared chunks fail.
  - Amended 2026-11-10 (F316): a listing row found through the document's `document_key` is one of its links only when
    `record_resolve_document_keys` gives that row the document (on a shared bill key, F314, the other bill's row does
    not); a row with an approved link always is.
  - The sample is the same on every run of a batch.
- **How it runs.** The CLI's `--accept-service <name>` connects through a libpq service, with none of `corpus_ingest`'s
  `PG*` variables inherited. The collection file's `acceptance` block (`sample`, `requireLinks`) is required with it.
  Each batch's report is written beside its receipts. If any batch is not accepted, the run exits non-zero, including
  the last batch. `--accepted` stays for acceptance by hand, and the two options cannot be combined.
- **Unit tests.**
  - 10 for acceptance: one step per check, each shown failing by removing it; the tie, the 24-key resolver limit, the
    sample bounds, and "nothing to check".
  - 17 for the CLI, 7 of them new; each new guard was shown failing by mutation, and a gap a mutation found (a batch
    with no id) got its own test.
- **On the full-size load copy, through psql.**
  - A real proof batch passed: 50 of 226 sampled, every check passed, in 139 s. The time is a psql process for each
    check (about 2.8 s a document), once a batch.
  - With one vector of one sampled document removed, acceptance failed on exactly that document with `vectors`
    ("0 of 1 chunks have a vector"). The vector was then restored and checked byte for byte.
- **Not run end to end.** The CLI driving a run with automated acceptance, because the load copy has no `corpus_ingest`
  login (it is `NOLOGIN` until the developer enables it). The parts are each proved: the run through `PsqlDb` (slice A)
  and acceptance through `PsqlAcceptDb` (above).

## Plan

Sequential, one write scope: `scripts/bulk-runner/` and `scripts/load-proof/bulk-proof.ts`, with this spec and open-work.

| Task | Scope | Verification |
|---|---|---|
| A1. `PsqlDb` | `psql_db.ts`, `psql_db_test.ts` | `deno test` on the runner |
| A2. CLI | `cli.ts`, `cli_test.ts` | same |
| A3. Proof through `PsqlDb` | `bulk-proof.ts` (a `--db psql` option) | the proof on the load copy |
| B. Acceptance | after the decisions above | its own tests and the proof |

## Not in this work

- **The pack reader**, which needs pack access through the service account.
- **Anything on NTER**, including enabling `corpus_ingest`'s login, which is the developer's out-of-band step.
- **In-run disk and commit-time readers** for production (`diskBytes`, `commitMs`): the plan's disk line applies; a reader
  needs a login that can see them.
