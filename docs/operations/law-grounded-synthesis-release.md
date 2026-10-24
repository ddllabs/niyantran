# Law grounded synthesis release

> **Status: Living.** Release verification in progress. No ingestion authorization.

## Change and scope

PR #31 replaces the extractive containment path with concise synthesized sentences whose citations are derived from server-owned original-passage IDs. It fixes the follow-up's fragile response shape with one bounded structural correction, retains source support limits, and rejects internal passage IDs in answer prose. Qualified literal heading trails preserve section context across a quoted numbered precedent without labelling the speaker or modifying stored chunks.

Evidence selection and synthesis use the selected model's supported reasoning. Each call allows 8,000 completion tokens, including provider reasoning, inside the existing total deadline and attempt accounting. This can increase latency and usage; it is not a claim of unchanged per-call cost. No model configuration, authentication, schema, worker, OCR, corpus text or embeddings were changed.

Runtime commit `c09551daf012765ed6001569389f2afb655d7445`; PR #31 merge `2429d5f0c79a0eac0eefd53e22dc70b039a7ac98`. Both required jobs passed on the branch and PR runs (`40078872421`, `40078896182`), with green Vercel preview. Main release checks and live acceptance are recorded below when verified.

## Local evidence

`npm test`: 6,575 passed. Full Deno Edge suite: 1,255 passed. Lint, production build, Deno evaluation-script check and diff checks passed. Independent review covered source mapping, attempt/deadline boundaries, heading ambiguity and private evaluation output. Causal tests failed without the new protections: synthesized/multi-source output, follow-up shape repair, ambiguous heading trail, retained selected reasoning and internal-ID rejection.

Actual OpenRouter/DeepSeek High evaluation used existing retrieved Globiz text and four questions. The guarded run completed 4/4: original disposition/limitation, same-context submissions-versus-findings follow-up, notice-versus-commencement date and false exemplary-cost premise. Its follow-up recovered once from `synthesis_shape`. Source-reviewed citations distinguish debtor chunks 20/42 from operative 79; date 74 establishes 1 September notice and 6 September commencement. An earlier reasoned follow-up also used explicit confined-inquiry 63 for a negative merits statement. The final guarded responses took 50.3/29.2/9.9/32.3 seconds and reported USD0.008884070872 total provider cost.

Failed intermediate evaluations are retained in the [implementation plan](../plans/2026-10-24-law-grounded-synthesis.md), not treated as passes. Nonreasoning selection omitted decisive evidence; 4,000-token synthesis sometimes exhausted its allowance in reasoning; an earlier false-premise sentence lacked disposition support. The guarded run fixed the latter by separating propositions. Its original response used the less precise “claimed debt” instead of source “claim”; its date response paraphrased despite a quotation request. The conflicting no-quotes prompt instruction was removed before commit. Website acceptance must check attribution, exact citation support and usable answers; local success alone does not close F247.

The opt-in `scripts/eval-law-answers.ts` takes caller-prepared private JSON cases, calls the real answer path without database writes and saves fresh 0600 output outside the repository. It halts on unknown cost and has bounded calls/time and an admission cost threshold, not a hard provider spend cap. Never commit corpus text, private evaluation output or credentials.

## Corpus preservation and concurrent work

The earlier baseline was 3,469 documents/101,243 chunks globally, ten Law documents/527 chunks/ten jobs and 436 insolvency listings. A new read-only pre-release check found 3,569/105,668 globally, 110 Law documents/110 jobs and 502 listings: another 100 Law documents/jobs had appeared independently of this task. This task performed no ingestion. All original-ten document, chunk, supplied-input and job fingerprints remained identical. Compare release effects to the new baseline and distinguish concurrent changes; never claim the old global counts remained unchanged.

## Production acceptance

PR31 main CI `40079381543` passed both required jobs. Vercel production `dpl_GMyQpDtZ99LY9kVGuRXThvourPwf` is READY at exact merge2429d5. Research-chatv85 matched the deployed source, but the live original question failed semantic acceptance: it attributed quoted Supreme Court first-CIRP facts to the current tribunal and changed claim admission into claimed debt. The source viewer exposed the mistake at78/79; paragraph7.32 in75 introduces the quotation. The reply completed in86seconds; completion is not correctness.

