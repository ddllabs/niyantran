# State source audit — 2026-10-08

> **Status: Living.** Read-only local execution; source availability changes over time.

## Scope and execution

41 exact State and retained Local-tier identities were probed through the existing localhost `/api/feature-feed` endpoint with three concurrent read-only requests. No source data, account, schema or provider was changed. Raw returned row counts below are diagnostic evidence, not accepted landing counts. The browser uses the existing `fetchFeature` pipeline, including its archive fallback and HTML-only guard; the landing additionally rejects generic backup packs and source-status placeholders.

## Returned source metadata

| Canonical tier | Module | API rows | Adapter | Acceptance limitation |
|---|---|---:|---|---|
| state | Constituency Register | 40 | embedded | Stored Goa coverage only. |
| state | Roll Demography | 40 | embedded | Stored Goa coverage only. |
| state | Community Bloc Matrix | 40 | embedded | Stored Goa coverage only. Community shares are modelled estimates, not census counts. |
| state | Election Results 2017–2024 | 40 | embedded | Stored Goa coverage only. |
| state | Split-Ticket & Competitiveness | 40 | embedded | Stored Goa coverage only. |
| state | MLA Directory | 500 | api | Directory or source-specific entries; no nationwide completeness claim. |
| state | SIR Roll Churn | 40 | embedded | Stored Goa coverage only. |
| state | Registration Gap | 40 | embedded | Stored Goa coverage only. |
| state | State Governance Brief | 120 | news-search | News articles; not a complete official register. |
| state | Bureaucrat Transfer & Posting Tracker (State Cadre) | 58 | news-search | News articles; not a complete official register. |
| local | Booth-level Results Database | 1731 | embedded | Stored Goa coverage only. |
| state | Governor Assent Tracker | 18 | news-search | News articles; not a complete official register. |
| state | State Tender Aggregator (State e-Procurement) | 25 | embedded | Generic backup; uncounted. |
| state | Assembly Proceedings Digest (Vernacular, Translated) | 54 | news-search | News articles; not a complete official register. |
| state | MLA Report Card + Statement Tracker | 500 | api | Identity profiles and news, not attendance/questions/performance scores. |
| state | Party Organisation Map | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | Centre-State Fund Flow Tracker | 11 | api | Union Budget summary lines, not state-level transactions; amounts not added to counts. |
| state | MLA Defection & Anti-defection Case Tracker | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Media Monitor (Vernacular District Editions) | 54 | news-search | News articles; not a complete official register. |
| state | Cabinet Decisions | 100 | news-search | News articles; not a complete official register. |
| state | State Economic Data (GSDP, sectors) | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | Cross-State Comparison Engine | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | State Fiscal Deep-Dive | 1 | download-or-html | Source-status placeholder; uncounted. |
| state | SDL Auction & Borrowing Tracker | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | CAG Audit Tracker | 47 | news-search | News articles; not a complete official register. |
| state | Legislative Productivity Comparison | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | Governor Friction & President's Rule Tracker | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | NITI Aayog State Indices | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Performance Tracker (Composite) | 500 | api | District directory; no composite performance score. |
| state | District Health & Nutrition Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Education Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Economic & Livelihood Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Agriculture & Rural Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Infrastructure & Connectivity | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Governance & Grievance Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| state | District Crime & Safety Indicators | 100 | news-search | Reference-only; unavailable. API news stand-ins are not counted. |
| local | Booth Political History | 1731 | embedded | Stored Goa coverage only. |
| local | Local Governance Brief | 11 | embedded | Stored Goa coverage only. |
| local | Municipal & Panchayat Tender Aggregator | 1 | scrape | Source-status placeholder; uncounted. |
| local | Municipal Watch | 100 | news-search | News articles; not a complete official register. |
| local | Panchayat Watch | 100 | news-search | News articles; not a complete official register. |

## Presentation reconciliation

The five reference State sections retain all35 reference names and6 existing-only destinations: Booth Political History in Elections; MLA Directory, Municipal Watch, Panchayat Watch, Municipal & Panchayat Tender Aggregator and Local Governance Brief in Government. This preserves all14 previously curated entries. No separate Local page or Local reference catalogue is introduced. Source tier stays Local for its six retained/State-listed modules; terminal URLs use the existing State shell. The 75-entry grounding inventory stays frozen.

The landing reports measured-module coverage rather than adding different source units. Module popups identify articles, directory entries, budget lines, constituency or booth records. Goa-derived views share resource keys, and community-model methodology is carried into relevant popups. Chart:40 stored Goa constituencies,23 North Goa and17 South Goa; it does not measure national coverage.

## Exclusions

This is not an independent validation of every upstream record or a new-source ingestion task. Existing terminal feeds may expose news/directory/planned states rather than the full analytical capability implied by a module title. This task makes that limitation explicit; it does not implement missing providers, model outputs, entitlements or geographic filters.
