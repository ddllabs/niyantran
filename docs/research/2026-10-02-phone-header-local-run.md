# Phone header and history list: local browser run (F47 leftovers)

> **Status: Historical (dated 2026-10-02).** Browser evidence for chat-panel-fixes T5 (`01d1714`).
>
> **Setup:** the same local-only setup as `2026-10-02-chat-panel-fixes-local-run.md`. That means a
> scratch Supabase stack, one local test account and a seeded conversation, with Vite on 5174.
> `research-chat` was not served, since no turn was run. Nothing touched NTER.

## Causes, measured at 375 × 812 before the change

| Defect | Measurement | Cause |
| --- | --- | --- |
| The header's right edge is cut | The search box spans x 10–391 in a 375 px header. The actions need 280 px and get 227 beside the brand, so the bar scrolls the account button out of view. | `.cmd` is `width: 100%` with content-box padding and border (26 px). The bar holds seven 32–40 px buttons, Log out among them, with 8 px gaps. |
| The history list runs off the left edge | It spans x −47 to 255. | It is anchored to its button's right edge (x 255) and is 300 px wide. |
| The account menu is unusable below 900 px (found in this run) | The menu opens, but the point under its Log out button belongs to the AI panel. | Below 900 px `.top-actions` has `overflow-x: auto`, which also clips the absolutely positioned menu to the 32 px bar. |

The page itself never scrolled sideways (document width 375), because `.terminal` clips its overflow.

## After `01d1714`

| Check | Viewport | Result |
| --- | --- | --- |
| Header | 375 × 812 | No header element crosses either edge. The search box spans x 10–365. The actions take 212 of 212 px, with no scrolling. The avatar sits at x 333–365. |
| History list | 375 × 812 | It spans x 57–359 and opens below the panel head (y 205). |
| Account menu | 375 × 812 | It spans x 35–365, y 54–417. The point under its Log out button hits the button. |
| Account menu | 768 × 1024 | It spans x 428–758. Log out is hit. The bar has no Log out, so the avatar (x 726–758) ends the bar. The menu's pointer sits at x 743, the avatar's centre (742). |
| Desktop unchanged | 1440 × 900 | The bar keeps Log out, its 8 px gaps and an absolutely positioned menu. The search box stays content-box. The history list anchors to its button (x 1018–1320). |
| Live TV | 375 × 812 | The modal is unaffected: it opens on top, spanning x 16–359. |

## Not fixed

- **At 320 px the avatar is still cut.** The actions need 212 px and get 172. Closing that gap
  means giving something up: the wordmark, a button, or touch-target size. That is a design
  choice for the owner, so it is recorded in F47.

## Checks

- **CSS tests:** five new tests in `src/ai/panelLayout.test.js`. All failed before the change.
- **Lint:** passes.
- **Vitest:** 1,963 tests pass.
- **The build:** passes.
