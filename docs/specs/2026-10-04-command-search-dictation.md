# Command search and Whisper dictation

> **Status: Normative.** Owner approved 2026-10-04 (“Agreed with the rest. go on”).

## Current state and problem
Source inspection found a global copy listener opening Upgrade for editable text; command search only lists modules despite promising records; microphone is disabled. Table search already uses local indexed filtering with React useDeferredValue, without remote requests on typing.

## Capability map and outcome
Build order: editable-copy → command-search → shared-dictation. Copy protects native editable interactions without changing record-export entitlements. Search groups Desks, Modules and Records, labels every destination, supports arrow keys/Enter/Escape, empty/loading/error states, and cancels obsolete 300ms-debounced record RPCs. Only currently accessible catalog destinations appear. Records route to their module and select the exact row through existing openInDesk.
Dictation is shared by top search and Ask AI, with visible recording/stopping/transcribing/error states. It appends editable transcript without submitting. Explicit microphone activation requests permission. Cleanup stops tracks and cancels late results on unmount, chat/account change or disabled state. Record at most 60s and 8MiB. Authenticated active accounts only, bounded multipart body, fixed OpenAI endpoint/model, no audio or transcript logging/storage. OpenAI key is server-only; no OpenRouter fallback.

## Acceptance evidence
Regression guards fail before fixes. Vitest verifies editable copy exclusion, accessible catalog grouping, stale search cancellation and dictation cleanup/error handling. Deno verifies auth, body admission, provider contract and failures. Real local browser fixture verifies keyboard selection, responsive layout and mocked microphone lifecycle. Production provider execution requires separately configured OPENAI_API_KEY and deployment; do not claim it from mocks.

## Scope and exclusions
src/shell/TerminalShell.jsx, upgrade.css and new command-search/copy helpers and tests; shared src/components dictation; src/ai/AiPanel.jsx and focused tests; supabase/functions/transcribe-audio and config.toml; docs spec/plan/tracker. No payment policies, corpus changes, new schema, provider chat changes, other worktrees or publication.

## Source and commands
https://developers.openai.com/api/docs/guides/speech-to-text documents multipart POST /v1/audio/transcriptions with model whisper-1. Existing RPC search_desk_rows is security invoker and preserves caller RLS.
Checks: npm test; npm run lint; npm run build; deno test -A --config supabase/functions/deno.json supabase/functions. No standalone typecheck exists.
