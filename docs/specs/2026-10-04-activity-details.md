# F64 activity details

> **Status: Normative.** Owner approved the four browser annotations and proposed
> implementation on 2026-10-04. Supersedes the F63 activity presentation where stated.

Current answers repeat a model-only label outside the activity accordion. Model
and effort are stored but the accordion only names fallback models. Searches
persist elapsed time, while live completion omits it; requested top-K and
embedding/database durations are not exposed. `reasoning_ms` is residual time.

Keep the existing chat/panel/Work mode layout. Remove the assistant's standalone
model label. Summary includes actual/requested model label, requested thinking
effort, activity/search/citation/total summary. Disclosure shows exact model ID,
requested model on fallback, requested effort, structured action states and
query, returned chunks or rows, requested top-K for document searches, elapsed
milliseconds, embedding and database retrieval milliseconds when measured.
Top-K is a per-call requested limit, not a result count or unique total.

Timing rows: search actions (inclusive), query embedding (subset), database
retrieval RPC (subset), answer generation, other processing, total, first answer
latency (overlapping). Reasoning duration says Not available; never infer it
from residual elapsed time or token counts. Old missing measurements say Not
available. Zero is valid for measured durations. Failed/cancelled actions must
not display as successful or claim returned results. No private reasoning or
raw provider errors displayed. Hindi equivalents remain.

Acceptance evidence: red/green guards for model/effort consolidation, failed and
cancelled states, absent/zero timing; injected-clock retrieval boundaries;
live/persisted event parity. Full Vitest, Deno, lint/build, offline real-component
browser check including existing saved answers and expanded details. No model
calls or production writes needed. No database/auth/billing/retrieval-policy
change, dependency, push or deployment. Local frontend can use old server events;
new telemetry requires a separately authorized Edge Function deployment.
