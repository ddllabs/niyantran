# V6 explorer restoration plan

> **Status: Historical (2026-10-12).** Owner-authorized correction completed locally on task/terminal-follow-up in 70267e8. Owner acceptance remains pending.

[Spec](../specs/2026-10-12-v6-explorer-restoration.md). F100 in open-work.md.
Sequential work; no delegation needed for implementation.

1. Snapshot dirty corpus paths/tracker; read original V6 HTML and prior frame.
2. Update DeskLandingFrame.test.jsx and deskDefaults.test.jsx: require visible reference explorer and
   exact direct links for each sector/all eight presentations. Execute RED.
3. Restore the original explorer markup/icons/summary text in
   DeskLandingFrame.jsx; add labelled native sector select while retaining
   approved picture-card defaults. Remove only the new accordion CSS; add
   minimal select/link styling in deskLandingV6.css. Execute focused GREEN.
4. Browser-check all sector/module/card destinations, source filter and State
   context, keyboard/modified clicks, both themes, responsive widths and AI
   lifecycle. Compare restored section with original reference/component.
   Run npm test, npm run lint, npm run build and asset verifier. No lib/backend
   change, so Deno/SQL/router checks are not required for this correction.
5. Review exact diff, corpus hashes and tracker normalization. Update current
   discovery/foundation contracts and record executed evidence. Commit exact
   UI/test/doc paths and only F100 tracker insert on the task branch. Leave
   original corpus changes unstaged, main unchanged, no push/deploy.

All five steps completed. [Executed evidence and limits](../research/2026-10-12-v6-explorer-restoration-local-run.md). Final 2,506 tests, lint/build/assets and eight-desk browser traversal passed. Corpus preserved; no merge/push/deploy.
