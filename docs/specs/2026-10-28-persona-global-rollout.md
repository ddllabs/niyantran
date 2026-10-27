# Published personas for all users

> **Status: Normative.** Owner authorized global rollout, push and merge to nter.pro on 2026-10-28.

Supersedes the pilot-only audience and single-editor restrictions of the prior persona spec. Every active authenticated user uses the published prompt for their own persona on the next new turn. Only active platform admins may read drafts/history, save, test raw editor text, publish or roll back. No account roles or prompt content are changed by this rollout.

Consumption eligibility and management authorization are separate service-only database functions. A global_enabled setting defaults false during staging. The existing enabled setting remains the runtime kill switch; admin management stays available when runtime consumption is paused. Rollback global_enabled=false restores the original single-owner consumption pilot; enabled=false restores bundled prompts for everyone. All admins retain management authorization in either case.

Normal users cannot select other personas through a probe, submit raw prompt overrides, read prompt storage through the Data API or call management RPCs. The active-prompt read checks the user's saved persona (corporate default when absent); admins may select a persona for testing. Published text preserves exact bytes. Stored output replay and in-flight turns retain existing behavior; new turns resolve the current publication. Storage failure uses bundled defaults with existing diagnostics.

Acceptance evidence: SQL tests for admin/non-admin/anonymous access, separate consumer/editor scopes, own-persona confinement, inactive accounts and kill switches; runtime tests proving a non-admin receives published text but cannot override it; signed-in production admin page shows all-user audience and global publication wording. Existing active prompts stay unchanged. No corpus, billing configuration, authentication flow or role grants are modified.
