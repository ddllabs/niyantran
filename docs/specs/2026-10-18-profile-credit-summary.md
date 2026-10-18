# Combined profile and credit summary

> **Status: Living.** Owner approved local implementation 2026-10-18.

Replace the separate header credits pill with the existing balance ring around
the profile initial. Clicking the combined control opens one Account dropdown.
Move every current credit-summary detail there: remaining/total, expiry/renewal,
period breakdown, held credits, pace, latest charges, all warnings/refusals and
retries. Preserve account identity, metadata and actions. The existing Credits
button opens the same #/account/credits page; avoid a duplicate credits-page CTA.
Keep automatic refusal opening quiet (no stolen chat focus), outside/Escape/
focus-leave dismissal and correct return focus on Escape. Unknown/empty/low
balances remain honest and accessible; ring semantics/calculations unchanged.
Dropdown scrolls within a narrow/short viewport, supports light/dark modes.
No API/RPC/database/credit conversion/deduction/grant/plan/payment/corpus change.
Verify causal guards before implementation, summary contents/route/ring/states,
focused and full app tests, lint/build and local preview. Production unpublished.
