-- Set-based document registration (F278 step 8, task C3b). Design, binding:
-- docs/research/2026-11-02-batch-registration-design.md (sections 1-7 and 11).
--
-- One admission core for two callers:
--   * ingest_register_batch: up to 100 supplied-text documents of one sealed batch per call, each
--     answered with a named outcome (admitted, existing, refused) and recorded in the batch ledger.
--   * ingest_register_text (unchanged contract, admin-ingest) and ingest_register_text_unmapped:
--     the same core for one document, re-raising the messages they raised before. The one rule
--     they gain is the duplicate-text refusal (design 11, Q3 accepted):
--       supplied text: conflict: another document holds this text
-- Registration writes documents, text inputs, jobs, links and the ledger only. It never reads or
-- writes document_chunks or desk_rows (it locks desk_rows rows, as before).
--
-- The core, shared by both callers (helpers; no grants):
--   ingest_admit_parse(p)            payload size, payload hash, JSON           (no locks)
--   ingest_admit_tier(r)             'law' | 'national' | null, as before
--   ingest_admit_shape(r, expected)  source, title, text, review, text hash, chunk plan (no locks)
--   ingest_admit_law(r, fingerprint) law_reconcile held / stale mapping   (caller holds 724892)
--   ingest_admit_lock(...)           every lock of a call, in one order (below)
--   ingest_admit_document(d, o)      existing source, policy gates, Law, F266, duplicate text,
--                                    then the writes; returns a verdict instead of raising
--   ingest_admit_message(reason, detail)  the single-document path's message for a reason
--
-- Lock order, the same on every path (design 5.2):
--   1. the global law lock 724892 (Law only; the single path takes it in ingest_register_text);
--   2. per-source locks hashtextextended(source_key, 724891), sorted by lock value;
--   3. per-text locks hashtextextended(text_sha256, 724894), sorted;
--   4. per-answer locks hashtextextended(answer_key, 724893), sorted;
--   5. documents of existing keys FOR SHARE by source_key, then the question rows of new answers
--      FOR UPDATE by (tier, feature, row_key).
-- The existing-key branch writes nothing, so it takes FOR SHARE (it was FOR UPDATE): a rerun no
-- longer blocks the worker's chunk writes once Phase B's chunk trigger takes documents FOR SHARE.
--
-- Duplicate text (design 3): a document is refused duplicate_text when another documents row holds
-- the same content_sha256 under another source_key, whatever its state, except the empty-text hash
-- of a pending PDF upload. The text lock (3 above) serialises it; documents_content_sha256 (partial,
-- not unique: the legacy paths may still write duplicates) keeps it an index probe.
--
-- The batch ledger (design 7.2). RLS on, no policies; service_role may SELECT; corpus_ingest has no
-- table privilege and reads through the functions.
--   ingest_collection_policies  one approved policy per collection (ingest_policy_approve only)
--   ingest_batches              one sealed manifest of one collection; a snapshot of its policy
--   ingest_batch_items          one row per manifest document and its decided outcome
--   ingest_batch_events         stop, resume and requeue, with the session user
--   ingest_batch_acceptance     D2's four checks (written by D2; read through ingest_batch_status)
--   ingest_settings             max_running (2) and claim_batch (1): today's behaviour
--   ingest_jobs.batch_id        nullable, no default (no table rewrite)
-- Counts (admitted, existing, refused by reason) and spend are computed from the items and jobs
-- when read, never stored, so they cannot drift from what they count.
--
-- Batch states move forward only: open -> sealed -> registering -> registered (every item decided)
-- -> indexing -> indexed (every admitted and existing item's job succeeded) -> accepted. stopped is
-- reachable from any state before accepted; ingest_batch_resume (service_role) returns it to the
-- state it was stopped from.
--
-- ingest_claim keeps its rules and gains two: max_running and claim_batch come from ingest_settings,
-- and a job whose batch is stopped, or over its spend reservation, its collection's budget or its
-- policy's failure rate, is not claimed (the batch is stopped with that reason). One claim returns
-- jobs of one group: the first due job's batch, or jobs without a batch as before. A batch group is
-- capped at claim_batch; jobs without a batch keep the previous cap, least(p_limit, free slots).
--
-- Functions and who may execute them (all security definer, search_path public, extensions):
--   corpus_ingest and service_role:
--     ingest_batch_open(jsonb), ingest_batch_add_items(uuid, jsonb), ingest_batch_seal(uuid),
--     ingest_register_batch(uuid, jsonb, boolean, boolean), ingest_batch_status(uuid, text[]),
--     ingest_batch_stop(uuid, text), ingest_batch_requeue(uuid, uuid[]), ingest_text_holders(text[])
--   service_role only: ingest_policy_approve(jsonb), ingest_batch_resume(uuid, jsonb)
--   nobody (owner only): every helper above, ingest_batch_block_reason(uuid),
--     ingest_batch_mark_stopped(uuid, text, boolean), ingest_batch_manifest_sha256(uuid)
--
-- corpus_ingest is created NOLOGIN, with no password, here (developer decision, design 11). The
-- developer enables its login out of band. The migration refuses a pre-existing corpus_ingest that
-- can log in, has any elevated attribute or belongs to another role.
--
-- The manifest hash (ingest_batch_seal) is SHA-256, lowercase hex, over the UTF-8 bytes of one line
-- per item, sorted by source_key in byte order (collate "C"):
--   source_key TAB payload_sha256 TAB content_sha256 TAB chunks TAB est_tokens LF
-- src/lib/batchManifest.js computes the same for the runner.
--
-- No function here has a SET clause for a custom setting (NTER's migration role is not a
-- superuser). run.sh applies this file as a non-superuser.
--
-- Down, only while no ingest_jobs row has a batch_id (after that, stop the batches and keep the
-- ledger, as docs/operations/supplied-text-import.md prescribes for supplied text):
--
--   begin;
--   drop function public.ingest_register_batch(uuid, jsonb, boolean, boolean);
--   drop function public.ingest_batch_open(jsonb);
--   drop function public.ingest_batch_add_items(uuid, jsonb);
--   drop function public.ingest_batch_seal(uuid);
--   drop function public.ingest_batch_status(uuid, text[]);
--   drop function public.ingest_batch_stop(uuid, text);
--   drop function public.ingest_batch_requeue(uuid, uuid[]);
--   drop function public.ingest_batch_resume(uuid, jsonb);
--   drop function public.ingest_text_holders(text[]);
--   drop function public.ingest_policy_approve(jsonb);
--   drop function public.ingest_batch_block_reason(uuid);
--   drop function public.ingest_batch_mark_stopped(uuid, text, boolean);
--   drop function public.ingest_batch_manifest_sha256(uuid);
--   drop function public.ingest_admit_document(jsonb, jsonb);
--   drop function public.ingest_admit_lock(boolean, text[], text[], text[], jsonb);
--   drop function public.ingest_admit_law(jsonb, text);
--   drop function public.ingest_admit_message(text, jsonb);
--   drop function public.ingest_admit_shape(jsonb, jsonb);
--   drop function public.ingest_admit_adapter(jsonb);
--   drop function public.ingest_admit_tier(jsonb);
--   drop function public.ingest_admit_parse(jsonb);
--   drop table public.ingest_batch_acceptance, public.ingest_batch_events, public.ingest_batch_items;
--   alter table public.ingest_jobs drop column batch_id;
--   drop table public.ingest_batches, public.ingest_collection_policies, public.ingest_settings;
--   drop index public.documents_content_sha256;
--   revoke usage on schema public from corpus_ingest;
--   -- run 20261022230537_supplied_text_connection.sql's "create or replace function public.ingest_claim";
--   -- run 20261028130000_pq_admission_links.sql's "create or replace function public.ingest_register_text_unmapped";
--   -- run 20261023184450_law_listing_publication.sql's "create function public.ingest_register_text" as create or replace;
--   -- then, as a role with CREATEROLE and only once nothing is granted to it: drop role corpus_ingest;
--   commit;

-- ---------------------------------------------------------------------------
-- The ingestion role. No login, no password, no attribute, no membership.

do $$
begin
  if not exists (select from pg_roles where rolname = 'corpus_ingest') then
    create role corpus_ingest nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls noreplication;
  end if;
  if exists (select from pg_roles where rolname = 'corpus_ingest'
              and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolreplication)) then
    raise exception 'batch registration: role corpus_ingest exists with login or elevated attributes; refusing to continue';
  end if;
  if exists (select from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'corpus_ingest') then
    raise exception 'batch registration: role corpus_ingest is a member of another role; refusing to continue';
  end if;
end;
$$;
grant usage on schema public to corpus_ingest;

-- ---------------------------------------------------------------------------
-- Tables.

create table public.ingest_settings (
  singleton   boolean primary key default true check (singleton),
  max_running int not null default 2 check (max_running between 1 and 64),
  claim_batch int not null default 1 check (claim_batch between 1 and 32),
  decision_id text,
  updated_at  timestamptz not null default now()
);
insert into public.ingest_settings (singleton) values (true);

create table public.ingest_collection_policies (
  collection            text primary key check (collection ~ '^[a-z0-9][a-z0-9_.:-]{0,199}$'),
  policy_sha256         text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
  admitted              jsonb not null,
  licence_classes       text[] not null,
  min_chars_per_page    int not null check (min_chars_per_page >= 0),
  min_pages_for_density int not null check (min_pages_for_density >= 1),
  require_page_count    boolean not null,
  budget_usd            numeric not null check (budget_usd > 0),
  chunk_ceiling         int not null check (chunk_ceiling > 0),
  stop_thresholds       jsonb not null,
  decision_id           text not null,
  approver              text not null,
  evidence_sha256       text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  active                boolean not null,
  approved_by           text not null default session_user,
  approved_at           timestamptz not null default now()
);

