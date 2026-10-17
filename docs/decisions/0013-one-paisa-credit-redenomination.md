# ADR 0013: Preserve value and history when changing the credit unit

> **Status: Normative.** Owner approved local implementation 2026-10-18.
> Production cutover subsequently approved and completed. Supplements ADR 0011's unit
> value and ledger entry vocabulary; its append-only rule remains binding.

## Context

The owner changed one credit from INR0.10 to INR0.01. Changing only the live
rate would reduce existing balances' economic value tenfold. Multiplying old
ledger entries would erase the original accounting evidence. Reporting raw
old and new charges together would misstate consumption and model estimates.

## Decision

- Convert economic balances and allowances at 10 new credits per old credit.
  Keep INR plan prices, provider costs, exchange rate, dates and durations.
- Preserve existing ledger entries, charge mappings and lot draw history.
  Snapshot legacy ledger identities and old/new wallet and lot lineage in
  restricted private tables. Add explicit redenomination debits and mapped
  replacement-lot grants. Do not label conversion as AI usage or natural expiry.
- Preserve historical hold amounts, recording their originating rate; normalize
  reservation projections rather than rewriting old holds.
- Keep wallet balance equal to the raw ledger sum including conversion bridge
  entries, and to all open lot remainders minus debt. Extend per-lot and debt
  reconciliation to account explicitly for conversion debits. This book sum
  must not be independently unit-normalized a second time.
- Normalize only charge projections for usage and estimates, using each
  original already-rounded amount and its frozen rate. Original charges/rates
  remain available for audit. Conversion entries are excluded from usage.
- Credit writers take an epoch gate before reading settings. Conversion locks
  that gate, validates activity/drain conditions and reconciles atomically.
  The additive contract and explicit cutover are separate migrations.
- Version administrator amounts, preserving original payload/version across
  retries. Legacy request IDs may replay once; new absent/stale versions reject.
  Browser caches/results must retain their observed unit until publication and
  must reject delayed responses from an earlier unit.

## Consequences

Signup and monthly allowances, reservations, warning thresholds and adjustment
ceilings become ten times their old quantities. The same AI processing uses
ten times the credits. User value and commercial prices remain unchanged.
Private conversion mappings make replacement-lot signup/cycle provenance and
later rollover reconstructible without minting the same source twice.

SQL fixtures must prove wallet, lot and debt conservation, unchanged original
ledger fingerprints, mixed-era reporting, source-key deduplication, retry
identity, numeric bounds, failed-cutover atomicity and writer exclusion. A
client rollback must retain compatible denomination-aware contracts.

Before database commit a failed cutover rolls back normally. After new-unit activity,
blind division is unsafe because four-decimal new amounts may require five
old-unit decimals. Recovery uses a verified forward correction; do not delete
conversion history or restore an old database over intervening activity.

## References

- [Original wallet decision](0011-per-user-credit-ledger.md)
- [Specification](../specs/2026-10-18-credit-paise.md)
- [Implementation plan](../plans/2026-10-18-credit-paise.md)
