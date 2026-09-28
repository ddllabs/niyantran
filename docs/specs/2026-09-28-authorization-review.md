# Review: database functions and API routes

> **Status: Historical (2026-09-28).** Tasks B1 and B2 of
> `docs/plans/2026-09-28-remaining-work.md`. The repository is public: this
> record lists only findings that are fixed or accepted. The one hardening
> item reported to the owner separately (the unused `/api/auth/*` group) was
> removed from production the same day.

## B1. `SECURITY DEFINER` functions callable by `authenticated`

Read from the live NTER catalogue (`pg_proc`, `has_function_privilege`) on
2026-09-28. `anon` can execute none of them. Every one pins
`search_path = ''`.

| Function | What it touches | Verdict |
|---|---|---|
| `ai_health()` | Counts of `model_pricing` rows and enabled `ai_models`, whether `vector` is installed, and the caller's own `auth.uid()`. Called by the `health` Edge Function as the caller. | Harmless: no row data. |
| `get_my_profile()` | The caller's own `user_profiles` row (`user_id = auth.uid()`). | Own data only. |
| `is_org_member(uuid)` | Whether the caller is an active member of the given organisation. | Reveals only the caller's own membership. |
| `is_org_owner(uuid)` | The same, for the owner role. | Reveals only the caller's own role. |
| `is_platform_admin()` | Whether the caller is an active admin. | Own status only. |
| `update_my_onboarding_profile(...)` | The caller's own persona, practice area, jurisdiction, language and onboarding flag. Raises without `auth.uid()`. Cannot touch role, plan or status. | Own data only. |

No fix was needed, so there is no new SQL fixture.

### The security advisor, line by line

- **Signed-in users can execute a SECURITY DEFINER function** (6 warnings): the
  six functions above. All are intentional and checked above.
- **RLS enabled, no policy** (5 notices): `analytics_events`,
  `analytics_rate_windows`, `invoice_counters`, `nter_news_articles` and
  `research_turns`. Each is server-only by design: the table grants nothing to
  `anon` or `authenticated`, and only the service role (or a
  `SECURITY DEFINER` function it alone may execute) reads or writes it.
  `research_turns` is written and read only by the `research-chat` Edge
  Function with the service role.
- **Leaked password protection disabled** (1 warning): a dashboard setting.
  It is an owner action (plan D1).

## B2. Routes served by `api/router.js`

"Public" means no bearer is needed. "Account" means `authorizeLocalUser`:
a verified Supabase session whose profile is active. "Admin" means an account
that is also a platform admin.

| Route | Check | Notes |
|---|---|---|
| `GET /api/feature-feed`, `/api/constitutions`, `/api/growth`, `/api/ohlc` | Public | Read-only public datasets. |
| `GET /api/home/markets`, `/latest`, `/pulse`, `/segments` | Public | Read-only; the snapshot cache is outside `public/` (B3). |
| `GET/POST /api/home/refresh` | Public | Refetches the three home feeds; concurrent calls share one in-flight refresh. Accepted, low risk. |
| `/api/livetv/*` | Public | YouTube responses are cached per channel. |
| `POST /api/news/ingest` | Bearer `NTER_TERMINAL_API_KEY` | Constant-time comparison; see T6. |
| `/api/users`, `/api/users/:id` | Admin | |
| `/api/auth/*` | **Removed from production** (owner decision, 2026-09-28) | The app never called it; it signs in through Supabase Auth directly. The Vite dev server still mounts `server/authApi.mjs` locally. |
| `/api/marketing/intro-video` | GET public; writes Admin | |
| `/api/analytics/event` | Public, rate-limited by hashed IP (60 a minute) | Reads (`/events`, `/summary`) are Admin. |
| `/api/user-prefs` | Account | Rows keyed by the verified user id; a mismatched `email` is refused. |
| `/api/billing/*` | Account for orders, verification and invoices | Invoices are read under RLS as the caller (T5). The demo invoice POST is refused in production. |
| `/api/air`, `/ships`, `/ais`, `/vessels` | Public | The AIS key stays server-side; responses are cached. |
| `/api/opensanctions`, `/api/fts`, `/api/portwatch`, `/api/launches`, `/api/celestrak`, `/api/wb-projects` | Public | Fixed upstream hosts. |
| `POST /api/ai/chat` | Bearer, forwarded to `research-chat`, which verifies it | |
| `GET /api/ai/desk-brief` | Public | Returns only a cached brief for an exact fingerprint. |
| `POST /api/ai/desk-brief` | Bearer, forwarded and verified | |
| `GET /api/ai/source-extract` | **Account (new)** | See the fixed finding below. |
| `GET /api/ai/fetch` | **Removed** | No caller. |

### Fixed on 2026-09-28: source fetching could reach internal addresses

`/api/ai/source-extract` and `/api/ai/fetch` fetched a caller-supplied URL for
anyone, with no host restriction, and followed redirects automatically. Now:

- `/api/ai/fetch` is gone, and `/api/ai/source-extract` requires an account.
  The browser callers (`src/lib/sourceDoc.js`, `src/lib/aiDrop.js`) send the
  bearer.
- `server/sourceExtract.mjs` resolves the host of every hop, the first
  request and each redirect (followed by hand, at most five), and refuses
  unless every address is public. Loopback, private, carrier-grade NAT,
  link-local (cloud metadata), multicast, reserved, documentation,
  IPv4-mapped and unique-local IPv6 ranges are refused, as are URLs with
  credentials and bodies over 10 MB (by `Content-Length` before reading).
- A residual risk remains: DNS can change between the check and the connect
  (rebinding). It now needs a signed-in account, and closing it fully would
  mean pinning the resolved address in the HTTP client.

Evidence: `src/lib/sourceFetchGuard.test.js` (31 cases) and
`src/lib/aiRoutesAuth.test.js` both failed against the previous code. The
real guard refused this machine's own dev server on `127.0.0.1` and
`localhost`.
