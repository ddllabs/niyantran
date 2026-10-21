-- New Test quote endpoint only. Existing quote/order/capture definitions and
-- previously issued financial snapshots remain unchanged.
BEGIN;
CREATE FUNCTION private.billing_day_window(p_start timestamptz,p_end timestamptz,p_now timestamptz)
RETURNS TABLE(cycle_days integer,remaining_days integer,fraction numeric,expires_at timestamptz)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH dates AS (
  SELECT greatest(1,(p_end AT TIME ZONE 'Asia/Kolkata')::date-(p_start AT TIME ZONE 'Asia/Kolkata')::date) total,
   (p_end AT TIME ZONE 'Asia/Kolkata')::date-(p_now AT TIME ZONE 'Asia/Kolkata')::date remaining,
   (((p_now AT TIME ZONE 'Asia/Kolkata')::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') midnight
 ), day_window AS (
  SELECT total,CASE WHEN p_now>=p_end THEN 0 ELSE least(total,greatest(1,remaining)) END days,least(midnight,p_end) expires FROM dates
 ) SELECT total,days,days::numeric/total,expires FROM day_window;
$$;
DO $migration$
DECLARE f text; old_fraction text:='fraction:=extract(epoch FROM b.ends_at-now())/extract(epoch FROM b.ends_at-b.starts_at);';
 old_expiry text:='starts:=b.starts_at; ends:=b.ends_at; expires:=least(expires,b.ends_at);';
BEGIN
 SELECT pg_get_functiondef('public.billing_cycle(text,jsonb)'::regprocedure) INTO f;
 IF position(old_fraction in f)=0 OR position(old_expiry in f)=0 THEN RAISE EXCEPTION 'Cycle quote definition changed; review daily migration'; END IF;
 f:=replace(f,'FUNCTION public.billing_cycle(', 'FUNCTION public.billing_cycle_daily(');
 f:=replace(f,old_fraction,'SELECT d.fraction INTO fraction FROM private.billing_day_window(b.starts_at,b.ends_at,now()) d;');
 f:=replace(f,old_expiry,'starts:=b.starts_at; ends:=b.ends_at; SELECT d.expires_at INTO expires FROM private.billing_day_window(b.starts_at,b.ends_at,now()) d;');
 f:=replace(f,$old$'currentPlan',current_plan,'fraction',fraction,$old$,
  $new$'currentPlan',current_plan,'fraction',fraction,'prorationBasis','ist-calendar-day-v1',
  'cycleDays',(SELECT d.cycle_days FROM private.billing_day_window(starts,ends,now()) d),
  'remainingDays',(SELECT d.remaining_days FROM private.billing_day_window(starts,ends,now()) d),$new$);
 EXECUTE f;
END $migration$;
ALTER FUNCTION private.billing_day_window(timestamptz,timestamptz,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.billing_cycle_daily(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.billing_day_window(timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.billing_cycle_daily(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_cycle_daily(text,jsonb) TO service_role;
COMMIT;
