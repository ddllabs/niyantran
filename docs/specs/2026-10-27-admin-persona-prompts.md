# Editable persona prompts

> **Status: Normative.** Owner approved the conversational plan on 2026-10-27.

## Objective and current state

The admin textarea is currently a localStorage scratchpad. Neither saved drafts nor unsaved text reaches research-chat. Shipped frontend markdown and backend JSON agree in repository tests; deployed parity and the reported typing failure require browser/release verification.

Provide server-backed drafts, current-text probes, explicit publication, immutable revision history and rollback for six existing personas. Preserve exact prompt text (100,000 UTF-8 bytes maximum, nonblank). Published text applies to the next new turn, never a running turn or replay. System grounding, citations, tools, billing and specialist verification prompts remain unchanged.

## Owner decisions

- Pilot access and published prompt resolution are restricted to the owner's verified account ID AND current platform-admin status. No automatic first-admin selection.
- Save draft does not publish. Test uses current unsaved editor text and starts a new conversation when its text or persona changes.
- Global activation requires separate owner approval; no global switch is exposed in this release.
- Database failure falls back to the bundled default, with restricted diagnostics. No cross-turn active-pointer cache.
- Browser drafts are imported only explicitly. Changes do not rewrite existing chat messages.

## Contracts and acceptance

Service-only storage RPCs enforce atomic expected-revision checks and maintain actor/timestamp history. The authenticated admin-personas function independently verifies identity and admin status. Prompt content is never logged. Only the pilot may send a bounded persona_prompt override to research-chat; other attempts are rejected.

Admin UI distinguishes unsaved, saved and published content, supports prior-version activation, handles conflicts without losing edits, and shows exact source/version/hash for probes. Customers and other admins retain bundled behavior.

Acceptance: exact text equality from editor through saved version and model system block; persisted drafts across refresh; working typing/paste/delete and keyboard controls in a real signed-in browser; publication/rollback changes the next pilot turn only; unauthorized direct database/function calls fail; outage fallback is explicit.

## Verification and boundaries

Use red-first Vitest and Deno tests and non-vacuous disposable SQL fixtures. Run npm test, deno test -A --config supabase/functions/deno.json supabase/functions, npm run lint, npm run build, npm run check:bundle and npm run test:sql. No live database test fixtures. Pilot deployment may add its own storage but may not modify corpus, billing or account roles. Both protected CI jobs are required before preview/release domain assignment. Never enable customer rollout in this task.
