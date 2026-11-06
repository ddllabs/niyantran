# Search timing on NTER

> **Status: Living (2026-11-06).** Read-only aggregates from `chat_turn_traces` and `model_call_logs` on NTER, in a read-only
> transaction, with no user text read. Open items: [F295 and F296](../plans/open-work.md).

## Why this was measured

`research-chat` aborts each network step at `NETWORK_TIMEOUT_MS`, 4,000 ms (`supabase/functions/research-chat/index.ts:30`).
That bound covers the embedding call and the `match_documents` call, one each. The hybrid gate, F288 and the F287 note all
measured against the database's 8 s limit. The question was how often the 4 s bound costs a real search.

## What the traces show

`search_documents` steps since 2026-10-01, with 8 users across all traces. Most of this is team and owner use.

| Measure | Value |
|---|---|
| Searches | 449 |
| Median step | 1,251 ms |
| p95 step | 2,747 ms |
| Longest step | 6,666 ms |
| Steps of 4 s or more | 11 |
| Failed searches | 5 (1.1%) |

Embedding took a median of 1,056 ms and p95 1,455 ms across the same 449 calls. So the embedding call is most of a typical
search, and the database work is a few hundred milliseconds. That is a subtraction of medians, not a per-phase measure.

## The five failures

Each failure was matched to the embedding calls of its conversation, by time.

| When (UTC) | Step ms | Embedding | Cause |
|---|---|---|---|
| 2026-10-09 09:50 | 4,003 | 4,002 ms, error | Embedding timed out |
| 2026-10-14 11:55 | 4,002 | 4,000 ms, error | Embedding timed out |
| 2026-10-14 11:55 | 4,001 | 4,001 ms, error | Embedding timed out |
| 2026-10-26 11:00 | 5,154 | 1,150 ms, success | Database search aborted at 4 s |
| 2026-11-03 07:37 | 4,004 | 4,003 ms, error | Embedding timed out |

- **Embedding timeouts: 4 of 449, 0.9%.** A timed-out embedding call fails the search at once. Later calls in the same
  conversation succeeded in under 1 s, so these look like transient provider stalls.
- **Database search aborts: 1 of 449, 0.2%.** The step time fits 1.15 s of embedding plus a 4 s abort. This is read from timing,
  since the trace does not store which phase failed.
- The six slow steps that did not fail returned 40 or 44 rows. Their step time includes embedding and, on Law turns, context reads.

So at today's size, on today's use, the 4 s bound has cost one database search, and it has cost four searches through the
embedding provider.

## What this does not show

- **Nothing on partitions.** The last traced chat turn is 2026-11-03 10:09 UTC, before the partition swap about six hours
  later. No user search on the partitioned tables has been traced on NTER.
- **Search at size.** All of this is at about 393,000 chunks.
- **Hybrid.** It is not on NTER.
- **Cold reads.** Nothing here isolates them.
- **Search mode.** Most steps carry no recorded mode: 405 of 449 could not be matched, so mode splits are not usable.
- **Which phase failed.** `embeddingMs` and `retrievalMs` exist at run time but are not stored in the trace.

## What it changes

- Local latency figures are not a guide to NTER. A typical database search on NTER is a few hundred milliseconds, against 482 to
  840 ms for broad search on the laptop, though the mix of modes differs.
- The 4 s bound is a real constraint for hybrid and for growth, but it is not hurting users today.
- The largest search failure today is the embedding call, and a retry or a separate budget would address it.
