-- Disposable PostgreSQL + real pgvector regression; no provider calls.
-- Run with psql -v ON_ERROR_STOP=1 after bootstrap_auth.sql, auth_schema.sql,
-- migrations 0001/0002/0003/0009 and 0014. Never bootstrap a hosted project.
-- All fixtures and helpers roll back. Before 0014 this must fail for both
-- stale hash-hit content and unfinished-document retrieval.
begin;
set local search_path = public, extensions;

create temporary table corpus_checks (label text, passed boolean);
grant insert on corpus_checks to authenticated, service_role, anon;
create function pg_temp.check_corpus(ok boolean, label text) returns void
language plpgsql as $$
begin
  insert into corpus_checks values (label, coalesce(ok, false));
  if ok is distinct from true then raise warning 'FAIL: %', label; end if;
end;
$$;

create temporary table corpus_fixture as
select 'a0140000-0000-0000-0000-000000000001'::uuid as doc,
       'a0140000-0000-0000-0000-000000000002'::uuid as other_doc,
       array_prepend(1::real, array_fill(0::real, array[1535]))::vector(1536) as embedding,
       encode(digest('1|document|Alpha 😀 beta', 'sha256'), 'hex') as hash;
grant select on corpus_fixture to authenticated, service_role, anon;

-- These offsets are UTF-16 code units, as produced by chunkDocument and
-- consumed by SourceReader.slice(). Astral characters occur before AND inside
-- the span: JS slice(12,25) / slice(13,28), not SQL substring character counts.
set local role service_role;
insert into documents (id, source_key, title, desk_tier, content_sha256, ocr_text)
select doc, 'corpus-integrity-fixture', 'Revision fixture', 'national', 'old-sha',
       E'😀 heading\n\nAlpha 😀 beta' from corpus_fixture;

select pg_temp.check_corpus(
  chunk_commit(doc, jsonb_build_array(jsonb_build_object(
    'chunk_hash', hash, 'chunk_index', 0, 'char_from', 12, 'char_to', 25,
    'content', 'Alpha 😀 beta', 'chunker_version', 1, 'token_count', 4,
    'embedding', to_jsonb(embedding::real[]))), array[hash]) =
  '{"inserted":1,"kept":0,"deleted":0}'::jsonb, 'initial commit inserts a chunk')
from corpus_fixture;
reset role;
create temporary table original_chunk as select c.* from document_chunks c
join corpus_fixture f on c.document_id = f.doc;
grant select on original_chunk to authenticated, service_role;

set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'new document hidden before markIndexed')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;

set local role service_role;
update documents set indexed_at = now(), chunker_version = 1
where id = (select doc from corpus_fixture);
insert into documents (id, source_key, title, desk_tier, content_sha256, ocr_text, indexed_at, chunker_version)
select other_doc, 'corpus-integrity-other', 'Other ready document', 'law', 'other-sha', 'Other text', now(), 1
from corpus_fixture;
select chunk_commit(other_doc, jsonb_build_array(jsonb_build_object(
  'chunk_hash', 'other-hash', 'chunk_index', 0, 'char_from', 0, 'char_to', 10,
  'content', 'Other text', 'chunker_version', 1, 'embedding', to_jsonb(embedding::real[]))), array['other-hash'])
from corpus_fixture;

set local role authenticated;
select pg_temp.check_corpus(count(*) = 1 and bool_and(m.content = 'Alpha 😀 beta')
  and bool_and(m.char_from = 12 and m.char_to = 25) and bool_and(m.similarity > 0.999),
  'ready document returns exact text, UTF-16 anchors and real cosine similarity')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
select pg_temp.check_corpus(count(*) = 1 and bool_and(m.document_id = f.other_doc), 'desk filter retained')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, null, 'law') m;
select pg_temp.check_corpus(count(*) = 1, 'match_count retained')
from corpus_fixture f cross join lateral match_documents(f.embedding, 1) m;

-- The upsert clears readiness before embedding or chunk writes. An interruption
-- here leaves the prior chunks but must not expose them against revised text.
set local role service_role;
update documents set ocr_text = E'😀 heading\n\n\nAlpha  😀  beta', content_sha256 = 'whitespace-sha',
  indexed_at = null, chunker_version = null where id = (select doc from corpus_fixture);
set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'whitespace revision hidden after document upsert')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
select pg_temp.check_corpus(count(*) = 1 and bool_and(m.document_id = f.other_doc),
  'unfinished revision does not hide other ready documents')
from corpus_fixture f cross join lateral match_documents(f.embedding) m;

-- Hash hit deliberately supplies no embedding: exact content/anchors must
-- refresh while UUID, creation time and the original embedding survive.
set local role service_role;
select pg_temp.check_corpus(
  chunk_commit(doc, jsonb_build_array(jsonb_build_object(
    'chunk_hash', hash, 'chunk_index', 0, 'char_from', 13, 'char_to', 28,
    'content', 'Alpha  😀  beta', 'chunker_version', 1, 'token_count', 4)), array[hash]) =
  '{"inserted":0,"kept":1,"deleted":0}'::jsonb, 'whitespace hash hit needs no embedding')
