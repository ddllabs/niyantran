-- Status: Normative. Latest-run pagination, disposable local database only.
-- Bootstrap: feed_empty_outcome chain plus 20261017095859_feed_latest_run_page.sql.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (expected %, got %: %)', label, expected_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: % (%)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;


INSERT INTO public.feed_state (tier,feature,variant,class,kind,interval_minutes,serve,fetched_at,item_count)
VALUES ('finance','Odds','','markets','measurement',15,true,now(),3002);
INSERT INTO public.feed_items (tier,feature,variant,item_key,row,kind,content_hash,position,last_seen)
SELECT 'finance','Odds','',g::text,jsonb_build_object('title',g::text),'measurement','h',CASE WHEN g <= 2501 THEN g % 2000 ELSE g-2502 END,
 CASE WHEN g <= 2501 THEN now()-interval '1 day' ELSE now() END FROM generate_series(1,3002) g;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE first_page AS SELECT public.feed_latest_run_page('finance','Odds','',500,0,now()) j;
SELECT pg_temp.assert_true((SELECT (j->>'total')::int=501 AND jsonb_array_length(j->'items')=500 FROM first_page),
 'latest page excludes 2501 historical rows and counts the complete current run');
SELECT pg_temp.assert_true((public.feed_latest_run_page('finance','Odds','',500,500,now())->'items'->0->>'item_key')='3002', 'last page completes the current run');
SELECT pg_temp.assert_true(public.feed_latest_run_page('finance','Odds','',500,0,now()-interval '1 hour') IS NULL, 'changed run identity returns nothing');
SELECT pg_temp.assert_true(jsonb_array_length(public.feed_latest_run_page('finance','Odds','',5000,0,now())->'items')=500, 'page size capped at 500');
RESET ROLE;
UPDATE public.feed_state SET serve=false WHERE feature='Odds';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.feed_latest_run_page('finance','Odds','',500,0,now()) IS NULL, 'serve-off state returns nothing');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.feed_latest_run_page(text,text,text,integer,integer,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.feed_latest_run_page(text,text,text,integer,integer,timestamptz)','EXECUTE')
 AND has_function_privilege('service_role','public.feed_latest_run_page(text,text,text,integer,integer,timestamptz)','EXECUTE'), 'reader is service only');
ROLLBACK;
