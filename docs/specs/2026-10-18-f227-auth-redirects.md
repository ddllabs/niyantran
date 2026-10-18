# F227: tighten Auth return destinations

> **Status: Living.** Owner approved the scoped cleanup2026-10-18.

## Current state and problem

NTER vfgcppstyzjarlzyqdac Site URL is https://www.nter.pro/. Dashboard lists10
redirect entries, including an all-Vercel wildcard and a malformed double-scheme
entry. Google OAuth requests the browser origin with trailing slash; recovery
requests origin/#/reset-password; signup/resend use the Site URL default. The
project-scoped preview pattern and localhost5173 entries already exist.
The asset is the authentication return destination; the trust boundary is an
untrusted redirect_to value. Remove unnecessary cross-site destinations while
preserving existing owned-host and development flows.

## Approved configuration scope

Only NTER Authentication URL Configuration redirect list:
- Remove https://*.vercel.app/**.
- Remove https://https://niyantran-six.vercel.app/**.
- Replace https://niyantran-six.vercel.app with its exact trailing-slash root.
- Add https://niyantran-six.vercel.app/#/reset-password explicitly.
- Preserve four exact nter.pro entries, two localhost entries and the existing
  https://niyantran-*-ddl-labs.vercel.app/** preview pattern.

Expected final9 entries. Site URL unchanged. No source, Google provider/Cloud
Console, CORS, DNS, schema, Edge Function, account, payment, feed or corpus edit.
URL fragments are client routing: acceptance must check the server's actual
redirect behavior, rather than infer a distinct server path from a fragment.

## Acceptance evidence

Save additions first, then removals; inspect saved9-entry inventory after reload.
If a safe invalid-token Auth error callback can verify target selection without
credentials, email or account changes, test approved production/retained/local/
preview destinations and unrelated/lookalike destinations. Do not follow unsafe
redirects or disclose tokens. This is redirect validation, not successful login.
Owner completes real Google sign-in and recovery/reset/sign-in after cleanup;
no password or recovery link is handled here. Keep F227 acceptance pending if
that owner evidence is missing. No paid model call or signup test.

## Recovery and limits

Retain exact pre-change URL inventory as evidence. Do not restore all-Vercel
access automatically: investigate any regression and prefer the exact missing
owned destination. Expanding Auth access needs separate approval. Preserve
scheduled M1/M2 read-only monitor and payment/corpus holds.
