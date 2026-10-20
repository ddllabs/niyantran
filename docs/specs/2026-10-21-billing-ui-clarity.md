# Billing clarity and invoice dismissal

> **Status: Normative.** Owner-approved UI scope, 2026-10-21.

Current billing UI always prints two money decimals, uses provider-specific pay labels, leaves renewal prepayment distinct from service dates only implicitly, and shows ledger lots as repeated outlined rows. The native invoice modal supports Escape and a text button but no backdrop dismissal.

Expected outcome: remove only unnecessary .00, preserve genuine paise and all checkout/financial values; label payment actions Pay online beside the exact total; distinguish renewal availability from the next service period and explain manual expiry to Free. Use a compact accessible billing-only credit table, grouping type plus exact expiry with expandable original amounts. Invoice closes using an accessible X, Escape, or a click wholly outside its bounds; content clicks/drags must not dismiss it, and trigger focus returns.

Scope: src/lib/billing.js display formatter, billing workspace/review components and tests, a billing credit breakdown component, scoped CSS, task records. Excludes calculations, APIs, SQL, reminders/grace policy, financial data, Production and Live credentials. Publish only task/razorpay-plan to the existing Test Preview.

Acceptance: causal tests for money precision, renewal dates, grouping/input immutability and modal dismissal; full application and Edge suites because the shared formatter lives in src/lib; lint/build/bundle checks; browser desktop/mobile/dark and authenticated Preview invoice/renewal checks. No new purchase or saved-plan change during verification.
