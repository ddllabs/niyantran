# Personal-data inventory for the privacy policy

> **Status: Historical (dated 2026-10-12).** Read-only code inventory on
> `main` at `b36ade0`, for F107. It reads the repository, not the live
> systems; items under "Unknown" need a live check or an owner answer.

## Collected from users

- **Signup (email):** full name, email, password (sent from the browser
  straight to Supabase Auth, which hashes it), persona. `SignupPage.jsx`.
- **Google sign-in:** Supabase stores the Google identity (typically name,
  email, avatar); the profile copies only first/last name, language, persona
  and plan from metadata (`handle_new_user`).
- **Profile (`user_profiles`):** email (plus a normalised copy), first/last
  name, persona, language, role, plan fields, trial date, status. The schema
  also has phone, department, practice area and jurisdiction; no UI collects
  a phone number.
- **Preferences:** watchlist and tour state.
- **Analytics:** event name, small properties (including persona
  questionnaire answers), session id, user id when signed in; no email, no
  IP stored. IPs are HMAC-hashed only for rate limiting. Events kept 180 days;
  rate windows 1 hour.
- **AI chat:** conversation titles; full user and assistant message text,
  sources, models, token usage and cost; model call logs; search-query traces
  (first 2,000 characters). No retention limit.
- **Attachments:** read in the browser; only extracted text is sent with the
  question to the model provider; not stored on the server. Browser keeps
  attachment chips locally.
- **Dictation:** audio (up to 8 MB) is transcribed through OpenRouter
  (Whisper); not stored.
- **Billing:** invoice rows keep email, buyer name/GSTIN/state/address,
  amounts and Razorpay ids; they outlive account deletion.
- **Browser storage:** Supabase session token in `localStorage`; app state
  in `localStorage`/`sessionStorage` (persona, watchlist, AI panel state,
  layout, caches). The app sets no cookies of its own.

## Where data goes

- **Supabase** (auth, database, storage, functions; Mumbai `ap-south-1` per
  a dated snapshot).
- **OpenRouter** for chat, embeddings of questions and dictation; prompts
  include persona, recent history, the question and attachment text. The
  upstream model providers depend on the enabled models. No zero-retention
  setting is configured.
- **Razorpay** at checkout: name and email prefilled; order notes carry user
  id, email and plan.
- **Supabase Auth emails** (built-in sender in production).
- **Vercel** hosting. **Google** for sign-in and web fonts.
- **Embedded third-party content:** YouTube (privacy-enhanced embeds),
  Vimeo/YouTube intro video, map tiles (OpenStreetMap, ArcGIS), Unsplash
  images, Wikidata. Optional GA/GTM injection exists but is not active for
  visitors.
- **Mistral OCR** for admin-uploaded public documents only.

## Rights and retention gaps

- No self-service account deletion or data export; deletion is a dashboard
  action. Deleting a conversation removes its messages but leaves model call
  logs and traces.
- No consent or terms acknowledgement at signup; a consent table exists but
  is unused.

## Billing facts that conflict with the owner's plans

- Code plans are Explorer $0, Professional $49/$41, Enterprise $149/$124,
  Government custom (USD), charged as USD × 83 plus 18% GST. Owner plans are
  Free/Plus ₹399/Pro ₹999/Max ₹9,999 on credits, not GST-registered.
- A yearly purchase appears to charge one month's yearly rate for a year's
  access (`server/gstBilling.mjs`, `grant_paid_plan`).
- No AI credits, quotas or caps exist; costs are only logged.
- A 14-day trial is offered from the Upgrade modal.

## Legal pages

Admin edits to Privacy, Terms, Pricing and site settings are saved only in
the editing browser, while the admin screen says they were published.
Visitors see the defaults in code. The default privacy text claims IP
collection and lacks DPDP, grievance and processor details.

## Unknown

Live Supabase region and log retention; Vercel region and log retention;
enabled chat models and OpenRouter data settings; custom SMTP; live password
policy; whether Razorpay keys or a GSTIN are configured; whether the
analytics purge jobs are scheduled live; Google identity fields stored.
