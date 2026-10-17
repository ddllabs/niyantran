-- Status: Normative. Existing handbook row period interpretation; no reload.
-- Local disposable fixture. Bootstrap: desk_rows_date_range plus handbook_period_ranges.
\set ON_ERROR_STOP on
BEGIN;

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
    RAISE NOTICE 'PASS: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;


INSERT INTO public.desk_rows (tier,feature,row_key,row,record_text,snapshot_at) VALUES
('state','State Fiscal Deep-Dive','hb:t1:fy','{"state":"Goa","year":"2019-20","period":"financial year","date":"2019-04-01"}','FY',now()),
('state','State Fiscal Deep-Dive','hb:t1:survey','{"state":"Goa","year":"2019-21","period":"period of years","date":"2019"}','Survey',now()),
('state','State Fiscal Deep-Dive','hb:t1:calendar','{"state":"Goa","year":"2019","period":"calendar year","date":"2019"}','Calendar',now()),
('state','Other','ordinary','{"year":"2019-20","period":"financial year","date":"2019-04-01"}','Ordinary',now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT max(total)=2 FROM public.search_desk_rows('state','State Fiscal Deep-Dive',null,'{}',50,'2020-01-01','2020-03-31')),
 'a late financial-year interval matches the financial year and survey, not calendar 2019');
SELECT pg_temp.assert_true((SELECT max(total)=1 FROM public.search_desk_rows('state','State Fiscal Deep-Dive',null,'{}',50,'2021-12-31','2021-12-31')),
 'survey end-year precision is inclusive');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.search_desk_rows('state','State Fiscal Deep-Dive',null,'{}',50,'2022-01-01','2022-01-01')),
 'after the survey interval no row matches');
SELECT pg_temp.assert_true((SELECT max(total)=1 FROM public.search_desk_rows('state','State Fiscal Deep-Dive',null,'{"year":"2019-20"}',50)), 'exact period is exact');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.search_desk_rows('state','Other',null,'{}',50,'2020-01-01','2020-03-31')),
 'ordinary module date semantics are unchanged');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.handbook_period_in(jsonb,text,text)','EXECUTE')
 AND has_function_privilege('authenticated','public.handbook_period_in(jsonb,text,text)','EXECUTE'), 'period helper is not public');
ROLLBACK;