from corpus_fixture;
select pg_temp.check_corpus(c.content = 'Alpha  😀  beta' and c.char_from = 13 and c.char_to = 28,
  'hash hit refreshes exact content and UTF-16 anchors')
from document_chunks c join corpus_fixture f on c.document_id = f.doc;
select pg_temp.check_corpus(c.id = o.id and c.embedding = o.embedding and c.created_at = o.created_at,
  'whitespace hash hit preserves UUID, embedding and creation time')
from document_chunks c join original_chunk o on c.document_id = o.document_id;
set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'revision hidden after chunk commit before markIndexed')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
set local role service_role;
update documents set indexed_at = now(), chunker_version = 1 where id = (select doc from corpus_fixture);
set local role authenticated;
select pg_temp.check_corpus(count(*) = 1 and bool_and(m.content = 'Alpha  😀  beta')
  and bool_and(m.id = o.id) and bool_and(m.char_from = 13 and m.char_to = 28),
  'completed whitespace revision retrieves current exact span with stable citation UUID')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m
cross join original_chunk o;

-- Changed text requires a new embedding. A failed commit must roll back its
-- deletion and remain hidden; a successful retry remains hidden until marked.
set local role service_role;
update documents set ocr_text = 'Changed meaning', content_sha256 = 'changed-sha',
  indexed_at = null, chunker_version = null where id = (select doc from corpus_fixture);
set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'changed-text revision hidden before embedding')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
set local role service_role;
do $$
begin
  begin
    perform chunk_commit((select doc from corpus_fixture),
      '[{"chunk_hash":"changed-hash","chunk_index":0,"char_from":0,"char_to":15,"content":"Changed meaning","chunker_version":1}]',
      array['changed-hash']);
    perform pg_temp.check_corpus(false, 'new hash without embedding is rejected');
  exception when raise_exception then
    perform pg_temp.check_corpus(sqlerrm like 'chunk_commit: new chunk % has no embedding',
      'new hash without embedding is rejected');
  end;
end;
$$;
select pg_temp.check_corpus(count(*) = 1 and bool_and(c.id = o.id), 'failed commit rolls back deletion')
from document_chunks c join original_chunk o on c.document_id = o.document_id;
set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'failed revision never retrieves stale chunks')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
set local role service_role;
select pg_temp.check_corpus(chunk_commit(doc, jsonb_build_array(jsonb_build_object(
  'chunk_hash', 'changed-hash', 'chunk_index', 0, 'char_from', 0, 'char_to', 15,
  'content', 'Changed meaning', 'chunker_version', 1, 'embedding', to_jsonb(embedding::real[]))), array['changed-hash']) =
  '{"inserted":1,"kept":0,"deleted":1}'::jsonb, 'changed text replaces obsolete chunk') from corpus_fixture;
set local role authenticated;
select pg_temp.check_corpus(count(*) = 0, 'changed-text commit hidden until markIndexed')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m;
set local role service_role;
update documents set indexed_at = now(), chunker_version = 1 where id = (select doc from corpus_fixture);
set local role authenticated;
select pg_temp.check_corpus(count(*) = 1 and bool_and(m.content = 'Changed meaning') and bool_and(m.id <> o.id),
  'completed changed-text revision retrieves new content and new UUID')
from corpus_fixture f cross join lateral match_documents(f.embedding, 40, array[f.doc]) m cross join original_chunk o;

-- Execute boundaries are unchanged by CREATE OR REPLACE; test real role calls.
do $$
begin
  begin
    perform chunk_commit((select doc from corpus_fixture), '[]', '{}');
    perform pg_temp.check_corpus(false, 'authenticated cannot call chunk_commit');
  exception when insufficient_privilege then
    perform pg_temp.check_corpus(true, 'authenticated cannot call chunk_commit');
  end;
end;
$$;
set local role anon;
do $$
begin
  begin
    perform * from match_documents((select embedding from corpus_fixture));
    perform pg_temp.check_corpus(false, 'anon cannot retrieve corpus');
  exception when insufficient_privilege then
    perform pg_temp.check_corpus(true, 'anon cannot retrieve corpus');
  end;
  begin
    perform chunk_commit((select doc from corpus_fixture), '[]', '{}');
    perform pg_temp.check_corpus(false, 'anon cannot call chunk_commit');
  exception when insufficient_privilege then
    perform pg_temp.check_corpus(true, 'anon cannot call chunk_commit');
  end;
end;
$$;
reset role;

do $$
declare failures int; total int;
begin
  select count(*) filter (where not passed), count(*) into failures, total from corpus_checks;
  if total <> 22 then raise exception 'Expected 22 assertions, executed % (fixture or empty-result defect)', total; end if;
  if failures > 0 then raise exception '% of % corpus revision assertions failed', failures, total; end if;
  raise notice '% corpus revision assertions passed', total;
end;
$$;
rollback;
