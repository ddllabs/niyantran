# ADR 0014: National first, and what the bulk ingestion loads

> **Status: Normative.** The owner's decisions for bulk ingestion (F278), recorded in the owner's National v1.1 completion
> plan (`docs/operations/national-v1.1-completion-plan.md` on the owner's branch, commits `21542c58` and `8ab6743e`) and
> relayed to the developer on 2026-11-03. Written into `main` on 2026-11-08. Supersedes the "policy-gated collections"
> exclusion in the [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §8 for MP profiles and affidavits.
> In this record "the owner" is the client and "the developer" is DDL Labs.

## Context

The bulk ingestion spec asked the owner for an approval model, a budget, pack access and a policy for personal-data
collections before any bulk batch. The owner answered all of them in one plan.

## Decision

1. **Order.** National first. All legal collections (high courts, tribunals and the law corpus) are on hold.
2. **Pack access.** A read-only Google service account on the owner's `Data Handover` folder. The developer creates it and
   sends the owner its address; the owner shares the folder as Viewer. The runner reads packs from Drive only: the
   developer's laptop copy is incomplete.
3. **Budget.** US$100 for National v1.1, embedding and OCR together. Each later National pack gets its own ceiling, set when
   the developer sends that pack's summary. The legal ceiling waits until legal resumes.
4. **Approval model.** One policy per collection, not per run. Payments, billing and accounts keep their hard stop.
5. **MP profiles: in.** The 3,157 v1.1 profiles load with v1.1. The 122,776 "MP Profiles & Performance" records from the
   2026-09-18 handover load as their own collection after v1.1.
6. **Licence classes: all in,** as public government records with attribution: regulatory, transfer orders, budget,
   cabinet and press releases, industry. Officer names in transfer orders load. Every citation shows its attribution.
7. **Out:** the tender archive and all affidavits (the candidate-affidavit OCR files in the 2026-09-18 handover, and the
   General Election 2024 affidavits in v1.6).
8. **More packs follow.** v1.5 is not the last. v1.6 was delivered on 2026-11-02 (204,975 documents, of which 175,669 are
   `servable = false` and 7,068 replace v1.4 or v1.5 documents). v1.7 OCR started on 2026-11-03. Neither is in the
   November inventory; the owner's agent offers the same read-only inventory for each.

## Consequences

- `servable = false` documents are refused at batch registration; attribution must show in citations for every licence
  class.
- The first collection is National v1.1, under its own policy and the US$100 ceiling.
- Open for the developer (tracked in [open-work](../plans/open-work.md) "Current state"): create the service account and
  send its address, with the request to agree the relaxed bill text check (F275).

## Related developer decisions

Recorded where they were made: Bills and Regulatory get their own partitions (2026-11-02, [partitions
plan](../plans/2026-11-01-chunk-partitions.md)); the NTER instance upgrade to 8 GB (2026-11-03, [Phase B apply
record](../operations/2026-11-03-phase-b-apply.md)); Phase B's broad-search latency exception (2026-11-03, bulk ingestion
spec §4.4); hybrid search only, with metadata
headers held (D5, 2026-11-06, [hybrid plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md)).
