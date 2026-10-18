# Record pane animation implementation

> **Status: Living.** Local only, sequential,2026-10-18.

Spec: ../specs/2026-10-18-record-pane-animation.md. Sole tracker: open-work.md F229.
1. Shared loading component in src/shell/record/RecordPanel.jsx, styling in
   recordPanel.css. Preserve BriefAnimation loader lifecycle and fallback words.
2. Gate adapted RecordPanel, RecordDetailBody and National GenericRecord on the
   existing hook's waiting states. Exact additional source scopes:
   src/shell/RecordDetail.jsx and src/desks/NationalRecord.jsx. No hook/API edits.
3. Focused renderer tests in their existing test files plus new
   src/shell/record/recordPaneLoading.test.jsx, demonstrating red before green.
   Update tests that previously expected details during loading to inspect ready
   state instead; preserve their semantic assertions. Registry integration guards
   should still verify adapter details using ready/no-brief state if necessary.
4. Run focused Vitest, full npm test, lint/build with no-dotenv guard; local
   credential-free animation preview. Update spec/plan evidence and sole tracker.
No new dependency, auth/credit write, backend, deployment, paid model, corpus or
payment work. Prior approved homepage edits remain separate and uncommitted.


## Local verification

Implemented shared RecordPaneLoading across all3 existing brief-rendering paths.
One native-size loader replaces details while loading/writing/pending; Close
record remains wired. Ready/error/unavailable/none restore regular content.
No useRecordBrief or request/provider/billing change. New waiting/detail guards
fail9 cases before implementation;22 new cases pass afterward. Existing adapter
and field assertions now render ready state rather than inspecting loading UI.
Focused86/86 (including unchanged16 hook tests), full6264/6264 across396 files,
lint and build pass with no-dotenv guard. Existing >500kB build warning remains.
No src/lib or Supabase edits; Deno/SQL not rerun for frontend-only change.
Local static preview /record-pane-preview.html has loading/writing/ready/error
controls and makes no LLM/auth requests. Arc control unavailable (window not
found); visual browser verification remains pending, no screenshot claimed.
No push/deploy, production mutation, paid call, corpus or payment work.
Prior homepage changes stay uncommitted alongside this local task.


## Authorized release — 2026-10-18

Owner explicitly approved push, merge and deploy. Combined release contains
homepage/sign-in source4e739b1 and pane-animation source8a33c19; no backend
operation. Diff review passed correctness, shared state/lifecycle, accessibility
(close/status), security (no new input/network boundary) and load behavior.
Bundle guard passes180382 gzip bytes (baseline180398; limit182446). Full6264,
lint/build evidence above remains current. Visual preview limitation disclosed;
publication explicitly authorized afterward. CI/production verification pending.


## Release verification

Branch fae886b pushed, preview dpl_AiiFSNPSvo2H2nNBVoo44B2W6Uwc READY.
CI39128091215 app and SQL success attempt1. Fast-forwarded main and pushed same
SHA. Production dpl_J3uHbqrdoHcJSoK3cGyEBqvLjgX2 READY with www.nter.pro,
nter.pro and retained Vercel aliases; aliasError null. HTTP200 on www and
niyantran-six; actual served CSS confirms scene1.1025, translate(-24px,-12px),
sign-in0.855, full-pane class and native animation zoom1. Ten assertions pass
across two hosts. These checks verify deployed assets, not a signed-in row click;
no live model or account test performed. Main CI39128436114 app/SQL success
on attempt1. F228/F229 closed with source hashes and release evidence.
Runtime build has the pre-existing >500kB warning. Hourly monitor ACTIVE;
T15 still pending daily intervals, Razorpay held/corpus excluded. No production
SQL/config/Edge changes. Local synthetic preview files stay generated/untracked.
