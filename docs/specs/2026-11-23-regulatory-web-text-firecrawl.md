# Clean web-page text for the Regulators archive, by Firecrawl on Supabase (F369, F355)

> **Status: Living (draft for the developer, 2026-11-23).** Not approved; nothing here is built, applied, deployed or
> enabled. Module `regulatory-archive` of [corpus and search completion](2026-11-20-corpus-and-search-completion.md);
> task C3 of the [v1.1 to v1.3 loads plan](../plans/2026-11-19-v1.1-to-v1.3-loads-and-closeout.md). Pattern:
> [Budget OCR text](2026-11-21-budget-ocr-text.md). Open work: F369, F355, F338, F346. The only list of open work is
> [open-work.md](../plans/open-work.md); this spec adds no line there (the supervisor records new items).

Evidence labels: **read** = read in the code or document cited at `c3a0f687`; **profile** = counted by the author on
2026-11-23 from the screen's input file `~/niyantran-eval-cache/route-review-2026-11-19/v1.3-regulators_archive.jsonl`
(8,261 lines; its receipt names `National/v1.3`, entry `documents/regulators_archive.jsonl.gz`, manifest verified),
counts only, no text or URL copied here; **docs** = Firecrawl's public documentation, read 2026-11-23 at the URL given;
**inferred** = concluded, not executed; **estimate** = an estimate. Nothing here was run against NTER.

## Developer decision being specified (2026-11-23)

Load the v1.3 Regulators archive, getting clean web-page text with **Firecrawl**, a paid scraping API. As relayed in
the dispatch; it is not yet recorded in the tracker. The rules of the Budget OCR decision (2026-11-21) carry over:

1. No model or API key on the operator's laptop: the Firecrawl key is a Supabase function secret.
2. A spend cap enforced in the database.
3. Nothing is admitted except through the screen and the batch policy (the existing five-desk supplied-text route).

## Current state

### The pack (plan table, then profile)

The plan counts v1.3's Regulators archive at 8,261 records, 0 on NTER, of which 7,728 are web-page text (F369), and
the SEBI and transfers refresh at 61. The profile agrees and adds:

| | Records | Extraction | `file_url` | Notes |
|---|---|---|---|---|
| RBI press releases | 6,609 | `html` | `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=<digits>` | |
| RBI notifications | 1,116 | `html` | `https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=<digits>` | |
| SEBI web pages | 3 | `html` | `https://www.sebi.gov.in/…/<name>.html` | |
| SEBI PDFs | 525 | `pdf_text` | `www.sebi.gov.in/…/*.pdf` | screenable today |
| SEBI other | 5 + 3 | `mixed`, `ocr` | `.pdf` | not allowed; stay held |
| **Total** | **8,261** | | | |

- Every one of the 7,728 `html` records has `pdf_blocked: true`, a `pdf_url_for_topup` (7,725 on `rbidocs.rbi.org.in`,
  3 on `www.sebi.gov.in`, all `.pdf`), `file_url` equal to `citation.page_url`, `page_split none`, no page spans,
  `page_count` null and `text_engine` "rbi page html -> text" (or the SEBI equivalent). `file_bytes` is the HTML page
  size (median about 114 kB), not the PDF's. So the pack's text is the text of the record's own official web page,
  taken because the PDF was blocked.
- Lengths of the 7,728 texts: median 1,733 characters; 265 under 300 (151 press releases and 114 notifications); 2,272
  under 1,000; 22 over 100,000; one over 600,000. Total 32.0 million characters.
