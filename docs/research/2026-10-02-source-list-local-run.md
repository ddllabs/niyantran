# The sources list: local browser run (F51)

> **Status: Historical (dated 2026-10-02).** This is the browser evidence for
> `docs/specs/2026-10-02-source-list.md` (`2d95bf6`, `2b1bdde`).
>
> **Setup:** local only; nothing touched NTER.
> - **The stack and account:** a scratch Supabase stack and one local test account, as in
>   `2026-10-02-chat-panel-fixes-local-run.md`.
> - **The answer:** a seeded answer citing two documents, shaped like the owner's screenshot.
>   "The Farmers (Old Age Allowance Bill,2000" is cited once, on page 2, as [2]. "THE NATIONAL
>   ANTI-DOPING (AMENDMENT) BILL, 2025" is cited three times, on pages 3, 5 and 7, as [23]–[25].
>   Both carry the stored file names from the screenshot.
> - **The dev server:** Vite on 5174.

| Check | Viewport | Result |
| --- | --- | --- |
| The label and rows | 1440 × 900 | "SOURCES · 2 DOCUMENTS" sits above one bordered list of two rows. Each row reads: icon, title, "Bills · p. 2 · cited 2" or "Bills · pp. 3, 5, 7 · cited 23 24 25", chevron. No file name is visible. |
| Phone | 375 × 812 | The rows span x 28–347 inside the 375 px dock, each 74 px tall. Long titles wrap to two lines. No element of the list crosses the screen's edge. |
| The default look is gone | 375 × 812 | The list has `list-style: none`. The rows have `border: 0` and a transparent background, which turns `#eff4ff` on hover. |
| Opening a source | 375 × 812 | Clicking the anti-doping row opens the reader on that document. It reports "no longer available" because the seeded document is not in the local database, which is expected. |

**Console:** a 403 on `/auth/v1/user` from before sign-in, and 503s from the local stack's Edge
Functions, which this setup does not run. Neither comes from this change.

**Checks:**
- **Vitest:** 1,969 tests pass. Four new SourceList tests and two CSS tests failed first.
- **Lint and the build:** pass.

**Not changed:** the malformed stored title ("…Bill,2000") shows as stored. That is F52.
