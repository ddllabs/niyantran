# ADR 0005: moved

> **Status: Living.** A pointer only. It records no decision of its own.

Two records share the number 0005:

- **ADR 0005 — One codebase: ddllabs/niyantran on Supabase, upstream
  integrated once** (accepted 2026-09-24). It makes `ddllabs/niyantran` `main`
  the only codebase, integrates upstream once, and makes Supabase the system
  of record. It lives at
  [`docs/niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md`](../niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md),
  beside the integration audit and plan, so that it is published with them.
- **ADR 0005 — Backend-First Reconciliation, Native Supabase OAuth, and
  Universal OpenRouter Gateway** (accepted 2026-09-24). It covers native
  Supabase Google OAuth and OpenRouter as the only model gateway. It lives at
  [`0005-backend-first-reconciliation-and-universal-openrouter-gateway.md`](0005-backend-first-reconciliation-and-universal-openrouter-gateway.md).

Both are Normative. The files keep their names so that existing references
still resolve. When a document cites "ADR 0005", check which file it links to.
