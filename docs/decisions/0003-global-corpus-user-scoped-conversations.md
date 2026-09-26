# ADR 0003: The document corpus is global; conversations are user-scoped

> **Status:** Normative — accepted 2026-09-20. Binds the ownership model of
> every AI table and the scoping of every retrieval RPC until superseded.

## Status

Accepted.

## Context

The documents to be indexed are supplied by Niyantran itself — the National
Desk source documents, delivered as file names, file URLs and raw OCR text.
Every signed-in user is entitled to all of them. There are no user uploads in
scope.

The Supabase project already carries organisation, membership, role and
invite tables, all empty and explicitly out of scope
(`docs/research/2026-09-20-supabase-baseline.md` §2). `user_profiles
.organisation_id` is nullable. The product today is single users signing up
with an email address; teams are a possible future.

The reference implementation scopes every retrieval RPC by organisation and
proves ownership inside the function before searching
(`docs/research/2026-09-20-tenderbase-reference-patterns.md` §5). That
prelude exists because there, a tender belongs to one organisation and the
external tender id is not unique across organisations.

## Decision

1. **The corpus has no owner.** `documents` and `document_chunks` carry no
   `user_id` and no `organisation_id`. Every `authenticated` user may read
   them. Only the service role (the ingestion function) may write them.
2. **Conversations, messages and traces belong to a user.** Each row carries
   `user_id`, defaulting to and checked against `auth.uid()`. RLS grants a
   user their own rows and nothing else. The `anon` role sees nothing.
3. **The match RPC has no ownership prelude.** It orders by distance and
   limits, with an optional document filter. Scoping by caller is
   unnecessary because there is nothing to scope.
4. **No AI table carries `organisation_id` in this cut.** If organisations
   become real, the change is additive: a nullable column, a policy edit and
   a new ADR. Nothing built now has to be unbuilt.

## Alternatives considered

**Organisation-scoped from day one.** Would mirror the reference
implementation exactly. Rejected: every RPC would carry an ownership check
that can only ever pass one way, every row a column that is always null, and
every policy a branch that never executes. Dead code in a security path is a
liability, not preparation.

**A nullable `user_id` on `documents`, meaning "global when null".** Rejected:
two ownership semantics in one table make every policy and every query a
special case. If user uploads arrive later, they get their own table or a
partition with its own policy, and the match function is extended to search
both — a cleaner seam than a nullable owner.

**A copy of the corpus per user.** Rejected outright: the same bytes embedded
nine times, and a re-index multiplied by the user count.

## Consequences

- Ingestion runs only under the service role and only from the edge function
  that owns it; there is no user-facing upload path in this cut.
- Read policies on the corpus are one line: `to authenticated using (true)`.
- Retrieval is simpler and faster than the reference: no ownership lookup
  before the vector scan.
- A future "my documents" feature is a new table and an extension of the
  match function, not a migration of the corpus.
- A future organisation feature does not touch the corpus at all; it touches
  only the user-owned tables, and only additively.
