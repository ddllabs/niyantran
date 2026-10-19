# Frontend icon repair

> **Status: Living.**

Scope: index.html, public/favicon.ico, public/apple-touch-icon.png and focused static asset verification. Missing default favicon returns 404; Apple icon returns SPA HTML. Add real brand-derived images and initial HTML declarations. Mark the favicon data-niy-site so existing settings update the same link. No application runtime, billing, corpus or backend changes.

Verify binary formats/dimensions, initial HTML, negative baseline, application tests, lint, build, bundle budget and browser loading. Deploy only this verified change from current origin/main, then check production MIME types and frontend resources. Shared Razorpay working files remain untouched.

## Verification before release

- Missing-file assertion failed on the unchanged baseline; passes after repair.
- Source and dist PNG signatures/dimensions (180x180), ICO header/embedded PNG (32x32), and both initial HTML links passed.
- npm ci --no-audit --no-fund passed; existing ESLint deprecation/install-script advisory warnings.
- npm test: 401 files, 6293 tests passed. npm run lint, npm run build, npm run check:bundle, git diff --check passed. No build warnings.
- Local HTTP: both icons plus entry JS, React JS and CSS returned200 with correct MIME types. Chrome rendered the local landing page with cache disabled. Local intro-video API503 reflects missing backend configuration in this isolated checkout; no environment/secrets were copied.
- No src/lib, src/admin, Supabase, SQL, server/API or runtime changes: Deno/SQL/router checks are not applicable to this static-only change.
- Chrome extension control timed out; native Chrome DevTools inspection works. Before the fix, production Console contained three runtime.lastError messaging errors, with no proven application attribution. These are outside the icon patch.