Research-chat was rolled back to the exact prior v84 payload asv86; retrieval confirms bundle hash `a67b142f9c6225d318f7590327a6ed2e20fb2b1b714c37b8306bb89315486a0d`. F247 remains open. The next change adds bounded positional paragraph openings and citable original anchors; it does not infer a speaker or alter stored evidence. New local and live acceptance are pending.

The historical [extractive release](law-answer-validation-release/README.md) remains a record of v84, not evidence that the new synthesis is already verified. No new cohort or 1,000-document submission is authorized here.

## Paragraph-unit follow-up under review

The follow-up groups original read-time paragraph spans and separates the quoted-precedent ending from operative paragraphs. It preserves original source handles, omits recognized orphan fragments, rejects conflicting overlaps, marks gaps, and bounds unit size/source count. Original numbered section headings accompany matching paragraphs. Each answer sentence cites one unit; that unit can carry several original chunk citations. A targeted party-submission/tribunal-assertion guard uses the existing correction budget. These are bounded safeguards, not universal speaker classification or proof of all legal semantics.

Intermediate source reviews remained failing until their issues were addressed: quoted facts promoted despite advisory context, debtor statements attributed to tribunal, an invented causal link between separate arguments, and unsupported non-adoption from party evidence. A provider interruption produced no answer and unknown cost. Preserve these failures; passing unit tests alone is insufficient. Current final provider and website acceptance remain pending; production is still the verifiedv86 rollback. No new ingestion or corpus writes.

## Verified release candidate

PR32 runtime `7b72a88fa87681c1f4d2b3403264626cbbd32b9b` merged as `afa39f48a730c192cd666954ea24577cd262285f`. Branch/PR CI40083998006/40084037894 passed both required jobs; Vercel preview passed. Local6,575 application and1,270 Edge tests, lint/build/diff checks passed. Independent source review accepted all four final candidate answers: original, same-context follow-up, date quotation and false costs premise. Nine provider calls costUSD0.004368288744; the follow-up recovered once from claim_shape. Earlier failures remain part of this record.

Pre-release read confirms3,569 documents/105,668 chunks globally,110 Law documents/jobs and502 insolvency listings. All110 document, chunk, input and job fingerprints and ingestion costs are unchanged from the latest baseline. Exact merged-commit CI, deployment and website acceptance are pending.

Merged-commit CI40084500163 passed both required jobs. Deployed research-chatv87; retrieved41 source files all match the42-file payload (deno.json is not returned). Bundle hash `98c0bd9e8984673b86321c73a26e8e7fba27c987102e856f007a78860a43dc5a`. Credential-free POST returns401, preserving application authentication. Website tests are now running in a fresh conversation with the existing indexed Globiz attachment, DeepSeek Flash/High and web search off.


## Live v87 result and retained-evidence correction

Vercel production dpl_E3HdvwpCHLhVSKXSLvncWu27c2Km serves mergeafa39f48. Original live answer69s/37.2credits correctly cited limitation but explicitly left part unanswered. Same-conversation follow-up63s/42.2credits correctly separated debtor debt-proof/costs submissions from tribunal limitation and no-cost disposition, with four original source handles and no verification error. Citation viewer checks include the original3.31 spans and7.33/7.34; this is not full four-case acceptance.

Root-cause reproduction identified a production/evaluation mismatch: High draft tool replies are capped at24,000characters, discarding retrieved Law evidence before final synthesis. The local retrieved original-case control retained11/53 chunks and lost7.21 under that cap. The correction retains authorized Law retrieval separately (at most256 chunks/300,000 rendered characters) for the existing final80,000-character paragraph selector. It preserves draft caps, server-owned handles and non-Law behavior. It adds no retrieval/model call by itself, though retaining previously discarded material may increase final-stage tokens within existing limits. Mixed-desk and oversized-first-Law paths still trigger review.

Causal evidence: retained-scope regression failed before implementation; disconnecting retention failed the handler integration test; removing retention bounds failed its guard; mixed-desk and oversized-first-Law regressions failed before their fixes. Independent review passes307 focused agent/handler tests. Final full Edge suite1275 passes. Website four-case acceptance remains pending. No ingestion or corpus writes.
