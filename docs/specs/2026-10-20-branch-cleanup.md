# Branch and documentation cleanup

Status: Normative.

Owner authorized consolidation of remaining non-payment documentation, updating local main, and removal of fully merged local/remote branches, after coordination with the payments chat. Main code is already integrated; stale branch refs and unintegrated release/observation prose remain.

Preserve task/razorpay-plan, task/credit-paise-plan, task/credit-paise-release, task/top-up-price-approval, their remote refs, and all shared checkout files. Work only in the isolated cleanup checkout. Do not push main or deploy. Preserve historical observations without treating their old tracker statuses as current requirements. Retain original commits through merge ancestry and a verified pre-cleanup bundle.

Acceptance: only docs differ from origin/main; preserved payment refs retain their exact tips; every deleted local branch tip is an ancestor of consolidated local main; every deleted remote tip is already an ancestor of origin/main; remote deletes use exact expected tips; shared checkout remains on Razorpay. Verify local main includes origin/main, document commits and deletion inventory, and report intentionally retained refs. No application, Edge or SQL tests required for prose/ref-only changes.
