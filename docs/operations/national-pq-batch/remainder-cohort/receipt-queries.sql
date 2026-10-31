-- Remainder cohort: every other production read used for the receipt (rule 6), beside cohort-live-check.sql and
-- verify.sql. Status: Historical (dated 2026-10-31). Each runs inside a read-only transaction that is rolled back.

-- R1. Progress during the run (run several times, 2026-10-31 10:56-11:15 and 16:26-16:46 UTC).
begin transaction read only;
select count(*) docs, max(created_at) last, now() from public.documents where desk_tier='national' and created_at > '2026-10-31 10:50:00+00';
rollback;

-- R2. After the run: duplicates and indexing jobs.
begin transaction read only;
select (select count(*) from public.documents where desk_tier='national' and created_at > '2026-10-31 10:50:00+00') docs,
       (select count(distinct file_url) from public.documents where desk_tier='national' and created_at > '2026-10-31 10:50:00+00') urls,
       (select json_object_agg(status, n) from (select j.status, count(*) n from public.ingest_jobs j join public.documents d on d.id = j.document_id
          where d.desk_tier='national' and d.created_at > '2026-10-31 10:50:00+00' group by j.status) s) jobs;
rollback;

-- R3. The document whose registration came back uncertain in submit-1: was it registered?
begin transaction read only;
select d.file_name, d.created_at, d.indexed_at, d.content_sha256,
  (select count(*) from public.document_chunks k where k.document_id = d.id) chunks,
  (select count(*) from public.record_document_links l where l.document_id = d.id) links,
  (select string_agg(g.status, ',') from public.ingest_jobs g where g.document_id = d.id) jobs
from public.documents d where d.source_key = 'e2a23c70167b307703b4dd6ab36c0fd219762c05';
rollback;

-- R4. Signed-in coverage of the five acceptance records (15 listing rows) through the released resolver.
begin transaction read only;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) is null;
select r.document_key, r.coverage, d.file_name
from public.record_resolve_document_keys(array[
 'desk-record:["national", "Parliamentary Question Database", "7314"]','desk-record:["national", "Parliamentary Question Database", "6083"]',
 'desk-record:["national", "Parliamentary Question Database", "232"]','desk-record:["national", "Parliamentary Question Database", "678"]',
 'desk-record:["national", "Parliamentary Question Database", "957"]','desk-record:["national", "Parliamentary Question Database", "1355"]',
 'desk-record:["national", "Parliamentary Question Database", "4019"]','desk-record:["national", "Parliamentary Question Database", "4184"]',
 'desk-record:["national", "Parliamentary Question Database", "4588"]','desk-record:["national", "Parliamentary Question Database", "4854"]',
 'desk-record:["national", "Parliamentary Question Database", "2577"]','desk-record:["national", "Parliamentary Question Database", "4944"]',
 'desk-record:["national", "Parliamentary Question Database", "5697"]','desk-record:["national", "Parliamentary Question Database", "6729"]',
 'desk-record:["national", "Parliamentary Question Database", "623"]']) r
left join public.documents d on d.id = r.document_id;
rollback;
