# Manual renewal and access-only grace verification

> **Status: Living.** Verified Test release2026-10-21; decline/refund owner
> handoffs remain open. Production checkout and Live keys unchanged.

## Result and scope

Manual checkout remains the release path. Eligible captured paid periods retain
model eligibility for48 elapsed hours after original expiry, without issuing
credits or extending financial/credit expiry. Any paid renewal during grace
charges its full monthly price and keeps the original monthly anchor. Explicit
Free applies at expiry (or immediately during grace); failed signup/upgrade does
not create a new grace clock. AutoPay integration remains deferred.

Eight new scoped SQL functions preserve existing financial functions. A narrow
trigger rejects cancellation/replacement of an already-effective pending Free
instruction across retained old writers; pre-expiry cancellation and paid
fulfilment remain possible. The owner-authenticated v3 credit reader reports
actual prorated cycle allocations. Caller contracts are versioned; v1/v2 capture
recovery remains supported alongside v3.

## Executed verification

- `npm test`:6522/6522 checks,421 files, all passed in the assembled root.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1174 passed,0 failed.
- `npm run test:sql`:53 fixtures and53 omission-vacuity checks passed on local
  disposable Postgres. Concurrent grace renewals demonstrated real profile-lock
  contention, one allocation/invoice and one review outcome.
- `npm run lint`, `npm run build`, `npm run check:bundle`, router import and
  `git diff --check`:passed. No standalone type-check exists.
- Regression evidence: missing grace access, missing v3 allocation reader,
  retained-v2 late Free cancellation, invalid deadlines, transient boundary-read
  failure, missing wallet refresh, and four UI cases all failed before their
  corrections. Disabled-grace/trigger and v2-reader mutants also failed.
- Date-independent RSS fixtures in separate local commit bd7bc92 correct six
  baseline failures;28 focused routing tests pass without changing feed runtime.
- Independent GPT-6 Astra review: no remaining P1/P2 code findings after fixes.
  Reviewer inspected diffs and ran diff checking; supervisor ran full suites.

## Browser and hosted prerequisite observations

All browser work used the in-app browser. Existing Test Preview remains logged
in with Pro and its previous financial records. An isolated presentation fixture
renders seven/two-day reminders, exact IST grace deadline and Free recovery.
Mouse renewal and keyboard recovery actions work. It does not prove hosted grace
or actual payments; no hosted date manipulation or extra payment occurred.
Mobile viewport resizing is unavailable in this browser control surface; no
mobile-device execution is claimed.

Read-only hosted prerequisite check: v2 quote, capture and credit-reader bodies
match disposable baseline hashes. New manual/v3 functions are absent. Deployed
research-chat v69 has37 source files; all match checkout baseline except its
existing index plan lookup, which still reads user_profiles directly. Preserve
that deployed source as rollback evidence and do not overwrite unrelated code.

## Activation and rollback boundaries

Shared SQL/trigger and Edge activation need explicit owner approval because
Production and Preview share NTER. Production checkout/settings, Live keys and
existing financial records remain untouched. Apply SQL before new callers;
wait for both mandatory CI jobs on the exact commit before Preview release.
Reconcile actual Test payments/webhooks/invoices after publication.

Once v3 orders exist, retain v3 capture/recovery support even if new checkout
must be paused. Blindly reverting paymentService to pre-v3 would strand those
orders. Leave additive SQL in place; rollback model-access lookup separately
with explicit authorization, preserving all paid facts and wallet records.
Production publication and Live credential/webhook setup remain a later,
separately authorized step. Standalone card/UPI mandate enrollment does not
prove integrated AutoPay or Live readiness.

## Known limitation

The pre-existing manual-grant trigger in the non-superuser SQL bootstrap is
owned by nter_migrator and its manual branch hits the profile guard. The fixture
seeds manual provenance with that trigger temporarily disabled inside a rolled
back transaction to test resolver precedence independently. Existing trigger
behavior was not changed opportunistically. O6 remains the release tracker.

## Approved shared activation

Owner explicitly approved shared SQL/trigger and Production model-authorization
scope. Applied the exact reviewed SQL; Supabase records it as
`20261021140246_billing_manual_grace` (local reviewed file retains its approved
`20261021123000` identifier). All eight functions have exact intended grants,
empty search paths and postgres ownership; no anon execution. Existing v2
quote/capture/credit-reader hashes remain unchanged. The Free-protection trigger
is installed. Owner profile reads Pro, original21Nov08:39:30.252932Z paid/access
end, not in grace; no financial period extension.

Research-chat v70 is ACTIVE with existing verify_jwt=false preserved (handler
authentication remains in place). All37 returned runtime source files exactly
match the prepared deployment; only index plan lookup and handler access-deadline
logic change from prior deployed v69. The included deno.json is formatting/test
configuration and is not returned as a runtime bundle file. No unrelated Edge
function or Production checkout/key configuration changed. Exact-SHA Preview
publication and authenticated browser/payment acceptance remain pending.

## CI and Test Preview acceptance

Runtime commit `a2bd59bab9b2aac13e3406e44b81e8aa1ba1faa1` is published to
`task/razorpay-plan`. CI39613814829 passed both required jobs on attempt1.
Vercel `dpl_8VeoKfrnjq9r99AorYVP37Hooc9o` is READY at that exact commit;
aliasAssigned changed from false while CI ran to true after both jobs passed.
Preview alias remains niyantran-git-task-razorpay-plan-ddl-labs.vercel.app.
No main/Production web publication occurred.

In-app authenticated execution:
- Pro renewal correctly opens14Nov for the21Nov original cycle end, with
  qualified grace wording and no early payment button.
- Max quote is server-stored cycle-v3:900000paise,685000 additional credits,
  original21Nov08:39:30.252932Z end. Test netbanking succeeded as payment
  pay_TqaVDueWU4cW4S / order_TqaUdpRWHM0EvJ. Exactly one new period/grant/invoice
  (NIY/2627/00014), Max total allowance750000, unchanged original cycle anchor.
  Owner independently confirms Captured9000 and payment.captured HTTP200.
- Test checkout close shows Payment cancelled, no allocation/invoice. Retry
  reused the same unpaid499 order and then succeeded when owner chose Success:
  pay_TqaaE9syBgc2qt / order_TqaXXgBLxbyxf2, one20000-credit lot and invoice00015.
- A dedicated full499 Test refund of that untouched lot is awaiting owner action.
  A separate499 Test attempt order_TqahE2CD902zC1 awaits deliberate mock-bank
  Failure. Neither is claimed passed. No Test bank window was exposed to the
  in-app tab inventory, so the owner performs its simulator action.

The owner balance difference before these purchases was a pre-existing495.1305
AI charge at12:26UTC, rather than this migration. Bounded Preview scan found
zero5xx requests and zero error/fatal runtime entries in the20-minute window.
Unauthenticated research-chat POST returns401/missing bearer token.

Post-DDL security advisors show the expected deny-by-default private-table RLS
information and intentional authenticated SECURITY DEFINER own-read warnings.
The two new own-read wrappers use auth.uid and have no caller-supplied user ID;
fixtures test cross-owner denial. No unrelated advisor remediation performed.
[Supabase advisor context](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

These publication records are retained locally until the two owner handoffs
close; no duplicate runtime release is required merely to rewrite this evidence.
