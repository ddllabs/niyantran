# Spec: T0, the serverless durability guard

> **Status: Historical (2026-09-29).** Closed by T7 (open-work C3): the SQLite
> tier, `server/db.mjs` and `sql.js` are gone, and `KNOWN_OFFENDERS` is empty.
> Was: Task spec for T0 of
> `docs/plans/2026-09-28-serverless-state-to-supabase.md`. The owner
> authorised the start on 2026-09-28. Mark it Historical when T7 closes the
> plan. (State on 2026-09-29: the guard landed in `d55da42`; two offenders
> remain, both for T7: `server/deskBrief.mjs` importing `server/db.mjs`, and
> `server/db.mjs` writing `writablePath('niyantran.sqlite')`. T7 is tracked
> as C3 in `docs/plans/open-work.md`, including removing `sql.js` from
> `vercel.json` and `package.json` and emptying `KNOWN_OFFENDERS`.)

## Objective

Make the ADR 0005 rule executable. The rule: no handler that Vercel serves may
write durable data under `/tmp`. Today nothing enforces it, which is how
ADR 0010 could wire seven durable stores into `api/router.js` without anyone
noticing.

T0 adds a Vitest guard. It starts from every Vercel function file under
`api/` (today only `api/router.js`). The guard fails whenever a module
reachable from them does any of these:

- imports `server/db.mjs` (the sql.js store under `writablePath()`);
- calls `writablePath()` with a key outside a small cache allow-list, with
  a key it cannot read statically, or with a key containing `..`;
- aliases `writablePath` or `writableRoot`, or uses either one without
  calling it directly, so that a later call would be invisible;
- reaches the temp directory some other way (`os.tmpdir()`,
  `process.env.TMPDIR` or a `'/tmp'` literal).

`server/writableRoot.mjs` itself is exempt.

The offenders that exist today are listed explicitly, each tagged with the
store and task that will remove it. The list may only shrink. A new offender
fails the suite, and so does an entry whose offence has gone.

T0 changes no runtime behaviour.

## Assumptions

1. **The guard reads source code; it does not run it.** Running the router
   would need secrets and network access. A static walk of relative imports
   is enough, because every import in the router's app graph is a literal
   specifier. The only runtime loads (`import('pdfjs-dist/…')` and
   `require('xlsx')` in `server/sourceExtract.mjs`) are bare package
   specifiers, not app code.
2. **The cache allow-list** is `desk-briefs` and `stat1.xlsx`. The spec
   classifies both as caches (C1 and C2). (Corrected 2026-09-28: `CACHE_KEYS`
   in the test is now `desk-briefs`, `stat1.xlsx`, `stat1.json` and
   `home-snapshots`; `862c995` moved the home snapshot and STAT-1 JSON caches
   under `writablePath()`.) The SQLite `entry_briefs` cache is
   reached through `server/db.mjs`, so it is listed as an offender until T7
   removes that tier.
3. **It lives in one file,** `src/lib/serverlessDurability.test.js`, inside
   Vitest's `src/**` include. The scanner stays in the test file and is not
   shipped.
4. **Scope.** Writes that bypass `writablePath()` and target the app
   directory are out of scope. Examples are the marketing video file and the
   STAT-1 JSON under `public/data/`. On Vercel those fail loudly with a
   read-only filesystem error rather than losing data quietly; they are
   reported separately. (Corrected 2026-09-28: none remain. The intro video
   moved to Supabase Storage in T4 (`c4b72e9`), and the STAT-1 and home
   snapshot caches moved under `writablePath()` in `862c995`; the committed
   `public/data/` files are now read-only seeds.)

## Known limits (from the 2026-09-28 independent review)

- **Offences are recorded per module, not per store.** A second durable
  table added inside `server/db.mjs`, or a new `getDb()` call in a module
  already on the list, stays green until that module's entry is removed.
  Every task that removes an entry must therefore remove all of that
  module's durable uses.
- **Only whole-line comments are stripped.** A trailing `// import …` or an
  import-shaped string can still produce a spurious unresolved-import
  failure. Failures of this kind are loud, never silent.
- **Writes to the app directory are not modelled** (assumption 4). This
  covered `server/homeApi.mjs` writing `public/data/*.json`, as well as the
  marketing video and STAT-1 writers; all three were fixed by T4 and
  `862c995` (corrected 2026-09-28).

## Commands

```bash
npx vitest run src/lib/serverlessDurability.test.js   # focused
npm test
npm run build
node -e "import('./api/router.js').then(()=>console.log('ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions
```

## Testing strategy

- **Scanner unit tests on an in-memory file map.** They cover:
  - a `db.mjs` import is flagged;
  - a non-cache key is flagged;
  - a dynamic key is flagged;
  - cache keys pass;
  - `import()` and `export … from` are followed;
  - bare package specifiers are ignored;
  - an unresolvable relative import is reported.
- **A sanity test on the real repo:** the walk must reach
  `server/db.mjs`, `server/userPrefsApi.mjs` and `server/writableRoot.mjs`.
  If it reaches none of them, it proves nothing.
- **Two-way list checks:** no unknown offenders, and no stale entries.
- **One unit test per bypass the review found:** an aliased import, an
  indirect reference, a temp directory reached without `writablePath`, a
  `..` escape, comment lines, and multiple entry files. Each failed before
  the fix.
- **Vacuity evidence,** recorded in the plan:
  - with an empty list, the guard fails on today's code and names every
    offender;
  - removing one entry fails the suite for that store;
  - a temporary new `writablePath('x.json')` call fails the suite.

## Boundaries

- **Always:** keep the change to the one test file plus the docs.
- **Ask first:** any change to `server/` or `api/`, which belongs to T1–T7.
- **Never:** weaken the guard to get green; add a durable key to the cache
  allow-list.

## Success criteria

- `npm test` passes: 644 existing tests plus the new ones.
- The build and the router import still succeed, and the Deno suite is
  unchanged at 415 passing.
- The vacuity evidence above has been observed and recorded.
