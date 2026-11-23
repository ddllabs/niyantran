-- nter.pro backend checks — read-only.
--
-- Where: Supabase dashboard → project NTER → SQL Editor → New query. Paste ONE block, press Run.
-- Every block is a single SELECT: it reads and never changes anything. Do not paste anything that
-- starts with insert, update, delete, alter, drop, create or truncate into this project.
--
-- Blocks A–C are about the whole service (no personal data). Blocks D–G are about one member:
-- replace you@example.com with the email you test the app with.

-- ============================================================================================
-- A. Is the data fresh? Modules whose feed is failing or overdue (empty result = all healthy)
-- ============================================================================================
select tier, feature, item_count, consecutive_failures, left(last_error, 120) as last_error,
       fetched_at, next_due_at, now() - fetched_at as age
from feed_state
where serve
  and (consecutive_failures > 0 or next_due_at < now() - interval '6 hours')
order by consecutive_failures desc, next_due_at
limit 50;

-- ============================================================================================
-- B. Feed runs in the last 24 hours, by result
-- ============================================================================================
select status, count(*) as runs, sum(new_items) as new_items, round(avg(ms)) as avg_ms
from feed_runs
where started_at > now() - interval '24 hours'
group by status
order by runs desc;

-- ============================================================================================
-- C. The service at a glance: feeds, desk records, models, AI answers in the last 24 hours
--    (nter.news stories are read from nter.news by www.nter.pro/api/home/latest, not from a table)
-- ============================================================================================
select
  (select count(*) from feed_state where serve)                                             as live_feeds,
  (select max(fetched_at) from feed_state where serve)                                      as newest_feed_fetch,
  (select count(*) from desk_rows)                                                          as desk_records,
  (select count(*) from ai_models where enabled)                                            as models_enabled,
  (select count(*) from chat_messages where role = 'assistant' and created_at > now() - interval '24 hours') as answers_24h,
  (select count(*) from chat_messages where role = 'assistant' and status = 'error' and created_at > now() - interval '24 hours') as failed_answers_24h,
  (select count(*) from record_briefs where written_at > now() - interval '24 hours')       as briefs_written_24h,
  (select round(avg(latency_ms)) from model_call_logs where created_at > now() - interval '24 hours' and status = 'success') as avg_model_latency_ms_24h;

-- ============================================================================================
-- D. One member: account, perspective, plan, credits
-- ============================================================================================
with me as (select user_id from user_profiles where email_normalised = lower('you@example.com'))
select p.email, p.first_name, p.persona, p.plan, p.plan_status, p.status,
       w.balance as credit_balance, w.debt as credit_debt,
       (select coalesce(sum(credits), 0) from credit_holds h where h.user_id = p.user_id and h.settled_at is null and h.swept_at is null) as credits_held_now
from user_profiles p
left join credit_wallets w on w.user_id = p.user_id
where p.user_id = (select user_id from me);

-- ============================================================================================
-- E. One member: the last 10 conversations and their latest answer (shows what the app asked)
-- ============================================================================================
with me as (select user_id from user_profiles where email_normalised = lower('you@example.com'))
select c.created_at, c.title, c.desk_tier, c.desk_feature,
       m.status as last_answer_status, m.model_served, left(m.error_message, 100) as error,
       jsonb_array_length(coalesce(m.sources, '[]'::jsonb)) as citations
from conversations c
left join lateral (
  select status, model_served, error_message, sources from chat_messages
  where conversation_id = c.id and role = 'assistant' order by created_at desc limit 1
) m on true
where c.user_id = (select user_id from me)
order by c.last_message_at desc nulls last
limit 10;

-- ============================================================================================
-- F. One member: credit movements (each answer and each grant)
-- ============================================================================================
with me as (select user_id from user_profiles where email_normalised = lower('you@example.com'))
select created_at, kind, credits, turn_key, note
from credit_ledger
where user_id = (select user_id from me)
order by created_at desc
limit 20;

-- ============================================================================================
-- G. One member: watchlist (same list on the website and in the app)
-- ============================================================================================
with me as (select user_id from user_profiles where email_normalised = lower('you@example.com'))
select watchlist, updated_at
from user_preferences
where user_id = (select user_id from me);

-- ============================================================================================
-- H. AI briefs written recently (after "Write the AI brief" on a record)
-- ============================================================================================
select written_at, tier, feature, left(headline, 100) as headline, model, status
from record_briefs
where written_at is not null
order by written_at desc
limit 10;
