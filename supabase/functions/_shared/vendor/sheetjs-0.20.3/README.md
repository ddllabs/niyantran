# SheetJS 0.20.3, vendored

> **Status: Normative.** These files must stay byte-identical to the release named here.

`xlsx.mjs` and `LICENSE` are SheetJS Community Edition 0.20.3 (Apache License 2.0), copied unchanged from
`https://cdn.sheetjs.com/xlsx-0.20.3/package/`. It is the same build the website installs from the tarball that
`package.json` pins.

- `xlsx.mjs` sha256: `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` (1,008,308 bytes)

**Why it is vendored.** `_shared/spreadsheetExtractor.ts` needs SheetJS, and a deployed Edge Function has only the files
under `supabase/functions/`.
- A relative import into the website's `node_modules/` does not exist once deployed.
- The CDN URL is refused by the bundler that `supabase functions deploy --use-api` uses ("Cannot import from
  cdn.sheetjs.com:443"). It was seen deploying `ingest-worker` on 2026-11-28.
- A copy here works with both bundlers, and nothing is fetched when a function is bundled.

**Updating.** Replace both files from the new release's `package/` folder, update the version in this folder's name, the
import in `spreadsheetExtractor.ts`, the hash above, and the pin in `package.json` together.
