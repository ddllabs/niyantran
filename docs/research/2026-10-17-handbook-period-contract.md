# Handbook period search contract

> **Status: Normative.** 2026-10-17 cleanup; existing rows, no reload.

Exact JSON `year` filters are exact. Date ranges use inclusive interval overlap
for State-desk row keys beginning `hb:t`, whose existing year/period fields define:

| Year | Period | Inclusive interval |
| --- | --- | --- |
| 2019 | calendar year | 2019-01-01 through 2019-12-31 |
| 2019-20 | financial year | 2019-04-01 through 2020-03-31 |
| 2019-21 | period of years | 2019-01-01 through 2021-12-31, year precision |

Survey intervals describe the stated years, not invented fieldwork dates.
Unrecognized periods fall back to the existing stored-date predicate. Ordinary
rows retain their previous date behavior. Current catalogue/tool descriptions
are updated without changing module IDs, row counts or catalogue generated_at.
The eight handbook `years` descriptions are the exact catalogue edit inventory.

Migration `20261017100644_handbook_period_ranges.sql` adds an invoker helper
and replaces only the search RPC's date predicate. It changes no data, ingestion
job, worker, embedding, document, chunk or page. Authenticated and service roles
can call the helper; anonymous/public execution is denied. Existing search grants
and bound SQL values are preserved.

Local SQL fixture failed before the fix on a January–March 2020 query that must
match financial 2019-20 and survey 2019-21. After the fix: pass, vacuity pass,
Down/schema equivalence/reapply pass. Production migration remains unapplied.
