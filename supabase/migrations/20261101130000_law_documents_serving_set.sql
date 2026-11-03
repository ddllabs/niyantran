-- The law publication policy on documents, evaluated once per query instead of once per row
-- (F278 step 3 gate, plan docs/plans/2026-11-01-chunk-partitions.md). Same rows admitted.
--
-- Why. Every search reads chunks through law_chunks_serving (exists a visible document), which the
-- planner runs as a hashed SubPlan over all of documents, applying the restrictive
-- law_documents_serving to each document. Today's policy, from 20261023184450:
--
--   not (starts_with(source_key,'law:trib:IBBI_NCLT:') and metadata->>'origin'='supplied-text')
--   or not exists(select 1 from public.law_listing_settings where active)
--   or public.law_document_is_published(id)
--
-- While the listing is active, each of the 7,549 NCLT supplied-text orders reads its metadata
-- (TOAST, about 2 kB) and then calls law_document_is_published, a security definer function that
-- runs its own query. On a copy of the retrieval replica (17,609 documents, 2026-11-02) that scan
-- took 90 ms of a 200 ms unscoped search, and the partitioned document_chunks (20261101120000) runs
-- it once per partition, which is what failed the latency gate for broad search.
--
-- What changes. The policy keeps its name, command, roles and restrictive mode; only its
-- expression changes:
--
--   not starts_with(source_key, 'law:trib:IBBI_NCLT:')
--   or not exists (select 1 from public.law_listing_settings where active)
--   or id in (select public.law_published_document_ids())
--   or not (metadata->>'origin' = 'supplied-text')
--
-- It is the same disjunction: not (a and b) is (not a) or (not b), and OR is commutative in SQL's
-- three-valued logic, so a row is admitted, refused or left null exactly as before (an order
-- without an origin key, while the listing is active and the order unpublished, is null, and so
-- refused, both times). law_published_document_ids() returns the documents linked to a visible law
-- record, which is exactly where law_document_is_published(id) is true: document_id is the links
-- table's primary key and never null, so IN gives true or false, never null. Only the evaluation
-- changes: PostgreSQL evaluates an OR left to right and stops at the first true, so the cheap
-- column test settles every non-NCLT document, the published set is built once per query (a
-- hashed SubPlan) instead of one function call per order, and metadata is read only for the
-- orders that are not published. Measured on the same copy: the documents scan 90 -> 8.5 ms,
-- unscoped match_documents median 101.6 -> 25 ms. supabase/tests/law_documents_serving_set.sql
-- proves the admitted rows equal the old expression's for every listing state and kind of
-- document.
--
-- law_published_document_ids() is security definer, as law_document_is_published is, so the
-- policy does not depend on the RLS of the law tables (and cannot recurse through them). It
-- returns only ids of documents linked to visible records, which authenticated users can already
-- test one by one with law_document_is_published and read whenever they are visible.
--
-- Lock. ALTER POLICY takes ACCESS EXCLUSIVE on documents, which every search reads, and a waiting
-- ACCESS EXCLUSIVE request makes new readers queue behind it. So it is requested with a 2 s
-- lock_timeout and retried every half second, 240 times (about 10 minutes), as the partition
-- migration's swap does: a search queues at most about 2 s behind it. Nothing else here takes a
-- lock on a table.
--
-- The second of a pair: 20261101120000_document_chunks_partitioned first, then this file, shipped
-- together; never this one alone, and it refuses to apply until document_chunks is partitioned. On
-- the unpartitioned table the new policy changes the plan of match_documents' feature-size count
-- (select count(*) ... limit 15001, which joins documents) and makes feature search 2-10x slower
-- (rehearsal 2026-11-02: NCLT 1.8 -> 4.4 s, Bills 0.20 -> 2.1 s), while with the partitions that
-- count reads the chunk's own desk_feature and is fast (NCLT 0.28 s, Bills 0.20 s). Applying it
-- second also keeps today's policy for the whole of the partition build. 20261101120000 checks only
-- document_chunks' policies, which this file does not change, so its preconditions hold in this
-- order, and this file's own check (today's documents policy, verbatim) is untouched by it.
--
-- Rollback, the first half of the pair's: this file first, then 20261101120000's (its header).
-- Rolling back only this file is allowed and leaves today's policy over the partitions; rolling back
-- the partitions requires this one first, because this file may not stand alone on the
-- unpartitioned table.
--   begin;
--   alter policy law_documents_serving on public.documents using(
--    not (starts_with(source_key,'law:trib:IBBI_NCLT:') and metadata->>'origin'='supplied-text')
--    or not exists(select 1 from public.law_listing_settings where active)
--    or public.law_document_is_published(id));
--   drop function public.law_published_document_ids();
--   delete from supabase_migrations.schema_migrations where version = '20261101130000';
--   commit;
-- Deleting the version row lets `supabase db push` apply the file again later; without it the CLI
-- believes it is applied. (The ALTER POLICY takes ACCESS EXCLUSIVE on documents; run it when no long
-- reader holds the table, or with the same lock retry as the migration.)

begin;

-- The partitions first (see the header), and the policy this file replaces must be today's, word
-- for word (whitespace and schema aside).
do $$
begin
  if (select relkind from pg_class where oid = to_regclass('public.document_chunks')) is distinct from 'p' then
    raise exception 'law_documents_serving_set: document_chunks is not partitioned; apply 20261101120000_document_chunks_partitioned first';
  end if;
  if (select array_agg(format('%s %s %s %s', polpermissive, polcmd, polroles::regrole[],
                              regexp_replace(pg_get_expr(polqual, polrelid), '\s+|public\.', '', 'g')))
        from pg_policy where polrelid = 'public.documents'::regclass and polname = 'law_documents_serving')
     is distinct from array['f r {authenticated} ((NOT(starts_with(source_key,''law:trib:IBBI_NCLT:''::text)AND((metadata->>''origin''::text)=''supplied-text''::text)))OR(NOT(EXISTS(SELECT1FROMlaw_listing_settingsWHERElaw_listing_settings.active)))ORlaw_document_is_published(id))'] then
    raise exception 'law_documents_serving_set: law_documents_serving is not the policy of 20261023184450; nothing changed';
  end if;
end
$$;

-- The documents linked to a visible law record: where law_document_is_published(id) is true.
create function public.law_published_document_ids() returns setof uuid
language sql stable security definer set search_path = public rows 10000 as $$
  select l.document_id from public.law_document_links l join public.law_records r on r.id = l.record_id where r.visible
$$;
revoke all on function public.law_published_document_ids() from public, anon;
grant execute on function public.law_published_document_ids() to authenticated, service_role;

do $$
declare
  c_wait constant text := '2s';
  c_attempts constant int := 240;
begin
  for attempt in 1..c_attempts loop
    begin
      perform set_config('lock_timeout', c_wait, true);
      lock table public.documents in access exclusive mode;
      perform set_config('lock_timeout', '30s', true);
      return;
    exception when lock_not_available then
      perform pg_sleep(0.5);
    end;
  end loop;
  raise exception 'law_documents_serving_set: readers held documents through % attempts; nothing changed', c_attempts;
end
$$;

alter policy law_documents_serving on public.documents using (
  not starts_with(source_key, 'law:trib:IBBI_NCLT:')
  or not exists (select 1 from public.law_listing_settings where active)
  or id in (select public.law_published_document_ids())
  or not (metadata->>'origin' = 'supplied-text'));

commit;
