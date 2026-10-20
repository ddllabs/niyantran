# Free plan card plan

> **Status: Living.** Sequential, no delegation. Spec: ../specs/2026-10-21-free-plan-card.md. Tracked under O6.

1. Add focused card/current/handoff regression cases in shell tests; observe RED against existing paid-only chooser.
2. Add optional Free card in PlanChoices, enable in billing/profile chooser, accept paid-account Free deep link, remove footer duplicate and preserve explicit zero-charge confirmation. Scope shell components/tests and upgrade/billing CSS only.
3. Run focused and full unit tests, lint/build/bundle; verify real components at desktop/mobile/dark with synthetic account responses.
4. Review, commit/publish Test branch under ongoing UI authorization, verify actual logged-in chooser by selection/read only. Record commit/evidence in open-work.md. Production/Live unchanged.

## Local verification

- Original paid-only renderer failed three new Free/current/profile checks (RED); focused21 cases now pass, including Free deep link, disabled existing Free and explicit zero-charge confirmation. Full `npm test`:414files/6458tests passed.
- `npm run lint`, `npm run build`, `npm run check:bundle`, `git diff --check` passed; initial JS180769bytes gzip, no new build warnings.
- Browser fixture used actual components with synthetic account/API responses. Verified paid Free selection→profile review→billing zero-charge confirmation; Free account current card disabled, no fresh welcome/quote claim; 320/390/768/1024/1440px without overflow, four/two/one grid and dark mode. Fixed native disabled-button text contrast while preserving disabled semantics. No console errors. Fixture/server/tabs removed and viewport reset.
- No src/lib/server/API/SQL changes; Edge/SQL suites not rerun for this UI-only change. No external payment or schedule mutation performed during verification.

| Before | After | Why |
| --- | --- | --- |
| Free hidden behind footer action | Free beside Plus/Pro/Max in both choosers | Matches the permanent-tier product model |
| Disabled Free inherited low-contrast native text | Current Free remains legible with explicit current badge | Current state is useful information even when no action is needed |
