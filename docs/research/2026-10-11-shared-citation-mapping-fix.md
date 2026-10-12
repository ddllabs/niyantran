# Shared Citation Pack mapping correction

> **Status: Living.** 2026-10-11. Local changes verified; no deployment or ingestion in this run.

The repeated tiny batches were partly caused by a shared application mapping defect, not a two-document capacity limit. Download resolution depended on analysis coverage. Identical duplicate analysis exports were treated as ambiguous, optional report/synopsis URLs blocked identity binding, and titles with a year before a parenthetical were not recognized.

## Implemented correction

`src/lib/impactRecord.js` now resolves an identity-bound document source independently of optional analysis. Full bill number/year/chamber/title remains mandatory. Exact duplicate analysis payloads collapse; conflicting analysis prose is withheld. Conflicting document mappings remain unresolved. Sources accept only supported Sansad HTTPS PDF paths and recognized version roles. Original analysis and corpus files are untouched.

`proposeBillSources` in `scripts/corpus-batch-review.mjs` compiles full Citation Pack identities against both current listing features. Conflicting URL identity/text, multiple URLs in one version role, missing listing identity and unsupported roles/URLs are separately recorded. This is mapping evidence, not certification of PDF content or OCR quality.

The local companion contains 3,026 analysis identity bindings and 5,941 bill source registries. All 67 previous bindings retain the same full identity and original links. Of 7,525 pack bill identities, 1,584 remain outside the source registry. Reasons overlap and do not imply 1,584 unusable PDFs. Workers, preflight tools and browser use the same binder.

## Larger cohort

The existing 500-source review inventory now has 490 resolved mappings and 397 exact source/Download URLs under the corrected resolver. Disjoint dispositions:

| Disposition | Documents |
|---|---:|
| Exact corrected Download plus passing source PDF identity; quality review pending | 310 |
| Source PDF identity review pending | 97 |
| Source-versus-Download version proof pending | 83 |
| Unresolved full mapping identity | 10 |

The 310-source draft contains 5,187 complete version-4 context chunks and 3,029,722 source characters. 180 of these also match the full independent PDF extraction ignoring whitespace. This does not prove substantive layout, table or section quality, so the draft remains non-executable. No truncation or chunker change was made by this correction. Previously executed endpoint dry runs remain historical evidence; fresh release-bound operational checks are still required.

## Production boundary

Fresh HTTPS inspection returned production asset `/assets/index-CuWTTdqB.js`, SHA256 `6ae4e0c3d9278eb53a73671b8e66c73e9e8f84eb26d85c4ff402bea08c18318a`. It does not load the identity companion and remains the previously inspected old resolver. Local mapping results must not be represented as current production Download behavior.

The narrow frontend deployment requires exact owner authorization under AGENTS.md. Proposed scope is the tested resolver and its mapping companion, with deployed Download verification before ingestion. Do not deploy the entire dirty branch or unrelated changes. Ingestion permission already exists; no repeat permission for passing new-source ingestion is needed. Existing-source overwrite/deletion remains excluded.

## Verification

- Failing regressions observed before fixes: duplicate analysis/title-year, source registry, optional role mapping, registry compiler.
- `npm test`: 185 files / 2,477 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 880 passed.
- `node --test scripts/corpus-*.test.mjs`: 112 passed.
- `npm run lint`: passed, no warnings.
- `npm run build`: passed; existing bundle-size warning above 500 kB remains.
- `git diff --check`: passed.

Evidence, fresh listing/document snapshots, reproducible compiler, 500-source dispositions, 310-source draft and hashes are under `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-shared-mapping-20261011`.

No production writes, paid embeddings, deployment, schema changes, commits or pushes occurred in this run. Latest retrieved document snapshot contains 2,769 documents. Last independently audited production baseline remains 2,766 indexed / 87,903 chunks / 1,478 covered bill keys; this run did not re-audit all production vectors. Existing dirty work is preserved. Full quality review, narrow deployment authorization/deployed verification, and fresh operational release gates remain open under R7.
