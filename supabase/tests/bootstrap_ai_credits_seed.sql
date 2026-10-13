-- Data seeded into the ai_credits chain just before 20261014200000_ai_credits.sql
-- (supabase/tests/run.sh), so ai_credits.sql can prove the migration's own data
-- steps ran, without calling their helpers itself:
--   * a profile on a paid plan with no plan_grants row (the launch backfill);
--   * a completed, claimed assistant answer whose usage carries cost keys at
--     the top level, inside `observed` and inside arrays (the usage scrub, which
--     must work although guard_research_result makes the answer immutable).
-- Disposable test databases only. Named bootstrap_* so run.sh does not take it for a fixture.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-00000000c0a1', 'seed.paid@example.invalid');
UPDATE public.user_profiles
SET plan = 'plus', plan_status = 'active', plan_source = 'manual', plan_period_end = now() + interval '40 days'
WHERE user_id = '00000000-0000-4000-8000-00000000c0a1';

INSERT INTO public.conversations (id, user_id, title)
VALUES ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000c0a1', 'Seeded conversation');
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content, turn_key, created_at)
VALUES ('d0000000-0000-4000-8000-0000000000a0', 'd0000000-0000-4000-8000-0000000000c1',
        '00000000-0000-4000-8000-00000000c0a1', 'user', 'A question.', 'seed-turn', now());
INSERT INTO public.chat_messages (id, conversation_id, user_id, role, content, status, usage, created_at)
VALUES ('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000c1',
        '00000000-0000-4000-8000-00000000c0a1', 'assistant', 'An answer.', 'complete',
        '{"prompt_tokens": 7, "cost_usd": 0.02, "web_searches": 1, "web_search_cost_usd": 0.004,
          "observed": {"cost_usd": 0.01, "cost_usd_from": 2, "attempts_reporting": 2},
          "attempts": [{"cost_usd": 0.5, "model": "m"}, {"nested": [{"cost_usd": 1, "tokens": 3}]}]}',
        now() + interval '1 microsecond');
INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id, execution_token)
VALUES ('00000000-0000-4000-8000-00000000c0a1', 'seed-turn', repeat('a', 64), 'd0000000-0000-4000-8000-0000000000c1',
        'd0000000-0000-4000-8000-0000000000a0', 'd0000000-0000-4000-8000-0000000000a1', gen_random_uuid());

COMMIT;
