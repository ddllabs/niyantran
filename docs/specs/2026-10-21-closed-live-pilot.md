# Closed Production release and Live pilot

> **Status: Living.** Owner approved implementation and main-domain release with checkout closed; Live keys unchanged.

Live currently accepts every authenticated buyer when checkout opens. Require a server-only Live UUID allowlist, independently of the Test list. Missing, empty or malformed lists fail closed. Authenticated identity controls all plan operations and new plan/top-up orders before database/provider writes; request bodies cannot override eligibility. Existing paid verification, webhook fulfilment and recovery remain available after a buyer is removed or checkout closes. Never expose allowlists in public config.

Set Production BILLING_LIVE_BUYER_IDS to the already verified owner UUID b8ad9669-4e23-4d2f-8792-de37206e1d4b and BILLING_CHECKOUT_OPEN=0. No key changes, Live payment, AutoPay activation, SQL migration or balance changes. Release through an up-to-date PR and both mandatory CI jobs, then verify www.nter.pro is serving the approved commit with payments closed.

CI investigation must distinguish healthy delayed Git processing from failed synchronization. Preserve existing gates and permissions; do not force promotion or synthesize passing statuses. Acceptance includes fresh Git deployment automatically receiving real CI success.
