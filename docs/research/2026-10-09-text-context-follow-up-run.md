# Existing-text context follow-up execution

> **Status: Historical (2026-10-09).** Completed owner-authorized five-document stage after owner accepted the Immigration/Foreigners context pilot.

All five prepared sources were ingested in full with chunker version4: **427 new chunks**, each with a real embedding and exact original-source spans. **410 chunks** have source-detected heading or clause context; frontmatter/unknown structure does not receive invented labels. Owner said “Perfect, it worked. Continue.” after the91-chunk pilot. This stage used a separately authorized release manifest, preserving the original unauthorized draft.

| Bill | Listing key | Document ID | Chunks | Tokens | Cost USD |
| --- | --- | --- | ---: | ---: | ---: |
| National Sports Governance2025 | bill:2025:76 | ff48ec26-b440-4853-a647-1882ed9429b5 | 100 | 15,797 | 0.00031594 |
| Biological Diversity Amendment2021 | bill:2021:158 | 8960664b-979c-44ab-8b07-163bdec607cb | 82 | 11,471 | 0.00022942 |
| SC/ST Prevention of Atrocities Amendment2013 | bill:2013:148 | 53c69888-35c3-4fda-a9f3-374596ca9988 | 80 | 13,003 | 0.00026006 |
| Authority for Advance Rulings on Central Taxes2007 | bill:2007:99 | 726e5167-87fb-414d-b22b-fc41d785c8ce | 83 | 12,135 | 0.00024270 |
| Industrial Finance Corporation Amendment1985 | bill:1985:210 | 98ab2e1a-1904-49bc-8c4b-d952b19fd65d | 82 | 14,332 | 0.00028664 |

Total: **66,738 tokens /USD0.00133476**. Five successful live ingestion attempts, six underlying provider requests (Sports required two batches), no retries, unknown usage, deletions or unrelated re-embedding. The conservative reserved ceilingUSD0.0071257 is not billed usage. Model-call logs independently confirm all five successful calls and427 inputs; database decimal costs round to six places, while full receipt costs above are retained.

## Execution and verification

Artifact directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/text-context-v4-final`.

Authorized manifest `follow-up-release.json`, SHA256 `cd46909accc77cc72da14e7487efc01dd984ea29e4b2e28dab2fee0ff670a88e`, limits:5 documents /1,000 stage chunks /100 complete chunks per document /75,000 source characters /two-second gap /five maximum attempts /USD0.08. Whole documents were ingested; none was truncated to meet the100-chunk limit. The deployed version19 function from the pilot remained unchanged.

Executed commands, with manifest path and hash bound as above:

```bash
node scripts/corpus-stage-job.mjs --baseline <follow-up-release.json> <manifest-sha256>
node scripts/corpus-stage-job.mjs --dry-run <follow-up-release.json> <manifest-sha256>
node scripts/corpus-job-supervisor.mjs --execute <follow-up-release.json> <manifest-sha256>
node /private/tmp/context-follow-up-verification.mjs
```

All completed successfully. Baseline and dry run re-fetched all PDFs and matched cached hashes, checked current bill identities and actual UI Download resolver links, regenerated frozen chunks/context/input byte budgets and confirmed the deployed endpoint acknowledged version4. Execution refreshed mapping, health and public model price again before paid writes. Checkpoint is `complete`,5/5 verified, each with one live attempt.

The independent read-only audit confirmed all427 content/context/input hashes, exact source spans, finite nonzero1536-dimensional vectors, source/PDF identity and document pipeline markers. Both bill listing features resolve each original PDF. Each bill-key indexed attachment lookup returns exactly its expected document. Ten probes (two per document) used actual retrieval/search and text-citation code with existing stored vectors, returning40 results each, all confined to the correct attached document; matching source chunk returned at similarity1, with exact citation URL, text hash, global offsets and source-supported context. No additional query embeddings were purchased. This verifies plumbing and citation/scoping correctness, not natural-language answer quality for each follow-up.

The extra audit initially required both a heading and clause label, then only a heading. Those assumptions incorrectly excluded valid label-only context in Biodiversity. The final audit accepts either source-supported heading or clause metadata and still compares exact frozen context/input hashes. No ingestion/parser change or production repair was needed. The successful final script and full audit JSON are saved alongside logs.

## Health and current totals

Fresh baseline broad/scoped p95:666.520/377.535ms,20 probes per scope. Nine stage windows, three probes per scope, all below2×baseline; maximum broad/scoped p95:818.365/519.843ms. No health pause. These timings include REST/network overhead; direct CPU/RAM telemetry remains unavailable.

Executed `ANALYZE public.document_chunks; ANALYZE public.documents;`. Planner live tuples now agree with real counts:57,671 chunks /2,461 documents. Current totals: **2,461 documents /2,458 indexed /57,671 chunks /1,352 covered listing bill keys**. This stage added five documents,427 chunks and five previously uncovered bill keys. The key denominator requires an indexed chunk-bearing document whose bill key exists in `desk_rows`.

Database size994,700,435bytes; combined chunk indexes243,343,360bytes. Postmaster start unchanged2026-09-28 08:19:47.722698UTC; no restart. Both Mistral documents retain original indexing/extract identity and40/81 version3 chunks. Earlier held stubs were untouched.

Evidence files include `follow-up-release.json`, its baseline/checkpoint, `follow-up-independent-verification.json`, `context-follow-up-*.log`, copied verification script and `followup_*.json` SQL/count/planner/model-log captures. Node experimental type-stripping warning remains. No implementation code changed, so the already-passed implementation suites were not repeated; see [implementation evidence](2026-10-09-text-section-context.md). `git diff --check` passed. Working tree remains uncommitted on `task/corpus-single-pilot-20261009`, with prior corpus changes preserved; main equals origin/main after fetch. No deployment, schema/frontend change, scheduler, merge or push occurred in this stage.

## Remaining work

The bounded context cohort is complete: six documents /518 chunks including the owner-accepted pilot. Owner may test Sports2025 or Biodiversity2021 by attaching the bill in chat and asking a clause-cited question, then opening its citation and Download PDF. These existing-text documents support text citations; no PDF-page coordinates were generated.

Forty-two mapping/PDF-approved medium sources remain:10,171 version4 chunks, exceeding the current whole-document worker limits. They require a separately measured larger-document execution policy, not truncation. Sixty-nine medium identity/body holds and other R7 cohorts remain under internal review; this stage establishes no new client-input blocker and authorizes no broad re-embedding or cleanup.
