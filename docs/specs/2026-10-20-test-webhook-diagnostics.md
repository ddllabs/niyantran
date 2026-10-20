# Test webhook rejection diagnostics

> **Status: Living.** Owner-approved diagnostics released to Test Preview at6100095; signed-delivery investigation remains open. Production/Live unchanged.

Question: which validation stage rejects real Razorpay Test deliveries? CDN logs prove requests reach api/router (streaming_func, WAF allow) with400; verified inbox is empty. Dashboard response is null, so exact reason is unknown. An unsigned probe reaches signature validation, which cannot prove the signed-delivery cause.

Add only fixed rejection categories in the existing billing API catch for the webhook route when server mode is test. Allowlisted stage names: raw_body, body_size, signature, json, merchant_payload, event_identity, configuration, processing. Log static event name plus stage/status only. Never log exception text, raw bytes, signatures, headers, configuration values, identifiers or buyer/provider data. Preserve response codes/bodies, raw-byte signature enforcement, merchant checks and capture/idempotency behavior. No schema, setting, secret, provider or payment mutations.

Acceptance: causal route tests for rejection stages, malicious/secret input exclusion and silence for Live mode and unrelated routes; focused/full app/Deno/lint/build/bundle/router checks. A Test deployment, once separately approved, observes existing automatic retries; no new purchase or forced replay needed. Code modification scope server/billingApi.mjs and src/lib/billingApi.test.js only; task records under docs. Do not claim a root cause until a signed delivery yields evidence.
