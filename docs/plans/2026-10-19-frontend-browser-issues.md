# Chrome frontend issue repair plan

> **Status: Living.**

Spec: ../specs/2026-10-19-frontend-browser-issues.md. Sequential work in isolated task/frontend-browser-issues checkout.

1. Trace browser warnings and source; inspect actual image dimensions and existing CSS.
2. Scope fixes to src/marketing/HomePage.jsx, marketing.css and homeHero.test.jsx. No unrelated image components unless runtime evidence requires them.
3. Prove focused regressions fail before changes; verify after fixes. Run npm test, npm run lint, npm run build, npm run check:bundle. No Edge/SQL changes.
4. Verify Chrome local rendering, then deploy exact verified changes and inspect production Network/Console/Issues. Preserve shared working files.

## Verification evidence (2026-10-19)

- Original production page in Chrome Incognito: two Issues (unnamed form control and lazy-image dimensions), zero console messages. The regular extension-enabled profile additionally reported CSP eval blocking without a source location. No application CSP header/meta was found. Incognito did not reproduce CSP; the particular extension/browser source remains unproven. Security policy unchanged.
- Both new focused regression tests failed on the original source (missing form identity and image dimensions); all nine focused tests passed after the initial fix.
- HTML width/height alone did not clear Chrome's image warning. DevTools linked the warning to the walkthrough globe itself, with 720x405 attributes present. Adding explicit CSS 16/9 aspect ratio cleared it. Final local production build: main target showed zero Issues; entering Finance left only the Finance bill and clearing restored all six preview rows.
- Local preview has one expected environment-dependent /api/marketing/intro-video 503; verify this endpoint separately on production. No backend changes are included.
- Browser screenshots: browser-audit-20261019/frontend-issues-incognito-before.png and frontend-issues-local-after.png in this task's artifact directory.
- Edge Function tests, SQL fixtures and router import are not applicable: no src/lib, src/admin, supabase, api or server changes.
- Final checks: npm test — 401 files / 6,295 tests passed; npm run lint — passed with zero warnings; npm run build — passed; npm run check:bundle — passed (entry 120,681 bytes gzip, initial JavaScript 180,766 bytes gzip); git diff --check — passed.
- Final diff review: no business-logic, API, authentication, security policy, dependency or data changes. Stable form identity is unique within the homepage; image retains lazy loading, its actual 16:9 ratio and existing responsive width cap. Browser evidence covers the behavior absent from server-rendered regression tests.

## Release

- Code commit a82bab8 published to origin/main after a clean fast-forward comparison; shared checkout and its four existing dirty documentation files preserved.
- Vercel deployment dpl_CQLJLMk6xsmCD9WzHLMGZ7qWCnDY is Ready, aliased to www.nter.pro (https://niyantran-ja9u6exc9-ddl-labs.vercel.app).
- Production Chrome Incognito, explicitly selecting Main instead of the browser warmup prerender target: zero Issues, zero console messages, 40 requests with no status outside 200/304. Finance filter returns the Finance bill; clearing restores six rows.
- Independent HTTP verification: 43 actual resources all HTTP 200, including deployed JS/CSS/fonts, favicon, apple-touch-icon, walkthrough image and /api/marketing/intro-video. Preconnect origin roots were excluded from asset counts (they are connection hints, not requested resources). Deployed JS contains the filter identity and image 720/405 dimensions.
- CSP attribution limit: absent in clean Incognito before and after release; regular-profile source location was empty. No confirmed application CSP defect and no security-policy changes. This does not establish which browser extension or feature caused it.
- Evidence: frontend-issues-production-network.png and frontend-issues-production-http.json in the task browser-audit-20261019 directory. These checks cover the scoped homepage fixes, not a fresh exhaustive authenticated-route audit.
