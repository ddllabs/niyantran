# Law answer and case-number release

> **Status: Historical (2026-10-24).** Partial release receipt: F248 passed; F247 remains open. No ingestion authorization.

F248 displays the canonical case number with a legacy title fallback. The Future Consumer order visibly shows `C.P. (IB)/914/MB/2025` in the record panel. No title or source document was changed.

F247 concerns answer grounding, not ingestion. The prompt-only release (PR17/v73) and extra context-search release (PR18/v74) failed live attribution acceptance. PR19/v75 supplied literal positional heading context and passed the then-tested debt-attribution check on the original Globiz question, but the same-conversation follow-up reused old references and misnumbered costs. PR20 requires fresh Law retrieval and includes original final passages when the authorized bounded prefix reaches the document end. V76 passed the narrow debt/costs follow-up but independent review found an unsupported adoption claim in the original longer answer. PR21 requires explicit tribunal adoption language and preserves sentence-level reported speech even in analysis. PR21 merged as `9e36adf989a6d55ff7b605cb7b82d8a9d1b89245` after required CI passed; research-chat v77 matches the reviewed payload and rejects unauthenticated calls with 401. The v77 original question still failed broader acceptance: it gave 1 September rather than source paragraph 7.29’s 6 September commencement, inferred adoption from the disposition and cited submissions paragraph 3.9 for a tribunal suppression claim. Independent review confirmed the failure. F247 remains open. One earlier request returned only `llm_result`; F249 tracks that separate response-format failure.

## Verification boundaries

Source headings are quoted context, not a legal speaker classifier. Unrecognized numbered boundaries prevent heading inheritance. Reads cover at most four Law documents and 256 chunks/300,000 characters per document. At the chunk limit, final passages are not inferred. Existing reply limits may truncate context. Documents with these limits require ordinary retrieval and explicit uncertainty rather than invented findings.

Globiz source paragraph 7.33 records limitation; 7.34 rejects/disposes of the application with no order as to costs; 7.35 concerns the certified copy. Section 3 contains the corporate debtor's submissions. Printed page labels exist in OCR, but structured page_number is absent on these chunks, so citation opening does not establish an exact-page deep link.

`evidence.json` and `verify.sql` record read-only corpus preservation. No OCR, re-ingestion, rechunking or corpus embedding was authorized or performed. Website research tests incur ordinary query/model usage. A sampled answer test does not certify every question, model or document.

## Client continuation

Use [the canonical agent message](../law-next-batch-agent-message.md), [client guide](../law-listing-client-guide.md) and [backend contract](../law-listing-backend-contract.md). Prepare up to 100 new eligible IBBI_NCLT documents first. Preserve the previous branch/checkpoints; inspect current main and do not replay the ten completed documents. Neither this release nor preparation authorizes submission or a 1,000-document run.

## Executed checks

Latest full local checks: `npm test`: 6,575 passed; `deno test -A --config supabase/functions/deno.json supabase/functions`: 1,222 passed; `npm run lint`, `npm run build` and `git diff --check` passed. The adoption prompt regression failed before the added rule; 46 focused prompt tests passed afterward. These demonstrate wiring, not answer correctness. Independent reviews checked source passages and identified the residual live errors.

Test configuration: signed-in NTER, Globiz selected record attached as Full text, Attached only, web off, DeepSeek Flash with High reasoning. Original question: “Why did the tribunal reject the petition concerning Globiz Exim, and what did it conclude about the claimed debt? Cite the relevant pages of the attached order.” Follow-up: “Did the tribunal find the debt unproven and award exemplary costs, or were those the debtor’s submissions? Separate the operative decision from those arguments and cite the relevant passages. Answer in no more than 150 words.”

The v76 follow-up performed 3 fresh searches and produced 4 citations; clicking the operative citation highlighted the original 7.34 passage and exposed the correct official IBBI PDF URL. It did not establish an exact-page PDF deep link. The v77 original retry produced 10 citations but still failed semantic acceptance. Successive runs are recorded, including failures; no all-model/all-document accuracy claim is made.

The final v77 follow-up used 2 fresh searches (52s, 20.1 credits) and correctly separated debtor submissions from disposition in prose. However its operative/costs citation opened the selected desk row, whose fields do not establish costs, rather than the original order passage. Therefore final citation acceptance also failed. This is included in F247; do not treat correct prose alone as a pass.

Production: main CI run `40024488428` passed. Vercel deployment `dpl_FjF5f16ZQWjyPHGpw5f6tMLUG889` is READY for exact commit `9e36adf989a6d55ff7b605cb7b82d8a9d1b89245`, with `aliasAssigned: true` and `www.nter.pro`/`nter.pro` aliases. Research-chat is version 77. These deployment checks do not override the failed semantic acceptance.
