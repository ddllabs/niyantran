# Web search: one stream, live sources and site icons (F131)

> **Status: Living.** Owner request 2026-10-13, after using F130 web search
> on production. Follows [web search](2026-10-13-web-search.md) (F130). Branch
> `task/web-search`, worktree `.claude/worktrees/web-search`. Awaiting the
> owner's approval; no code until then.

## Objective

On a turn that searches the web, the reader sees the answer written once,
below a live view of the search, with the sources at the top of the answer
as real site icons.

The owner's report, in order:

1. The question is sent; the thinking notes open with the tool activity.
2. The answer starts to stream.
3. Near the end, the view jumps back to the thinking notes and the answer
   disappears.
4. The answer streams again from the start. The sources appear only at the
   very end, as a plain row under the answer.

The owner asked for:

- **one stream**: the double stream goes away;
- **search progress while it happens**: "searched the web, N sources";
- **a modern source strip at the top of the answer**, like Perplexity or
  Google's AI answers: overlapping round site icons, **at least four shown**,
  then "+N";
- **real site icons**, fetched through our own server via DuckDuckGo's icon
  service (owner decision, 2026-10-13);
- **continuity**: the thinking notes, the search and the answer read as one
  flow that only grows downward.

## Owner decisions (2026-10-13)

1. **Stay on OpenRouter's server web-search tool.** Search terms are not
   shown, because OpenRouter does not send them (Probe 3). Switching to our own
   Exa tool, which would show them, is deferred.
2. **Real site icons through our server via DuckDuckGo.** The reader's
   browser asks only our server. Our server asks DuckDuckGo for the domain's
   icon and caches it. If there is no icon, the circle shows the domain's
   first letter.
3. **Four icons, then "+N".**
4. F130's decisions stand: automatic per record, the globe overrides both
   ways, at most 3 searches per turn, web sources labelled unofficial and kept
   apart from record citations.

## Current state (code reading and Probe 3)

### Why the answer streams twice (code reading)

- A research call streams any text it writes to the reader as a draft
  (`agent.ts:726`, `draftText`).
- A research call that searched the web is never accepted as the answer
  (`agent.ts:787`). F130's probes showed such a call drops the strict answer
  schema, so the answer phase must write the cited answer again.
- The draft is therefore taken back (`retract('rewriting')`). The handler
  clears the reader's text with `patch {from: 0, text: ''}`
  (`handler.ts:796`), and the answer phase streams the final answer.
- On the client, the cleared text removes the answer block. Only the open
  thinking notes are left, so the view jumps up (`AiPanel.jsx:1036`). The new
  answer then streams in its place.
- `webSources` arrive only in the terminal frame, and the saved message
  draws them under the answer (`MessageRow.jsx:35`).

Every web turn therefore shows a draft that is always thrown away.

### Probe 3 (executed 2026-10-13, about $0.13)

- **Setup.** Script: the session scratchpad `web-probe-3.mjs`, not committed.
  It sent research-chat's research-call shape with `openrouter:web_search`
  (Exa, `max_uses: 3`), streamed, to `google/gemini-3.8-flash`,
  `anthropic/claude-sonnet-5` and `deepseek/deepseek-v4-flash`. It recorded
  every JSON key path, every field named for search, query or server, and the
  arrival times.
- **No search terms anywhere.** Across the three models, the only
  search-related field was `usage.server_tool_use_details` (counts). OpenRouter's
  web-search docs name no field that carries the query. A model's free-text
  reasoning sometimes says what it will search: DeepSeek did once, Gemini's
  reasoning was mostly encrypted, and Claude's did not. That is not a reliable
  source and is not shown.
- **Pages arrive live, per search.** `url_citation` annotations come in a
  burst as each search finishes, seconds apart, long before the call ends:
  - Gemini: bursts at 7.1 s, 15.6 s and 21.4 s; the call ended at 33.9 s.
  - DeepSeek: bursts at 5.4 s, 9.8 s and 13.3 s; the call ended at 21.4 s.
  - Claude: bursts at 4.3 s and 15.0 s; the call ended at 24.0 s.

  Today `openrouterStream.ts:317` holds every page until the call finishes.
