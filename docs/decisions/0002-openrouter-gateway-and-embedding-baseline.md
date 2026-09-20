# ADR 0002: OpenRouter is the single model gateway; embedding baseline

> **Status:** Normative — accepted 2026-09-20, amended 2026-09-21 (points 2
> and 4: the registry moved from code to a database allowlist; the refresh
> cadence is twelve hours). Binds every model call and the vector column
> width until superseded by a later ADR.

## Status

Accepted; amended 2026-09-21.

## Context

`server/aiApi.mjs` carries three provider adapters — Gemini, OpenRouter,
DeepSeek — each with its own key, its own request shape and a fallback chain
of model ids whose availability was never verified
(`docs/research/2026-09-20-ai-path-audit.md` §5). No key is configured, so
none of them runs. There is no server-side registry: the browser names the
model and the server trusts it.

The owner's other product routes every chat call through OpenRouter and keeps
a registry that the server re-resolves the client's choice against
(`docs/research/2026-09-20-tenderbase-reference-patterns.md` §12). It embeds
with OpenAI's `text-embedding-3-small` at 1536 dimensions, called at OpenAI
directly.

The owner verified on 2026-09-20, against OpenRouter's live catalogue, that
OpenRouter serves embedding models. A separate precedent exists in the
owner's Knowledge Graphs project (its ADR 0002, 2026-07-21), which selected
`openai/text-embedding-3-small` **through OpenRouter** at its default 1536
dimensions.

The vector column width is the one setting that cannot be changed cheaply:
every stored embedding is that width, and changing the model or the
dimension is a full re-index of the corpus.

## Decision

1. **OpenRouter is the only outbound model endpoint**, for chat completions
   and for embeddings. One secret, `OPENROUTER_API_KEY`, held in Supabase
   project secrets. The browser never holds or sends a key.
2. **Chat models come from a server-side allowlist held in the database**
   (`public.ai_models`, global, one enable toggle per model, edited only
   through an admin-checked edge function). The server re-resolves whatever
   the client asked for against the allowlist; an id not enabled there is
   refused, never forwarded. A row can be enabled only if the id is present
   in the refreshed OpenRouter catalogue with tool calling among its
   supported parameters. The default model is the single row flagged
   `is_default`, not a constant in code and not an environment variable.
   *(Amended 2026-09-21: the 2026-09-20 text placed the registry in code
   with a generated client mirror. The owner's running product keeps it in
   the database with an allowlist, and Niyantran adopts that.)*
3. **Embedding model:** `openai/text-embedding-3-small`, exact id pinned;
   **1536 dimensions**; the dimension parameter is not sent — the model's
   default width is used. Both the model id reported by the provider and the
   vector length are asserted on every call, before any vector is stored or
   any search is run.
4. **Model pricing is display-only, and the catalogue gates the allowlist.**
   A `model_pricing` table is refreshed from OpenRouter every twelve hours
   for the picker, for estimates, and as the set of ids that may be enabled
   in `ai_models`. Cost accounting uses the `usage.cost` OpenRouter reports
   for the actual call, logged on every call from day one, even though
   metering is deferred.

## Alternatives considered

**OpenAI direct for embeddings, OpenRouter for chat.** The reference
implementation's arrangement; proven code. Rejected because it needs a
second vendor account and key for a single call type, and OpenRouter serves
the same model. Kept as the fallback if OpenRouter's embedding endpoint ever
proves unreliable — the switch is one URL and one header, behind the same
assertions.

**Gemini embeddings.** A Gemini key is already provisioned in
`.env.example`, so no new vendor. Rejected: 768-dimension default changes
the column width and every constant, and it departs from the profile the
reference implementation validated retrieval against.

**Keep three provider adapters.** Rejected: three code paths, three keys,
three failure modes, and no registry to refuse an unknown id.

## Consequences

- Changing the embedding model or width is a **full re-index**. The
  assertions in point 3 exist so that a provider-side change is caught on the
  first call, not discovered weeks later as quietly degraded retrieval.
- `src/lib/aiModelsStore.js`, which edits model ids in `localStorage`, serves
  the legacy path only. The admin "AI models" page becomes the allowlist
  editor when the backend flag is on (foundation spec §D.1) and is unchanged
  when it is off.
- Niyantran's role layer (default analyst, expert escalation, PDF parser,
  visual research) is kept as a table over the allowlist. It is Niyantran's
  own routing idea, not a reference pattern.
- The allowlist's contents are a product choice made by the owner from the
  live catalogue, id by id, not a constant anywhere. This ADR fixes only
  that the allowlist exists in the database and that the server is its
  authority.
- Reasoning effort is per model. The allowlist row carries each model's
  accepted effort values so the picker cannot request one the model rejects.
- Adding a model is a toggle, not a deploy. The server caches the allowlist
  briefly, so a change takes effect within a minute, and a wrong toggle does
  too.
- A repair-pass model (a cheap, schema-capable model used to add citations to
  an answer that arrived without them) is likewise a deployment setting.
