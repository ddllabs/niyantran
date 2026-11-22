-- Keyword and vector search together on any desk that has a flag row (F393, module `hybrid-sitewide` of
-- docs/specs/2026-11-20-corpus-and-search-completion.md; spec docs/specs/2026-11-21-hybrid-sitewide.md).
-- Not applied anywhere. Additive: it adds one table, three private helpers and replaces public.match_documents_hybrid
-- with a version whose NCLT branch and whose "everything else" branch are the present ones.
-- Deploy order: this migration first, then the Edge Function that reads the new table (spec, "Deploy order").
--
-- What it adds.
--
--   1. public.hybrid_search_desks: one row per desk (desk_feature), the switch of the general rule. No row, or
--      enabled = false: the desk returns exactly what match_documents returns. The migration inserts no row.
--      Readable by authenticated (the Edge Function reads it with the caller's client, as it reads app_flags);
--      written by service_role only. Rollback for a desk: delete its row. A row for NCLT / NCLAT (Insolvency) is refused
--      (it keeps its own rule and its own switch), and so is a row for a name that no document carries (a trigger: the
--      database holds no list of desks; the desk catalogue is in the application).
--
--   2. retrieval_internal.hidden_document_ids(): the one place where this migration decides which documents the
--      caller may not read. SECURITY DEFINER, executable by no role but its owner (it returns ids the caller may not
--      read). It first runs the NCLT helper's policy comparison (an empty-text call of hybrid_candidate_ids, which reads no
--      row; NCLT's function is not changed): if the access policies on documents and document_chunks are no longer
--      the ones the copy was written against it raises 55000. Then it returns the documents the publication rule of
--      law_documents_serving does not admit (a copy of the rule, the same text as in the NCLT helper; the fixture
--      compares the two).
--
--   3. retrieval_internal.keyword_candidate_ids(p_query_text, p_query_embedding, p_desk_tier, p_desk_feature):
--      the general keyword rule, in the private schema the NCLT helper already lives in. SECURITY DEFINER,
--      search_path = pg_catalog, pg_temp, custom plans, ids and ranks only, executable by authenticated and
--      service_role only (a function created here would otherwise be executable by PUBLIC; it revokes explicitly).
--      The rule (the one measured as R1 in docs/specs/2026-11-18-regulatory-search-after-load.md):
--        * the question is cut to 4000 characters and analysed with the 'simple' text configuration;
--        * of its first 64 words (digit words first, then the longest) a word is rare when it is in 1 to 2000 chunks
--          of the desk that the caller can read;
--        * of the rare words, digit words first and each group rarest first, a word is kept while the readable counts
--          of the kept words add up to at most 6000 (a bound on the rows scored);
--        * a candidate is a chunk of the desk (embedded, in an indexed document of the tier) holding at least two of
--          the kept words (one, when only one was kept); its score is the sum over the kept words it holds of
--          ln(2001 / the word's count) + 1, so a rarer word weighs more, rounded to 6 decimals so that ties are exact;
--        * the best 100 by score, and every candidate tied with the 100th, are ordered by score, then by cosine
--          similarity to the question (halfvec, as match_documents), then id, and the first 100 are the list. A
--          chunk's score depends only on which kept words it holds, so ties are the normal case and the cut must
--          not split them (cutting by id kept 11 of the 100 nearest in a measurement on 2026-11-21). The ties are
--          bounded by the word budget: at most 6000 rows are scored.
--      Access. It reads as its owner, who bypasses row-level security, so it asks hidden_document_ids() for the
--      documents the publication rule does not admit and leaves their chunks out BEFORE it counts, scores, cuts or
--      ranks anything; if the access policies have drifted that call raises 55000 and the search fails closed (the app
--      then falls back to vector only). A call with no text, no vector or no desk returns at once and reads no row.
--      The function that calls it reads every returned chunk back through the caller's own RLS.
--
--      The rarity probes are in a fourth function of the same schema, retrieval_internal.rare_word_counts(), SECURITY
--      DEFINER and executable by no role but its owner. Its SET clause (enable_seqscan and enable_indexscan off) is what
--      keeps its planner settings to itself: they are restored when it returns, whatever the caller had. It reads the
--      desk's partition by name and tests the desk so that the keyword index is the only index the probe can use.
--
--   4. public.match_documents_hybrid is replaced with the same signature, columns and grants:
--        * names document ids                       -> match_documents (as before)
--        * NCLT / NCLAT (Insolvency)                -> the NCLT rule, unchanged
--        * a desk with an enabled hybrid_search_desks row -> the general rule fused with the vector list
--        * every other scope                        -> match_documents (as before)
--      Fusion is the NCLT one: reciprocal rank fusion, k = 60, weight 1, the 100 vector rows of match_documents and
--      the up to 100 keyword rows; ties: score, vector rank, keyword rank, chunk id. `similarity` is the chunk's
--      cosine similarity, rows are in fused order, and every returned row is read again through RLS.
--
-- It creates no index: every chunk partition already has the keyword index (document_chunks_content_tsv, 20261102120000).
-- Orders after 20261102120000_chunk_hybrid_search (the helper it calls and the function it replaces).
--
-- Rollback (nothing else depends on it): restore match_documents_hybrid from 20261102120000, then
--   drop function retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text);
--   drop function retrieval_internal.rare_word_counts(text[], text, uuid[], int);
--   drop function retrieval_internal.hidden_document_ids();
--   drop table public.hybrid_search_desks;
--   drop function public.hybrid_search_desks_known_desk();

begin;

create table public.hybrid_search_desks (
  desk_feature text primary key check (btrim(desk_feature) <> ''),
  enabled      boolean not null default true,
  hybrid_ms    integer check (hybrid_ms is null or hybrid_ms between 500 and 4000),
  fallback_ms  integer check (fallback_ms is null or fallback_ms between 1000 and 4000),
  updated_at   timestamptz not null default now(),
  constraint hybrid_search_desks_not_nclt check (desk_feature <> 'NCLT / NCLAT (Insolvency)')
);
-- The database has no list of desks (the catalogue is in the application): a row must at least name a desk that holds a
-- document. Refused with the code of a failed check (23514).
create function public.hybrid_search_desks_known_desk() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if not exists (select 1 from public.documents d where d.desk_feature = new.desk_feature) then
    raise exception 'no document carries this desk_feature' using errcode = '23514';
  end if;
  return new;
end
$fn$;
revoke all on function public.hybrid_search_desks_known_desk() from public, anon, authenticated, service_role;
create trigger hybrid_search_desks_known_desk before insert or update of desk_feature on public.hybrid_search_desks
  for each row execute function public.hybrid_search_desks_known_desk();
alter table public.hybrid_search_desks enable row level security;
create policy hybrid_search_desks_read on public.hybrid_search_desks for select to authenticated using (true);
revoke all on table public.hybrid_search_desks from public, anon, authenticated, service_role;
grant select on table public.hybrid_search_desks to authenticated;
grant select, insert, update, delete on table public.hybrid_search_desks to service_role;

create function retrieval_internal.hidden_document_ids() returns uuid[]
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
set plan_cache_mode = force_custom_plan
as $fn$
declare
  v_hidden uuid[];
begin
  -- Fail closed: the copy of the publication rule below is correct only for the policies the NCLT helper was written
  -- against. Its empty-text call runs that comparison and reads no row; it raises 55000 on a difference.
  perform 1 from retrieval_internal.hybrid_candidate_ids('', null, null, null);

  -- The documents the publication rule of law_documents_serving does not admit (a null result is not admitted either).
  -- A copy of the rule in the NCLT helper; the fixture requires the two statements to be the same text.
  select coalesce(array_agg(d.id), '{}') into v_hidden
    from public.documents d
   where (not starts_with(d.source_key, 'law:trib:IBBI_NCLT:')
          or not exists (select 1 from public.law_listing_settings where active)
          or d.id in (select public.law_published_document_ids())
          or not (d.metadata->>'origin' = 'supplied-text')) is not true;
  -- The hidden-list test of the callers admits every row when the list is null (unnest(null) is empty): fail closed instead.
  if v_hidden is null then
    raise exception 'keyword search unavailable' using errcode = '55000';
  end if;
  return v_hidden;
end
$fn$;

revoke all on function retrieval_internal.hidden_document_ids() from public, anon, authenticated, service_role;

-- The rarity probes, in a function of their own so that its SET clause is what keeps their planner settings: a function
-- restores, when it returns, the settings named in its SET clause and no others. The probes forbid sequential and plain
-- index scans. For a word in many chunks of a partition the default planner prefers a sequential scan (it expects to find
-- 2001 matches soon), and a probe that way cost about 200 ms a word on a 40,000-chunk partition (measured 2026-11-21).
-- Bitmap scans are left, and two of them can serve a probe: the keyword index (GIN), and the btree on (desk_feature,
-- language), whose condition "desk_feature = X" matches EVERY row of a per-desk partition and would make the probe compute
-- to_tsvector(content) row by row until 2,001 matches (the same work as the sequential scan). So the probe reads the
-- desk's partition by name, not the parent, and writes the desk test as (desk_feature || '') = X, which no index can
-- serve: the keyword index is the only one left. A desk without a partition of its own is in the default partition, whose
-- test is the same; if neither is found the parent is read (slower, never wrong).
-- Returns, for the words of p_lexes in the order given, those that are in 1 to p_rare_max readable chunks of the desk.
create function retrieval_internal.rare_word_counts(
  p_lexes        text[],
  p_desk_feature text,
  p_hidden       uuid[],
  p_rare_max     int
) returns table (
  lex text,
  lit text,
  df  int
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
set enable_seqscan = off
set enable_indexscan = off
as $fn$
declare
  v_part text;
  v_lex  text;
  v_lit  text;
  v_df   int;
begin
  select k.oid::regclass::text into v_part
    from pg_inherits i join pg_class k on k.oid = i.inhrelid
   where i.inhparent = 'public.document_chunks'::regclass
     and pg_get_expr(k.relpartbound, k.oid) = format('FOR VALUES IN (%L)', p_desk_feature);
  if v_part is null then
    select k.oid::regclass::text into v_part
      from pg_inherits i join pg_class k on k.oid = i.inhrelid
     where i.inhparent = 'public.document_chunks'::regclass and pg_get_expr(k.relpartbound, k.oid) = 'DEFAULT';
  end if;
  v_part := coalesce(v_part, 'public.document_chunks');

  foreach v_lex in array p_lexes loop
    v_lit := '''' || replace(replace(v_lex, '\', '\\'), '''', '''''') || '''';
    -- Each probe counts readable chunks and stops after p_rare_max + 1; the documents the caller may not read are left out
    -- before the count.
    execute format($q$select count(*)
      from (select 1
              from %s c
             where to_tsvector('simple'::regconfig, c.content) @@ %L::tsquery
               and (c.desk_feature || '') = $1
               and c.document_id is not null and c.document_id not in (select h.id from unnest($2) h(id))
             limit %s) z$q$, v_part, v_lit, p_rare_max + 1)
      into v_df using p_desk_feature, p_hidden;
    if v_df between 1 and p_rare_max then
      lex := v_lex; lit := v_lit; df := v_df;
      return next;
    end if;
  end loop;
end
$fn$;

revoke all on function retrieval_internal.rare_word_counts(text[], text, uuid[], int) from public, anon, authenticated, service_role;

create function retrieval_internal.keyword_candidate_ids(
  p_query_text      text,
  p_query_embedding extensions.vector(1536),
  p_desk_tier       text,
  p_desk_feature    text
) returns table (
  id        uuid,
  list_rank integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
declare
  -- A word is rare when it is in at most this many chunks of the desk that the caller can read.
  c_rare_df_max constant int := 2000;
  -- The kept words' readable counts add up to at most this, so at most this many chunks are scored.
  c_match_budget constant int := 6000;
  -- A candidate holds at least this many of the kept words (fewer when fewer were kept).
  c_min_words constant int := 2;
  -- Rows of the list.
  c_candidates constant int := 100;
  -- Words probed per call (digit words first, then the longest), and characters of the text that are analysed.
  c_max_terms constant int := 64;
  c_query_max constant int := 4000;
  v_text    text;
  v_lit     text;
  v_df      int;
  v_terms   text[];
  v_lexes   text[] := '{}';
  v_lits    text[] := '{}';
  v_dfs     int[]  := '{}';
  v_klits   text[] := '{}';
  v_kdfs    int[]  := '{}';
  v_sum     int    := 0;
  v_min     int;
  v_hidden  uuid[];
  v_found   uuid[];
begin
  v_text := left(p_query_text, c_query_max);
  if nullif(btrim(coalesce(v_text, '')), '') is null or p_query_embedding is null or p_desk_feature is null then
    return;
  end if;

  -- The documents the caller may not read, once per call (it raises 55000 when the access policies have drifted);
  -- every read below leaves their chunks out before it counts.
  v_hidden := retrieval_internal.hidden_document_ids();

  -- The rare words: the probes count readable chunks of the desk for each of the first c_max_terms words (digit words
  -- first, then the longest), in retrieval_internal.rare_word_counts, which keeps the planner settings the probes need to
  -- itself (see there).
  select coalesce(array_agg(t.lex), '{}') into v_terms
    from (select x.lex
            from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, v_text))) as lex) x
           order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex
           limit c_max_terms) t;
  select coalesce(array_agg(r.lex), '{}'), coalesce(array_agg(r.lit), '{}'), coalesce(array_agg(r.df), '{}')
    into v_lexes, v_lits, v_dfs
    from retrieval_internal.rare_word_counts(v_terms, p_desk_feature, v_hidden, c_rare_df_max) r;

  -- The word budget: digit words first, then the others, each group rarest first, ties by the word; a word is kept
  -- when its count still fits in what is left of c_match_budget.
  for v_lit, v_df in
    select w.lit, w.df
      from unnest(v_lexes, v_lits, v_dfs) w(lex, lit, df)
     order by (w.lex ~ '[0-9]') desc, w.df, w.lex
  loop
    if v_sum + v_df <= c_match_budget then
      v_sum := v_sum + v_df;
      v_klits := v_klits || v_lit;
      v_kdfs := v_kdfs || v_df;
    end if;
  end loop;

  if cardinality(v_klits) = 0 then
    return;
  end if;
  v_min := least(c_min_words, cardinality(v_klits));

  -- The candidates. Step 1 reads, word by word through the keyword index, the readable chunks of the desk that hold
  -- the word, with the word's weight. Step 2 sums the weights per chunk and keeps those holding v_min words, in an
  -- indexed document of the tier. Step 3 keeps the best c_candidates by score and every row tied with the last of them, and reads each
  -- one's vector back by its unique key (id, desk_feature) to order ties by similarity; the first c_candidates of that
  -- order are the list. The cut keeps every row tied with the c_candidates-th, so it never decides between equal scores
  -- (the order below does), and the list is the same as with a wider pool: the first c_candidates rows by score, then
  -- distance, then id, all hold a score at least the c_candidates-th's.
  with m as materialized (
    select r.id, r.document_id, r.desk_feature, k.w
      from (select z.lit, round((ln((c_rare_df_max + 1)::numeric / z.df) + 1)::numeric, 6) as w
              from unnest(v_klits, v_kdfs) z(lit, df)) k
     cross join lateral (
       select c.id, c.document_id, c.desk_feature
         from public.document_chunks c
        where to_tsvector('simple'::regconfig, c.content) @@ k.lit::tsquery
          and c.desk_feature = p_desk_feature
          and c.embedding is not null
          and c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))
     ) r
  ),
  scored as (
    select m.id, m.document_id, m.desk_feature, sum(m.w) as score
      from m
     group by m.id, m.document_id, m.desk_feature
    having count(*) >= v_min
  ),
  pool as (
    select s.id, s.desk_feature, s.score
      from scored s
      join public.documents d on d.id = s.document_id
     where d.indexed_at is not null
       and (p_desk_tier is null or d.desk_tier = p_desk_tier)
     order by s.score desc
     fetch first c_candidates rows with ties
  )
  select array_agg(k.id order by k.score desc, k.dist, k.id) into v_found
    from (select p.id, p.score,
                 (r.embedding::extensions.halfvec(1536)) operator(extensions.<=>) (p_query_embedding::extensions.halfvec(1536)) as dist
            from pool p
           cross join lateral (
             select c.embedding from public.document_chunks c where c.id = p.id and c.desk_feature = p.desk_feature
           ) r
           order by p.score desc, 3, p.id
           limit c_candidates) k;

  return query select a.id, a.n::integer from unnest(v_found) with ordinality a(id, n);
