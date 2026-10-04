# F74 dictation production activation

> **Status: Historical (dated 2026-10-04).** Owner authorized: “Activate everything and push.”

## Released
Pushed verified F75 commits d352997 and f346ab8 to origin/main. Vercel production dpl_Ct5ySu6QevXSLXX4xqeXeoxC9Gug is READY at f346ab8; alias niyantran-six.vercel.app resolves to it. Served entry /assets/index-h6720-5o.js.
Deployed only transcribe-audio using `supabase functions deploy transcribe-audio --use-api --project-ref vfgcppstyzjarlzyqdac` from main. Function version 1, ACTIVE, verify_jwt=false (handler verifies bearer and active profile). Existing OPENROUTER_API_KEY name verified present through secrets list, without displaying values or changing secrets. No schema, other functions or provider chat changes.

## Verification
Prior unchanged release checks: 2,100 Vitest and 862 Deno tests, lint, production build and function compilation passed; existing build warnings remain (F75 record).
Live unauthenticated POST returned 401 missing bearer token; allowed-origin preflight returned 204. Vercel alias/deployment checked via connector.
Direct OpenRouter provider probes used the same fixed multipart URL/model/response_format as the handler, an existing local server credential and synthetic WAV audio. Valid English (3.59s) and Hindi (3.45s) both returned 200 and nonempty transcripts. English recognized the sentence but rendered “bill” as “pill”; this is smoke evidence, not an accuracy guarantee. First English voice produced a WAV with zero audio bytes and returned provider 400; repeating with an installed voice and nonempty audio passed. No user audio, credentials or provider keys are recorded here.
These probes verify the provider contract separately from the deployed function's auth/CORS. No signed-in browser microphone or authenticated full-path transcript was exercised; F76 tracks that acceptance check. No claim of full-path production verification or Safari microphone quality is made.

## Recovery
For a dictation-specific failure, restore the frontend to f977de9 (microphone remains but unavailable endpoint is actionable), or disable the dictation endpoint pending repair; do not change other AI functions. Production rollback remains owner-authorized. No database rollback is needed.