- **The reported count overstates.** Gemini and DeepSeek each reported
  `web_search_requests: 4` with `max_uses: 3`: the 4th attempt was refused at
  the limit. All three were billed exactly 3 searches:
  `cost − upstream_inference_cost` = $0.021 = 3 × $0.007. F130 logs and
  charges the reported 4, so `model_call_logs.web_search_count` can overstate
  executed searches by one.

### DuckDuckGo icon service (executed 2026-10-13)

`https://icons.duckduckgo.com/ip3/<domain>.ico`:

| Domain | Result |
|---|---|
| reuters.com | 200 `image/x-icon` |
| pib.gov.in | 200 `image/jpeg` |
| sansad.in | 200 `image/png` (31 KB) |
| prsindia.org | 200 `image/x-icon` |
| livemint.com | 200 `image/png` |
| economictimes.indiatimes.com | 200 `image/vnd.microsoft.icon` |
| en.wikipedia.org | 200 `image/vnd.microsoft.icon` |
| rbi.org.in, www.rbi.org.in | 404 with a 1.5 KB grey placeholder PNG |
| egazette.gov.in | 404 with a 1.5 KB grey placeholder PNG |
| an unregistered domain | 404 with a 1.5 KB grey placeholder PNG |

A 404 means no icon; the circle shows the domain's first letter instead.

## Design

### 1. One stream (`research-chat/agent.ts`, `handler.ts`)

A research call that is offered the web tool **holds its draft text instead
of streaming it**.

- **Searched or rewritten.** If the call searched, or its draft is otherwise
  not the answer, the held text is dropped. Nothing was sent, so no retract
  frame is sent and the reader's view never empties.
- **Promoted.** If the call did not search and its draft is promoted as the
  answer, the held text is sent once as answer text, then `promoted`, as today.
- **While held,** the ticker shows its stage line ("Reading the web results"),
  and the source strip (§2) fills live.
- **Unchanged.**
  - Research calls not offered the web tool still stream their drafts and
    retract them as today. Holding those too is an open question below.
  - The answer phase still streams the final answer once, as today.

Cost: on a web turn the first answer words appear later, after the research
call ends instead of during it. The draft streamed during that wait was always
discarded, so the reader loses nothing they could keep.

### 2. Live sources (`openrouterStream.ts`, `agent.ts`, `handler.ts`, `chatStream.ts`)

- **Stream.** `openrouterStream` yields a display-only
  `{ type: 'web-progress', pages }` event as annotations arrive. The existing
  `web-results` event at the end is unchanged: it is still the only thing that
  is carried forward to the answer call, counted or charged. The F130 rule
  stands: a call that breaks off contributes nothing.
- **Agent.** The agent forwards `web-progress` only from a call offered the
  tool (security pass I3).
- **Handler.** The handler sends a `webProgress { pages: [{url, title,
  domain}] }` frame. URLs pass `normaliseUrl`, so only https, without
  credentials or fragments. Titles are trimmed. Excerpts are never sent.
- **Client.** The client merges these pages by URL into `stream.webLive`.
  The terminal `webSources` frame replaces them as the authoritative list. A
  retried call's pages may show briefly and then drop out at the terminal
  frame; that is accepted.
- **Search count.**
  - **While searching**, the strip shows the number of pages found so far,
    not searches, because pages are what is known exactly.
  - **When the call ends,** the existing `web` step gives the search count:
    "Searched the web 3 times · 15 pages".
- **The count is capped at the offered `max_uses`**, which fixes the Probe 3
  overstatement. This applies to the trace row, `model_call_logs.web_search_count`,
  the budget charge and the cost fallback. When the cost split is positive,
  the cost is still `cost − upstream_inference_cost`.

### 3. The source strip (`src/ai/WebSourceStrip.jsx`, new)

One strip at the top of the answer, between the thinking notes and the answer
text. The live turn and saved messages render the same component, so a turn
looks the same before and after it is saved.

```
 (◉)(◉)(◉)(◉) +11   From the web · unofficial · 15 sources        ›
```

**Contents**

