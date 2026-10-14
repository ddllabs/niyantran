-- Data seeded into the credit_estimates_and_effort chain just before
-- 20261014230000_credit_estimates_and_effort.sql (supabase/tests/run.sh), so
-- credit_estimates_and_effort.sql can prove the migration's own data steps ran:
--   * model_pricing and ai_models rows the min_plan seed patterns must sort
--     into free and plus (enabled and disabled alike);
--   * model_pricing rows for the three Claude models the migration adds, and an
--     admin-added row for one of them that ON CONFLICT DO NOTHING must keep;
--   * two Gemma rows: one to be disabled, one an ai_roles row points at, which
--     the migration must leave enabled.
-- Prices are USD per token. The ids are fixtures, not production's list.
-- Disposable test databases only. Named bootstrap_* so run.sh does not take it for a fixture.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.model_pricing (model_id, prompt_usd, completion_usd, supported_parameters, reasoning_efforts, reasoning_required)
VALUES
  ('google/gemini-3.5-flash-lite', 0.0000001,  0.0000004,  ARRAY['tools'], ARRAY['minimal','low','medium','high'], true),
  ('google/gemini-3.7-flash',      0.0000003,  0.0000025,  ARRAY['tools'], ARRAY['low','medium','high'], true),
  ('google/gemini-3.1-pro',        0.00000125, 0.00001,    ARRAY['tools'], ARRAY['low','high'], true),
  ('deepseek/deepseek-v4-flash',   0.0000003,  0.0000012,  ARRAY['tools'], ARRAY['high','xhigh'], false),
  ('~deepseek/deepseek-latest',    0.0000003,  0.0000012,  ARRAY['tools'], ARRAY['high','xhigh'], false),
  ('~openai/gpt-luna-latest',      0.0000002,  0.0000008,  ARRAY['tools'], ARRAY['low','medium','high'], false),
  ('openai/gpt-6-astra',           0.000004,   0.00002,    ARRAY['tools'], ARRAY['low','medium','high','xhigh','max'], true),
  ('anthropic/claude-sonnet-5',    0.000003,   0.000015,   ARRAY['tools'], ARRAY['low','medium','high','xhigh','max'], false),
  ('anthropic/claude-haiku-4',     0.000001,   0.000005,   ARRAY['tools'], ARRAY['low','medium','high'], false),
  ('google/gemma-4-31b-it',        0.0000001,  0.0000002,  ARRAY['tools'], ARRAY[]::text[], false),
  ('google/gemma-3-27b-it',        0.0000001,  0.0000002,  ARRAY['tools'], ARRAY[]::text[], false),
  ('z-ai/glm-tiny',                0.00000001, 0,          ARRAY['tools'], ARRAY[]::text[], false),
  ('x-ai/grok-unpriced',           NULL,       NULL,       ARRAY['tools'], ARRAY[]::text[], false),
  ('anthropic/claude-haiku-5.5',   0.000001,   0.000005,   ARRAY['tools'], ARRAY['low','medium','high'], false),
  ('anthropic/claude-sonnet-5.5',  0.000003,   0.000015,   ARRAY['tools'], ARRAY['low','medium','high','xhigh','max'], true),
  ('anthropic/claude-opus-5.5',    0.000015,   0.000075,   ARRAY['tools'], ARRAY['low','medium','high','xhigh','max'], false);

INSERT INTO public.ai_models (model_id, label, tier, efforts, enabled, is_default, sort_order) VALUES
  ('google/gemini-3.5-flash-lite', 'Flash-Lite',   1, '{}', true,  true,  10),
  ('google/gemini-3.7-flash',      'Flash',        1, '{}', true,  false, 20),
  ('google/gemini-3.1-pro',        'Gemini Pro',   2, '{}', true,  false, 25),
  ('deepseek/deepseek-v4-flash',   'DeepSeek',     1, '{}', true,  false, 30),
  ('~deepseek/deepseek-latest',    'DeepSeek new', 1, '{}', true,  false, 31),
  ('~openai/gpt-luna-latest',      'Luna',         1, '{}', true,  false, 35),
  ('anthropic/claude-sonnet-5',    'Sonnet 5',     3, '{}', true,  false, 40),
  ('anthropic/claude-haiku-4',     'Haiku 4',      1, '{}', true,  false, 41),
  ('openai/gpt-6-astra',           'Astra',        3, '{}', true,  false, 50),
  ('google/gemma-4-31b-it',        'Gemma',        1, '{}', true,  false, 60),
  ('google/gemma-3-27b-it',        'Gemma (role)', 1, '{}', true,  false, 61),
  ('z-ai/glm-tiny',                'Tiny',         1, '{}', true,  false, 70),
  ('x-ai/grok-unpriced',           'Unpriced',     2, '{}', true,  false, 80),
  ('google/gemini-2.5-flash-lite', 'Old Flash',    1, '{}', false, false, 90),
  ('anthropic/claude-opus-5.5',    'Opus (admin)', 2, '{high}', true, false, 42);

INSERT INTO public.ai_roles (role_id, label, hint, model_id, sort_order)
VALUES ('EXPERT_ESCALATION', 'Expert escalation', 'Fixture role on a Gemma model.', 'google/gemma-3-27b-it', 20);

COMMIT;
