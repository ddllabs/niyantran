# Orientation list versus the M1/M2 release

> **Status: Living.** Compared 2026-10-17 against the owner's attached orientation
> report, the sole tracker and the cleanup execution evidence. Updated after F218.

The entire six-milestone list is **not complete**. The approved M1 implementation
and both M2 leftovers are released. T15 still requires three real post-rollout
refresh opportunities, including daily reference intervals. Payment integration
must wait for that gate; corpus ingestion remains explicitly excluded.

## Every M1 item from the attachment

| Original item | Current result and evidence |
| --- | --- |
| F215 fixtures source | Adapter repaired with four-league completeness checks (`acadaa2`). First scheduled success returned seven events. Three real hourly opportunities remain part of T15. |
| F160 empty nothing-new | Retained-item guard and verified-empty distinction implemented (`8cd624c`); migration applied, SQL/vacuity/Down checks pass. |
| F160 Music Charts queue timeout | Caller cancellation reaches the host queue (`acadaa2`); cancelled queued work cannot start upstream. |
| F160 constitution key churn | Stable upstream version IDs implemented (`acadaa2`); exact 188-key inventory and production rekey verified. Daily observations remain T15. |
| F160 variants beyond 2,000 historical items | Run-pinned, service-only latest-run reader implemented (`8cd624c`, `acadaa2`); bounded complete paging and refresh-race checks pass. Large boundary proven locally, not with synthetic production data. |
| F216 unsupported caveats | Grounding rules released; page-versus-TOTAL correction in `00aaf99`, research-chat v65. Five frozen cases have passing faithful evidence (four v64, corrected case v65). Total approved evaluation spend $0.03677325; temporary runner deleted. |
| F210 flaky thread tests | Explicit synchronization replaced timing/positional assumptions (`8d6dec5`). Three consecutive real first-attempt CI runs passed; later documentation CI also passed. |
| F202 unused stored searches | Exact inventory removed 57 proven duplicate feature-map fields (`6657958`); registry fields still used at runtime were retained. Parity checks pass. |
| F201 optional comparison consistency | Selected year is exact, missing values explicit, previous period must be comparable (`81912bd`); all selected-table blocks considered within fixed bounds. |
| F201 optional extra page reads | First page plus only necessary remaining pages (`acadaa2`); 1/500/501/2,000 boundaries tested. |
| F201 optional period semantics | Inclusive date-range overlap and exact JSON period filtering (`8cd624c`, `81912bd`); no corpus reload. |
| MLA serving decision from the open questions | Existing profiles became honestly labelled reference data, separate from coverage (`acadaa2`); 400 profiles plus 100 reporting records verified from storage after the actual scheduled refresh. True scorecard remains M3. |
| Approved test-only addition F217 | Morning Brief's aging fixture clock fixed (`8d6dec5`); runtime retention unchanged. |

## M2, closure and later milestones

| Item | Current result |
| --- | --- |
| F208 catalogue initial loading | Released `e5f45c2`. Local entry 224,234 → 180,398 B gzip; total initial JS including globe 229,274 → 185,438 B. Baseline lowered after browser/search/navigation checks. |
| F202 Heads of State links | Released `d4c0054`. Exact safe Wikidata item link verified for keyboard access, href, new tab and noopener. |
| T15 release and closure | Code, three migrations, affected Edge Functions and inventoried reference transitions released. CI gate passed. Real multi-day source observations remain open, with owner-requested hourly read-only follow-ups. |
| F218 new rollout finding | Separate narrow Satellite landing store-first fix authorized after the cleanup. See its execution record for release status; it does not replace T15. |
| M3 sources and methods | Still open for a true MLA scorecard, district modules, tender sources and resulting homepage source count. Separate from payments. |
| M4 corpus/retrieval | Parked and out of scope by owner instruction. No ingestion resumed. |
| M5 payment gateway | Waiting for M1/M2 closure and the next approved plan. Existing billing scaffolding is not payment acceptance. Legal/address/review and live billing decisions remain tracked. |
| M6 launch | Domain, hosting and launch checks remain separate open work. |

## The four earlier open questions

All were resolved in the approved cleanup contract: include all three optional
F201 items; reliable existing MLA reference profiles belong in M1, a true
scorecard in M3; repair the existing fixtures source without paid replacement
or reduced league coverage; show an explicit RBI year gap rather than silently
substituting another year. No new answer is needed for those four questions.

## Documentation and access comparison

- The old “small/backend-only/no owner input” description and milestone ordering
  were superseded by the approved spec/plan and updated tracker. M5 follows M1/M2
  closure; M4 is parked. The MLA boundary is now explicit.
- Old intra-day checkout, bundle, function versions and module counts in dated
  snapshots are historical evidence. Use the rollout sections for released
  state: research-chat v65 and desk-brief v17. Old “local only/no push” paragraphs
  describe their execution phase, followed by the authorized rollout record.
- Some living architecture claims remain inaccurate: the index still says nine
  Edge Functions and omits the scheduled-store path; the database chapter still
  calls `desk_rows.id` a UUID primary key, while its migration uses the composite
  `(tier, feature, row_key)` key. F191's older address count still needs the M3
  source-count work. These were not silently repaired by M1/M2; documentation
  reconciliation is recorded separately as F219 and is not a new payment gate.
- GitHub and Supabase access supported the actual rollout. The Vercel connector
  still denies DDL Labs access, but the authenticated CLI now successfully
  inspects the exact team/project. GitLab's earlier account-level check was
  never a project-specific verification; this release uses GitHub.

Primary evidence: [cleanup execution record](2026-10-17-m1-m2-cleanup-evidence.md),
[sole tracker](../plans/open-work.md), and
[F218 execution record](2026-10-17-f218-stored-summary-evidence.md).
