# Unused top-up refund correctness

> **Status: Living.** Owner-authorized pre-Live verification; shared activation requires separate approval.

## Evidence

Test pay_TqaaE9syBgc2qt has a full processed ₹499 refund. Its 20,000-credit lot is untouched. Provider facts are recorded and benefits intentionally await review. Existing review uses global FIFO, consuming unrelated earlier credits while preserving the refunded lot. History derives Paid from fulfilment.

## Fixed interfaces and scope

Add service-only `billing_review_adjustment_v2(p)`, with authoritative server account/mode and verified admin actor. For a top-up debit, allow only the entire original allocation of a fully refunded, wholly unused, unexpired purchase. Require the adjustment payment to be the fulfilling payment (never a refunded overpayment). Lock order/payment/adjustment and buyer, then the canonical wallet; reject unswept holds, including late-settlement reservations. Validate original purchase source key, grant-ledger provenance and absence of prior lot draws, remove only those credits with existing ledger/draw audit, create no debt and preserve all other lots. Reject partial/consumed cases, prior reversals and combined restoration/period changes. Same-decision retry is idempotent; paired refund/purchase-review records cannot cause two debits. Other reviews retain behavior after environment validation. Existing financial functions remain unchanged.

Add service-only `billing_purchases_v2(p)`, preserving the retry-aware own-purchase list with `refunded_paise` from authoritative payment facts and `refund_review_pending` from unreviewed refund/purchase-review records. History shows full/partial refund recorded independently of fulfilment. Original sale invoice/amount stays intact. Projection failure fails the history request, never silently returns Paid.

## Acceptance and exclusions

Disposable SQL proves exact-lot removal with older unrelated lots, conservation, unchanged debt/period/invoice, actor/environment isolation, retries, paired-record dedupe and unsupported-case rejection. API tests prove identity/environment binding; render tests prove status/invoice. Full repository gates and independent review precede hosted activation and Test-only publication. Exact Test review needs approval after concrete local work. No automatic refund, consumed/partial policy, Production checkout/settings, Live keys or main release.