- Site chrome (the site's menu and search lines) is in 310 of the 7,728 (291 press releases, 19 notifications); the rest
  start at the document. The short notifications are mostly stub pages whose body is the PDF (115 notifications are
  under 300 characters or end on the page's "previous versions" line).
- Every record: one regulator of RBI (7,725) or SEBI (536), licence class `govt_material_confirm_counsel`, one row link,
  a `YYYY-MM-DD` citation date (2024: 2,498; 2025: 2,815; 2026: 2,414; 2027: 1, in the future), a title.
- The refresh entries (profile): SEBI refresh 50 (46 `pdf_text`, 2 `mixed`, 1 `ocr`, 1 `html` whose `file_url` is a PDF);
  AGMUT transfers refresh 11 (the Transfers desk, F390; out of scope here). 50 + 11 = the plan's 61.
- Not counted: how many of the 8,261 are already live (by `source_key` or text); whether the pack text flattens the
  tables in RBI's money-market press releases (the footnote of their liquidity table is in 991 of the 7,728, so such
  tables are common); how titles compare with the official pages (F346 found file names for titles in v1.1; not
  checked for v1.3).

### The screen and the route (read)

- `scripts/bulk-runner/screens/regulatory.json` allows `extraction_allowed: ["pdf_text"]`, so every `html` record is
  held `extraction_not_allowed` (F369). It allows the density-only basis and sets no `unpaged_text`.
- `screens/search_only.ts` already handles web pages for Cabinet (`cabinet.json`: `extraction_allowed ["html"]`,
  `unpaged_text true`): a record with `page_split none` and no spans passes `text_binds` with a page count of 0, the
  density check does not apply to it (no spans), and the density-only basis is earned when `text_binds`, `length`,
  `density` and `extraction` each passed. So for web text the length rule (`min_chars` 300, `max_chars` 600,000) is the
  only size rule today.
- `public.ingest_search_only_desks()` (`20261123090000_national_search_only_five_desks.sql`) lists the Regulatory desk's
  file-link hosts: `rbidocs.rbi.org.in`, `www.rbi.org.in`, `www.sebi.gov.in`. Admission allows a query in `file_url`
  (it checks the path before `?`), so the `aspx?prid=` links are admissible as links.
- The `text_engine` and `extraction` fields are copied into stored metadata by `prepareSuppliedText` (`COPIED` in
  `search_only.ts`); other added fields are not stored.
- The Budget OCR route (`20261125100000_budget_ocr_queue.sql`, `supabase/functions/budget-ocr/`,
  `scripts/bulk-runner/ocr_route.ts`) is live on NTER with its spend recorded (US$4.159 under a US$10 cap, switch off,
  F391). Its tables and functions are fixed to the Budget desk, `.pdf` links without a query, and a price per page.

### Search (F355)

- The bar (F355 spec): on the 55 Regulatory questions, at least 47 in the first 10 and none lost that vector only finds;
  clearly better on a fresh set. Vector only was 40 of 55 after the v1.1 load (from 50 before it).
- 2026-11-22, read-only on NTER (`~/niyantran-eval-cache/hybrid-measure-2026-11-22/02-summary.out`, counts): on 141
  Regulatory questions (144 distinct across the 55, v1, v2, holdout and sealed sets, less 3 ambiguous) vector only has 97 in the first 10
  and 115 in the first 40; hybrid 104 and 115, 2.04 times slower warm. On the 55 hybrid reaches 44. No desk passed;
  `hybrid_search_desks` is empty.
- Standing holds: F355 "No further Regulatory load until it passes"; programme decision 3 of 2026-11-20 ("the archive
  stays held until hybrid passes on Regulatory"). The 2026-11-23 decision to load may lift them; it does not say so (D1).
- Size (estimate): the v1.1 load stored about 700 characters per Regulatory chunk, so 32 million characters are about
  45,000 to 50,000 chunks: the Regulatory partition from 183,805 to about 230,000. The last load (2,605 documents, same
  regulators) cost 10 questions in the first 10; this one is three times as many documents, almost all RBI.

### Firecrawl (docs)

| Fact | Source |
|---|---|
| `POST https://api.firecrawl.dev/v2/scrape`, bearer token; body `url`, `formats` (default markdown), `onlyMainContent` (default true: drops headers, navs, footers), `timeout` (default 60,000 ms, max 300,000), `maxAge` (cache, default 2 days; 0 always fetches fresh), `parsers` (pdf on by default; a list turns off the others), `proxy` (`basic`, `enhanced`, `auto`; default `auto`), `location` (default `US`), `storeInCache`, `zeroDataRetention` | https://docs.firecrawl.dev/api-reference/endpoint/scrape , https://docs.firecrawl.dev/advanced-scraping-guide |
| Response: `data.markdown`; `data.metadata` with `title`, `sourceURL`, `url` (after redirects), `statusCode` (the site's), `contentType`, `error`. No credits field in the scrape response | scrape reference |
| Errors: 400 bad request; 402 payment required; 403 forbidden (feature not enabled, terms); 404 cache miss modes; 409 duplicate or in-flight `x-request-id`; 429 rate limit; 500 unknown; 503 `request_unresolved` ("retry with the same x-request-id") or `billing_unavailable` | scrape reference |
| `auto` "retries with enhanced proxies" after basic fails; enhanced costs the same credit, "An escalated retry is not charged separately" | https://docs.firecrawl.dev/features/proxies , https://docs.firecrawl.dev/features/enhanced-mode |
| Scrape "1 credit / page"; PDF parsing "+1 credit / PDF page"; JSON format +4; `parsers: []` returns a PDF as base64 for 1 credit flat | https://docs.firecrawl.dev/billing , advanced scraping guide |
| A page that answers 403 or 404 is still billed 1 credit; a scrape with no document (site never answered) costs 0; usage is readable from a Credit Usage endpoint | billing |
| robots.txt: read before **crawling** (user-agent token `FirecrawlAgent` and `*`); `ignoreRobotsTxt` is a crawl option, "Enterprise only". The docs do not say whether `/scrape` checks robots.txt | advanced scraping guide, https://docs.firecrawl.dev/api-reference/endpoint/crawl-post |
| Plans: Free US$0, 1,000 credits, 2 browsers, 10 scrapes/min, no pay-as-you-go; Hobby US$19/month, 5,000 credits, 5 browsers, 100/min, top-up US$5 per 1,000; Standard US$99/month, 100,000 credits, 25 browsers, 500/min, US$5 per 2,000; credits do not roll over below Scale; an account-level monthly top-up cap can be set | https://www.firecrawl.dev/pricing |

The pricing page says "1 credit per PDF page" and the billing page "+1 credit / PDF page" on top of the scrape; this
spec prices a PDF at 1 + pages to err high. Not verified: whether `/scrape` honours robots.txt; whether a repeated
`x-request-id` returns the first result or bills again.

### The hosts (executed once, 2026-11-23)

One automated GET of `https://www.rbi.org.in/robots.txt` by the author's fetch tool was answered **418**. F338 found
`rbidocs.rbi.org.in` answers automated requests with an HTML page in place of the PDF and of robots.txt. So robots.txt
for both RBI hosts cannot be read by an automated client, and `www.rbi.org.in` may refuse Firecrawl's basic fetcher too.
The pack's builder fetched these pages on 2026-10-07 (`archive_fetch`).

## Problem

7,728 records cannot pass the screen because their text type is not allowed. Their text is the official page's, but
taken by a simple HTML-to-text pass: 310 carry the site's menu, tables are probably flattened (not checked), and the
pipeline has no record of how the text was taken. The developer wants clean page text from a known extractor, taken
on Supabase under a cap, with the screen still deciding admission. The desk's search is already below its bar, and
this load adds about 25% to the partition.

## Expected outcome

- Each selected record's official page is scraped once by Firecrawl from a Supabase Edge function, under a spend cap in
  the database, with no key on the laptop; the text comes back to the laptop by the existing `corpus_ingest` login.
- The runner writes the pack's own record with the new text, `extraction web_firecrawl`, and screens it; the Regulatory
  screen allows `web_firecrawl` and nothing else new; the normal `run` admits it through the five-desk route.
- Regulatory search is measured before and after each load stage, against a stop rule the developer accepts beforehand.

Acceptance evidence:

1. A trial of 20 (5 notifications, 15 press releases, seeded) returns text for at least 18 with site status 200; the
   developer reads 5 against the official page (no menu, tables as rows, nothing missing at the end); the credits
   Firecrawl reports for the trial equal the queue's count.
2. The screen on the collected trial: every record screened or held with a counted reason; `html` records still held;
   the v1.1 Regulatory records give the same outcome counts as before the screen change (only the rules hash moves).
3. The fixtures and tests below fail first and pass after; each named mutation makes them fail.
4. The search check is recorded before the first load, after the first batch of 100 and after the last, in one
   sitting each, and the stop rule (D1) holds or the developer accepts the result on record.
5. Committed spend never passes the cap; the final reconciliation with Firecrawl's usage is recorded.

## Design

### What is scraped

- **The record's own official page, `file_url`**, which for all 7,728 equals `citation.page_url`. Not the blocked PDF.
  This keeps faith with the F338 decision of 2026-11-15 ("no way round the host"), as far as the choice of URL goes.
- **URL rule (enqueue refuses anything else):** host in the Regulatory desk's list from `ingest_search_only_desks()`,
  and then exactly one of
  `^https://www\.rbi\.org\.in/Scripts/BS_PressReleaseDisplay\.aspx\?prid=[0-9]{1,7}$`,
  `^https://www\.rbi\.org\.in/Scripts/NotificationUser\.aspx\?Id=[0-9]{1,7}$`,
  `^https://www\.sebi\.gov\.in/[a-z0-9/_.-]{1,400}\.html$` (with the segment checks of `billUrlSegmentsOk`). No
  `rbidocs.rbi.org.in` URL is accepted unless D2 adds it with its own rule.
- **Selection:** records of `national-regulatory` with `extraction html` that the screen held for
  `extraction_not_allowed` and for no reason that the new text cannot change (the exact reason set is fixed from the
  real hold file in T0; a record held for a duplicate `source_key`, `already_live` or `publisher_unresolved` is not
  scraped).
- **Request (fixed in code, hashed into the receipt):** `formats ["markdown"]`, `onlyMainContent true`, `parsers []` (a
  URL that turns out to serve a PDF costs 1 credit and fails `not_html` instead of paying per page), `maxAge 0`,
  `storeInCache false`, `blockAds true`, `removeBase64Images true`, `timeout 60000`, `proxy` per D3 (recommended
  `basic`), default `location`; no `actions`, no JSON format, no prompt-injection scan (each adds credits; the text is
  treated as untrusted data in any case). `x-request-id` is the request row's id.
- **When Firecrawl fails** (any final failure below): the record is not scraped again by this route and stays held
  (`extraction_not_allowed`), counted by failure code in the collect receipt. The pack's own `html` text is **not** a
  fallback (D4).

### Where it runs: a new queue and function, modelled on `budget-ocr` (recommended)

Recommendation: **a new migration and a new Edge function `web-text`**, copying the Budget OCR pattern, not a
generalised `budget_ocr` queue. Reasons:

1. `private.budget_ocr_requests` is live with its spend and text as the F391 record; altering a live table and the
   checks its fixture proves (Budget host, `.pdf` with no query, price per page, the page-count rules) risks that record
   for no gain.
2. The unit differs: Firecrawl bills a credit per scrape, Mistral a price per page; one `usd_per_1000_pages` setting
   would mis-price one of them, as the vision run showed (the spec's live run notes).
3. Separate caps and switches: a Firecrawl problem cannot stop or spend from the Budget OCR cap, and the reverse.
4. A separate secret (`WEB_TEXT_SECRET`) and key (`FIRECRAWL_API_KEY`): `budget-ocr` never holds the Firecrawl key.

Shared code is imported, not copied: `secretMatches`, `redactMessage` from `ingest-worker/mistral.ts`; the claim, lease
and money rules are re-implemented in the new migration from the Budget OCR bodies, so the fixture proves them again.

**Migration** (one file, timestamped after `20261125100000`; creates objects only):

- `private.web_text_settings`, one row: `cap_usd` default **0** (nothing can be claimed until the developer sets it;
  check 0 to 100), `usd_per_credit` default 0.005 (check above 0, at most 0.1), `enabled` false, `function_url` null
  (check `^https://[a-z0-9]{20}\.supabase\.co/functions/v1/web-text$`), `max_attempts` 2, `halt_source_errors` 5.
  RLS on, no policy, no grant.
- `private.web_text_requests`: `source_key` (unique, 40 hex), `desk_feature` (the Regulatory spelling only, by check),
  `official_url` (unique, the URL rule above, at most 2,000 bytes), `pack_sha256`, `status` (`queued`, `running`,
  `done`, `failed`), `estimate_usd`, `spent_usd`, `attempts`, `claim_token`, `lease_until`, `credits`, `cost_usd`, the
  markdown `text` (at most 2,000,000 characters), `text_sha256`, `source_status`, `final_url_host`, `content_type`,
  `scraped_at`, `error_code`, timestamps; the same status and done checks as Budget OCR.
- Functions, all `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, schema-qualified, none for `PUBLIC`, `anon`,
  `authenticated`:

  | Function | Who | What |
  |---|---|---|
  | `public.web_text_enqueue(jsonb)` | `corpus_ingest`, `service_role` | up to 50 items `{source_key, official_url, pack_sha256}`; the URL rule and the host list; refuses duplicates; the estimate is 1 credit × the current `usd_per_credit`, computed here |
  | `public.web_text_read(text[])` | `corpus_ingest`, `service_role` | rows by key, text only when `done` |
  | `public.web_text_status()` | `corpus_ingest`, `service_role` | counts by status and code, committed money, cap, switch |
  | `public.web_text_claim(limit, lease)` | `service_role` | refuses while off; the cap rule of Budget OCR |
  | `public.web_text_finish(id, token, jsonb)` | `service_role` | stores text and metadata; cost = 1 credit × price, computed here |
  | `public.web_text_fail(id, token, code, uncertain, permanent)` | `service_role` | retries to `max_attempts`; counts money; the halt rule |
  | `private.web_text_tick()` | cron owner | inert unless enabled, a URL set, work queued, under the cap, and the vault holds `web_text_secret` |

- **Cap:** `committed = Σ spent_usd + Σ estimate_usd of running`; `claim` locks the settings row and refuses the next
  request when `committed + estimate > cap_usd` (`cap`). Money counted conservatively: a scrape that returned a
  document (any site status) counts 1 credit; a timeout, a 5xx, a dropped connection or a lost lease counts its whole
  estimate (it may have been billed); 400, 401, 402, 429 count nothing (not billed, per the billing page, inferred for
  401).
- **Halt rule (in the database):** `fail` with code `source_status_*` or `not_html` increments a run counter; when
  `halt_source_errors` such failures arrive with no `done` between them, the run switches off (`enabled = false`). This
  bounds the case where the RBI host refuses Firecrawl's fetcher and every refusal is still billed. A 401 or 402 from
  Firecrawl also switches the run off (wrong key, no credits).
- **Cron** `web-text`, every minute (or `30 seconds` if the developer wants the run in about half the time), scheduled
  only where `pg_cron` exists, inert as above. Applying the migration spends nothing.

**Edge function `supabase/functions/web-text/`** (`index.ts`, `handler.ts`, `firecrawl.ts`, tests;
`config.toml` `verify_jwt = false` with the same comment as `budget-ocr`):

- POST only, `x-web-text-secret` equal to `WEB_TEXT_SECRET` (constant time; 401 with no detail); 503 before any claim
  when the secret is under 32 characters or `FIRECRAWL_API_KEY` is unset. Answers 202 and, under `waitUntil`, claims up
  to `CLAIM_LIMIT` (2 on the Free plan, 5 on Hobby: the plan's concurrent browsers) and scrapes them together.
- Each scrape has `AbortSignal.timeout(75 s)` (Firecrawl's own 60 s plus margin; under the 300 s lease and the 150 s
  Free-plan function limit).
- Outcome mapping (final unless marked retried):

  | Firecrawl answer | Code | Money | Retry |
  |---|---|---|---|
  | 200, `success`, site status 200, `contentType` HTML, final host equal to the requested host, markdown non-empty | done | 1 credit | |
  | 200 with site status other than 200 | `source_status_<nnn>` | 1 credit | retried once |
  | 200 with a non-HTML content type | `not_html` | 1 credit | no |
  | 200 with the final URL on another host | `redirected_off_host` | 1 credit | no |
  | 200 with empty markdown | `empty_text` | 1 credit | no |
  | 400 | `firecrawl_rejected` | 0 | no |
  | 401, 403 | `firecrawl_forbidden` | 0 | no; switches off |
  | 402 | `firecrawl_no_credits` | 0 | no; switches off |
  | 409 | `firecrawl_duplicate` | estimate | retried |
  | 429 | `firecrawl_rate_limited` | 0 | retried |
  | 500, 503, dropped connection | `firecrawl_unavailable` | estimate | retried |
  | our time limit | `firecrawl_timeout` | estimate | retried |
  | a body that does not parse | `firecrawl_unreadable` | estimate | retried |
  | `finish` itself fails | `report_failed` | 1 credit | no (never pay twice) |

- NUL removed before storing. Logs: row id, source key, outcome, code, site status, credits counted, latency; never the
  text, the URL or a key.

**Secrets (developer):** `FIRECRAWL_API_KEY` and `WEB_TEXT_SECRET` (32+ random characters) as Edge function secrets on
NTER; the same `WEB_TEXT_SECRET` in the vault as `web_text_secret`. Nothing typed on the laptop or into the repository.

### Runner: `scripts/bulk-runner/web_route.ts`, wired in `cli.ts`

- `cli.ts web-enqueue --records … --holds … [--limit N] [--offset N] [--budget-usd N] [--dry-run]`: selects as above
  in `source_key` order, refuses the whole plan if any URL fails the rule or the estimate passes `--budget-usd`; prints
  counts and reasons only.
- `cli.ts web-collect --records … --holds … [--limit N] [--offset N] --out <dir outside every checkout>`: checks the
  records file against its receipt, reads done rows ten keys at a time, refuses a row that is not this record's own
  (key, URL, pack hash), and builds the pack's record with:
  - `text`: the markdown, **normalised** by one tested function: image links removed, `[label](url)` replaced by its
    label, bare URLs kept as text, runs of blank lines collapsed, control codes removed and counted;
  - `extraction "web_firecrawl"`, `text_engine "firecrawl v2/scrape markdown onlyMainContent proxy=<mode>"`,
    `page_split "none"`, `pages []`, `page_count` absent, `content_sha256` and `n_chars` of the new text; every other
    field as the pack has it (citation, title, links, licence);
  - an **identity check** against the pack's own text of the same page: the share of the new text's normalised word
    5-grams found in the pack text must be at least a threshold set from the trial (D9; a draft of 0.8); below it the
    record is not written and is counted `web_text_unbound` (guards a block or error page answered with status 200).
  - The receipt: the pack receipt with the new hash and count, the request options' sha256, counts by outcome and code,
    credits and cost, and the identity-check distribution. Provenance per document is the stored `extraction` and
    `text_engine`; the queue row (scrape time, site status, final host, text hash) stays in `private` as the durable
    record, keyed by `source_key`.
- Both use the one login `corpus_ingest` through psql; no key is read from any file.

### Screen change (Regulatory only)

`regulatory.json`: `extraction_allowed ["pdf_text", "web_firecrawl"]` and `unpaged_text true`. Nothing else, and no
other desk's file. Effects (inferred, proved in T4): `html`, `mixed` and `ocr` stay held; `pdf_text` records keep their
verdicts (`unpaged_text` only touches records with no spans and `page_split none`); the rules hash changes once.

Length and density for web text: `min_chars` 300 and `max_chars` 600,000 stay (the 265 stub pages are expected to stay
held as too short, counted). The density check cannot apply (no spans). One added rule is recommended inside the
existing length check's family, for `web_firecrawl` only: hold `web_text_short_lines` when more than half the text's
lines are under 20 characters and the text is under 1,000 characters (a menu or link list that survived). Draft; set
from the trial or dropped (D9).

## Search quality (F355)

The local load copy has generated vectors and cannot judge quality, and embedding the new texts locally would need a
model key on the laptop, which the decision forbids. So the measurement is on NTER, read-only, as on 2026-11-22:

1. **Before** (one sitting, after the trial and before any load): vector only and hybrid, on the 141 Regulatory
   questions (the 55 marked), with `scripts/eval-retrieval.mjs --target nter`; the result is the baseline.
2. **After the first batch of 100**, then `analyze`: the same run with `--compare` against the baseline.
3. **After every 2,000 documents** and after the last: the same.
4. **Stop rule (D1, recommended):** stop loading when vector only loses more than 3 of the 141 in the first 10, or any of
   the 55 in the first 40, against the baseline; the developer then decides whether to discard the batch
   (`ingest_discard`, a named yes) or accept on record. The F355 bar itself (47 of 55) is not reachable by this load and
   stays the bar for the search build.
5. Raw output stays in `~/niyantran-eval-cache/`; the spec records counts.

## Cost and the cap (estimate)

| Item | Quantity | Price | Cost |
|---|---|---|---|
| Trial, Free plan | 20 scrapes | 0 (1,000 free credits) | US$0 |
| Main run | 7,728 scrapes, 1 credit each | US$0.005 a credit (top-up rate; Hobby's plan rate is 0.0038) | about US$38.6 |
| Retries and refusals | at most one retry each for `source_status_*`; halt after 5 in a row | same | under US$5 if the halt holds |
| Embedding at load | about 32 million characters, about 8 million tokens | US$0.02 per million tokens | about US$0.16 |

Firecrawl's own billing: Hobby (US$19, 5,000 credits) with about three US$5 top-ups, about US$34 for the month; or
Standard (US$99, 100,000 credits) if v1.4's Regulatory records will use the same route. **Cap to ask for: US$50 in the
database** (`usd_per_credit` 0.005), and an account-level monthly top-up cap on Firecrawl of the same size. If D2 adds
the blocked PDFs, their cost is 1 + pages per PDF, not counted here; the PDFs' page counts are not in the pack.

## Ordered tasks

| # | Task | Who | Write scope | Tests (failing first) | Verification |
|---|---|---|---|---|---|
| T0 | Screen v1.3 offline on the current code; record hold counts by reason; fix the selection's reason set; count already-live keys read-only | supervisor | none in the repository | | `deno run -A --config supabase/functions/deno.json scripts/bulk-runner/screen.ts --screen national-regulatory …` (live reads read-only) |
| T1 | Migration and fixture | senior builder (Opus) | one file in `supabase/migrations/`; `supabase/tests/web_text_queue.sql`; its `run.sh` entry | grants, definer, pinned path; URL rule (each RBI form, SEBI, refused `rbidocs`, a query on SEBI, a second query key, credentials, port, encoded separator, `..`); duplicates; cap exactly at and just over; cap 0 refuses; claim while off; stale token; money per code; retry and final; lease expiry; halt after N; switch off on 401/402; cron body with stand-ins. Vacuity: fails without the migration; at least 8 mutations each fail it | `npm run test:sql` |
| T2 | Edge function | senior builder | `supabase/functions/web-text/`; `supabase/config.toml` one entry | injected `fetch` only: the exact request body and headers; each row of the outcome table; NUL strip; 503 and 401 paths; nothing logged but the listed fields; concurrency bounded by `CLAIM_LIMIT`; time limits under the lease. At least 8 mutations each fail | `deno test -A --config supabase/functions/deno.json supabase/functions` |
| T3 | Runner commands | engineering agent (Sonnet) | `scripts/bulk-runner/web_route.ts`, `web_route_test.ts`, a few lines of `cli.ts` | selection; URL refusal of the whole plan; budget refusal; record built and passed by the screen's own `text_binds`; normaliser cases; identity check below and above the threshold; receipt; psql quoting; nothing printed but counts | `deno test -A --config supabase/functions/deno.json scripts/bulk-runner`; `deno lint` and `deno fmt --check` on `scripts/bulk-runner` |
| T4 | Screen change | engineering agent | `scripts/bulk-runner/screens/regulatory.json`; its pinned-value test; `search_only_test.ts` cases | a `web_firecrawl` record screens; `html` stays held; a `pdf_text` record's verdict unchanged; the optional short-lines rule if D9 keeps it | as T3; the v1.1 Regulatory file screened offline before and after: identical outcome counts |
| T5 | Independent security review of T1 to T3 against the access rules and the money rules | reviewer (Opus), given the code and these rules, not the builders' notes | none | | review report; fixes each with a failing test |
| T6 | Merge (supervisor, after CI's two jobs); apply the migration by psql as `postgres` after a rolled-back dry run; set secrets; deploy `web-text`; read the deploy's file list | supervisor; developer for secrets | NTER | | `select * from private.web_text_settings` shows off, cap 0; the cron row exists; nothing queued |
| T7 | Trial of 20 on the Free plan: set `cap_usd` 1, URL, enable; `web-enqueue --limit 20` (dry run first); `web-collect`; screen; developer reads 5; reconcile credits with Firecrawl's usage; switch off | supervisor; developer reads | outside the repository | | acceptance evidence 1 and 2 |
| T8 | Baseline search measurement | supervisor | outside the repository | | Search quality step 1 |
| T9 | Scrape the rest in batches of 50 queued at a time (hands-off on Supabase); collect and screen each | supervisor | outside the repository | | status counts; cap never passed; halt never fired, or its cause recorded |
| T10 | Load: first batch of 100 with acceptance, `analyze`, measurement, stop rule; then the rest by the hands-off route, measuring every 2,000; record in `docs/operations/` | supervisor | `docs/operations/` | | acceptance on every batch; `analyze public.document_chunks; analyze public.desk_rows; analyze public.documents;` |

T1, T2 and T3 share one fixed interface (the function names, arguments, row shape and codes above) and have disjoint
write scopes, so they may run together once this spec is approved. T4 is independent. T6 onward wait for the developer's
named yes at each production step.

Every code change also runs `npm run lint`, `npm run build`, `npm test`, and the CI router import is not needed (no
change under `api/` or `server/`).

## Rollback

- Stop spending: `update private.web_text_settings set enabled = false;` (claim refuses; running rows finish or lapse).
  Lower the cap the same way. Revoke or rotate the Firecrawl key in Firecrawl's dashboard.
- Remove the schedule: `select cron.unschedule(jobid) from cron.job where jobname = 'web-text';`.
- The migration's Down section drops only its own objects; the vault secret is left for the developer to delete.
- The screen change is one revert of `regulatory.json` (the rules hash returns).
- Loaded documents are ordinary supplied-text documents: `ingest_discard` / `ingest_delete` by batch, each a named yes.
  Firecrawl stores nothing for us (`storeInCache false`); its own retention is its terms.

## Decisions needed from the developer

1. **D1, the search hold.** Does the 2026-11-23 decision lift F355's "no further Regulatory load until it passes" and
   the 2026-11-20 archive hold? Recommended: yes for this load, with the staged stop rule above accepted beforehand;
   the 47-of-55 bar stays for the search build.
2. **D2, what is scraped.** The official web page only (recommended), or also the blocked PDF on `rbidocs.rbi.org.in`
   for the stub pages. The PDF path reverses the F338 decision of 2026-11-15 and costs per page.
3. **D3, proxy mode.** `basic` only (recommended: no escalation past the host's handling of automated clients, which
   F338 ruled out) or Firecrawl's default `auto`, which escalates to enhanced proxies. Also whether `location` stays
   Firecrawl's default or is set to India. If `basic` fails on `www.rbi.org.in` in the trial, the route yields nothing
   and this decision returns with the trial's counts.
4. **D4, fallback.** A record Firecrawl cannot read stays held (recommended), or the pack's own `html` text is allowed
   for it (then 310 records with site chrome need their own rule).
5. **D5, the Firecrawl account (billing, the developer's own).** Free plan for the trial; then Hobby with top-ups or
   Standard; an account-level top-up cap; whether zero data retention is wanted (it costs more and is enabled by
   Firecrawl's support).
6. **D6, the cap.** US$50 in the database at US$0.005 a credit.
7. **D7, terms.** Whether scraping RBI's site through a third-party service is acceptable under RBI's website terms
   and the `govt_material_confirm_counsel` licence class, given that robots.txt cannot be read by an automated client
   and Firecrawl's docs do not say whether `/scrape` honours it. Recommended: the owner's counsel question already open
   for this licence class covers it; record the answer before T9.
8. **D8, schedule.** Every minute (about 26 hours for 7,728 at 5 a minute) or every 30 seconds (about 13 hours).
9. **D9, thresholds.** The identity-check share (draft 0.8) and the short-lines rule are set from the trial or dropped;
   the developer accepts the numbers before T9.

## Exclusions

No change to the Budget OCR queue, `budget-ocr`, the five-desk route, `ingest_register`, the worker, chunking, the
embedding model, search functions or any other desk's screen. No PDF is fetched, stored or served. The 525 SEBI
`pdf_text` records and the SEBI refresh are screened by the existing route and are not part of this spend. AGMUT
transfers (F390), F346 title and date corrections, and the one future date are not changed here (prepare already drops
invalid dates; a 2027 date is a valid date and is noted for F346).

## Not verified

- Whether Firecrawl's basic fetcher is served by `www.rbi.org.in` (the trial shows it).
- Whether `/scrape` honours robots.txt, and how a reused `x-request-id` is billed.
- That Firecrawl's markdown keeps RBI's tables as rows and drops the menu (the trial's reading shows it).
- How many of the 8,261 are already live, and the hold counts on the current screen (T0).
- The chunk and cost figures are estimates; the per-credit price depends on the plan bought.
