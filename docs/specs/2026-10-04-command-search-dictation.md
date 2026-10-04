# Command search and Whisper dictation

> **Status: Normative.** Owner approved 2026-10-04 (“Agreed with the rest. go on”).

## Current state and problem
Source inspection found a global copy listener opening Upgrade for editable text; command search only lists modules despite promising records; microphone is disabled. Table search already uses local indexed filtering with React useDeferredValue, without remote requests on typing.

## Capability map and outcome
Build order: editable-copy → command-search → shared-dictation. Copy protects native editable interactions without changing record-export entitlements. Search groups Desks, Modules and Records, labels every destination, supports arrow keys/Enter/Escape, empty/loading/error states, and cancels obsolete 300ms-debounced record RPCs. Only currently accessible catalog destinations appear. Records route to their module and select the exact row through existing openInDesk.
Dictation is shared by top search and Ask AI, with visible recording/stopping/transcribing/error states. It appends editable transcript without submitting. Explicit microphone activation requests permission. Cleanup stops tracks and cancels late results on unmount, chat/account change or disabled state. Record at most 60s and 8MiB. Authenticated active accounts only, bounded multipart body, fixed OpenRouter transcription endpoint/model, no audio or transcript logging/storage. Existing OPENROUTER_API_KEY is server-only; use openai/whisper-large-v3-turbo through OpenRouter, as amended by the owner on 2026-10-04.

## Recording presentation (F77, owner approved 2026-10-04)
Recording replaces the existing composer toolbar with Cancel, a blue microphone-level history, elapsed time and Stop. Bars derive from locally sampled stream energy, settling to a baseline in silence; they do not imply speech recognition or live text transcription. Reduced motion shows a restrained level indicator. Top search uses the same compact strip. Permission/transcription states retain Cancel; microphone stops before transcription. The typed draft and composer height remain stable; Send is unavailable while dictation is active. Cancellation/context cleanup releases analyser, frame callbacks and microphone tracks. Errors allow retry from the mic.

## Acceptance evidence
Regression guards fail before fixes. Vitest verifies editable copy exclusion, accessible catalog grouping, stale search cancellation and dictation cleanup/error handling. Deno verifies auth, body admission, provider contract and failures. Real local browser fixture verifies keyboard selection, responsive layout and mocked microphone lifecycle. Production provider execution requires existing server-side OPENROUTER_API_KEY and deployment; do not claim it from mocks.

## Scope and exclusions
src/shell/TerminalShell.jsx, upgrade.css and new command-search/copy helpers and tests; shared src/components dictation; src/ai/AiPanel.jsx and focused tests; supabase/functions/transcribe-audio and config.toml; docs spec/plan/tracker. No payment policies, corpus changes, new schema, provider chat changes, other worktrees or publication.

## Source and commands
https://openrouter.ai/blog/tutorials/transcription-on-openrouter/ documents multipart POST /api/v1/audio/transcriptions with file/model and the same Bearer key as chat. Model: openai/whisper-large-v3-turbo. Existing RPC search_desk_rows is security invoker and preserves caller RLS.
Checks: npm test; npm run lint; npm run build; deno test -A --config supabase/functions/deno.json supabase/functions. No standalone typecheck exists.
