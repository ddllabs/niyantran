# F221: settle feed test producers before releasing fetch

> **Status: Living.** Scoped test-only implementation authorized October 17, 2026.

The timeout suite leaves real live loaders running after returning archived answers.
Their 12-second source timeout can trigger a PIB fallback against a later test's
fetch mock. The deterministic diagnosis is recorded in
`docs/research/2026-10-17-f221-test-isolation-diagnosis.md`.

Outcome: each test owns and drains its source requests and deferred live loaders
before restoring fetch or timers. Production late-answer reuse remains unchanged.
A real-loader regression must fail with the old teardown and pass with disposal,
including replacement-fetch counts of zero and one. Existing preferences tests
remain unchanged. Focused suites, full Vitest/Deno, lint, build, router import and
bundle checks must pass; publication uses genuine first-attempt CI evidence.

Code scope: `src/lib/featureFeedTimeLimit.test.js` only. Documentation scope:
this spec, its plan, diagnosis/evidence, cleanup evidence, sole open-work tracker
and coordination Operations. No runtime/configuration, backend, SQL, stored data,
corpus ingestion or payment changes. No local containers required.
