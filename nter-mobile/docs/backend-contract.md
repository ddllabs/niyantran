# Backend contract

The app has no backend of its own. It is a client of the same services nter.pro uses, read from
the website's code (`ddllabs/niyantran`) on 26 Oct 2026. Nothing here needs a server secret: the
app ships only the Supabase **publishable** key, which the website ships too.

| Piece | Value |
| --- | --- |
| Supabase project | NTER · `vfgcppstyzjarlzyqdac` · `https://vfgcppstyzjarlzyqdac.supabase.co` |
| Publishable key | `sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I` (public by design) |
| Public API | `https://www.nter.pro/api/*` (no sign-in, no CORS headers) |
| Edge functions | `research-chat`, `desk-brief` (member's JWT as `Authorization: Bearer`, plus `apikey`) |

The app code lives in `src/services/live.js`; `src/services/sample.js` implements the same calls
against the bundled snapshot.

## Accounts

Same Supabase Auth users as the website.

- **Sign in** `auth.signInWithPassword({email, password})`, then `rpc('get_my_profile')`; an account whose `status` is not `active` is signed out again.
- **Create account** `auth.signUp({email, password, options: {data: {name, first_name, last_name, personaId, plan: 'free'}}})`. With email confirmation on there is no session until the link is opened; resend with `auth.resend({type: 'signup', email})` (60-second cooldown in the app).
- **Forgot password** `auth.resetPasswordForEmail(email, {redirectTo: 'https://www.nter.pro/#reset-password'})` — the new password is chosen on the website.
- **Google** `auth.signInWithOAuth({provider: 'google', options: {redirectTo: 'pro.nter.app://auth/callback', skipBrowserRedirect: true}})`, opened in the in-app browser; the app exchanges the returned `code` with `auth.exchangeCodeForSession`. Needs the redirect URL added in Supabase (see `owner-actions.md`).
- **Perspective** `from('user_profiles').update({persona}).eq('user_id', uid)` with one of `policy_analyst, journalist, upsc_aspirant, corporate_affairs, legal_researcher, academic` (the website also avoids `update_my_onboarding_profile`, which blanks other fields).
- **Sign out** `auth.signOut({scope: 'local'})`.

## Plan, credits, models

- `rpc('my_entitlement_manual')` → `{plan, status, period_end, lapsed, access_until, grace_until, …}`. The effective plan is Free unless the plan is active, not lapsed and before its access deadline (`effectivePlan` in `src/services/shape.js`).
- `rpc('my_credits_cycle_v3')` → `{balance, held, plan, cycle: {allowance, starts_at, ends_at}, used_this_cycle, recent}`; available = balance − held; low at ≤ 2,000 or ≤ 10 % of the allowance.
- `from('ai_models').select('model_id,label,vendor,tier,efforts,params,is_default,sort_order,min_plan').eq('enabled', true)` and `rpc('model_credit_estimates')` → `[{model_id, credits}]`. Plan ranks free 0 · plus 1 · pro 2 · max 3; a missing `min_plan` counts as Plus. The server enforces it too (403 `model_requires_plan`).
- Plans: Free ₹0 (10,000 credits to start, 30 days), Plus ₹399 (20,000/month), Pro ₹999 (65,000/month), Max ₹9,999 (750,000/month). Bought on the website (Razorpay).

## News, markets, desks (public)

| Call | Returns |
| --- | --- |
| `GET /api/home/latest?limit=24` | `{ok, rows: [{id, title, link, img, category, dek, pub, published_at, author, source}]}` — nter.news stories |
| `GET /api/home/markets` | `{ok, rows: [{name, symbol, last, d1, dM, spark, asOf}]}` |
| `GET /api/site-figures` | `{bills, documents, ministries, fronts}` for the landing page |
| `GET /api/feature-feed?tier=&feature=` | `{ok, tier, feature, rows, source, coverage, …}`; rows with `status: 'source_status'` are notes, not records |
| … paged modules add `page, pageSize (50/100/200), q, sort, dir` | `{paged, page, pageSize, total, columns, filterGroups, rows}` — Bill Passage Probability Index, Parliamentary Question Database, NCLT / NCLAT (Insolvency) |
| `rpc('search_desk_rows', {p_tier, p_feature: null, p_query, p_filters: {}, p_limit})` | `[{tier, feature, row_key, row}]` — record search, one call per desk |

Desk ids vs module tiers: `global → geopolitics`, `law → judiciary`, `economics → finance`, `carbon → climate`; the rest match. `feature-feed` takes the module tier; `search_desk_rows`, `desk_context` and `selection` take the desk id. The desk catalogue (`src/sample/desks.json`) is generated from the website's own presentation files by `scripts/export-sample.mjs`.

When `feature-feed` fails, the app shows the module's saved rows and says so (the website does the same with its archive).

## Record brief (the desk card)

`POST functions/v1/desk-brief` with `{scope: 'record', tier, feature, row, mode?: 'read'}`. The row
is sent exactly as the website sends it (`recordPayloadRow` in `src/services/live.js`, from the
website's `src/lib/deskBrief.js`): whole when its JSON is ≤ 30,000 bytes, else 40 fields of ≤ 220
characters. The server hashes what it is sent, so the same row from the app and from the website
reads the same stored brief.

- `mode: 'read'` only looks: `{state: 'ready' | 'pending' | 'missing' | 'failed' | 'unavailable', …}`.
- Without `mode` the function claims and writes the brief (paid by the platform, not the member).
- Ready, format 2: `{format, brief, why, watch, tags, model, writtenAt}`; older format 1: `{headline, points[]}`.
- Flow (`src/deskcard/useDeskBrief.js`, the website's `useRecordBrief`): read; on `missing` write
  once; on `pending` read again every 2 s for up to 60 s; show the result after the 2.5 s NTER
  animation; keep it for the session. Signed-out readers are not sent to the function.

## Analysis packs for desk cards

The bill, question, pipeline and regulatory cards add the website's analysis packs, read from
www.nter.pro like the website reads them (phone apps directly; browsers through the `/data` proxy
or rewrite):

| Request | Used by |
| --- | --- |
| `GET /data/embedded_json/national_bill_analysis.json` (+ `_identity.json`) | Bill Passage Probability Index (base rate, precedent, days in stage, summary, key changes, PDF) |
| `GET /data/embedded_json/national_question_database_analysis.json` | Parliamentary Question Database |
| `GET /data/embedded_json/national_policy_pipeline_analysis.json` | Policy Pipeline Tracker |
| `GET /data/embedded_json/national_regulatory_watch_analysis.json`, `GET /data/ontology.json` | Regulatory Body Watch (and the bill PDF link) |

They are fetched once per app session and only when such a card is opened (the bill pack is about
10 MB). Without them the card still shows everything from the row.

## Research chat

`POST functions/v1/research-chat`, `Accept: text/event-stream`.

```json
{
  "conversation_id": "optional uuid",
  "message": "≤ 4,000 characters",
  "turn_key": "≤ 64, unique per turn",
  "model": "model_id",
  "reasoning": "off | minimal | low | medium | high | xhigh | max",
  "focus": "attached | selection | desk | broad",
  "attachments": [{"kind": "row | record | file", "title": "…", "text": "≤ 40,000", "tier": "desk id", "feature": "…"}],
  "desk_context": {"tier": "desk id", "feature": "optional"},
  "web_search": true
}
```

Up to 12 attachments; a row's text is at most 64 fields of ≤ 500 characters (`recordAttachment`).

Frames (`data: {…}`), in order: `conversation{id}`, `duplicate`, `reasoning` (text), `web`, `webProgress{pages}`, `tool{name, phase, step, …}`, `chunk` (text), `patch{from, text}`, `model`, `sources[]` (citations: `{id, kind: 'row', tier, feature, row_key, title, row_snapshot}` or `{id, kind: 'text', document_id, title, file_name, page_number, …}`), `webSources[]`, `followUpQuestions[]`, `truncated{reason}`, `notice`, `timing` + `usage`, `saveFailed`, `error` + `code`, `done{message_id}`, then one `{credits: n}`, then `[DONE]`. Answers mark citations as `[1]`, `[2, 3]`, `[4-6]` (ids ≤ 99, ranges ≤ 5) — the same grammar as the website's `citationMarkers.js`.

Refusals before the stream: 402 (no credits; `held: true` when credits are held by a running answer), 403 `model_requires_plan`, 503 `credits_unavailable`.

Stop: upsert `chat_cancellations {conversation_id, user_id, cancel_requested_at}` on `conversation_id`.

Conversations (own rows only, by row-level security):

- list `from('conversations').select('id,title,created_at,last_message_at,web_search').eq('user_id', uid).order('last_message_at', {ascending: false, nullsFirst: false}).limit(40)`
- messages `from('chat_messages').select('id, role, content, sources, web_sources, follow_ups, activity, timing, model_requested, model_served, reasoning_effort, status, error_message, execution_expires_at, turn_key, created_at')` — a `running` message past `execution_expires_at` is shown as interrupted
- rename (≤ 80 characters) and delete on `conversations`

### Streaming on a phone

The app sends everything through Capacitor's native HTTP, so no CORS change is needed. Native HTTP returns the event stream whole, at the end of the answer; the app then replays the frames. To show answers word by word on a phone, add the app's origins to the function's `ALLOWED_ORIGINS` and build with `VITE_STREAM_CHAT=1` (see `owner-actions.md`).

## Watchlist

`user_preferences(user_id, watchlist jsonb, tours jsonb)`, own row only. Watchlist = up to 24 `{tab, feature, label}`; default Open Fronts (global), Bill Passage (national), Markets (economics). Upsert on `user_id`.

## Kept on the phone only

Pinned records, Studio documents, the writing profile and the theme are stored with Capacitor Preferences (localStorage on the web). There is no server table for them yet.

## Quick Exit

The catalogue (6 perspectives × 5 buckets, 94 documents) ships with the app (`src/data/quickExitData.js`). Making a document sends one research-chat turn: the record as a `row` attachment, `focus: 'attached'`, and an instruction built from the document's block specification (`makeInstruction`, always ≤ 4,000 characters). It costs credits like a question. PDF and Word are made on the phone (pdf-lib with Inter, docx).
