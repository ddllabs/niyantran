# PR #13 conflict-scan correction

> **Status: Historical (2026-10-24).** Local repair evidence against `c9533bf52f34bb886c59381acb827b48d1cd52cf`; supervisor integration and CI determine release status.

## Explanation for the client agent

The conflict scan used a byte substring check before decoding JSON. That optimization assumed a source key always appeared literally in the JSON bytes. JSON also permits Unicode escapes: `law:trib:` and `law\u003atrib\u003a` decode to the same identity. A competing revision encoded the second way was skipped, and the screen nevertheless reported a complete conflict scan. The earlier tests covered repeated ZIP members and policy failures but did not cover alternate JSON encodings.

Two related assumptions were also unsafe: malformed or ambiguous JSON lines were silently skipped, and another occurrence's declared text hash was trusted without computing it from its text. Changed text with the original declared hash could therefore evade the revision comparison.

The repair decodes every record in the selected collection subtree before comparing source keys. It rejects duplicate JSON object keys (including equivalent escaped names), non-object records, missing/non-string identities, invalid UTF-8 and nonstandard numeric constants. Any unreadable record makes the scan incomplete, holds all candidates, and prevents finalization. Diagnostics retain counts and at most 20 member/line locations rather than corpus text. Matching occurrences now carry computed and declared text hashes; missing or mismatched hashes hold the source. Byte-identical repeated ZIP entries remain safely skipped.

Screen schema is now 3. Re-screen unsubmitted cohorts with this version; schema-2 screens cannot be finalized. Do not edit an old evidence file to change its version. Preserve completed ingestion evidence unchanged. This defect reproduction does not establish corruption in the ten previously indexed documents and does not authorize re-ingestion.

## Verification

Synthetic fixtures only; no real corpus scan, network calls, Supabase writes or embedding requests.

- RED: `python3 -I scripts/law-cohort-screen.test.py` against unchanged `c9533bf` implementation with five new test methods: 15 tests, 10 failures across methods/subcases. Failures reproduced escaped competing identity approval, omitted escaped identical occurrence, stale declared hash approval, incomplete scans treated as complete, and acceptance of schema-2 evidence.
- GREEN: same command after the repair: 16 tests pass, including the existing real importer offline dry-run contract test. Malformed cases include invalid JSON, array records, duplicate keys, equivalent escaped duplicate keys, null identities, NaN and invalid UTF-8.
- A sixth regression for a matched occurrence containing a lone Unicode surrogate failed with `UnicodeEncodeError` before its guard; it now holds the source with an invalid occurrence hash. No complete evidence was produced by the earlier abort.
- `node --experimental-strip-types --test scripts/corpus-text-import.test.mjs`: 7 pass, zero skipped.
- `git diff --check`: clean.

The complete selected subtree is still streamed one JSONL record at a time. Parsing every record costs more CPU than raw substring filtering; no production-scale runtime or throughput claim is made. Retaining all matching occurrences and existing member hashing are unchanged. A gzip/ZIP read failure aborts the command rather than producing finalizable evidence. Existing limits remain: this offline screener does not reconcile against the live database, prove semantic OCR accuracy or grant legal clearance. It is not an unrestricted bulk-ingestion runner.

## Handoff

After supervisor review and successful required CI, use the released schema-3 screener for new cohorts. Keep original receipts and decisions for completed cohorts. A future optimization must preserve semantic identity equivalence and must fail closed when the scan cannot prove completeness. Keep escaped-identity, malformed-input and stale-hash regressions in CI.
