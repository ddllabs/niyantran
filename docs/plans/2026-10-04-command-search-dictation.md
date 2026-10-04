# F73 implementation plan

> **Status: Historical (dated 2026-10-04).** 2026-10-04. Spec: ../specs/2026-10-04-command-search-dictation.md.

Sequential work on task/f73-search-dictation; no delegation.
1. Copy: src/shell/copyPolicy.js + tests, TerminalShell.jsx and upgrade.css. Prove native editable copy remains available and protected record copy still gates.
2. Search: src/shell/CommandSearch.jsx, commandSearch.js and tests/CSS, TerminalShell.jsx. Reuse Supabase search_desk_rows with caller session, 300ms debounce, abort stale requests; accessible tier mapping and exact row open through existing openInDesk. Verify grouping, keyboard and races.
3. Dictation backend: supabase/functions/transcribe-audio/{handler,index,handler_test}.ts and config.toml. Direct OpenAI whisper-1 multipart only; authenticated active accounts, body cap and fixed provider contract. No production configuration.
4. Dictation UI: src/components/{DictationButton.jsx,dictation.js,dictation.test.js,dictation.css}; wire CommandSearch and AiPanel. Shared lifecycle, cleanup, editable result, no auto-send.
5. Verify red/green focused guards, both suites, lint/build; local browser fixtures without production writes; review every diff then coherent local commits/integration. Record outcomes and limitations. Push/deploy need exact owner authorization.

## Completed implementation and review
Local code commits: 75bddf3 (editable copy), a60e2cf (shared dictation and Whisper endpoint), 2ac4850 (command search). Reviewed the actual changed files for accessible destination filtering, fixed provider URL/model, verified Auth and active profile, bounded body, no credential/audio/transcript logging, stale-result suppression, context cleanup, and native editable selection. No dependencies, database migrations, billing rules or data collections changed. Record searches use indexed desk snapshots; unindexed live modules remain navigation matches. Existing row caps and missing-live-row behavior of openInDesk remain unchanged.

## Executed evidence
- Copy policy initially retained the old behavior: both guards failed; fixed implementation passes.
- Search stub: three guards failed (grouping/access, caller RPC/cancellation, failures); real implementation passes.
- Dictation stub: three lifecycle guards failed (start/stop, late transcript, late permission cleanup); implementation passes.
- Whisper handler stub: four guards failed (contract, authorization, admission, provider failure); implementation passes.
- Additional guards were made non-vacuous: removing denied-permission guidance fails its test; leaking provider error text fails its test; removing chat microphone wiring fails its test. All mutations restored. One full Deno run overlapped the intentional error-leak mutant and failed that guard; the full suite was rerun after restoration and passed.
- `npm test`: **132 files / 2,100 tests passed**.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: **861 passed**.
- `deno check --config supabase/functions/deno.json supabase/functions/transcribe-audio/index.ts`: passed (function compilation check, not an application type-check).
- `npm run lint`: passed with zero warnings/errors.
- `npm run build`: passed. Existing deskBrief mixed static/dynamic import and >500kB chunk warnings remain.
- `git diff --check`: passed.
- Isolated actual-component Chrome fixture: Desks/Modules/Records groups, Enter navigation, Escape, stale old-query suppression despite mocked lookup ignoring abort, empty state, native editable copy/selection and protected record copy; record-stop-editable transcript with no auto-send; microphone cleanup on chat switch. Dropdown remains within viewport at 320, 375, 768, 1024, 1440px; no page errors. Keyboard-selected items scroll into view. Microphone and transcription were mocked, not live audio quality verification.
- Official OpenAI speech-to-text docs and Supabase RPC docs checked. Changelog markdown fetch failed through the browser fetcher (unsupported markdown content type); shell fallback could not resolve that host. Existing RPC/function patterns were confirmed against current source and executed tests.

## Boundaries and remaining operations
No production queries, deployment, secret configuration, push, other-worktree reconciliation or corpus changes. F74 tracks publication, secret verification/configuration and a real microphone/provider test. OpenAI credentials stay exclusively in Supabase secrets. No claim of actual Whisper accuracy, production record-search latency or Safari microphone support is made from the mocks.