create table public.ingest_batches (
  id              uuid primary key default gen_random_uuid(),
  collection      text not null references public.ingest_collection_policies(collection),
  manifest_sha256 text not null unique check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  policy_sha256   text not null,
  policy          jsonb not null,   -- the policy as approved when the batch was opened
  state           text not null default 'open'
                  check (state in ('open','sealed','registering','registered','indexing','indexed','accepted','stopped')),
  stopped_from    text check (stopped_from in ('open','sealed','registering','registered','indexing','indexed')),
  stop_reason     text,
  items_planned   int not null check (items_planned between 1 and 10000),
  chunks_planned  int not null check (chunks_planned >= 1),
  est_tokens      bigint not null check (est_tokens >= 0),
  est_cost_usd    numeric not null check (est_cost_usd > 0),
  runner_commit   text not null check (runner_commit ~ '^[a-f0-9]{7,40}$'),
  opened_by       text not null default session_user,
  created_at      timestamptz not null default now(),
  sealed_at       timestamptz,
  stopped_at      timestamptz,
  updated_at      timestamptz not null default now(),
  constraint ingest_batches_stop check ((state = 'stopped') = (stop_reason is not null and stopped_from is not null))
);
create index ingest_batches_collection on public.ingest_batches (collection);

create table public.ingest_batch_items (
  batch_id       uuid not null references public.ingest_batches(id),
  source_key     text not null check (length(source_key) between 1 and 1024 and source_key !~ '[\x01-\x1F\x7F]'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  chunks         int not null check (chunks between 1 and 800),
  est_tokens     bigint not null check (est_tokens >= 0),
  outcome        text not null default 'planned' check (outcome in ('planned','admitted','existing','refused')),
  reason         text,
  detail         jsonb,
  document_id    uuid,   -- no foreign key: the ledger outlives a discarded document
  job_id         uuid,
  requeues       int not null default 0 check (requeues between 0 and 1),
  decided_at     timestamptz,
  primary key (batch_id, source_key),
  constraint ingest_batch_items_decided check ((outcome = 'planned') = (decided_at is null)
    and (outcome = 'refused') = (reason is not null))
);
create index ingest_batch_items_job on public.ingest_batch_items (job_id) where job_id is not null;

create table public.ingest_batch_events (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.ingest_batches(id),
  event      text not null check (event in ('stopped','resumed','requeued')),
  detail     jsonb not null default '{}',
  actor      text not null default session_user,
  created_at timestamptz not null default now()
);
create index ingest_batch_events_batch on public.ingest_batch_events (batch_id, id);

create table public.ingest_batch_acceptance (
  batch_id    uuid not null references public.ingest_batches(id),
  check_name  text not null check (check_name in ('text_hash','chunks_vectors','links_full','retrieval_probe')),
  sample      uuid[] not null,
  passed      boolean not null,
  evidence    jsonb not null default '{}',
  recorded_at timestamptz not null default now(),
  primary key (batch_id, check_name)
);

alter table public.ingest_jobs add column batch_id uuid references public.ingest_batches(id);
create index ingest_jobs_batch on public.ingest_jobs (batch_id, status) where batch_id is not null;

create index documents_content_sha256 on public.documents (content_sha256)
  where content_sha256 <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

alter table public.ingest_settings            enable row level security;
alter table public.ingest_collection_policies enable row level security;
alter table public.ingest_batches             enable row level security;
alter table public.ingest_batch_items         enable row level security;
alter table public.ingest_batch_events        enable row level security;
alter table public.ingest_batch_acceptance    enable row level security;
revoke all on table public.ingest_settings, public.ingest_collection_policies, public.ingest_batches,
  public.ingest_batch_items, public.ingest_batch_events, public.ingest_batch_acceptance
  from public, anon, authenticated, service_role;
grant select on table public.ingest_settings, public.ingest_collection_policies, public.ingest_batches,
  public.ingest_batch_items, public.ingest_batch_events, public.ingest_batch_acceptance to service_role;

-- ---------------------------------------------------------------------------
-- The admission core.

-- Size, payload hash and JSON, in the order ingest_register_text_unmapped checked them.
create function public.ingest_admit_parse(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare h text;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p->>'payload') > 4000000 then
    return jsonb_build_object('reason', 'bad_payload');
  end if;
  h := encode(sha256(convert_to(p->>'payload', 'UTF8')), 'hex');
  if h is null or h is distinct from p->>'payload_sha256' then
    return jsonb_build_object('reason', 'payload_hash_mismatch');
  end if;
  if not pg_input_is_valid(p->>'payload', 'jsonb') then
    return jsonb_build_object('reason', 'bad_payload', 'detail', 'invalid_json');
  end if;
  return jsonb_build_object('r', (p->>'payload')::jsonb, 'h', h);
end $$;

-- The two admitted tiers, exactly as ingest_register_text_unmapped decided them (20261028130000).
create function public.ingest_admit_tier(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions as $$
 select case
   when coalesce(r->>'source_key','') like 'law:%' and r->>'desk_tier' = 'law' then 'law'
   when coalesce(r->>'source_key','') ~ '^[0-9a-f]{40}$' and r->>'desk_tier' = 'national'
     and r->>'desk_feature' = 'Parliamentary Question Database'
     and public.pq_answer_key(r->>'file_url') is not null then 'national'
 end
$$;

-- The batch path's collection adapters (design 1). A collection without one is refused no_adapter.
create function public.ingest_admit_adapter(r jsonb) returns text
language sql immutable security definer set search_path = public, extensions as $$
 select case
   when r->>'desk_tier' = 'law' then 'law'
   when r->>'desk_tier' = 'national' and r->>'desk_feature' = 'Parliamentary Question Database' then 'lok_sabha_answers'
 end
$$;

-- The shape checks of ingest_register_text_unmapped, in its order, as reasons.
create function public.ingest_admit_shape(r jsonb, expected jsonb) returns text
language plpgsql immutable security definer set search_path = public, extensions as $$
begin
  if public.ingest_admit_tier(r) is null or length(coalesce(r->>'title','')) not between 1 and 300
    or length(coalesce(r->>'text','')) not between 1 and 600000
    or nullif(r->>'desk_feature','') is null
    or r#>>'{review,status}' is distinct from 'eligible'
    or r->>'text_sha256' is distinct from encode(sha256(convert_to(r->>'text','UTF8')),'hex') then
    return 'invalid_source_or_text_hash';
  end if;
  if jsonb_typeof(expected) is distinct from 'array' or jsonb_array_length(expected) not between 1 and 800 then
    return 'bad_chunks';
  end if;
  if exists(select 1 from jsonb_array_elements(expected) e where coalesce(e->>'chunk_hash','') !~ '^[a-f0-9]{64}$' or coalesce(e->>'embed_hash','') !~ '^[a-f0-9]{64}$')
    or (select count(distinct e->>'chunk_hash') from jsonb_array_elements(expected) e) <> jsonb_array_length(expected) then
    return 'duplicate_or_invalid_chunks';
  end if;
  return null;
end $$;

-- A new Law source: law_reconcile must not hold it, and the caller's fingerprint must be current.
-- The caller holds the global law lock 724892 and has checked that the source is new.
create function public.ingest_admit_law(r jsonb, p_fingerprint text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare proposal jsonb;
begin
  proposal := public.law_reconcile(jsonb_build_object('record', r));
  if proposal->>'status' = 'held' then
    return jsonb_build_object('reason', 'law_admission_held', 'detail', proposal->'reasons');
  end if;
  if p_fingerprint is distinct from proposal->>'fingerprint' then
    return jsonb_build_object('reason', 'stale_mapping');
  end if;
  return null;
end $$;

-- The single-document path's message for each reason: the text it raised before, byte for byte.
create function public.ingest_admit_message(p_reason text, p_detail jsonb) returns text
language sql immutable security definer set search_path = public, extensions as $$
 select case p_reason
   when 'bad_payload' then 'supplied text: bad payload'
   when 'payload_hash_mismatch' then 'supplied text: payload hash mismatch'
   when 'invalid_source_or_text_hash' then 'supplied text: invalid source or text hash'
   when 'bad_chunks' then 'supplied text: bad chunks'
   when 'duplicate_or_invalid_chunks' then 'supplied text: duplicate or invalid chunks'
   when 'immutable_conflict' then 'supplied text: conflict: existing source is immutable'
   when 'legacy_source' then 'supplied text: conflict: existing source is immutable'
   when 'missing_job' then 'supplied text: conflict: missing job'
   when 'answer_key_conflict' then 'supplied text: national question held: answer_key_conflict'
   when 'house_conflict' then 'supplied text: national question held: house_conflict'
   when 'subject_conflict' then 'supplied text: national question held: subject_conflict'
   when 'date_conflict' then 'supplied text: national question held: date_conflict'
   when 'ministry_conflict' then 'supplied text: national question held: ministry_conflict'
   when 'file_url_held' then 'supplied text: conflict: another document holds this file_url'
   when 'answer_held' then 'supplied text: conflict: another document holds this answer'
   when 'no_desk_row' then 'supplied text: national question has no desk row for its file_url'
   when 'duplicate_text' then 'supplied text: conflict: another document holds this text'
   when 'law_admission_held' then 'law listing: admission held ' || coalesce(p_detail::text, '')
   when 'stale_mapping' then 'law listing: stale mapping'
   else 'supplied text: refused: ' || coalesce(p_reason, 'unknown')
 end
$$;

-- Every lock of one call, in the one order. Returns the source keys that already exist; their
-- documents rows are held FOR SHARE. Question rows are locked only for answers of new sources.
create function public.ingest_admit_lock(p_law boolean, p_sources text[], p_texts text[], p_answers text[], p_pq jsonb)
returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare k bigint; v_existing text[];
begin
  if p_law then perform pg_advisory_xact_lock(724892); end if;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724891) order by hashtextextended(s, 724891))
                                 from unnest(p_sources) s where s is not null), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724894) order by hashtextextended(s, 724894))
                                 from unnest(p_texts) s
                                where s is not null and s <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  foreach k in array coalesce((select array_agg(distinct hashtextextended(s, 724893) order by hashtextextended(s, 724893))
                                 from unnest(p_answers) s where s is not null), '{}') loop
    perform pg_advisory_xact_lock(k);
  end loop;
  select coalesce(array_agg(x.source_key order by x.source_key), '{}') into v_existing from (
    select d.source_key from public.documents d where d.source_key = any(p_sources) order by d.source_key for share
  ) x;
  perform 1 from (
    select 1 from public.desk_rows q
     where q.tier = 'national' and q.feature = 'Parliamentary Question Database'
       and q.row->>'source_url' in (select e->>'file_url' from jsonb_array_elements(coalesce(p_pq, '[]')) e
                                     where not (e->>'source_key' = any(v_existing)))
     order by q.tier, q.feature, q.row_key for update
  ) x;
  return v_existing;
