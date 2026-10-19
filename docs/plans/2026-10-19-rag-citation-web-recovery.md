# Research citation and web recovery plan

> **Status: Living.** Local implementation authorized; publication remains separate.

Spec: ../specs/2026-10-19-rag-citation-web-recovery.md. Sequential, no delegation.
Checkout /private/tmp/niyantran-rag-production, task/rag-citation-web-recovery.
Preserve pre-existing recovery/audit documents and the separate billing checkout.

1. Reproduce current-subject selection, verified attached-row citations, repair
   prose integrity and skipped-web fallback defects with focused Deno tests.
2. Implement only research-chat/{turnScope,handler,repair,agent}.ts and relevant
   tests; extend _shared/openrouterStream.ts tool_choice for the bounded web-only
   call and test its exact wire body. Use existing provider/accounting paths.
   Include src/ai/AiPanel.jsx and its test: pinned records currently omit tier,
   so the backend cannot resolve their authoritative desk identity.
3. Verify the unchanged PDF viewer in the owner's Arc session, no new model
   request needed. Record concrete automation blockers if present.
4. Run focused/full tests, lint, build, bundle and router import; review security,
   time/search budgets, failure modes and diff. Record evidence in this plan and
   the sole open-work tracker. No publication or production mutations.

Provider contract references: https://openrouter.ai/docs/guides/features/server-tools/web-search
and https://openrouter.ai/blog/tutorials/tool-calling/ (read 2026-10-19).
Required tool selection varies by provider; production provider acceptance must
be demonstrated before claiming that external web execution is verified.

## Execution evidence — 2026-10-19 IST

Six focused regressions failed against original behavior: exact-anchor repair,
web-only required fallback, bounded provider-decline handling, server-grounded
attachments, evidence-presence verification and required-tool wire body. A
separate frontend regression failed because requestAttachments omitted tier.
The current-subject integration test was also run with the old handler branch
temporarily restored: failed with no scoped pre-search; fixed branch restored
in finally, passing. Selection-priority regression exposed the older-pin case
during implementation and was corrected before full verification.

Verified commands and outcomes:
- npm test:401 files,6293 tests pass (final run after client tier addition).
- deno test -A --config supabase/functions/deno.json supabase/functions:
  1172 pass,0 fail (final implementation and scope/security tests).
- npx vitest run src/ai/AiPanel.test.jsx src/ai/WorkSurface.test.jsx
  src/ai/page-viewer:471 pass.
- npm run lint, npm run build, npm run check:bundle and router import:pass.
  Initial JS180729 bytes gzip; no chunk advisory. git diff --check:pass.
- No SQL changed; hosted database was not used as a write-test fixture.

Review: explicit off/free/model gates remain upstream; forced web has one
checkpointed attempt across failover, retains overall step/time/search limits
and uses existing accounting. The forced request offers only the server web
tool with required selection; answer calls remain tools-disabled. No invented
web activity or URLs. Repair applies exact unique anchors to original prose;
unknown IDs, modified/ambiguous anchors, excessive edits and changed prose are
rejected. Failed repair now discloses unverified content even after retrieval.
Pinned row text becomes citable only after exact database identity lookup.
Existing citation hashes, PDF-page evidence enrichment and viewer files unchanged.

Authenticated browser execution: native Arc observed the owner's existing
conversation, original legacy passed-version reader, then Source3's introduced
PDF at page3/22 with selectable PDF text and amber citation highlighting. Owner
clicked the PDF version and Text switch because AX clicks/key input had no effect
and coordinate input returned noWindowsAvailable. Text view was then observed
on page3 with the same amber-highlighted passage and rendered page headings.
Owner reported PDF/page4/Cited-p3 navigation complete; final observed page
control3/22 and highlight, but screenshot still showed Text selected, so no
independent claim about the final PDF navigation transition. No new research
request or charge was generated; visible balance remained2813.

No push, commit, merge, deployment, secret/provider setting, schema, ledger,
payment or corpus action. Working changes remain on the scoped local branch;
pre-existing recovery/audit documentation and separate billing checkout preserved.
Remaining release gate: real-provider acceptance (especially required server-tool
selection on Gemini2.5 Lite) and new-turn verification after approved deployment.
Local scripted execution proves control flow and wire request, not provider
compliance or answer quality on a live turn.
