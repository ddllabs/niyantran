-- ingestion-v2 (plan I1): the private corpus bucket, the stored-file, raw-OCR
-- and job tables, and the six job functions. Spec:
-- docs/specs/2026-10-01-rag-v2-ingestion-v2.md ("Tables and columns",
-- "Functions"); plan docs/plans/2026-10-01-rag-v2-ingestion-v2.md ("Fixed
-- interfaces"). The TypeScript side of this contract is
-- supabase/functions/ingest-worker/types.ts (IngestJob, FilePart, AdvancePatch,
-- ActivatePatch). Additive: no existing table, row or function changes.
--
--   * Bucket corpus: private, 50,000,000 bytes, PDF/JPEG/PNG/WebP, no object
--     policies (service role only). Keys are content-addressed:
--     files/<sha256>.pdf and img/<sha256>.<ext>. An existing corpus bucket with
--     other settings makes this migration fail rather than be accepted.
--   * document_files: one row per stored PDF object of a document (a whole PDF
--     or a part). Signed-in users read it (the viewer maps a page to its part);
--     the service role writes it.
--   * document_ocr_pages: Mistral's raw page, without image base64, keyed by
--     (document_id, ocr_hash, page_number). Service role only.
--   * ingest_jobs: one row per extraction job; at most one queued or running
--     job per document. The service role may only read it: every write goes
--     through the functions below, so the fencing token cannot be bypassed.
--   * documents.page_count (migration 0003) is filled at registration and at
--     activation; no column is added to documents.
--
-- Functions (security definer, search_path public, extensions; execute revoked
-- from public, anon and authenticated, granted to service_role):
--
--   ingest_register(p jsonb) -> jsonb       the only entry point
--   ingest_claim(p_limit int, p_lease interval) -> setof ingest_jobs
--   ingest_advance(p_job uuid, p_token uuid, p jsonb) -> jsonb
--   ingest_retry(p_job uuid) -> jsonb
--   ingest_cancel(p_job uuid) -> jsonb
--   ingest_activate(p_job uuid, p_token uuid, p jsonb) -> jsonb
--
-- Decisions beyond the spec's text (plan I1):
--   * Claim: at most INGEST_MAX_RUNNING (2) jobs hold an unexpired lease at
--     once, under a transaction-scoped advisory lock. attempts counts claims on
--     the current step; a due job already claimed INGEST_MAX_ATTEMPTS (6) times
--     without progress becomes failed ('attempts_exhausted') instead of being
--     claimed a 7th time.
--   * Advance never sets stage 'done': only ingest_activate finishes a job, so
--     a job can't succeed while its document stays hidden from search. A stage
--     change counts as progress (attempts return to 0). A release clears the
--     claim token, so the releasing worker's token is spent.
--   * Cancel: a queued, running or failed job becomes cancelled. A running
--     job's worker is fenced out (its token no longer matches a running job);
--     what it already wrote (raw OCR pages, committed chunks) stays, and stays
--     invisible to search because indexed_at is still null. Cancelling a
--     cancelled job is a no-op; a succeeded job cannot be cancelled.
--   * Activate requires stage 'index' and checks content_sha256 against
--     ocr_text (SHA-256 of its UTF-8 bytes, as ingest-documents computes it).
--     documents.chunker_version is left as it is: ActivatePatch does not carry
--     one, and every page chunk records its own.
--   * Errors are stored redacted (ingest_redact): URL query strings, auth
--     headers, key=value secrets, sk- keys, JWTs, hex runs of 32+ and
--     mixed-case base64-like runs of 40+ characters become [redacted]; code is
--     cut to 100 characters and message to 1,000.
--
-- No function here has a SET clause for a custom setting (NTER's migration
-- role is not a superuser), and nothing needs pg_cron, pg_net or Vault: the
-- schedule is an operator step. run.sh applies this file as a non-superuser.
--
-- Down, only while no document has been registered through ingest_register
-- (it drops their files, raw OCR and jobs; the documents rows would remain):
--
--   begin;
--   drop function public.ingest_activate(uuid, uuid, jsonb);
--   drop function public.ingest_cancel(uuid);
--   drop function public.ingest_retry(uuid);
--   drop function public.ingest_advance(uuid, uuid, jsonb);
--   drop function public.ingest_claim(int, interval);
--   drop function public.ingest_register(jsonb);
--   drop function public.ingest_redact(text, int);
--   drop table public.ingest_jobs, public.document_ocr_pages, public.document_files;
--   delete from storage.buckets where id = 'corpus';  -- only when it holds no objects
--   commit;

-- ---------------------------------------------------------------------------
-- The private corpus bucket (decision 2).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('corpus', 'corpus', false, 50000000,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select from storage.buckets
     where id = 'corpus'
       and public = false
       and file_size_limit = 50000000
       and allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'ingestion_v2: a corpus bucket already exists with other settings; refusing to continue';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables.

create table public.document_files (
  document_id  uuid   not null references public.documents(id) on delete cascade,
  part_index   int    not null check (part_index >= 0),
  page_offset  int    not null check (page_offset >= 0),  -- global pages before this part
  page_count   int    not null check (page_count >= 1),
  sha256       text   not null,
  byte_size    bigint not null check (byte_size > 0),
  storage_path text   not null,                          -- files/<sha256>.pdf in corpus
  constraint document_files_part_key primary key (document_id, part_index)
);

create table public.document_ocr_pages (
  document_id uuid        not null references public.documents(id) on delete cascade,
  ocr_hash    text        not null,
  page_number int         not null check (page_number >= 1),
  raw         jsonb       not null,   -- Mistral's page without image base64 (types.ts RawOcrPage)
  created_at  timestamptz not null default now(),
  constraint document_ocr_pages_page_key primary key (document_id, ocr_hash, page_number)
);

create table public.ingest_jobs (
  id              uuid        primary key default gen_random_uuid(),
  document_id     uuid        not null references public.documents(id) on delete cascade,
  status          text        not null default 'queued'
                              check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage           text        not null default 'ocr' check (stage in ('ocr', 'index', 'done')),
  file_sha256     text        not null,   -- copied from the document; input to ocr_hash
  ocr_hash        text,                   -- set once by the worker's first advance
  extract_hash    text,
  model_id        text,
  pages_total     int         not null check (pages_total >= 1),
  pages_per_call  int         not null default 25 check (pages_per_call > 0),
  claim_token     uuid,                   -- the fencing token of the current claim
  lease_until     timestamptz,
  attempts        int         not null default 0 check (attempts >= 0),  -- claims on the current step
  next_attempt_at timestamptz not null default now(),
  error_code      text,                   -- last failure, redacted
  last_error      text,
  ocr_pages       int         not null default 0 check (ocr_pages >= 0),
  ocr_cost_usd    numeric     not null default 0 check (ocr_cost_usd >= 0),
  embed_tokens    bigint      not null default 0 check (embed_tokens >= 0),
  embed_cost_usd  numeric     not null default 0 check (embed_cost_usd >= 0),
  requested_by    uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  constraint ingest_jobs_running_claim check (status <> 'running' or (claim_token is not null and lease_until is not null)),
  constraint ingest_jobs_done_succeeded check ((stage = 'done') = (status = 'succeeded'))
);

-- One active job per document.
create unique index ingest_jobs_one_active on public.ingest_jobs (document_id)
  where status in ('queued', 'running');
-- The claim's scan.
create index ingest_jobs_active_due on public.ingest_jobs (status, next_attempt_at)
  where status in ('queued', 'running');

alter table public.document_files     enable row level security;
alter table public.document_ocr_pages enable row level security;
alter table public.ingest_jobs        enable row level security;

-- Supabase's default privileges grant new tables broadly: revoke first.
revoke all on table public.document_files, public.document_ocr_pages, public.ingest_jobs
  from public, anon, authenticated, service_role;
grant select on table public.document_files to authenticated;
grant select, insert, update, delete on table public.document_files, public.document_ocr_pages to service_role;
grant select on table public.ingest_jobs to service_role;

create policy document_files_read on public.document_files for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Redaction of stored errors. Not granted to anyone: the functions below run
-- it as its owner.

create function public.ingest_redact(p_text text, p_max int)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  s text := p_text;
begin
  if s is null then
    return null;
  end if;
  -- URL query strings and fragments (signed URLs carry their token there).
  s := regexp_replace(s, '(https?://[^\s?#"''<>]*)[?#][^\s"''<>]*', '\1?[redacted]', 'gi');
  -- Authorization schemes.
  s := regexp_replace(s, '\m(bearer|basic)\s+[^\s"'',;]+', '\1 [redacted]', 'gi');
  -- key=value and "key": "value" secrets.
  s := regexp_replace(s,
         '((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|signature|authorization|x-ingest-secret)["'']?\s*[:=]\s*["'']?)[^\s"'',;&}]+',
         '\1[redacted]', 'gi');
  -- Provider keys (OpenAI/OpenRouter style).
  s := regexp_replace(s, '\msk-[A-Za-z0-9_-]{8,}', '[redacted]', 'g');
  -- JWTs (Supabase keys).
  s := regexp_replace(s, 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*)?', '[redacted]', 'g');
  -- Hex secrets (INGEST_WORKER_SECRET is 64 hex characters).
  s := regexp_replace(s, '[0-9A-Fa-f]{32,}', '[redacted]', 'g');
  -- Base64-like runs: 40+ characters with upper and lower case and a digit, so
  -- a storage path such as storage/v1/object/sign/corpus/files stays readable.
  s := regexp_replace(s,
         '(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*[0-9])[A-Za-z0-9+/_=-]{40,}',
         '[redacted]', 'g');
  if length(s) > p_max then
    s := left(s, p_max - 1) || '…';
  end if;
  return s;
end;
$$;

revoke all on function public.ingest_redact(text, int) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ingest_register: the only entry point. Validates the parts and their stored
-- objects, refuses legacy documents, re-extraction and a changed file, resumes
-- a failed or cancelled job, and otherwise inserts the document, its files and
-- one queued job.

create function public.ingest_register(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_bucket    constant text   := 'corpus';
  c_max_bytes constant bigint := 50000000;
  v_source_key text;
  v_title      text;
  v_file_sha   text;
  v_pages      int;
  v_metadata   jsonb;
  v_files      jsonb;
  v_part       jsonb;
  v_k          int := 0;
  v_offset     int := 0;
  v_index      int;
  v_poffset    int;
  v_pcount     int;
  v_sha        text;
  v_size       bigint;
  v_path       text;
  v_path0      text;
  v_stored     bigint;
  v_doc        public.documents%rowtype;
  v_job        public.ingest_jobs%rowtype;
  v_doc_id     uuid;
  v_job_id     uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ingest_register: p must be a json object';
  end if;

  v_source_key := nullif(btrim(p->>'source_key'), '');
  v_title      := nullif(btrim(p->>'title'), '');
  v_file_sha   := p->>'file_sha256';
  v_metadata   := coalesce(p->'metadata', '{}'::jsonb);
  v_files      := p->'files';
  if v_source_key is null then
    raise exception 'ingest_register: source_key is required';
  end if;
  if v_title is null then
    raise exception 'ingest_register: title is required';
  end if;
  if v_file_sha is null or v_file_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'ingest_register: file_sha256 must be 64 lowercase hex characters';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ingest_register: metadata must be a json object';
  end if;
  if jsonb_typeof(p->'page_count') is distinct from 'number' then
    raise exception 'ingest_register: page_count is required';
  end if;
  v_pages := (p->>'page_count')::int;
  if v_pages < 1 then
    raise exception 'ingest_register: page_count must be at least 1';
  end if;
  if jsonb_typeof(v_files) is distinct from 'array' or jsonb_array_length(v_files) = 0 then
    raise exception 'ingest_register: files must be a non-empty array';
  end if;

  -- Parts, in part_index order: contiguous from 0, each starting where the
  -- previous one ended, content-addressed, and present in the bucket at the
  -- stated size.
  for v_part in
    select e from jsonb_array_elements(v_files) e order by (e->>'part_index')::int
  loop
    v_index   := (v_part->>'part_index')::int;
    v_poffset := (v_part->>'page_offset')::int;
    v_pcount  := (v_part->>'page_count')::int;
    v_sha     := v_part->>'sha256';
    v_size    := (v_part->>'byte_size')::bigint;
    v_path    := v_part->>'storage_path';
    if v_index is distinct from v_k then
      raise exception 'ingest_register: parts must be numbered 0..n-1 without gaps (expected part %, got %)', v_k, v_index;
    end if;
    if v_pcount is null or v_pcount < 1 then
      raise exception 'ingest_register: part % must have page_count of at least 1', v_k;
    end if;
    if v_poffset is distinct from v_offset then
      raise exception 'ingest_register: part % must start at page_offset % (got %)', v_k, v_offset, v_poffset;
    end if;
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'ingest_register: part % sha256 must be 64 lowercase hex characters', v_k;
    end if;
    if v_path is distinct from 'files/' || v_sha || '.pdf' then
      raise exception 'ingest_register: part % storage_path must be files/<sha256>.pdf', v_k;
    end if;
    if v_size is null or v_size < 1 or v_size > c_max_bytes then
      raise exception 'ingest_register: part % byte_size must be between 1 and % bytes', v_k, c_max_bytes;
    end if;
    select (o.metadata->>'size')::bigint into v_stored
      from storage.objects o
     where o.bucket_id = c_bucket and o.name = v_path;
    if not found then
      raise exception 'ingest_register: part % object % is not in the % bucket', v_k, v_path, c_bucket;
    end if;
    if v_stored is distinct from v_size then
      raise exception 'ingest_register: part % object % has size %, expected %', v_k, v_path, v_stored, v_size;
    end if;
    if v_k = 0 then
      v_path0 := v_path;
    end if;
    v_offset := v_offset + v_pcount;
    v_k := v_k + 1;
  end loop;
  if v_offset <> v_pages then
    raise exception 'ingest_register: parts cover % pages, page_count is %', v_offset, v_pages;
  end if;
  if v_k = 1 and v_sha <> v_file_sha then
    raise exception 'ingest_register: a single part must be the whole file (sha256 = file_sha256)';
  end if;

  -- An existing document with this source_key.
  select * into v_doc from public.documents where source_key = v_source_key for update;
  if found then
    if v_doc.storage_path is null then
      raise exception 'ingest_register: % is a legacy document (no storage_path); refused', v_source_key;
    end if;
    if v_doc.file_sha256 is distinct from v_file_sha then
      raise exception 'ingest_register: % exists with a different file; refused', v_source_key;
    end if;
    if v_doc.extract_hash is not null then
      raise exception 'ingest_register: % is already extracted; re-extraction is refused', v_source_key;
    end if;
    if exists (select from public.ingest_jobs
                where document_id = v_doc.id and status in ('queued', 'running', 'succeeded')) then
      raise exception 'ingest_register: % already has an active or succeeded job; refused', v_source_key;
    end if;
    select * into v_job from public.ingest_jobs
     where document_id = v_doc.id and status in ('failed', 'cancelled')
     order by created_at desc, id desc
     limit 1
     for update;
    if not found then
      raise exception 'ingest_register: % has no job to resume; refused', v_source_key;
    end if;
    perform public.ingest_retry(v_job.id);
    return jsonb_build_object('document_id', v_doc.id, 'job_id', v_job.id, 'status', 'queued', 'resumed', true);
  end if;

  insert into public.documents
    (source_key, title, file_name, file_url, desk_tier, desk_feature, metadata,
     content_sha256, ocr_text, page_count, indexed_at,
     storage_path, file_sha256, source_mime)
  values
    (v_source_key, v_title, nullif(p->>'file_name', ''), nullif(p->>'file_url', ''),
     nullif(p->>'desk_tier', ''), nullif(p->>'desk_feature', ''), v_metadata,
     encode(sha256(''::bytea), 'hex'), '', v_pages, null,
     v_path0, v_file_sha, 'application/pdf')
  returning id into v_doc_id;

  insert into public.document_files (document_id, part_index, page_offset, page_count, sha256, byte_size, storage_path)
  select v_doc_id, (e->>'part_index')::int, (e->>'page_offset')::int, (e->>'page_count')::int,
         e->>'sha256', (e->>'byte_size')::bigint, e->>'storage_path'
    from jsonb_array_elements(v_files) e;

  insert into public.ingest_jobs (document_id, status, stage, file_sha256, pages_total, next_attempt_at, requested_by)
  values (v_doc_id, 'queued', 'ocr', v_file_sha, v_pages, now(), nullif(p->>'requested_by', '')::uuid)
  returning id into v_job_id;

  return jsonb_build_object('document_id', v_doc_id, 'job_id', v_job_id, 'status', 'queued', 'resumed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_claim: claims up to p_limit due jobs, within the system-wide cap.

create function public.ingest_claim(p_limit int, p_lease interval)
returns setof public.ingest_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Serialises every claim, so the cap can't be exceeded by two claims racing.
  c_lock_key           constant bigint := 4917230411;
  INGEST_MAX_RUNNING   constant int    := 2;
  INGEST_MAX_ATTEMPTS  constant int    := 6;
  v_free int;
begin
  if p_lease is null or p_lease <= interval '0' then
    raise exception 'ingest_claim: p_lease must be a positive interval';
  end if;
  if p_limit is null or p_limit < 1 then
    return;
  end if;

  perform pg_advisory_xact_lock(c_lock_key);

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

  select INGEST_MAX_RUNNING - count(*)::int into v_free
    from public.ingest_jobs
   where status = 'running' and lease_until > now();
  if v_free <= 0 then
    return;
  end if;

  return query
    with picked as (
      select j.id
        from public.ingest_jobs j
       where (j.status = 'queued' and j.next_attempt_at <= now())
          or (j.status = 'running' and j.lease_until <= now())
       order by case when j.status = 'running' then j.lease_until else j.next_attempt_at end, j.created_at, j.id
       limit least(p_limit, v_free)
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
-- ingest_advance: the fenced write of a step's outcome, then the release.

create function public.ingest_advance(p_job uuid, p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job        public.ingest_jobs%rowtype;
  v_stage      text;
  v_rank_old   int;
  v_rank_new   int;
  v_progressed boolean;
  v_key        text;
  v_ocr_pages  int     := coalesce((p->>'ocr_pages')::int, 0);
  v_ocr_cost   numeric := coalesce((p->>'ocr_cost_usd')::numeric, 0);
  v_tokens     bigint  := coalesce((p->>'embed_tokens')::bigint, 0);
  v_embed_cost numeric := coalesce((p->>'embed_cost_usd')::numeric, 0);
  v_ppc        int     := (p->>'pages_per_call')::int;
  v_error      jsonb   := p->'error';
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ingest_advance: p must be a json object';
  end if;
  select * into v_job from public.ingest_jobs where id = p_job for update;
  if not found then
    raise exception 'ingest_advance: job % does not exist', p_job;
  end if;
  if v_job.status <> 'running' or v_job.claim_token is distinct from p_token then
    raise exception 'ingest_advance: job % is not running under this claim token', p_job;
  end if;
  if jsonb_typeof(p->'progressed') is distinct from 'boolean' then
    raise exception 'ingest_advance: progressed (boolean) is required';
  end if;
  v_progressed := (p->>'progressed')::boolean;

  -- Set once: the first value sticks, a different one later is refused.
  foreach v_key in array array['ocr_hash', 'extract_hash', 'model_id'] loop
    if p->>v_key is not null
       and (to_jsonb(v_job)->>v_key) is not null
       and (to_jsonb(v_job)->>v_key) <> p->>v_key then
      raise exception 'ingest_advance: % is already set to a different value', v_key;
    end if;
  end loop;

  if v_ocr_pages < 0 or v_ocr_cost < 0 or v_tokens < 0 or v_embed_cost < 0 then
    raise exception 'ingest_advance: counters are increments and cannot be negative';
  end if;
  if v_ppc is not null and v_ppc < 1 then
    raise exception 'ingest_advance: pages_per_call must be at least 1';
  end if;

  -- Stage moves forward only; only ingest_activate reaches 'done'.
  v_stage := coalesce(p->>'stage', v_job.stage);
  v_rank_old := array_position(array['ocr', 'index', 'done'], v_job.stage);
  v_rank_new := array_position(array['ocr', 'index', 'done'], v_stage);
  if v_rank_new is null then
    raise exception 'ingest_advance: unknown stage %', v_stage;
  end if;
  if v_rank_new < v_rank_old then
    raise exception 'ingest_advance: stage cannot move back from % to %', v_job.stage, v_stage;
  end if;
  if v_stage = 'done' then
    raise exception 'ingest_advance: only ingest_activate moves a job to done';
  end if;

  update public.ingest_jobs
     set stage          = v_stage,
         ocr_hash       = coalesce(ocr_hash, p->>'ocr_hash'),
         extract_hash   = coalesce(extract_hash, p->>'extract_hash'),
         model_id       = coalesce(model_id, p->>'model_id'),
         ocr_pages      = ocr_pages + v_ocr_pages,
         ocr_cost_usd   = ocr_cost_usd + v_ocr_cost,
         embed_tokens   = embed_tokens + v_tokens,
         embed_cost_usd = embed_cost_usd + v_embed_cost,
         pages_per_call = coalesce(v_ppc, pages_per_call),
         attempts       = case when v_progressed or v_rank_new > v_rank_old then 0 else attempts end
   where id = p_job
  returning * into v_job;

  if coalesce(jsonb_typeof(v_error), 'null') = 'object' then
    if coalesce((v_error->>'permanent')::boolean, false) then
      update public.ingest_jobs
         set status      = 'failed',
             claim_token = null,
             lease_until = null,
             error_code  = public.ingest_redact(v_error->>'code', 100),
             last_error  = public.ingest_redact(v_error->>'message', 1000),
             finished_at = now()
       where id = p_job
      returning * into v_job;
    else
      update public.ingest_jobs
         set status          = 'queued',
             claim_token     = null,
             lease_until     = null,
             error_code      = public.ingest_redact(v_error->>'code', 100),
             last_error      = public.ingest_redact(v_error->>'message', 1000),
             next_attempt_at = now() + least(interval '30 seconds' * power(2, least(attempts, 20)), interval '1 hour')
       where id = p_job
      returning * into v_job;
    end if;
  elsif v_error is not null and jsonb_typeof(v_error) <> 'null' then
    raise exception 'ingest_advance: error must be an object {code, message, permanent}';
  else
    update public.ingest_jobs
       set status          = 'queued',
           claim_token     = null,
           lease_until     = null,
           next_attempt_at = now()
     where id = p_job
    returning * into v_job;
  end if;

  return jsonb_build_object('status', v_job.status, 'stage', v_job.stage, 'attempts', v_job.attempts,
                            'next_attempt_at', v_job.next_attempt_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_retry and ingest_cancel: operator controls.

create function public.ingest_retry(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.ingest_jobs%rowtype;
begin
  select * into v_job from public.ingest_jobs where id = p_job for update;
  if not found then
    raise exception 'ingest_retry: job % does not exist', p_job;
  end if;
  if v_job.status not in ('failed', 'cancelled') then
    raise exception 'ingest_retry: job % is %; only a failed or cancelled job can be retried', p_job, v_job.status;
  end if;
  update public.ingest_jobs
     set status          = 'queued',
         attempts        = 0,
         error_code      = null,
         last_error      = null,
         claim_token     = null,
         lease_until     = null,
         next_attempt_at = now(),
         finished_at     = null
   where id = p_job
  returning * into v_job;
  return jsonb_build_object('status', v_job.status, 'stage', v_job.stage);
end;
$$;

create function public.ingest_cancel(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.ingest_jobs%rowtype;
begin
  select * into v_job from public.ingest_jobs where id = p_job for update;
  if not found then
    raise exception 'ingest_cancel: job % does not exist', p_job;
  end if;
  if v_job.status = 'succeeded' then
    raise exception 'ingest_cancel: job % has succeeded and cannot be cancelled', p_job;
  end if;
  if v_job.status <> 'cancelled' then
    update public.ingest_jobs
       set status      = 'cancelled',
           claim_token = null,
           lease_until = null,
           finished_at = now()
     where id = p_job
    returning * into v_job;
  end if;
  return jsonb_build_object('status', v_job.status, 'stage', v_job.stage);
end;
$$;

-- ---------------------------------------------------------------------------
-- ingest_activate: the first extraction becomes the document's, and the
-- document becomes searchable. One transaction; indexed_at is set last.

create function public.ingest_activate(p_job uuid, p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job     public.ingest_jobs%rowtype;
  v_doc     public.documents%rowtype;
  v_extract text;
  v_text    text;
  v_sha     text;
  v_pages   int;
  v_tokens  bigint;
  v_cost    numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ingest_activate: p must be a json object';
  end if;
  select * into v_job from public.ingest_jobs where id = p_job for update;
  if not found then
    raise exception 'ingest_activate: job % does not exist', p_job;
  end if;
  if v_job.status <> 'running' or v_job.claim_token is distinct from p_token then
    raise exception 'ingest_activate: job % is not running under this claim token', p_job;
  end if;
  if v_job.stage <> 'index' then
    raise exception 'ingest_activate: job % is at stage %, not index', p_job, v_job.stage;
  end if;

  v_extract := nullif(p->>'extract_hash', '');
  v_text    := p->>'ocr_text';
  v_sha     := p->>'content_sha256';
  v_pages   := (p->>'page_count')::int;
  v_tokens  := coalesce((p->>'embed_tokens')::bigint, 0);
  v_cost    := coalesce((p->>'embed_cost_usd')::numeric, 0);
  if v_extract is null then
    raise exception 'ingest_activate: extract_hash is required';
  end if;
  if v_text is null then
    raise exception 'ingest_activate: ocr_text is required';
  end if;
  if v_sha is distinct from encode(sha256(convert_to(v_text, 'UTF8')), 'hex') then
    raise exception 'ingest_activate: content_sha256 is not the SHA-256 of ocr_text';
  end if;
  if v_pages is null or v_pages < 1 then
    raise exception 'ingest_activate: page_count must be at least 1';
  end if;
  if v_tokens < 0 or v_cost < 0 then
    raise exception 'ingest_activate: counters are increments and cannot be negative';
  end if;
  if v_job.extract_hash is not null and v_job.extract_hash <> v_extract then
    raise exception 'ingest_activate: extract_hash differs from the job''s';
  end if;

  select * into v_doc from public.documents where id = v_job.document_id for update;
  if v_doc.extract_hash is not null then
    raise exception 'ingest_activate: document % is already extracted; only a first extraction can be activated', v_doc.id;
  end if;

  -- Compare-and-set on extract_hash (chunk contract R6), then indexed_at last.
  update public.documents
     set extract_hash   = v_extract,
         ocr_text       = v_text,
         content_sha256 = v_sha,
         page_count     = v_pages
   where id = v_doc.id and extract_hash is null;
  update public.documents
     set indexed_at = now()
   where id = v_doc.id;

  update public.ingest_jobs
     set stage          = 'done',
         status         = 'succeeded',
         extract_hash   = v_extract,
         embed_tokens   = embed_tokens + v_tokens,
         embed_cost_usd = embed_cost_usd + v_cost,
         attempts       = 0,
         error_code     = null,   -- an earlier, recovered failure no longer describes the job
         last_error     = null,
         claim_token    = null,
         lease_until    = null,
         finished_at    = now()
   where id = p_job
  returning * into v_job;

  return jsonb_build_object('status', v_job.status, 'stage', v_job.stage, 'document_id', v_job.document_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute: the service role only.

revoke all on function public.ingest_register(jsonb) from public, anon, authenticated;
revoke all on function public.ingest_claim(int, interval) from public, anon, authenticated;
revoke all on function public.ingest_advance(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_retry(uuid) from public, anon, authenticated;
revoke all on function public.ingest_cancel(uuid) from public, anon, authenticated;
revoke all on function public.ingest_activate(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_register(jsonb) to service_role;
grant execute on function public.ingest_claim(int, interval) to service_role;
grant execute on function public.ingest_advance(uuid, uuid, jsonb) to service_role;
grant execute on function public.ingest_retry(uuid) to service_role;
grant execute on function public.ingest_cancel(uuid) to service_role;
grant execute on function public.ingest_activate(uuid, uuid, jsonb) to service_role;
