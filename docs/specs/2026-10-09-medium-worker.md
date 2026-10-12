# Larger-document corpus worker

> **Status: Living.** Owner instructed continuation after next50 preflight.

Current worker rejects all42 identity-approved sources (103–790 version4 chunks) and reads at most101 chunks. Enable explicit `worker_profile:"medium_v1"` for context-version4 jobs only, capped800 chunks /600,000 source characters. Existing default limits100/75,000 remain. Stage remains30 documents /1,000 chunks, one document per request, two-second gap, bounded attempts/budget, exact identity/source/PDF/context verification and health gates. No truncation, OCR, schema/endpoint deployment, cleanup or changed chunking.

Read all stored chunks in deterministic100-row pages, with a maximum plus one sentinel, failing closed on inconsistent/truncated reads, duplicate hashes, partial indexing or source changes. Lost successful responses reconcile without a second paid call; partial commits remain held. Real handler integration must prove multiple100-row commits and full verification.

Owner continuation covers preparation and progressive ingestion of identity-approved sources after tests/checks. Begin only with the smallest103-chunk source and USD0.015 ceiling; verify complete storage/scoped retrieval/citations and ANALYZE before expansion. Larger sources and eight identity holds are not automatically released by a passing local test. No50-document single invocation or CPU capacity claim.

Write scope: corpus-stage-job.mjs/tests; this spec/plan, R7, operations/research evidence; local artifacts. Preserve prior work and immutable manifests.
