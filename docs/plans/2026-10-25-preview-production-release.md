# Reviewed preview production release

Status: **Historical (2026-10-25).** Owner explicitly authorized pushing and merging all reviewed preview changes to production on25 October2026 IST. This supersedes the earlier preview-only publication boundary for this release; it does not authorize Supabase migrations, data/corpus changes or unrelated work.

## Target and scope

Release branch task/nter-news-rss-preview through [PR58](https://github.com/ddllabs/niyantran/pull/58) into protected main. Reviewed preview b7a772a1 contains eight commits above production348ae6b1: nter.news publisher integration and official branding/date/image/heading repairs, plus citation actions, hierarchical bounded snapshot search and scoped view retention. Homepage layout retained. Existing [news plan](2026-10-25-nter-news-rss-preview.md) and [discovery implementation evidence](2026-10-25-discovery-workspace.md) describe the implementation. No source changes are needed for publication.

## Release gates

1. Confirm clean checkout and fetch origin; review main-to-preview diff, source trust boundaries, test evidence and exact deployment targets. Completed: main is ancestor, eight preview commits, no other worker changes or conflicts; no public/data, backup, src/data, Supabase or deployment-config modifications.
2. Create PR, attach it to this chat, retain full release description and existing coverage/advisory limitations. Required jobs Build and tests / SQL fixtures (disposable Postgres) must pass on the current PR commit. No administrator bypass.
3. Merge the exact reviewed head with a merge commit to preserve its verified history, keep the preview branch/alias available, and let native Vercel main integration build production. No direct push or forced alias promotion.
4. Verify both required jobs on the actual main merge commit, Vercel READY and www.nter.pro/nter.pro aliases on that exact deployment. Read-only public news API, assets and browser smoke checks; no paid research or real-record brief generation.
5. Final delivery report records PR/merge/deployment and checks, clean branch state and limitations. Runtime receipts stay in the delivery report to avoid recursive documentation-only deployments.

## Baseline and recovery

Preview b7a772a1 passed433 files/6625 application tests,1412 Edge tests,lint/build/bundle,router and both required CI jobs on Actions40153494308. Signed-in preview confirmed filter and scroll restoration after Back/reload, Globiz cross-desk path/date and individual existing citation-reader navigation. Initial JavaScript181765 gzip bytes is within182446 budget. Known pre-existing zod advisory and incomplete snapshot record coverage remain separately tracked.

Previous production:348ae6b13ced086544b3fd8fe72713985a35177d / dpl_96d6nUJ6tLC5cvUDM8xvRGaE4jQy. A production rollback would restore that application deployment through the normal release process; no database restore is needed because this release includes no database writes or migrations. Stop publication on any failed mandatory check; diagnose before proceeding. No automatic rollback trigger or approval to alter domain/auth policy is introduced.

## Integration receipt

PR58 merged on25 October2026 at13:38:55 IST, merge `a2c69f625cf3e1734a0d1bd83859bc4b0fb2fca1`, exact reviewed head `cef285c4964c3bd81a1b54ce14363d377d793c7d`. Both required jobs passed in push40175036438 and PR40175040027; Vercel preview check also passed. Pre-release news API returned200, delivery publisher,12 rows, no missing image URLs, stale false. Three sampled explainer images returned200. No protected data collections or deployment configuration changed.

Native production build `dpl_4dps3SCm7CyCGDY95kv2CrnaSCHH` is READY for that merge SHA. Exact-main run40175482127 and domain assignment are the remaining publication gate at this recording point; do not bypass them. The final delivery report records their eventual outcome and live verification. This closure changes documentation only; subsequent documentation publication must pass the same checks, without further application edits.