end
$fn$;

revoke all on function retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text) from public, anon, authenticated, service_role;
grant execute on function retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text) to authenticated, service_role;

create or replace function public.match_documents_hybrid(
  query_embedding extensions.vector(1536),
  query_text      text,
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null,
  p_desk_feature  text   default null
) returns table (
  id            uuid,
  document_id   uuid,
  content       text,
  similarity    float8,
  chunk_index   int,
  source_kind   text,
  page_number   int,
  char_from     int,
  char_to       int,
  title         text,
  file_name     text,
  file_url      text,
  desk_tier     text,
  desk_feature  text,
  block_ids     uuid[],
  image_ids     uuid[],
  section       jsonb
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $fn$
#variable_conflict use_column
declare
  -- The desk whose own rule (title-gated names and months) is kept.
  c_nclt constant text := 'NCLT / NCLAT (Insolvency)';
  -- Rows taken from the vector side before fusion.
  c_candidates constant int := 100;
  -- The reciprocal rank fusion constant of Cormack, Clarke and Buettcher (2009); weight 1 for each list.
  c_rrf_k constant int := 60;
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_kw    uuid[];
  v_mo    uuid[];
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 then
    return query select * from public.match_documents(query_embedding, v_limit, p_document_ids, p_desk_tier, p_desk_feature);
    return;
  end if;

  -- The general rule: a desk other than NCLT with an enabled row. The row is read as the caller; no row, no keyword path.
  if p_desk_feature is distinct from c_nclt then
    if p_desk_feature is null
       or not exists (select 1 from public.hybrid_search_desks h where h.desk_feature = p_desk_feature and h.enabled) then
      return query select * from public.match_documents(query_embedding, v_limit, p_document_ids, p_desk_tier, p_desk_feature);
      return;
    end if;

    select array_agg(h.id order by h.list_rank)
      into v_kw
      from retrieval_internal.keyword_candidate_ids(query_text, query_embedding, p_desk_tier, p_desk_feature) h
     where exists (select 1 from public.document_chunks c where c.id = h.id and c.desk_feature = p_desk_feature);
    if v_kw is null then
      return query select * from public.match_documents(query_embedding, v_limit, null, p_desk_tier, p_desk_feature);
      return;
    end if;

    return query
      with vec as (
        select m.id, m.ordinality as rn
          from public.match_documents(query_embedding, c_candidates, null, p_desk_tier, p_desk_feature) with ordinality m
      ),
      kw as (
        select a.id, a.n as rn from unnest(v_kw) with ordinality a(id, n)
      ),
      fused as (
        select u.id, v.rn as vr, k.rn as kr,
               coalesce(1.0 / (c_rrf_k + v.rn), 0) + coalesce(1.0 / (c_rrf_k + k.rn), 0) as score
          from (select vec.id from vec union select kw.id from kw) u
          left join vec v on v.id = u.id
          left join kw k on k.id = u.id
         order by 4 desc, v.rn nulls last, k.rn nulls last, 1
         limit v_limit
      )
      -- The access check, last: every row is read again through the caller's RLS.
      select c.id, c.document_id, c.content,
             (1 - (c.embedding <=> query_embedding))::float8,
             c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
             c.block_ids, c.image_ids, c.metadata->'section'
        from fused f
        join public.document_chunks c on c.id = f.id and c.desk_feature = p_desk_feature
        join public.documents d on d.id = c.document_id
       order by f.score desc, f.vr nulls last, f.kr nulls last, f.id;
    return;
  end if;

  -- NCLT: the rule of 20261102120000, unchanged.
  select array_agg(h.id order by h.list_rank) filter (where h.list_name = 'keyword'),
         array_agg(h.id order by h.list_rank) filter (where h.list_name = 'month')
    into v_kw, v_mo
    from retrieval_internal.hybrid_candidate_ids(query_text, query_embedding, p_desk_tier, p_desk_feature) h
   where exists (select 1 from public.document_chunks c where c.id = h.id and c.desk_feature = c_nclt);
  if v_kw is null and v_mo is null then
    return query select * from public.match_documents(query_embedding, v_limit, null, p_desk_tier, p_desk_feature);
    return;
  end if;

  return query
    with vec as (
      select m.id, m.ordinality as rn
        from public.match_documents(query_embedding, c_candidates, null, p_desk_tier, p_desk_feature) with ordinality m
    ),
    kw as (
      select a.id, a.n as rn from unnest(v_kw) with ordinality a(id, n)
    ),
    mo as (
      select a.id, a.n as rn from unnest(v_mo) with ordinality a(id, n)
    ),
    fused as (
      select u.id, v.rn as vr, k.rn as kr, m.rn as mr,
             coalesce(1.0 / (c_rrf_k + v.rn), 0) + coalesce(1.0 / (c_rrf_k + k.rn), 0) + coalesce(1.0 / (c_rrf_k + m.rn), 0) as score
        from (select vec.id from vec union select kw.id from kw union select mo.id from mo) u
        left join vec v on v.id = u.id
        left join kw k on k.id = u.id
        left join mo m on m.id = u.id
       order by 5 desc, v.rn nulls last, k.rn nulls last, m.rn nulls last, 1
       limit v_limit
    )
    -- The access check, last: every row is read again through the caller's RLS.
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
           c.block_ids, c.image_ids, c.metadata->'section'
      from fused f
      join public.document_chunks c on c.id = f.id and c.desk_feature = c_nclt
      join public.documents d on d.id = c.document_id
     order by f.score desc, f.vr nulls last, f.kr nulls last, f.mr nulls last, f.id;
end
$fn$;

revoke all on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) to authenticated, service_role;

-- The policy check, now, on this database: a mismatch rolls the migration back (and so the helper, the table and the replaced
-- function with it).
do $$
begin
  perform retrieval_internal.hidden_document_ids();
end
$$;

commit;
