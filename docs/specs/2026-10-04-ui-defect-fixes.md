# F60 — Frontend defect fixes

> **Status: Historical (2026-10-04).** Owner-authorized scope implemented and verified locally; owner acceptance and publication remain separate.

## Current state and problem

The frontend review covered the current implementation on `0b45d1e`. In the deployed
786 × 977 viewport the AI thread had only 67px of height beneath its controls and
composer. An existing answer displayed literal `<br>` tokens. Source inspection
also found missing keyboard interactions, silent conversation write failures,
attachment processing without progress, silent attachment truncation, stale entry
briefs, inaccessible hidden controls and misleading graph controls.

## Expected outcome and acceptance

- At the reviewed tablet viewport, the AI reading region has at least 200px;
  desktop and phone layouts remain usable, and changing layout preserves the thread.
- Safe break tokens render as line breaks while arbitrary HTML remains escaped.
- AI popovers support keyboard navigation, dismissal and focus restoration.
  Attachment removal is visibly unavailable when locked.
- Attachment processing exposes a busy state; the existing 12-item limit names
  omitted items. Conversation save failures are visible and Reload reconciles them.
  Identity changes cannot leak errors or attachments across accounts.
- Selectable desk rows and sort controls expose keyboard behavior and semantics;
  the desk drawer manages focus. Old briefs cannot remain under a different record.
  Graph copy and controls describe only implemented behavior.
- Marketing controls have accessible names and keyboard behavior. Recovery copy
  has readable contrast. Off-screen admin navigation cannot receive keyboard focus.
- Meaningful regression tests fail with the original defects. Focused tests, full
  Vitest and Deno suites, lint, build and local browser verification pass.

## Scope and exclusions

AI presentation/controller/store/attachment helpers, shell and desk interactions,
marketing/admin accessibility, their tests, and task documentation. No redesign,
new attachment formats or arbitrary size policy, retrieval, payments, ingestion,
authentication behavior, production writes, deployment changes or publication.
Existing duplicate attachment entry points and source-card navigation are intentional
and remain for the later UI enhancement discussion.
