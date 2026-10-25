# F253 — Shared prompt-cache policy and cross-desk audit

**Status: Normative.** Owner authorized caching consistency and review of shared RAG/web behavior on2026-10-24. Baseline91804da9.

## Outcome and scope
All AI Research model calls, including Law selection/synthesis/correction and fallback, receive prompt-cache opt-in and the server-owned conversation ID at the common transport boundary. Brief generation uses the same model-aware prompt-cache serializer. Preserve Gemini implicit caching, 4000-character eligible text-prefix threshold (count through the last user message, so a short system plus long evidence can qualify), Anthropic controls, model/reasoning/provider routing, request contents, attempt limits, usage and citation validation. Configuration enables eligible caching; it cannot guarantee a cache hit or a speedup.

No full-response caching, model/provider change, prompt reordering, web-policy change, schema change or ingestion in this repair. Existing measured explicit-Gemini exclusion remains. Response caching needs separate validated-result/invalidation and billing acceptance.

## Architecture audit
All interactive desks call src/lib/aiClient.js → research-chat handler/runAgent. Law is an in-turn evidence-review stage, not a separately deployed RAG agent. Recent decimal-paragraph logic is used by Law hydration; Law citation guards are gated by Law evidence/context. Shared handler/agent edits have wider potential reach and require cross-desk regression tests.

Web policy is desk-agnostic: missing indexed records in attached/selection mode and modules without documents in desk mode enable web automatically; broad/no-record/greeting, explicit off, unsupported model and failed lookups do not. Indexed status is a proxy, not per-turn vector integrity verification. Offering web is not proof it ran; context questions can trigger the bounded required-web fallback. No change to this contract.

## Acceptance and commands
Causal request-boundary tests fail before the fix for Law review and brief generation. Cover compact/selected evidence, correction, provider fallback, normal chat and cross-desk indexed/missing records. Use injected provider fakes, no external calls. Full npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run lint; npm run build; node -e "import('./api/router.js')"; git diff --check. Source review independent before commit. No guaranteed production cache-hit claim without provider measurements.

## Style and boundaries
Use existing TypeScript pure helper style and object spreads; e.g. {...request, cache: true, session_id: conversation.id}. Keep policy in one serializer and conversation ownership in the handler. Never modify evidence, source data, auth, billing or user web overrides for this task.

## Release authorization — 2026-10-24

Owner approved push, PR, CI-gated merge/deploy and actual cache-hit plus cross-desk RAG/automatic-web verification. This supersedes the local-only boundary. Use existing indexed documents and normal authenticated chat; no larger batches/re-ingestion. Save current research-chat v94 and desk-brief v18 bundles for recovery, preserve authentication, compare exact deployed files, and verify401 without credentials. Check usage cached_prompt_tokens for actual hits; automatic/provider-dependent misses are reported, not hidden. Existing implicit baseline hits are not evidence of improvement caused by this change.
