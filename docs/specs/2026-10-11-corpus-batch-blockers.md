# Corpus mapping and validation blockers

> **Status: Living.** Owner authorized local fixes and preparation on 2026-10-11; ingestion requires review of the resulting exact batch.

Latest owner continuation after the completed 182-document run authorizes the next passing absent-source cohort. The remaining 97 identity and 83 version candidates are the next review inventory, not readiness counts. Acceptance and exclusions remain unchanged: complete text/context and exact current production mapping, full independent source/Download proof, operational preflight and post-write audit. Do not restart completed manifests or broaden existing-source/deployment permissions.

Fix cross-year/ambiguous bill analysis selection and support separately reviewed Download text repair without changing original hashes or weakening source/PDF/version/quality checks. Preserve the deployed version-4 chunker and all existing manifests. Prepare a fresh inventory and a non-executable batch of at most 500 sources, 20,000 chunks and 10 million characters; each source remains bounded by 800 chunks/600,000 characters.

Analysis entries lack year/title/house in the existing embedded collection. Missing identity must fail closed rather than infer a year from URL digits or array position. Corpus-proposed identity evidence is not a deployed UI mapping. Distinguish preparation-ready from release-ready and retain deployment holds.

Acceptance: regression tests fail before each fix and pass afterward; mutations of repaired text/raw/PDF/review evidence are rejected; unchanged chunker output and quality holds remain; inventory distinguishes complete, recovery, identity, Download, text-quality and release holds. No arbitrary special-key ban is removed without a replacement explicit identity proof.

Scope: impactRecord resolver and tests; local corpus proof/preparation scripts and tests; operations documentation, this spec/plan, R7; new local evidence directory. Excludes ingestion, paid embeddings/OCR, production writes, deployment, existing-source repair, original corpus/data collection edits, push/merge.

Local identity companion: add `public/data/embedded_json/national_bill_analysis_identity.json` with an exact inventory of 65 analysis entries covering the 65 bill keys supported by the 81 source/Download PDF identity passes in the new batch. Original analysis/corpus files stay unchanged. This companion binds each identity to the exact original analysis PDF-link object and bill number; browser and preparation scripts use the same binder. It certifies the mapping only, not source text quality. Unproven entries fail closed, so deployment must review reduced analysis/Download coverage before publication. No deployment is authorized by this task.

## Owner continuation, 2026-10-11

The owner now authorizes fixing Citation Pack mappings and ingesting each independently passing absent-source subset without waiting for held files. This supersedes the preparation-only ingestion exclusion above. Existing-source overwrite/deletion and deployment remain excluded. First isolate the two same-Download sources `859abed1c9d3b25a11c15beca6122838b4e6b672` / `bill:2022:220` and `0be2479d1661d7144d4a18adf8301a848c7014c0` / `bill:2022:218`. Review their printed 2022 registration versus 2023 passed titles, preserve raw text, bind separately reviewed layout repairs, and add only their two proven analysis identity bindings. No general year/title guard waiver. Expand only after source-specific proof. Broader 3,040 pack/listing identity proposals remain drafts, not deployed mappings or released documents.

## Shared-blocker correction, latest owner instruction

Replace the repeated tiny-subset selection with systematic mapping repair and a fresh up-to-500 cohort. Diagnose duplicate analysis identities, incomplete identity companion coverage, and title-format mismatches. Exact duplicate analysis payloads may collapse to one value; conflicting payloads remain unresolved. Expand the local mapping companion only from exact Citation Pack URL identities unanimously matching unique current two-feature listing identity. Missing review is a pending check, not an actual defective-file hold. Retain every source/PDF/version/context gate and deployment boundary. No production release of locally corrected Download behavior before its deployed verification.

Acceptance includes failing duplicate/title-format regressions, unchanged cross-key rejection, reproducible full-pack mapping inventory and measured resolved/unresolved counts. Existing indexed sources and prior completed releases remain untouched.

Source registry amendment: the identity companion may bind Citation Pack document URLs directly to full current listing identity without requiring an analysis entry. Optional analysis prose must remain absent when unavailable or conflicting. Compilation rejects ambiguous source/version roles and shared listing keys; source quality is a separate gate. The expanded exact local inventory and hashes are recorded in the shared-citation-mapping-fix report, superseding the original 65-entry scope. No original collection is edited.

## Exact production authorization

Owner explicitly authorized deploying only the Download resolver and mapping companion, verifying production, then ingesting passing sources while isolating individual failures. Deploy from current production commit 66e955e5f5b5a33f8018b92cb13c7664d5a5cb40 with only src/lib/impactRecord.js and public/data/embedded_json/national_bill_analysis_identity.json replaced. Existing dirty checkout is not the deployment source. Preserve rollback deployment dpl_BNrzGcxxHisELAJW3Sq5DxvLh9nd. No schema, Edge Function, existing-source overwrite, push or merge.

## Full remaining 270-source release, latest owner instruction

Review all 270 previously unreviewed sources in the 310-source same-Download candidate pool, excluding the 38 completed sources and two confirmed missing-scanned-text failures. Assemble every passing absent source into ONE frozen manifest (up to 500), not separate tiny releases. Preserve full v4 section context, complete text and all mandatory identity/provenance/current production Download, budget, capacity, dry-run and audit gates. Actual failures get source-specific evidence and remain excluded; unreviewed is not a failure.

Sequence: freeze exact inventory; reconstruct/examine all page/text/layout evidence and chunk context; reconcile current Supabase absence and listing mappings; prepare one passing release and per-source exclusions; run fresh baseline/dry-run and sequential supervisor; audit cumulatively at each 20-document/2000-chunk maintenance pause, ANALYZE and acknowledge only verified exact progress; independently audit final state and record exact deltas/usage. Writes are limited to fresh task artifacts, these active docs/R7/operations/run report and authorized new corpus ingestion. No original edits, deployment, schema/compute changes, existing-source overwrite/deletion or Git publication. No delegation.
