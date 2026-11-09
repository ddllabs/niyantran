# Pack reader for the bulk runner (F285, C1)

> **Status: Living (2026-11-10).** The last missing stage of the bulk runner's input side. Bulk ingestion spec:
> [F278](2026-11-01-bulk-ingestion.md); runner: [stages](2026-11-07-bulk-runner.md),
> [command line and acceptance](2026-11-08-runner-cli-and-acceptance.md). Scope and order approved by the developer on
> 2026-11-09 ("go ahead with B, L1 and C1").

## Current state

- `scripts/bulk-runner/cli.ts plan|run` reads `--records <file.jsonl>`: one pack record per line, in the pack's own shape
  (`prepare.ts` takes it as `Rec`). Nothing produces that file from a pack today.
- The owner's packs are on Google Drive, shared with the read-only service account
  `drive-reader@nter-pro.iam.gserviceaccount.com`. The key is a file outside the repository (default
  `~/.config/niyantran/drive-reader.json`, mode 600). The account sees two folders, `National` and `Legal`; Legal is on
  hold and is not read.
- Each National version has one zip at `National/<version>/file to ingest/NTER_citation_pack_<version>…zip` (v1.1
  0.25 GB to v1.5 4.25 GB). Inside, under `citation_pack_v1/`: `manifest.json` (bytes and sha256 per file),
  `README.md`, a loader `.sql` (not used: no direct SQL), `links/*.csv`, `rows/*.jsonl.gz` and
  `documents/*.jsonl.gz`. The documents files are stored (method 0) gzip streams of JSON lines; v1.1 has one file per
  collection (`bills.jsonl.gz`, `parliamentary_questions.jsonl.gz`, `regulatory.jsonl.gz`, …), later packs one or more
  files per source job (`…-00.jsonl.gz`).
- Measured on 2026-11-09 with a scratch script (not in the repository): the zip directory (including zip64) can be read
  with HTTP range requests through the Drive API, and one entry can be fetched by range.

## Problem

Without a reader, a records file has to be built by hand from a multi-gigabyte zip, with nothing proving it is the
owner's file, unchanged, and filtered by the owner's licence rules.

## Outcome

A command that turns one documents entry of one pack into a records file the runner accepts, with a receipt that proves
where every line came from.

```
deno run -A scripts/bulk-runner/pack.ts list   --pack National/v1.1
deno run -A scripts/bulk-runner/pack.ts select --pack National/v1.1 --entry documents/parliamentary_questions.jsonl.gz \
  --out <dir outside the repo>/pq.jsonl [--skip-keys <file>] [--limit <n>] [--cache <dir>] [--key <path>]
```

- `list` prints the zip's name, size and Drive checksum, then each entry with its size and its manifest sha256.
- `select`:
  1. finds the zip by path under the folders shared with the account; refuses a path outside `National/`;
  2. reads the zip directory by range; reads `citation_pack_v1/manifest.json`;
  3. downloads the named entry by range into a cache directory outside the repository (default
     `~/niyantran-packs/<pack>/<entry>`), and refuses it unless its sha256 equals the manifest's; a cached file is
     reused only when its sha256 still matches;
  4. reads the gzip stream line by line; every line must parse as JSON with a `schema` starting `nter.citation_pack/1.`
     and a non-empty `source_key`, or the command stops with the line number (no partial output file);
  5. keeps or drops each record:
     - `servable === false` → dropped, counted as `not_servable` (developer decision 2026-11-09: refuse for now);
     - `licence_class` starting `BARRED_` → dropped, counted as `licence_barred`;
     - `v16_replaces === true` → dropped, counted as `replacement` (the runner has no path that replaces a loaded
       document's text and chunks yet);
     - `source_key` in `--skip-keys` (one key per line) → dropped, counted as `skipped_key`;
     - a `source_key` seen earlier in the same entry → dropped, counted as `duplicate_key`;
     - after these, `--limit n` keeps the first n in file order, counted as `over_limit`;
  6. writes kept lines byte for byte as they were in the pack (no re-serialisation), one per line, to a temporary file,
     then renames it to `--out`; refuses an `--out` inside the repository or an existing file;
  7. writes `<out>.receipt.json`: pack path, zip name, size and Drive checksum, entry name, manifest sha256 (verified),
     lines read, each count above, lines written, the output's sha256, the reader's git commit, and the start and end
     times. No key, token or record text in it.

Logs print counts and names only, never record text, the key or the access token.

## Acceptance

- Unit tests (no network): a synthetic zip built in the test, served by a fake range fetcher, covering a stored entry,
  a deflated entry, a zip64 directory, a manifest mismatch (refused), a truncated gzip (refused, no output), a bad JSON
  line (refused with its number), each drop rule, `--limit`, `--skip-keys`, byte-for-byte output, an `--out` inside the
  repository (refused) and an existing `--out` (refused). Each guard is shown failing first (mutation or removal).
- The Drive client is behind an interface the tests replace; token signing is tested against a fixed key generated in
  the test, not the real one.
- `deno test -A --config supabase/functions/deno.json scripts/bulk-runner`, `deno lint --config
  supabase/functions/deno.json scripts/bulk-runner`, `npm run lint` and `npm run build` pass. CI does not run the
  runner's tests today (F306), so these are run by hand and recorded.
- Proof by the supervisor, no database writes: `select` on `National/v1.1`
  `documents/parliamentary_questions.jsonl.gz` (22.6 MB) from Drive; the manifest sha256 verifies; the record count
  equals the pack's own count for that collection (v1.1 README; 6,840 in the owner's completion plan); then
  `cli.ts plan --records <out>` with a collection file for Parliamentary Questions runs and reports batches and holds.

