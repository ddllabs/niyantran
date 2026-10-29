-- Lok Sabha remainder cohort: the open answers, read live and read-only (rule 6). Writes nothing.
-- Status: Living (2026-10-30). An answer file is open when it has a listing row and no document, by URL, answer key or
-- older pack path (reconcile.sql section 5). Run 2026-10-30 ~01:40 IST: n 793, md5 71ffe6854a1d82a01440f939d982fda4 over
-- the keys sorted bytewise (collate "C") and joined by newlines; open-answer-keys.txt holds the same keys, one per line,
-- with a trailing newline (sha256 6655391450c0eecbfcb693781f436912d6196f90f20b89a54db5c9b6d5e16092).
-- 793 = the 893 of the 2026-10-29 reconciliation, minus the 100 of validation cohort 1.
begin transaction read only;
with u as materialized (select distinct r.row->>'source_url' url from public.desk_rows r
                         where r.tier = 'national' and r.feature = 'Parliamentary Question Database'),
uk as materialized (select url, public.pq_answer_key(url) k from u),
dk as materialized (select public.pq_answer_key(file_url) k from public.documents where desk_tier = 'national' and file_url like 'https://sansad.in/%'
     union select metadata->>'document_key_suggested' from public.documents where desk_tier = 'national' and metadata ? 'document_key_suggested'),
pk as materialized (select lower(regexp_replace(metadata->>'source_path','^.*/','')) f from public.documents
                     where desk_tier = 'national' and desk_feature = 'Parliamentary Question Database' and metadata ? 'source_path'),
o as (select distinct k from uk where k is not null and k not in (select k from dk where k is not null)
                     and lower(split_part(k,':',3) || '_' || split_part(k,':',4) || '.pdf') not in (select f from pk where f is not null))
select count(*) n, md5(string_agg(k, E'\n' order by k collate "C")) h,
       string_agg(split_part(k,':',3) || '/' || split_part(k,':',4), ',' order by k collate "C") keys from o;
rollback;