end $$;

-- One document, after every lock is held: the existing-source branch, then (batch only) the policy
-- gates, then Law (batch only; the single path checked it first, as before), F266 and duplicate
-- text, then the writes. A refusal writes nothing and returns {outcome:'refused', reason, detail}.
--   d: {p (the request: payload, payload_sha256, expected, pages, sections, actor?,
--       mapping_fingerprint?), r (the parsed payload), h (its hash), required_checks}
--   o: {batch_id?, policy? (the batch's policy snapshot), law_check}
create function public.ingest_admit_document(d jsonb, o jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  p jsonb := d->'p'; r jsonb := d->'r'; h text := d->>'h'; expected jsonb := (d->'p')->'expected';
  pol jsonb := o->'policy'; v_batch uuid := (o->>'batch_id')::uuid;
  doc public.documents%rowtype; saved public.ingest_text_inputs%rowtype; j public.ingest_jobs%rowtype;
  v_tier text := public.ingest_admit_tier(r); v_text text := r->>'text';
  v_key text; c jsonb; w record; n integer := 0; v_rows text[] := '{}'; holder record; v jsonb;
  meta jsonb; lc text; k text; np int; c_empty constant text := 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
begin
  select * into doc from public.documents where source_key = r->>'source_key';
  if found then
    select * into saved from public.ingest_text_inputs where document_id = doc.id;
    if not found then
      return jsonb_build_object('outcome','refused','reason','legacy_source','detail',jsonb_build_object('document_id',doc.id));
    end if;
    if saved.payload_sha256 <> h or saved.expected <> expected then
      return jsonb_build_object('outcome','refused','reason','immutable_conflict','detail',jsonb_build_object('document_id',doc.id));
    end if;
    select * into j from public.ingest_jobs where document_id = doc.id order by created_at desc, id desc limit 1;
    if not found then
      return jsonb_build_object('outcome','refused','reason','missing_job','detail',jsonb_build_object('document_id',doc.id));
    end if;
    return jsonb_build_object('outcome','existing','document_id',doc.id,'job_id',j.id,'job_status',j.status);
  end if;

  if pol is not null then
    lc := coalesce(r->>'licence_class', '');
    if lc like '%PERSONAL_DATA%' or not (lc = any(array(select jsonb_array_elements_text(pol->'licence_classes')))) then
      return jsonb_build_object('outcome','refused','reason','licence_not_admitted','detail',jsonb_build_object('licence_class',lc));
    end if;
    if r->'servable' = 'false'::jsonb then
      return jsonb_build_object('outcome','refused','reason','not_servable');
    end if;
    for k in select jsonb_array_elements_text(coalesce(d->'required_checks', '[]')) loop
      if r#>'{review,checks}'->k is distinct from 'true'::jsonb then
        return jsonb_build_object('outcome','refused','reason','review_incomplete','detail',jsonb_build_object('check',k));
      end if;
    end loop;
    if coalesce(jsonb_typeof(r->'n_chars'),'null') <> 'null' and r->'n_chars' <> to_jsonb(length(v_text)) then
      return jsonb_build_object('outcome','refused','reason','n_chars_mismatch',
        'detail',jsonb_build_object('declared',r->'n_chars','actual',length(v_text)));
    end if;
    np := case when jsonb_typeof(r->'pages') = 'array' then jsonb_array_length(r->'pages') else 0 end;
    foreach k in array array['n_pages','page_count'] loop
      if coalesce(jsonb_typeof(r->k),'null') <> 'null' and r->k <> to_jsonb(np) then
        return jsonb_build_object('outcome','refused','reason','page_count_mismatch',
          'detail',jsonb_build_object('field',k,'declared',r->k,'pages',np));
      end if;
    end loop;
    if v_text ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      return jsonb_build_object('outcome','refused','reason','control_codes');
    end if;
    -- Declared counts equal the page spans (checked above), so the spans are the page count.
    if np = 0 then
      if (pol->>'require_page_count')::boolean then
        return jsonb_build_object('outcome','refused','reason','no_page_count');
      end if;
    elsif np >= (pol->>'min_pages_for_density')::int
      and length(v_text)::numeric / np < (pol->>'min_chars_per_page')::numeric then
      return jsonb_build_object('outcome','refused','reason','thin_text','detail',jsonb_build_object(
        'n_pages',np,'chars',length(v_text),'chars_per_page',round(length(v_text)::numeric / np, 1),'file_url',r->>'file_url'));
    end if;
  end if;

  if coalesce((o->>'law_check')::boolean, false) and starts_with(coalesce(r->>'source_key',''), 'law:') then
    v := public.ingest_admit_law(r, p->>'mapping_fingerprint');
    if v is not null then return jsonb_build_object('outcome','refused') || v; end if;
  end if;

  if v_tier = 'national' then
    -- F266: the document is the answer file behind one or more question rows, and says so itself.
    v_key := public.pq_answer_key(r->>'file_url');
    c := coalesce(r->'citation', '{}'::jsonb);
    if r ? 'document_key_suggested' and r->>'document_key_suggested' is distinct from v_key then
      return jsonb_build_object('outcome','refused','reason','answer_key_conflict');
    end if;
    for w in select q.row_key, q.row from public.desk_rows q
              where q.tier='national' and q.feature='Parliamentary Question Database'
                and q.row->>'source_url' = r->>'file_url'
              order by q.row_key for update loop
      n := n + 1;
      v_rows := v_rows || w.row_key;
      if public.pq_answer_key(w.row->>'source_url') is distinct from v_key then
        return jsonb_build_object('outcome','refused','reason','answer_key_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'house') is null or public.pq_norm(c->>'house') is distinct from public.pq_norm(w.row->>'house') then
        return jsonb_build_object('outcome','refused','reason','house_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'subject') is null or public.pq_norm(c->>'subject') is distinct from public.pq_norm(w.row->>'subject') then
        return jsonb_build_object('outcome','refused','reason','subject_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_date(c->>'answered_on') is null or public.pq_date(c->>'answered_on') is distinct from public.pq_date(w.row->>'date') then
        return jsonb_build_object('outcome','refused','reason','date_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
      if public.pq_norm(c->>'ministry') is null or public.pq_norm(c->>'ministry') is distinct from public.pq_norm(w.row->>'ministry') then
        return jsonb_build_object('outcome','refused','reason','ministry_conflict','detail',jsonb_build_object('row_key',w.row_key)); end if;
    end loop;
    select x.id, x.source_key into holder from public.documents x where x.desk_tier='national'
       and (x.file_url = r->>'file_url' or public.pq_answer_key(x.file_url) = v_key) order by x.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','file_url_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    -- Older pack imports carry no file_url; their pack file name names the same answer file.
    select x.id, x.source_key into holder from public.documents x
     where x.desk_tier='national' and x.desk_feature='Parliamentary Question Database'
       and (x.metadata->>'document_key_suggested' = v_key
         or lower(regexp_replace(coalesce(x.metadata->>'source_path',''),'^.*/',''))
            = lower(split_part(v_key,':',3) || '_' || split_part(v_key,':',4) || '.pdf'))
     order by x.id limit 1;
    if found then
      return jsonb_build_object('outcome','refused','reason','answer_held',
        'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
    end if;
    if n = 0 then return jsonb_build_object('outcome','refused','reason','no_desk_row'); end if;
  end if;

  -- Design 3: one text, one document. The holder is named, never its text.
  select x.id, x.source_key into holder from public.documents x
   where x.content_sha256 = r->>'text_sha256' and x.source_key <> r->>'source_key'
     and x.content_sha256 <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
   order by x.id limit 1;
  if found then
    return jsonb_build_object('outcome','refused','reason','duplicate_text',
      'detail',jsonb_build_object('holder_document_id',holder.id,'holder_source_key',holder.source_key));
  end if;

  meta := (r - 'text' - 'pages' - 'sections' - 'source_key' - 'title' - 'desk_tier' - 'desk_feature') ||
    jsonb_build_object('origin','supplied-text','text_chunking_mode','section_context_v1','payload_sha256',h,
     'supplied_pages',coalesce(p->'pages','[]'::jsonb),'supplied_sections',coalesce(p->'sections','[]'::jsonb),'citation_offset_encoding','utf16');
  insert into public.documents(source_key,title,file_name,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata,source_mime)
  values(r->>'source_key',r->>'title',r->>'file_name',r->>'file_url',v_tier,r->>'desk_feature',r->>'text_sha256',r->>'text',meta,'text/plain') returning * into doc;
  insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected) values(doc.id,p->>'payload',h,expected);
  -- requested_by references auth.users: a batch has no person behind it (design 1), so it stays null.
  insert into public.ingest_jobs(document_id,input_kind,stage,file_sha256,pages_total,requested_by,batch_id)
  values(doc.id,'supplied_text','index',r->>'text_sha256',jsonb_array_length(coalesce(p->'pages','[]'::jsonb)),
         case when v_batch is null then (p->>'actor')::uuid end, v_batch) returning * into j;
  if v_tier = 'national' then
    -- The same link record_mapping_apply writes (F257), bound to the admitted document.
    insert into public.record_document_links(tier,feature,row_key,document_id,role,version,source_url,text_sha256,
      row_sha256,document_identity_sha256,fingerprint,decision_id,approver,evidence_sha256)
    select q.tier,q.feature,q.row_key,doc.id,'answer','1',doc.file_url,doc.content_sha256,
      encode(sha256(convert_to(q.row::text,'UTF8')),'hex'),
      encode(sha256(convert_to(jsonb_build_object('source_key',doc.source_key,'metadata',doc.metadata)::text,'UTF8')),'hex'),
      public.record_mapping_fingerprint(q.tier,q.feature,q.row_key,doc.id),
      'admission:pq-answer-key-v1','supplied-text admission',h
    from public.desk_rows q
    where q.tier='national' and q.feature='Parliamentary Question Database' and q.row_key = any(v_rows);
    update public.record_document_links l
       set expected_link_count=(select count(*) from public.record_document_links x
                                 where x.tier=l.tier and x.feature=l.feature and x.row_key=l.row_key)
     where l.tier='national' and l.feature='Parliamentary Question Database'
       and l.row_key = any(v_rows);
  end if;
  return jsonb_build_object('outcome','admitted','document_id',doc.id,'job_id',j.id,'job_status',j.status,
    'links', case when v_tier = 'national' then n end);
end $$;

-- ---------------------------------------------------------------------------
-- The single-document path: the same core, the same messages.

create or replace function public.ingest_register_text_unmapped(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v jsonb; r jsonb; reason text; res jsonb; national boolean;
begin
  v := public.ingest_admit_parse(p);
  reason := v->>'reason';
  -- An unparseable payload raised the cast error here before; keep it.
  if v->>'detail' = 'invalid_json' then perform (p->>'payload')::jsonb; end if;
  if reason is not null then raise exception '%', public.ingest_admit_message(reason, null); end if;
  r := v->'r';
  reason := public.ingest_admit_shape(r, p->'expected');
  if reason is not null then raise exception '%', public.ingest_admit_message(reason, null); end if;
  national := public.ingest_admit_tier(r) = 'national';
  perform public.ingest_admit_lock(false, array[r->>'source_key'], array[r->>'text_sha256'],
    case when national then array[public.pq_answer_key(r->>'file_url')] else '{}'::text[] end,
    case when national then jsonb_build_array(jsonb_build_object('source_key',r->>'source_key','file_url',r->>'file_url')) else '[]'::jsonb end);
  res := public.ingest_admit_document(jsonb_build_object('p',p,'r',r,'h',v->>'h'), jsonb_build_object('law_check',false));
  if res->>'outcome' = 'refused' then raise exception '%', public.ingest_admit_message(res->>'reason', res->'detail'); end if;
  if res->>'outcome' = 'existing' then
    return jsonb_build_object('document_id',res->'document_id','job_id',res->'job_id','status',res->'job_status','existing',true);
  end if;
  return jsonb_build_object('document_id',res->'document_id','job_id',res->'job_id','status',res->'job_status','existing',false,
    'links',res->'links');
end $$;
revoke all on function public.ingest_register_text_unmapped(jsonb) from public,anon,authenticated,service_role;

create or replace function public.ingest_register_text(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; v jsonb; result jsonb;
begin
 r:=(p->>'payload')::jsonb;
 if starts_with(coalesce(r->>'source_key',''),'law:') then
  perform pg_advisory_xact_lock(724892);
  if not exists(select 1 from public.documents where source_key=r->>'source_key') then
   v:=public.ingest_admit_law(r,p->>'mapping_fingerprint');
   if v is not null then raise exception '%',public.ingest_admit_message(v->>'reason',v->'detail'); end if;
  end if;
 end if;
 result:=public.ingest_register_text_unmapped(p);
 if result->>'existing'='false' then
  update public.law_publications set actor=(p->>'actor')::uuid where document_id=(result->>'document_id')::uuid and actor is null;
 end if;
 return result;
end $$;

-- ---------------------------------------------------------------------------
-- Collection policy (service_role: the supervisor records the owner's approval).

create function public.ingest_policy_approve(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admitted jsonb := p->'admitted'; v_classes text[]; v_stop jsonb := p->'stop_thresholds'; e jsonb; k text;
  v_adapters text[]; content jsonb; sha text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'ingest_policy_approve: p must be an object'; end if;
  if coalesce(p->>'collection','') !~ '^[a-z0-9][a-z0-9_.:-]{0,199}$' then raise exception 'ingest_policy_approve: invalid collection'; end if;
  if length(coalesce(p->>'decision_id','')) not between 1 and 200 or length(coalesce(p->>'approver','')) not between 1 and 200
    or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'ingest_policy_approve: decision_id, approver and evidence_sha256 are required';
  end if;
  if jsonb_typeof(v_admitted) is distinct from 'array' or jsonb_array_length(v_admitted) not between 1 and 20 then
    raise exception 'ingest_policy_approve: admitted must list 1 to 20 desks';
  end if;
  for e in select * from jsonb_array_elements(v_admitted) loop
    if jsonb_typeof(e) <> 'object' or exists(select 1 from jsonb_object_keys(e) x where x not in ('desk_tier','desk_feature','adapter','required_checks'))
      or public.ingest_admit_adapter(e) is distinct from e->>'adapter'
      or length(coalesce(e->>'desk_feature','')) not between 1 and 300
      or (e ? 'required_checks' and (jsonb_typeof(e->'required_checks') <> 'array'
          or exists(select 1 from jsonb_array_elements(e->'required_checks') x where x not in ('"title_guard"'::jsonb,'"bill_identity"'::jsonb)))) then
      raise exception 'ingest_policy_approve: invalid admitted desk %', e;
    end if;
  end loop;
  select array_agg(distinct a->>'adapter') into v_adapters from jsonb_array_elements(v_admitted) a;
  if cardinality(v_adapters) <> 1 then raise exception 'ingest_policy_approve: a collection has one adapter'; end if;
  if jsonb_typeof(p->'licence_classes') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(p->'licence_classes') x where jsonb_typeof(x) <> 'string') then
    raise exception 'ingest_policy_approve: licence_classes must be an array of strings ('''' admits a record without one)';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_classes from jsonb_array_elements_text(p->'licence_classes') x;
  if exists(select 1 from unnest(v_classes) x where x like '%PERSONAL_DATA%') then
    raise exception 'ingest_policy_approve: personal-data licence classes are never admitted';
  end if;
  if jsonb_typeof(v_stop) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(v_stop) x where x not in ('refusal_share','refusal_share_by_reason','failure_rate','uncertain_max','min_decided'))
    or jsonb_typeof(v_stop->'refusal_share') is distinct from 'number' or (v_stop->>'refusal_share')::numeric not between 0 and 1
    or jsonb_typeof(v_stop->'failure_rate') is distinct from 'number' or (v_stop->>'failure_rate')::numeric not between 0 and 1
    or jsonb_typeof(v_stop->'uncertain_max') is distinct from 'number' or (v_stop->>'uncertain_max')::numeric < 0
    or (v_stop->>'uncertain_max')::numeric <> trunc((v_stop->>'uncertain_max')::numeric)
    or jsonb_typeof(v_stop->'min_decided') is distinct from 'number' or (v_stop->>'min_decided')::numeric < 1
    or (v_stop->>'min_decided')::numeric <> trunc((v_stop->>'min_decided')::numeric)
    or (v_stop ? 'refusal_share_by_reason' and (jsonb_typeof(v_stop->'refusal_share_by_reason') <> 'object'
        or exists(select 1 from jsonb_each(v_stop->'refusal_share_by_reason') x
                   where jsonb_typeof(x.value) <> 'number' or (x.value#>>'{}')::numeric not between 0 and 1))) then
    raise exception 'ingest_policy_approve: stop_thresholds needs refusal_share, failure_rate (0-1), uncertain_max (>= 0) and min_decided (>= 1)';
  end if;
  foreach k in array array['min_chars_per_page','min_pages_for_density','chunk_ceiling'] loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric <> trunc((p->>k)::numeric) then
      raise exception 'ingest_policy_approve: % must be an integer', k;
    end if;
  end loop;
  if jsonb_typeof(p->'require_page_count') is distinct from 'boolean' or jsonb_typeof(p->'budget_usd') is distinct from 'number'
    or (p ? 'active' and jsonb_typeof(p->'active') is distinct from 'boolean') then
    raise exception 'ingest_policy_approve: require_page_count (boolean), budget_usd (number) and active (boolean, optional) are required';
  end if;
  content := jsonb_build_object('collection',p->>'collection','admitted',v_admitted,'licence_classes',to_jsonb(v_classes),
    'min_chars_per_page',(p->>'min_chars_per_page')::int,'min_pages_for_density',(p->>'min_pages_for_density')::int,
    'require_page_count',(p->>'require_page_count')::boolean,'budget_usd',(p->>'budget_usd')::numeric,
    'chunk_ceiling',(p->>'chunk_ceiling')::int,'stop_thresholds',v_stop);
  sha := encode(sha256(convert_to(content::text,'UTF8')),'hex');
  insert into public.ingest_collection_policies(collection,policy_sha256,admitted,licence_classes,min_chars_per_page,
    min_pages_for_density,require_page_count,budget_usd,chunk_ceiling,stop_thresholds,decision_id,approver,evidence_sha256,active)
  values(p->>'collection',sha,v_admitted,v_classes,(p->>'min_chars_per_page')::int,(p->>'min_pages_for_density')::int,
    (p->>'require_page_count')::boolean,(p->>'budget_usd')::numeric,(p->>'chunk_ceiling')::int,v_stop,
    p->>'decision_id',p->>'approver',p->>'evidence_sha256',coalesce((p->>'active')::boolean,true))
  on conflict (collection) do update set policy_sha256=excluded.policy_sha256,admitted=excluded.admitted,
    licence_classes=excluded.licence_classes,min_chars_per_page=excluded.min_chars_per_page,
    min_pages_for_density=excluded.min_pages_for_density,require_page_count=excluded.require_page_count,
    budget_usd=excluded.budget_usd,chunk_ceiling=excluded.chunk_ceiling,stop_thresholds=excluded.stop_thresholds,
    decision_id=excluded.decision_id,approver=excluded.approver,evidence_sha256=excluded.evidence_sha256,
    active=excluded.active,approved_by=session_user,approved_at=now();
  return jsonb_build_object('collection',p->>'collection','policy_sha256',sha,'active',coalesce((p->>'active')::boolean,true));
end $$;

-- ---------------------------------------------------------------------------
-- The ledger.

create function public.ingest_batch_manifest_sha256(p_batch uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
 select encode(sha256(convert_to(coalesce(string_agg(i.source_key || E'\t' || i.payload_sha256 || E'\t' || i.content_sha256
   || E'\t' || i.chunks::text || E'\t' || i.est_tokens::text || E'\n', '' order by i.source_key collate "C"), ''), 'UTF8')), 'hex')
   from public.ingest_batch_items i where i.batch_id = p_batch
$$;

create function public.ingest_batch_open(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare pol public.ingest_collection_policies%rowtype; b public.ingest_batches%rowtype; k text;
begin
  if jsonb_typeof(p) is distinct from 'object' or coalesce(p->>'manifest_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(p->>'runner_commit','') !~ '^[a-f0-9]{7,40}$' or jsonb_typeof(p->'collection') is distinct from 'string' then
    raise exception 'ingest_batch_open: collection, manifest_sha256 and runner_commit are required';
  end if;
  foreach k in array array['items_planned','chunks_planned','est_tokens','est_cost_usd'] loop
    if jsonb_typeof(p->k) is distinct from 'number' then raise exception 'ingest_batch_open: % must be a number', k; end if;
  end loop;
  if (p->>'items_planned')::numeric not between 1 and 10000 or (p->>'chunks_planned')::numeric < 1
    or (p->>'est_tokens')::numeric < 0 or (p->>'est_cost_usd')::numeric <= 0
    or (p->>'items_planned')::numeric <> trunc((p->>'items_planned')::numeric)
    or (p->>'chunks_planned')::numeric <> trunc((p->>'chunks_planned')::numeric)
    or (p->>'est_tokens')::numeric <> trunc((p->>'est_tokens')::numeric) then
    raise exception 'ingest_batch_open: items_planned 1-10000, chunks_planned >= 1, est_tokens >= 0 (integers) and est_cost_usd > 0';
  end if;
  select * into b from public.ingest_batches where manifest_sha256 = p->>'manifest_sha256';
  if found then
    if b.collection is distinct from p->>'collection' then return jsonb_build_object('refused','manifest_exists'); end if;
    return jsonb_build_object('batch_id',b.id,'state',b.state,'existing',true);
  end if;
  select * into pol from public.ingest_collection_policies where collection = p->>'collection';
  if not found then return jsonb_build_object('refused','no_collection_policy'); end if;
  if not pol.active then return jsonb_build_object('refused','policy_inactive'); end if;
  insert into public.ingest_batches(collection,manifest_sha256,policy_sha256,policy,items_planned,chunks_planned,est_tokens,est_cost_usd,runner_commit)
  values(pol.collection,p->>'manifest_sha256',pol.policy_sha256,to_jsonb(pol),(p->>'items_planned')::int,(p->>'chunks_planned')::int,
    (p->>'est_tokens')::bigint,(p->>'est_cost_usd')::numeric,p->>'runner_commit')
  on conflict (manifest_sha256) do nothing
  returning * into b;
  if not found then  -- a concurrent open of the same manifest won
    select * into b from public.ingest_batches where manifest_sha256 = p->>'manifest_sha256';
    if b.collection is distinct from p->>'collection' then return jsonb_build_object('refused','manifest_exists'); end if;
    return jsonb_build_object('batch_id',b.id,'state',b.state,'existing',true);
  end if;
  return jsonb_build_object('batch_id',b.id,'state',b.state,'existing',false);
end $$;

create function public.ingest_batch_add_items(p_batch uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; e jsonb; old public.ingest_batch_items%rowtype; added int := 0; total int;
begin
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_add_items: batch % does not exist', p_batch; end if;
  if b.state <> 'open' then raise exception 'ingest_batch_add_items: batch % is %, not open', p_batch, b.state; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception 'ingest_batch_add_items: p_items must be an array of 1 to 1000 items';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' or exists(select 1 from jsonb_object_keys(e) x where x not in ('source_key','payload_sha256','content_sha256','chunks','est_tokens'))
      or jsonb_typeof(e->'source_key') is distinct from 'string' or jsonb_typeof(e->'chunks') is distinct from 'number'
      or jsonb_typeof(e->'est_tokens') is distinct from 'number'
      or (e->>'chunks')::numeric <> trunc((e->>'chunks')::numeric) or (e->>'est_tokens')::numeric <> trunc((e->>'est_tokens')::numeric) then
      raise exception 'ingest_batch_add_items: invalid item %', left(e::text, 300);
    end if;
    insert into public.ingest_batch_items(batch_id,source_key,payload_sha256,content_sha256,chunks,est_tokens)
    values(p_batch,e->>'source_key',e->>'payload_sha256',e->>'content_sha256',(e->>'chunks')::int,(e->>'est_tokens')::bigint)
    on conflict (batch_id, source_key) do nothing;
    if found then added := added + 1;
    else
      select * into old from public.ingest_batch_items where batch_id = p_batch and source_key = e->>'source_key';
      if old.payload_sha256 <> e->>'payload_sha256' or old.content_sha256 <> e->>'content_sha256'
        or old.chunks <> (e->>'chunks')::int or old.est_tokens <> (e->>'est_tokens')::bigint then
        raise exception 'ingest_batch_add_items: % is already planned with other values', e->>'source_key';
      end if;
    end if;
  end loop;
  select count(*) into total from public.ingest_batch_items where batch_id = p_batch;
  if total > b.items_planned then
    raise exception 'ingest_batch_add_items: % items exceed the % planned', total, b.items_planned;
  end if;
  return jsonb_build_object('batch_id',p_batch,'added',added,'items',total);
end $$;

create function public.ingest_batch_seal(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; pol public.ingest_collection_policies%rowtype;
  v_items int; v_chunks bigint; v_tokens bigint; v_sha text; v_dups jsonb; v_other_chunks bigint; v_other_cost numeric;
begin
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_seal: batch % does not exist', p_batch; end if;
  if b.state <> 'open' then
    return jsonb_build_object('batch_id',b.id,'state',b.state,'items',(select count(*) from public.ingest_batch_items where batch_id=b.id),'already',true);
  end if;
  select count(*), coalesce(sum(chunks),0), coalesce(sum(est_tokens),0) into v_items, v_chunks, v_tokens
    from public.ingest_batch_items where batch_id = b.id;
  v_sha := public.ingest_batch_manifest_sha256(b.id);
  if v_sha <> b.manifest_sha256 or v_items <> b.items_planned or v_chunks <> b.chunks_planned or v_tokens <> b.est_tokens then
    return jsonb_build_object('batch_id',b.id,'state','open','refused','manifest_hash_mismatch','detail',jsonb_build_object(
      'computed_sha256',v_sha,'items',v_items,'chunks',v_chunks,'est_tokens',v_tokens));
  end if;
  select jsonb_agg(x.content_sha256 order by x.content_sha256) into v_dups from (
    select content_sha256 from public.ingest_batch_items where batch_id = b.id group by content_sha256 having count(*) > 1 limit 20) x;
  if v_dups is not null then
    return jsonb_build_object('batch_id',b.id,'state','open','refused','manifest_duplicate_text','detail',jsonb_build_object('content_sha256',v_dups));
  end if;
  select * into pol from public.ingest_collection_policies where collection = b.collection;
  select coalesce(sum(chunks_planned),0), coalesce(sum(est_cost_usd),0) into v_other_chunks, v_other_cost
    from public.ingest_batches where collection = b.collection and id <> b.id and state <> 'open';
  if not pol.active or v_other_chunks + b.chunks_planned > pol.chunk_ceiling or v_other_cost + b.est_cost_usd > pol.budget_usd then
    return jsonb_build_object('batch_id',b.id,'state','open','refused','over_policy_ceiling','detail',jsonb_build_object(
      'policy_active',pol.active,'chunks_reserved',v_other_chunks,'chunk_ceiling',pol.chunk_ceiling,
      'cost_reserved_usd',v_other_cost,'budget_usd',pol.budget_usd));
  end if;
  update public.ingest_batches set state='sealed', sealed_at=now(), updated_at=now() where id = b.id;
  return jsonb_build_object('batch_id',b.id,'state','sealed','items',v_items);
end $$;

-- Stops a batch with a reason; the first reason is kept. With p_skip_locked the row is skipped when
-- another transaction holds it (the claim must not wait behind a registration call).
create function public.ingest_batch_mark_stopped(p_batch uuid, p_reason text, p_skip_locked boolean) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype;
begin
  if p_skip_locked then
    select * into b from public.ingest_batches where id = p_batch for update skip locked;
  else
    select * into b from public.ingest_batches where id = p_batch for update;
  end if;
  if not found or b.state in ('stopped','accepted') then return false; end if;
  update public.ingest_batches set state='stopped', stopped_from=b.state, stop_reason=p_reason, stopped_at=now(), updated_at=now()
   where id = p_batch;
  insert into public.ingest_batch_events(batch_id,event,detail) values(p_batch,'stopped',jsonb_build_object('reason',p_reason,'from',b.state));
  return true;
end $$;

-- Why a batch's jobs may not be claimed, or null. Spend is summed from the jobs (model_call_logs
-- keeps the exact totals); thresholds come from the batch's policy snapshot.
create function public.ingest_batch_block_reason(p_batch uuid) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; v_spend numeric; v_budget numeric; v_failed bigint; v_done bigint; st jsonb;
begin
  select * into b from public.ingest_batches where id = p_batch;
  if not found then return 'stopped'; end if;
  if b.state = 'stopped' then return 'stopped'; end if;
  select coalesce(sum(embed_cost_usd),0), count(*) filter (where status='failed'), count(*) filter (where status in ('failed','succeeded'))
    into v_spend, v_failed, v_done from public.ingest_jobs where batch_id = p_batch;
  if v_spend >= b.est_cost_usd then return 'spend_ceiling'; end if;
  select budget_usd into v_budget from public.ingest_collection_policies where collection = b.collection;
  if (select coalesce(sum(j.embed_cost_usd),0) from public.ingest_jobs j join public.ingest_batches x on x.id = j.batch_id
       where x.collection = b.collection) >= v_budget then
    return 'collection_spend_ceiling';
  end if;
  st := b.policy->'stop_thresholds';
  if v_done >= (st->>'min_decided')::numeric and v_failed::numeric / v_done > (st->>'failure_rate')::numeric then
    return 'failure_rate';
  end if;
  return null;
end $$;

create function public.ingest_register_batch(p_batch uuid, p_documents jsonb,
                                             p_dry_run boolean default false,
                                             p_all_or_nothing boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.ingest_batches%rowtype; pol jsonb; item public.ingest_batch_items%rowtype;
  dry boolean := coalesce(p_dry_run, false); aon boolean := coalesce(p_all_or_nothing, false);
  n int; i int; e jsonb; v jsonb; r jsonb; sk text; adapter text; entry jsonb; reason text; call_reason text;
  parsed jsonb[]; res jsonb[]; pend jsonb[]; seen text[] := '{}';
  v_sources text[] := '{}'; v_texts text[] := '{}'; v_answers text[] := '{}'; v_pq jsonb := '[]'; v_law boolean := false;
  rolled_back boolean := false; out jsonb; results jsonb := '[]'; by_reason jsonb := '{}'; ocr jsonb := '[]';
  t_adm int := 0; t_ex int := 0; t_ref int := 0; t_would int := 0;
  st jsonb; v_decided bigint; w record; v_state text; v_stop text; counts jsonb;
begin
  if p_batch is null then raise exception 'ingest_register_batch: p_batch is required'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) not between 1 and 100 then
    raise exception 'ingest_register_batch: p_documents must be an array of 1 to 100 documents';
  end if;
  if octet_length(p_documents::text) > 8000000 then
    raise exception 'ingest_register_batch: a call carries at most 8 MB of documents';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_register_batch: batch % does not exist', p_batch; end if;
  pol := b.policy;
  n := jsonb_array_length(p_documents);
  parsed := array_fill(null::jsonb, array[n]); res := parsed; pend := parsed;
  call_reason := case b.state when 'open' then 'batch_not_sealed' when 'stopped' then 'batch_stopped' end;

  -- 1. Checks that need no lock: payload, manifest, adapter, collection, shape.
  for i in 1..n loop
    e := p_documents->(i-1);
    v := public.ingest_admit_parse(e);
    sk := (v->'r')->>'source_key';
    if v ? 'reason' then
      res[i] := jsonb_build_object('source_key',null,'outcome','refused','reason',v->>'reason'); continue;
    end if;
    r := v->'r';
    if sk is not null and sk = any(seen) then
      raise exception 'ingest_register_batch: source_key % appears more than once in one call', sk;
    end if;
    seen := seen || sk;
    if call_reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',call_reason); continue;
    end if;
    if (e ? 'pages' and jsonb_typeof(e->'pages') is distinct from 'array')
      or (e ? 'sections' and jsonb_typeof(e->'sections') is distinct from 'array') then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','bad_payload','detail','pages and sections must be arrays'); continue;
    end if;
    select * into item from public.ingest_batch_items where batch_id = b.id and source_key = sk;
    if not found then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','not_in_manifest'); continue;
    end if;
    if item.outcome = 'refused' then  -- decided earlier in this batch: the recorded verdict, nothing written
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',item.reason,'detail',item.detail,'replayed',true); continue;
    end if;
    reason := case
      when item.payload_sha256 <> v->>'h' then 'payload_sha256'
      when item.content_sha256 is distinct from r->>'text_sha256' then 'content_sha256'
      when jsonb_typeof(e->'expected') = 'array' and jsonb_array_length(e->'expected') <> item.chunks then 'chunks' end;
    if reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason','manifest_mismatch','detail',jsonb_build_object('field',reason)); continue;
    end if;
    -- From here a verdict is about the exact manifest document, so it is recorded in the ledger.
    adapter := public.ingest_admit_adapter(r);
    select x into entry from jsonb_array_elements(pol->'admitted') x
     where x->>'desk_tier' = r->>'desk_tier' and x->>'desk_feature' = r->>'desk_feature' and x->>'adapter' = adapter limit 1;
    reason := case when adapter is null then 'no_adapter' when entry is null then 'collection_not_admitted'
                   else public.ingest_admit_shape(r, e->'expected') end;
    if reason is not null then
      res[i] := jsonb_build_object('source_key',sk,'outcome','refused','reason',reason);
      if item.outcome = 'planned' then pend[i] := res[i]; end if;
      continue;
    end if;
    parsed[i] := jsonb_build_object('p',e,'r',r,'h',v->>'h','required_checks',coalesce(entry->'required_checks','[]'::jsonb),
                                    'item_outcome',item.outcome);
    v_sources := v_sources || sk;
    v_texts := v_texts || (r->>'text_sha256');
    if adapter = 'law' then v_law := true; end if;
    if adapter = 'lok_sabha_answers' then
      v_answers := v_answers || public.pq_answer_key(r->>'file_url');
      v_pq := v_pq || jsonb_build_array(jsonb_build_object('source_key',sk,'file_url',r->>'file_url'));
    end if;
  end loop;

  -- 2. Every lock, in the one order.
  if cardinality(v_sources) > 0 then
    perform public.ingest_admit_lock(v_law, v_sources, v_texts, v_answers, v_pq);
  end if;

  -- 3. Verdicts and writes, document by document, so a later document sees an earlier one's
  --    writes. A dry run, or an all-or-nothing call with a refusal, rolls this block back: the
  --    verdicts come from the same code that writes, and nothing is written.
  begin
    for i in 1..n loop
      if pend[i] is not null then
        update public.ingest_batch_items set outcome='refused', reason=pend[i]->>'reason', detail=pend[i]->'detail', decided_at=now()
         where batch_id = b.id and source_key = pend[i]->>'source_key' and outcome = 'planned';
      end if;
      if parsed[i] is null then continue; end if;
      sk := parsed[i]->'r'->>'source_key';
      out := jsonb_build_object('source_key',sk) || public.ingest_admit_document(parsed[i],
               jsonb_build_object('batch_id',b.id,'policy',pol,'law_check',true));
      if out->>'outcome' = 'admitted' then
        update public.ingest_batch_items set outcome='admitted', reason=null, detail=null,
          document_id=(out->>'document_id')::uuid, job_id=(out->>'job_id')::uuid, decided_at=now()
         where batch_id = b.id and source_key = sk;
      elsif parsed[i]->>'item_outcome' = 'planned' then
        update public.ingest_batch_items set outcome=out->>'outcome', reason=out->>'reason', detail=out->'detail',
          document_id=(out->>'document_id')::uuid, job_id=(out->>'job_id')::uuid, decided_at=now()
         where batch_id = b.id and source_key = sk;
      end if;
      res[i] := out;
    end loop;
    if dry or (aon and exists(select 1 from unnest(res) x where x->>'outcome' = 'refused')) then
      raise exception using errcode = 'NB001', message = 'ingest_register_batch: rolled back';
    end if;
  exception when sqlstate 'NB001' then
    rolled_back := true;
  end;

  for i in 1..n loop
    out := res[i];
    if rolled_back and out->>'outcome' = 'admitted' then
      out := (out - 'document_id' - 'job_id' - 'job_status' - 'links') || jsonb_build_object('outcome','would_admit');
    end if;
    case out->>'outcome'
      when 'admitted' then t_adm := t_adm + 1;
      when 'existing' then t_ex := t_ex + 1;
      when 'would_admit' then t_would := t_would + 1;
      else
        t_ref := t_ref + 1;
        by_reason := by_reason || jsonb_build_object(out->>'reason', coalesce((by_reason->>(out->>'reason'))::int,0) + 1);
        if out->>'reason' = 'thin_text' then
          ocr := ocr || jsonb_build_array(jsonb_build_object('source_key',out->>'source_key','file_url',out#>>'{detail,file_url}'));
        end if;
    end case;
    results := results || jsonb_build_array(out);
  end loop;

  -- 4. Batch state and the refusal stop rule (real calls only).
  v_state := b.state;
  if not rolled_back and call_reason is null then
    if v_state = 'sealed' then v_state := 'registering'; end if;
    if v_state = 'registering' and not exists(select 1 from public.ingest_batch_items where batch_id = b.id and outcome = 'planned') then
      v_state := 'registered';
    end if;
    if v_state <> b.state then
      update public.ingest_batches set state = v_state, updated_at = now() where id = b.id;
    end if;
    st := pol->'stop_thresholds';
    select count(*) into v_decided from public.ingest_batch_items where batch_id = b.id and outcome <> 'planned';
    if v_decided >= (st->>'min_decided')::numeric then
      for w in select i.reason, count(*) cnt from public.ingest_batch_items i where i.batch_id = b.id and i.outcome = 'refused'
                group by i.reason order by count(*) desc, i.reason loop
        if w.cnt::numeric / v_decided > coalesce((st->'refusal_share_by_reason'->>w.reason)::numeric, (st->>'refusal_share')::numeric) then
          v_stop := 'refusal_share:' || w.reason; exit;
        end if;
      end loop;
      if v_stop is not null and public.ingest_batch_mark_stopped(b.id, v_stop, false) then v_state := 'stopped'; end if;
    end if;
  end if;

  select jsonb_build_object('items',count(*),'planned',count(*) filter (where outcome='planned'),
    'admitted',count(*) filter (where outcome='admitted'),'existing',count(*) filter (where outcome='existing'),
    'refused',count(*) filter (where outcome='refused')) into counts
    from public.ingest_batch_items where batch_id = b.id;
  return jsonb_build_object('batch_id',b.id,'dry_run',dry,'written',not rolled_back and call_reason is null,
    'results',results,
    'totals',jsonb_build_object('admitted',t_adm,'existing',t_ex,'refused',t_ref,'would_admit',t_would,'by_reason',by_reason),
    'ocr_route',ocr,
    'batch',jsonb_build_object('state',v_state,'stop_reason',(select stop_reason from public.ingest_batches where id=b.id)) || counts);
end $$;

create function public.ingest_batch_status(p_batch uuid, p_source_keys text[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; v_next text; v_jobs record; v_items jsonb; counts jsonb; by_reason jsonb; jobs jsonb; acc jsonb;
begin
  if coalesce(cardinality(p_source_keys),0) > 1000 then raise exception 'ingest_batch_status: at most 1000 source keys'; end if;
  select * into b from public.ingest_batches where id = p_batch;
  if not found then raise exception 'ingest_batch_status: batch % does not exist', p_batch; end if;
  -- Forward moves only, derived from the jobs of the decided items.
  if b.state in ('registered','indexing') then
    select count(*) total, count(*) filter (where j.status = 'succeeded') ok,
           count(*) filter (where j.status <> 'queued' or j.attempts > 0) started
      into v_jobs
      from public.ingest_batch_items i join public.ingest_jobs j on j.id = i.job_id
     where i.batch_id = b.id and i.outcome in ('admitted','existing');
    v_next := case when v_jobs.ok = v_jobs.total then 'indexed'
                   when b.state = 'registered' and v_jobs.started > 0 then 'indexing' end;
    if v_next is not null then
      update public.ingest_batches set state = v_next, updated_at = now() where id = b.id and state = b.state;
      if found then b.state := v_next; end if;
    end if;
  end if;
  select jsonb_build_object('items',count(*),'planned',count(*) filter (where outcome='planned'),
    'admitted',count(*) filter (where outcome='admitted'),'existing',count(*) filter (where outcome='existing'),
    'refused',count(*) filter (where outcome='refused')) into counts from public.ingest_batch_items where batch_id = b.id;
  select coalesce(jsonb_object_agg(reason, cnt), '{}') into by_reason from (
    select reason, count(*) cnt from public.ingest_batch_items where batch_id = b.id and outcome='refused' group by reason) x;
  select jsonb_build_object('queued',count(*) filter (where status='queued'),'running',count(*) filter (where status='running'),
    'succeeded',count(*) filter (where status='succeeded'),'failed',count(*) filter (where status='failed'),
    'cancelled',count(*) filter (where status='cancelled'),
    'uncertain',count(*) filter (where status='failed' and error_code='text_outcome_uncertain'),
    'spend_usd',coalesce(sum(embed_cost_usd),0),'tokens',coalesce(sum(embed_tokens),0)) into jobs
    from public.ingest_jobs where batch_id = b.id;
  select coalesce(jsonb_agg(jsonb_build_object('check',check_name,'passed',passed,'sample',sample,'recorded_at',recorded_at) order by check_name),'[]')
    into acc from public.ingest_batch_acceptance where batch_id = b.id;
  if p_source_keys is not null then
    select coalesce(jsonb_agg(jsonb_build_object('source_key',i.source_key,'outcome',i.outcome,'reason',i.reason,'detail',i.detail,
        'document_id',i.document_id,'job_id',i.job_id,'job_status',j.status,'job_stage',j.stage,'error_code',j.error_code,
        'requeues',i.requeues,'indexed',d.indexed_at is not null) order by i.source_key), '[]')
      into v_items
      from public.ingest_batch_items i
      left join public.ingest_jobs j on j.id = i.job_id
      left join public.documents d on d.id = i.document_id
     where i.batch_id = b.id and i.source_key = any(p_source_keys);
  end if;
  return jsonb_build_object('batch_id',b.id,'collection',b.collection,'state',b.state,'stop_reason',b.stop_reason,
    'manifest_sha256',b.manifest_sha256,'policy_sha256',b.policy_sha256,
    'planned',jsonb_build_object('items',b.items_planned,'chunks',b.chunks_planned,'est_tokens',b.est_tokens,'est_cost_usd',b.est_cost_usd),
    'counts',counts || jsonb_build_object('by_reason',by_reason),'jobs',jobs,
    'indexed',(select count(*) from public.ingest_batch_items i join public.documents d on d.id = i.document_id
                where i.batch_id = b.id and i.outcome in ('admitted','existing') and d.indexed_at is not null),
    'acceptance',acc,'items',v_items);
end $$;

create function public.ingest_batch_stop(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype;
begin
  if coalesce(p_reason,'') !~ '^[a-z][a-z0-9_:.-]{0,99}$' then
    raise exception 'ingest_batch_stop: reason must be a short lowercase token';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_stop: batch % does not exist', p_batch; end if;
  if b.state = 'accepted' then raise exception 'ingest_batch_stop: batch % is accepted', p_batch; end if;
  if b.state = 'stopped' then
    return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',b.stop_reason,'already',true);
  end if;
  perform public.ingest_batch_mark_stopped(b.id, p_reason, false);
  return jsonb_build_object('batch_id',b.id,'state','stopped','stop_reason',p_reason,'already',false);
end $$;

create function public.ingest_batch_requeue(p_batch uuid, p_job_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; j public.ingest_jobs%rowtype; item public.ingest_batch_items%rowtype;
  v_id uuid; results jsonb := '[]'; v_uncertain bigint; v_max numeric; v_stop text;
begin
  if coalesce(cardinality(p_job_ids),0) not between 1 and 1000 then raise exception 'ingest_batch_requeue: 1 to 1000 job ids'; end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_requeue: batch % does not exist', p_batch; end if;
  v_max := (b.policy->'stop_thresholds'->>'uncertain_max')::numeric;
  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_job_ids) x) loop
    if b.state = 'stopped' or v_stop is not null then
      results := results || jsonb_build_array(jsonb_build_object('job_id',v_id,'outcome','refused','reason','batch_stopped')); continue;
    end if;
    select * into j from public.ingest_jobs where id = v_id and batch_id = p_batch for update;
    if not found then
      results := results || jsonb_build_array(jsonb_build_object('job_id',v_id,'outcome','refused','reason','not_in_batch')); continue;
    end if;
    if j.status <> 'failed' then
      results := results || jsonb_build_array(jsonb_build_object('job_id',v_id,'outcome','refused','reason','not_failed')); continue;
    end if;
    select * into item from public.ingest_batch_items where batch_id = p_batch and job_id = v_id for update;
    if item.requeues >= 1 then
      v_stop := case when j.error_code = 'text_outcome_uncertain' then 'uncertain_after_requeue' else 'failed_after_requeue' end;
    else
      select count(*) into v_uncertain from public.ingest_jobs where batch_id = p_batch and status = 'failed' and error_code = 'text_outcome_uncertain';
      if v_uncertain > v_max then v_stop := 'uncertain_count'; end if;
    end if;
    if v_stop is not null then
      perform public.ingest_batch_mark_stopped(p_batch, v_stop, false);
      results := results || jsonb_build_array(jsonb_build_object('job_id',v_id,'outcome','refused','reason',v_stop)); continue;
    end if;
    perform public.ingest_retry(v_id);
    update public.ingest_batch_items set requeues = requeues + 1 where batch_id = p_batch and job_id = v_id;
    insert into public.ingest_batch_events(batch_id,event,detail)
    values(p_batch,'requeued',jsonb_build_object('job_id',v_id,'error_code',j.error_code));
    results := results || jsonb_build_array(jsonb_build_object('job_id',v_id,'outcome','requeued'));
  end loop;
  return jsonb_build_object('batch_id',p_batch,'results',results,
    'state',(select state from public.ingest_batches where id=p_batch),'stop_reason',(select stop_reason from public.ingest_batches where id=p_batch));
end $$;

create function public.ingest_batch_resume(p_batch uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.ingest_batches%rowtype; v_cost numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' or length(coalesce(p->>'decision_id','')) not between 1 and 200
    or length(coalesce(p->>'approver','')) not between 1 and 200 or coalesce(p->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'ingest_batch_resume: decision_id, approver and evidence_sha256 are required';
  end if;
  select * into b from public.ingest_batches where id = p_batch for update;
  if not found then raise exception 'ingest_batch_resume: batch % does not exist', p_batch; end if;
  if b.state <> 'stopped' then raise exception 'ingest_batch_resume: batch % is %, not stopped', p_batch, b.state; end if;
  if p ? 'est_cost_usd' and (jsonb_typeof(p->'est_cost_usd') <> 'number' or (p->>'est_cost_usd')::numeric < b.est_cost_usd) then
    raise exception 'ingest_batch_resume: est_cost_usd may only be raised';
  end if;
  v_cost := coalesce((p->>'est_cost_usd')::numeric, b.est_cost_usd);
  update public.ingest_batches set state=b.stopped_from, stopped_from=null, stop_reason=null, stopped_at=null,
    est_cost_usd=v_cost, updated_at=now() where id = b.id;
  insert into public.ingest_batch_events(batch_id,event,detail) values(b.id,'resumed',jsonb_build_object(
    'reason',b.stop_reason,'to',b.stopped_from,'decision_id',p->>'decision_id','approver',p->>'approver',
    'evidence_sha256',p->>'evidence_sha256','est_cost_usd',v_cost));
  return jsonb_build_object('batch_id',b.id,'state',b.stopped_from,'est_cost_usd',v_cost);
end $$;

-- Live holders of the given texts: hashes, keys and ids only, never text.
create function public.ingest_text_holders(p_hashes text[])
returns table(content_sha256 text, source_key text, document_id uuid)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if coalesce(cardinality(p_hashes),0) > 10000 then raise exception 'ingest_text_holders: at most 10000 hashes'; end if;
  return query
    select d.content_sha256, d.source_key, d.id from public.documents d
     where d.content_sha256 = any(p_hashes)
       and d.content_sha256 <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
     order by d.content_sha256, d.source_key;
end $$;

-- ---------------------------------------------------------------------------
-- ingest_claim: 20261022230537's rules, with the settings row and the batch stop condition.

create or replace function public.ingest_claim(p_limit int, p_lease interval)
returns setof public.ingest_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Serialises every claim, so the cap can't be exceeded by two claims racing.
  c_lock_key           constant bigint := 4917230411;
  INGEST_MAX_ATTEMPTS  constant int    := 6;
  v_max     int;
  v_k       int;
  v_free    int;
  v_batch   uuid;
  v_reason  text;
  v_blocked uuid[] := '{}';
  v_first   public.ingest_jobs%rowtype;
begin
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'ingest_claim: p_lease must be a positive interval';
  end if;
  if p_limit is null or p_limit < 1 then
    return;
  end if;

  perform pg_advisory_xact_lock(c_lock_key);

  select s.max_running, s.claim_batch into v_max, v_k from public.ingest_settings s where s.singleton;
  v_max := coalesce(v_max, 2);
  v_k := coalesce(v_k, 1);

  -- A killed supplied-text worker can have paid for vectors without committing them.
  -- Hold an expired claim for reconciliation instead of automatically buying them again.
  update public.ingest_jobs set status='failed',claim_token=null,lease_until=null,
    error_code='text_outcome_uncertain',last_error='Expired supplied-text claim; reconcile before retry',finished_at=now()
    where input_kind='supplied_text' and status='running' and lease_until <= now();

  -- A due job already claimed INGEST_MAX_ATTEMPTS times on its step would
  -- exceed the limit with this claim: it fails instead.
  update public.ingest_jobs
     set status      = 'failed',
         claim_token = null,
         lease_until = null,
         error_code  = 'attempts_exhausted',
         last_error  = format('claimed %s times on stage %s without progress', attempts, stage),
         finished_at = now()
   where attempts >= INGEST_MAX_ATTEMPTS
     and ((status = 'queued' and next_attempt_at <= now())
          or (status = 'running' and lease_until <= now()));

  -- Paid work stops server-side, even when the runner is gone: a batch that is stopped, or has
  -- reached its spend reservation, its collection's budget or its failure rate, is not claimed.
  for v_batch in
    select distinct j.batch_id from public.ingest_jobs j
     where j.batch_id is not null
       and ((j.status = 'queued' and j.next_attempt_at <= now()) or (j.status = 'running' and j.lease_until <= now()))
  loop
    v_reason := public.ingest_batch_block_reason(v_batch);
    if v_reason is not null then
      v_blocked := v_blocked || v_batch;
      if v_reason <> 'stopped' then perform public.ingest_batch_mark_stopped(v_batch, v_reason, true); end if;
    end if;
  end loop;

  select v_max - count(*)::int into v_free
    from public.ingest_jobs
   where status = 'running' and lease_until > now();
  if v_free <= 0 then
    return;
  end if;

  -- The first due job in the usual order decides the group: its batch, or no batch.
  select j.* into v_first
    from public.ingest_jobs j
   where ((j.status = 'queued' and j.next_attempt_at <= now())
          or (j.status = 'running' and j.lease_until <= now()))
     and (j.batch_id is null or not (j.batch_id = any(v_blocked)))
   order by case when j.status = 'running' then j.lease_until else j.next_attempt_at end, j.created_at, j.id
   limit 1
   for update skip locked;
  if not found then
    return;
  end if;

  return query
    with picked as (
      select j.id
        from public.ingest_jobs j
       where ((j.status = 'queued' and j.next_attempt_at <= now())
              or (j.status = 'running' and j.lease_until <= now()))
         and j.batch_id is not distinct from v_first.batch_id
         and (j.batch_id is null or (j.input_kind = 'supplied_text' and j.stage = 'index'))
       order by case when j.status = 'running' then j.lease_until else j.next_attempt_at end, j.created_at, j.id
       limit case when v_first.batch_id is null then least(p_limit, v_free) else least(p_limit, v_free, v_k) end
       for update skip locked
    ), claimed as (
      update public.ingest_jobs j
         set status      = 'running',
             claim_token = gen_random_uuid(),
             lease_until = now() + p_lease,
             attempts    = j.attempts + 1,
             started_at  = coalesce(j.started_at, now())
        from picked
       where j.id = picked.id
      returning j.*
    )
    select * from claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute. Supabase's default privileges grant every new function broadly: revoke first.

revoke all on function
  public.ingest_admit_parse(jsonb), public.ingest_admit_tier(jsonb), public.ingest_admit_adapter(jsonb),
  public.ingest_admit_shape(jsonb, jsonb), public.ingest_admit_law(jsonb, text), public.ingest_admit_message(text, jsonb),
  public.ingest_admit_lock(boolean, text[], text[], text[], jsonb), public.ingest_admit_document(jsonb, jsonb),
  public.ingest_batch_manifest_sha256(uuid), public.ingest_batch_mark_stopped(uuid, text, boolean),
  public.ingest_batch_block_reason(uuid),
  public.ingest_policy_approve(jsonb), public.ingest_batch_resume(uuid, jsonb),
  public.ingest_batch_open(jsonb), public.ingest_batch_add_items(uuid, jsonb), public.ingest_batch_seal(uuid),
  public.ingest_register_batch(uuid, jsonb, boolean, boolean), public.ingest_batch_status(uuid, text[]),
  public.ingest_batch_stop(uuid, text), public.ingest_batch_requeue(uuid, uuid[]), public.ingest_text_holders(text[])
  from public, anon, authenticated, service_role;
grant execute on function
  public.ingest_batch_open(jsonb), public.ingest_batch_add_items(uuid, jsonb), public.ingest_batch_seal(uuid),
  public.ingest_register_batch(uuid, jsonb, boolean, boolean), public.ingest_batch_status(uuid, text[]),
  public.ingest_batch_stop(uuid, text), public.ingest_batch_requeue(uuid, uuid[]), public.ingest_text_holders(text[])
  to corpus_ingest, service_role;
grant execute on function public.ingest_policy_approve(jsonb), public.ingest_batch_resume(uuid, jsonb) to service_role;