- **Icons.** Up to **four** overlapping 20 px circles, one per distinct
  domain, cited pages first. They overlap by about a third, each with a 2 px
  ring in the panel's surface colour.
- **"+N"** is a fifth circle of the same size: the count of the remaining
  distinct domains. It is shown only when there are more than four.
- **Label.** "From the web · unofficial" (F130 decision 5), then
  "N sources". While searching: a pulsing globe, "Searching the web…" and
  "N pages so far".
- **Opening the list.** The whole strip is one button. It opens the existing
  web-sources panel (`WorkSurface`, "Close web sources"), where each entry now
  also shows its site icon.

**Placement and continuity**

- **Live turn.** The strip appears with the first page found, above where
  the answer will be written. The thinking notes stay above it and are
  unchanged.
- **Saved turn.** `MessageRow` renders the strip in the same place, at the
  top, and the "From the web" row under the answer (`WebSourceRow`) is
  removed. The document `SourceList` stays under the answer.

**Accessibility**

- **Name.** The button's accessible name lists the count and the first
  domains ("From the web, unofficial: 15 sources (reuters.com, pib.gov.in,
  …). Open the list").
- **Images.** Icons are decorative (`alt=""`).
- **Motion.** The pulse respects `prefers-reduced-motion`.

**Inline web links.** A markdown link in the answer to a page in the turn's
web sources gets a small site icon in place of today's globe mark.

**Icon fallback.** On an image error or a 404, the circle shows the domain's
first letter on a neutral tint. It never shows the broken-image glyph.

### 4. Icon endpoint (`server/siteIconApi.mjs`, new; `api/router.js`; `vite.config.js`)

`GET /api/site-icon?domain=<host>`. The endpoint is public, because image
requests carry no token, and returns only a DuckDuckGo icon.

**Validation**

- **Format.** The host is lowercase, at most 253 characters, with two or more
  dot-separated labels of `a-z`, `0-9` and `-` (punycode `xn--` allowed).
- **Refused hosts.** IP literals, `localhost` and `.local`, `.internal`,
  `.test` and `.localhost` names are refused with 400.
- **Fixed upstream.** The upstream is always
  `https://icons.duckduckgo.com/ip3/<host>.ico`. The reader's input is never
  used as a URL, so the server cannot be pointed at internal hosts.

**Fetch**

- **Limits.** Timeout 4 s; body at most 100 KB.
- **Types.** Accepted types are `image/x-icon`, `image/vnd.microsoft.icon`,
  `image/png`, `image/jpeg`, `image/gif` and `image/webp`. SVG is refused,
  since it can carry script when opened directly.
- **Failure.** An upstream non-200, a timeout or a refused type gives 404
  with no body.

**Response**

- **Body.** The image bytes with the upstream type.
- **Headers.** `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'`.
- **Caching.** `Cache-Control: public, max-age=86400, s-maxage=604800`, so the
  Vercel CDN answers repeat requests. A 404 is cached for a day.

**Client.** `siteIconUrl(domain)` in `src/ai/WebSourcesList.jsx` builds the
URL. Images use `loading="lazy"` and `referrerpolicy="no-referrer"`.

**Privacy.** No user data leaves our server. DuckDuckGo receives only domain
names, from our server's address and not the reader's. A privacy-policy line
is an open question below.

### 5. Telemetry

No schema change.

- `model_call_logs.web_search_count` and the `web_search` trace rows record
  the capped count (§2).
- The display-only `webProgress` frames are not logged.

## Acceptance evidence

1. **Agent tests** (`deno test`):
   - A web-offered research call that searches sends no `draftText` and no
     `retract`. The answer text is sent once.
   - A web-offered call that does not search and is promoted sends its text
     once, before `promoted`.
   - A call not offered the tool still streams and retracts as before.
   - Each guard is proved by mutation: revert the hold, and the test fails.
2. **Stream tests.** `web-progress` is yielded per annotation burst, from
   the Probe 3 Gemini burst timings as a trimmed fixture. `web-results` is
   still yielded once, at the end, and never for a call that breaks off.