## Scope

May change: `scripts/bulk-runner/pack.ts` (command), `scripts/bulk-runner/zip.ts` (zip directory and entry reading,
pure), `scripts/bulk-runner/drive.ts` (service-account token and range reads), and their `_test.ts` files; this spec;
`docs/plans/open-work.md` (F285 line only).

Not in scope: the collection files and adapters, v1.2's bill patches, the Lok Sabha hold list, links and rows files,
any NTER access, any change to `cli.ts`, `prepare.ts`, `plan.ts`, `run.ts` or the database. No new dependency: Deno's
standard library and Web APIs only (WebCrypto for RS256, `DecompressionStream` for gzip and raw deflate).

## Risks

- Drive range reads can be slow or rate-limited: retry a failed range up to three times with backoff, then stop with
  the HTTP status; never return a partial entry.
- A large entry (v1.5 and v1.6 have entries up to 520 MB) is streamed to disk and hashed while writing, not held in
  memory.
- The key file is read only to sign a token; the token lives in memory for one run.

## Result, 2026-11-09 (night)

Built test-first by a task agent in its own worktree; reviewed independently twice (first "accept with changes": four
required fixes and twelve optional ones, all applied; second "accept"). Supervisor reproduced: 214 runner tests pass
(125 before), `deno lint` and `deno check` clean, `deno fmt --check` clean with the repository config, `npm run lint` and
`npm run build` pass. Decisions taken in review: an empty selection is refused; a key seen on any earlier line, even a
dropped one, makes later lines `duplicate_key`; `node:crypto` is used for incremental sha256 (WebCrypto has none).

Proof on the real pack, read-only, no database: `list --pack National/v1.1` printed the zip (252,355,253 bytes, Drive
sha256 `459b354c…`) and every entry with its manifest hash. `select --entry documents/parliamentary_questions.jsonl.gz`
fetched 22,612,008 bytes in 14 s, verified them against the manifest (`474bb46e…`), read 6,840 lines, dropped none and
wrote 6,840 (128,206,309 bytes, sha256 `007c51fe…`) with its receipt. A separate `gunzip` of the cached file gives the
same bytes, and 6,840 equals the pack README's count.

**Acceptance step 3 is not met, and cannot be by the reader.** `cli.ts plan` on that file refused `nothing_to_load`:
every record was held `prepare_failed: text_sha256 does not match the text`. The runner, like admission
(`ingest_admit_shape`), takes a screened record: a top-level `text_sha256`, and a `review` with `status: 'eligible'`,
the same `text_sha256` and `source_key`, and `checks` holding each check the collection's policy requires. Pack records
carry `content_sha256` (checked: it is the sha256 of `text`, and the pages joined by form feeds equal `text`) and no
review. The reader must not invent a review; a screening stage per collection makes it (F307).
