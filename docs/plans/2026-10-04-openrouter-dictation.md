# F75 OpenRouter dictation

> **Status: Historical (dated 2026-10-04).** Owner requested OpenRouter Whisper Large V3 Turbo on 2026-10-04.

## Spec
F73 currently calls OpenAI directly with whisper-1 and OPENAI_API_KEY. Route the same bounded authenticated multipart request to https://openrouter.ai/api/v1/audio/transcriptions with model openai/whisper-large-v3-turbo and existing server-side OPENROUTER_API_KEY. Preserve active-account admission, limits, cancellation, error redaction and editable frontend transcript. No UI, database, billing, deployment or secret changes. Acceptance: provider contract guard fails for previous URL/model, passes after change; function entry selects existing OpenRouter secret; full suites, lint/build pass.

## Ordered plan and write scope
1. Update provider contract tests in supabase/functions/transcribe-audio/handler_test.ts and prove red.
2. Update handler.ts URL/model and index.ts secret. Verify focused tests and function compilation.
3. Update normative F73 spec and open-work tracker; run full npm/Deno suites, lint/build, review diff; commit and integrate locally. Publication/deployment remains separate.

## Source
https://openrouter.ai/blog/tutorials/transcription-on-openrouter/ confirms OpenAI-style multipart file/model, same Bearer key as chat, and JSON text output.

## Completion evidence
Code commit d352997. Provider contract test failed against previous URL/model; credential guard failed when index was deliberately reverted to OPENAI_API_KEY; all mutations restored. Final six focused guards passed. `deno check --config supabase/functions/deno.json supabase/functions/transcribe-audio/index.ts` passed. `npm test`: 132 files / 2,100 tests passed. `deno test -A --config supabase/functions/deno.json supabase/functions`: 862 passed. `npm run lint`: passed, zero warnings/errors. `npm run build`: passed with existing mixed-import and large-chunk warnings. `git diff --check`: passed. Reviewed actual URL/model/Bearer-key diff; authenticated active-account admission, bounds, cancellation and error redaction unchanged. No frontend edits, real provider call, push, deployment or secret configuration; F74 retains production activation. Existing server secret selection is established by source and executed guard, not a live credentials probe.