3. **Count cap.** With the Probe 3 Gemini fixture (`web_search_requests` 4,
   `max_uses` 3), the count is 3. The cost is $0.021 from the split, or
   3 × $0.007 when there is no split.
4. **Handler tests.**
   - `webProgress` frames carry only `url`, `title` and `domain`.
   - A non-https page is dropped.
   - Pages from a call not offered the tool are never sent.
5. **Client tests** (Vitest):
   - The strip shows four icons and "+N" for more than four domains. It
     shows no "+N" for four or fewer.
   - The strip orders cited pages first.
   - A failed icon falls back to a letter.
   - The live strip updates from `webProgress` frames, and the terminal
     `webSources` replaces it.
   - A saved message renders the strip above the answer and no row below it.
6. **Icon endpoint tests**:
   - Refusals: an IP literal, `localhost`, uppercase, a 254-character host
     and a path in the domain each give 400.
   - Upstream outcomes, with a stubbed upstream: SVG → 404, 404 → 404,
     a body over 100 KB → 404, a timeout → 404.
   - On success, the response carries the cache headers.
7. **Checks.** Lint 0, build 0, both test suites, and the router import
   check (this changes `api/` and `server/`).
8. **Local run** in the browser pane, against the local stack with a real
   web turn:
   - the answer streams once;
   - the strip fills live before the answer starts;
   - icons load through `/api/site-icon`;
   - the saved turn looks the same after reload.

   Screenshots go to the owner.

## Scope

- **In scope**
  - `supabase/functions/_shared/openrouterStream.ts`, `webSearch.ts`,
    `chatStream.ts`
  - `supabase/functions/research-chat/agent.ts`, `handler.ts`
  - their tests and a trimmed Probe 3 fixture
  - `src/lib/researchChat.js`, `src/ai/useResearchThread.js`,
    `src/ai/AiPanel.jsx` (live turn), `src/ai/MessageRow.jsx`
  - new `src/ai/WebSourceStrip.jsx`
  - `src/ai/WebSourcesList.jsx`, `src/ai/AiMarkdown.jsx` (inline icon)
  - CSS in `src/index.css`
  - `WebSourceRow.jsx` removed with its tests
  - new `server/siteIconApi.mjs`, `api/router.js`, `vite.config.js`
  - docs: this spec, a plan, `open-work.md`, `coordination.md`
- **Production steps (each needs the owner's go-ahead naming it):**
  - redeploy `research-chat`;
  - push to `origin/main`, which deploys the website and the icon endpoint.

  No migration.
- **Out of scope**
  - **Showing search terms.** That needs our own Exa tool (decision 1).
  - **Holding drafts on turns without web search.** That is an open
    question.
  - **Favicons from the sites themselves**, as opposed to DuckDuckGo.
  - **Any change to when web search is offered.**

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The first words arrive later on web turns | The reader waits longer for text | The ticker and the live strip show progress throughout. The discarded draft gave nothing lasting |
| The icon endpoint is used as a free DuckDuckGo proxy | Function invocations | The upstream is fixed, responses are small, and the CDN caches for a week. Accepted |
| DuckDuckGo changes or blocks the icon URL | Letters instead of icons | The fallback is built in; nothing breaks |
| A retried call's live pages appear and then drop out | A brief inconsistency | The terminal `webSources` frame is authoritative. Accepted |
| Some Indian government sites have no DuckDuckGo icon (rbi.org.in, egazette.gov.in) | Letter circles for them | Accepted. Fetching the site's own favicon is out of scope |

## Open questions (owner)

1. **Hold drafts on all turns?** The same jump happens, less often, on turns
   without web search, when the model writes text and then decides to search
   records. Holding every research draft removes the jump everywhere. The
   cost is that answers which today stream straight from the research call
   would then appear in one go at its end. Recommendation: web turns now as
   specified; measure how often the other retracts happen from the
   `research.draft_retracted` logs; decide after.
2. **Privacy policy.** DuckDuckGo receives only domain names, from our
   server, with no reader data, so no policy change is strictly needed.
   Recommendation: add half a sentence to the existing web-search bullet for
   completeness ("site icons are fetched by our server from DuckDuckGo").
