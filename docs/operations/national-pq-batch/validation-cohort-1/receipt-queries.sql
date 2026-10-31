-- Validation cohort 1: every other production read used for the receipt (rule 6), beside cohort-live-check.sql and
-- verify.sql. Status: Historical (dated 2026-10-30). Each runs inside a read-only transaction that is rolled back.

-- R1. Progress and state during the run (run several times, 2026-10-29 19:18-19:37 UTC).
begin transaction read only;
select count(*) docs, count(indexed_at) indexed, min(created_at) first_registered, max(created_at) last_registered,
  (select count(*) from public.record_document_links l join public.documents d2 on d2.id = l.document_id
    where d2.metadata->'review'->>'decision_id' = 'national-pq-validation-20261029-v100') links,
  (select count(*) from public.ingest_jobs g join public.documents d3 on d3.id = g.document_id
    where d3.metadata->'review'->>'decision_id' = 'national-pq-validation-20261029-v100' and g.status in ('queued','running')) jobs_pending
from public.documents where metadata->'review'->>'decision_id' = 'national-pq-validation-20261029-v100';
rollback;

-- R2. The document whose first registration came back HTTP 503 (submit-1 "uncertain"): was it registered?
begin transaction read only;
select count(*) found, bool_and(d.content_sha256 = '077515f909e3639930d4aba0954b26d530249a7c4691d189c3d4846cc5760273') text_hash_matches_plan,
  max(d.created_at) created, max(d.indexed_at) indexed,
  max((select count(*) from public.document_chunks k where k.document_id = d.id)) chunks,
  max((select count(*) from public.record_document_links l where l.document_id = d.id)) links,
  string_agg((select string_agg(g.status, ',') from public.ingest_jobs g where g.document_id = d.id), ';') jobs,
  string_agg(d.metadata->'review'->>'decision_id', ';') decision
from public.documents d where d.source_key = '132ce2837e4f3b9d213332afab2fe1ca85754d2f';
rollback;

-- R3. Signed-in coverage of the five acceptance records (8 listing rows) through the released resolver.
begin transaction read only;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) is null;
select r.document_key, r.coverage, d.file_name
from public.record_resolve_document_keys(array[
 'desk-record:["national", "Parliamentary Question Database", "3056"]','desk-record:["national", "Parliamentary Question Database", "4765"]',
 'desk-record:["national", "Parliamentary Question Database", "669"]','desk-record:["national", "Parliamentary Question Database", "3513"]',
 'desk-record:["national", "Parliamentary Question Database", "3631"]','desk-record:["national", "Parliamentary Question Database", "3994"]',
 'desk-record:["national", "Parliamentary Question Database", "4829"]','desk-record:["national", "Parliamentary Question Database", "216"]']) r
left join public.documents d on d.id = r.document_id;
rollback;

-- R4. The failed website-acceptance turn: retrieval step and model call (2026-10-29 19:41-19:43 UTC).
begin transaction read only;
select created_at, step_index, step_type, result_count, latency_ms, cardinality(chunk_ids) n_chunks, aborted, error_message,
  (select string_agg(distinct d.file_name, ',') from public.document_chunks k join public.documents d on d.id = k.document_id
    where k.id = any(t.chunk_ids)) cited_files
from public.chat_turn_traces t where created_at between '2026-10-29 19:41:00+00' and '2026-10-29 19:43:00+00' order by created_at, step_index;
select created_at, caller, purpose, status, model_requested, error_message, latency_ms
from public.model_call_logs where created_at between '2026-10-29 19:41:00+00' and '2026-10-29 19:43:00+00' order by created_at;
rollback;
