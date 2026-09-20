# ADR 0002: OpenRouter is the single model gateway; embedding baseline

> **Status:** Normative — accepted 2026-09-20. Binds every model call and the
> vector column width until superseded by a later ADR.

## Status

Accepted.

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
2. **Chat models come from a server-side registry.** The server re-resolves
   whatever the client asked for against the registry; an id not in the
   registry is refused, never forwarded. Every listed model must support tool
   calling. The default model is a deployment setting (`AI_DEFAULT_MODEL`),
   not a constant in code.
3. **Embedding model:** `openai/text-embedding-3-small`, exact id pinned;
   **1536 dimensions**; the dimension parameter is not sent — the model's
   default width is used. Both the model id reported by the provider and the
   vector length are asserted on every call, before any vector is stored or
   any search is run.
4. **Model pricing is display-only.** A `model_pricing` table is refreshed
   from OpenRouter on a schedule for the picker and for estimates. Cost
   accounting uses the `usage.cost` OpenRouter reports for the actual call,
   logged on every call from day one, even though metering is deferred.

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
- `src/lib/aiModelsStore.js` and the admin "AI models" page, which edit
  model ids in `localStorage`, are superseded by the registry; the admin page
  becomes read-only over the registry or is retired in the streaming spec.
- The registry's contents are a product choice recorded in the streaming
  agent spec, not here. This ADR fixes only that a registry exists and that
  the server is its authority.
- Reasoning effort is per model. The registry carries each model's accepted
  effort values so the picker cannot request one the model rejects.
- A repair-pass model (a cheap, schema-capable model used to add citations to
  an answer that arrived without them) is likewise a deployment setting.
