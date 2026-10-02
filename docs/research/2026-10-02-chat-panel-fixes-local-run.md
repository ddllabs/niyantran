# chat-panel-fixes: local browser run (F47, F46 D4)

> **Status: Historical (dated 2026-10-02).** This is the browser evidence required by
> `docs/specs/2026-10-02-chat-panel-fixes.md`.
>
> **Setup:** local only. Nothing touched NTER.
> - **The stack:** a scratch copy of `supabase/` under its own project id, with
>   `backend/sql/auth_schema.sql` and all 44 migrations, and the bill desk loaded (9,817 rows).
> - **The model registry:** one row for Gemini 3.8 Flash, written by hand.
> - **The account:** one local test account, created through the local auth admin API, with a
>   generated password kept in a mode-600 scratch file and deleted afterwards.
> - **The thread:** a seeded 12-message conversation.
> - **`research-chat`:** served locally from the working tree, with a mode-600 env file holding the
>   OpenRouter key and the local origin, deleted afterwards.
> - **The dev server:** Vite on 5174, pointed at the local stack.

| Check | Viewport | Result |
| --- | --- | --- |
| T2, history-open dimming | 1440 × 900 | With history open, `.ai-v2-chrome`, `.ai-v2-body` and `.ai-v2-foot` have opacity 0.42 and `pointer-events: none`. `.ai-v2-head` keeps opacity 1 with z-index 30, and the history list sits above the dimmed panel. Before T2, none of these rules matched. |
| T3, phone layout, before | 375 × 812 | Dock 268 px (y 544–812), under a 401 px desk. Thread (`.ai-v2-body`) 18 px. Reproduced as F47 recorded. |
| T3, phone layout, after | 375 × 812 | Dock 669 px, the whole workspace (y 143–812). Desk collapsed (height 0, `visibility: hidden`, still mounted). Thread 318 px, 39% of the screen. Composer fully visible (y 697–753). |
| T4, end-of-turn shift | 1440 × 900 | A real turn on the local function: a desk question with "Broad context", answered with a table and **16 citation bubbles**. A `layout-shift` observer from Send to the end recorded **total 0**: one entry of value 0 on the composer actions. No placeholders were left. |

## Findings

- **T4 needed no code change.** A citation placeholder already has a bubble's footprint (the same
  `cite-bubble` class, 22 px), and the follow-up row's space is reserved (panel-loading). The shift
  F46's review described (D4) is gone. Its fixes landed with answer streaming and panel loading.
- **The thread is 39% of the screen, not 40%.** The remaining height goes to the app's own header
  (143 px: brand, search and desk tabs), which is outside this spec, and to the controls row
  wrapping onto two lines.
- **Noted, not changed:**
  - **At 375 px the app header overflows its width by a few pixels** (the avatar is cut at the
    right edge). This predates this work.
  - **The history list opened while the dock is narrow extends past the left edge.**

  Both are recorded in open-work F47.
- **The Browser pane was hidden**, so frames ran only at the screenshots taken every 3–4 s. Layout
  shifts are measured against the last frame, so they are still counted, but only in aggregate.

## State after the run

- The dev server, the served function and the local stack are stopped.
- The env file, the account file and the scratch stack are deleted.
- The temporary launch entry is removed.
