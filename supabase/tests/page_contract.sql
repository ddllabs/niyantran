-- Disposable PG + real pgvector assertions for the page contract
-- (20261001120000_page_contract; docs/specs/2026-09-30-rag-v2-chunk-contract.md,
-- "Schema" and "Testing strategy"): the new documents and document_chunks
-- columns; document_pages, document_page_blocks and document_page_images with
-- their checks, keys, cascades, RLS and an every-privilege matrix; chunk_commit
-- writing block_ids, image_ids and embed_hash and replacing a vector on an
-- embed_hash change while keeping the id; match_documents and its helper
-- returning block_ids, image_ids and section on all three branches, with nulls
-- for old rows; one overload each; no anon or PUBLIC execute; no hnsw.* SET
-- clause anywhere.
-- Run on feature_filter's chain plus the migration, which run.sh applies as a
-- NON-superuser (see its header); never against a hosted project. The vacuity
-- check drops the migration. Every label is unique and each assertion was
-- shown red on its own against a broken variant of the migration, so no
-- assertion here is implied by an earlier one.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION 'FAIL: % expected % got %: %', label, expected_state, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;
CREATE FUNCTION pg_temp.accepted(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL: % refused with %: %', label, SQLSTATE, SQLERRM;
  END;
  RAISE NOTICE 'PASS: %', label;
END; $$;
-- name:type:notnull for every live column, in order.
CREATE FUNCTION pg_temp.shape(t regclass) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || CASE WHEN attnotnull THEN ':nn' ELSE '' END, ', ' ORDER BY attnum)
    FROM pg_attribute WHERE attrelid = t AND attnum > 0 AND NOT attisdropped;
$$;
CREATE FUNCTION pg_temp.v(i int, w real DEFAULT 1) RETURNS vector LANGUAGE sql AS $$
  SELECT (array_fill(0::real, array[i - 1]) || array[w] || array_fill(0::real, array[1536 - i]))::vector(1536);
$$;
CREATE FUNCTION pg_temp.j(x vector) RETURNS jsonb LANGUAGE sql AS $$ SELECT to_jsonb(x::real[]); $$;

-- ===== 1. Shape =====
SELECT pg_temp.assert_true(to_regclass('public.document_pages') IS NOT NULL AND to_regclass('public.document_page_blocks') IS NOT NULL
                           AND to_regclass('public.document_page_images') IS NOT NULL, 'the three page tables exist');
SELECT pg_temp.assert_true(pg_temp.shape('public.documents') LIKE '%, storage_path:text, file_sha256:text, extract_hash:text, source_mime:text', 'documents gains four nullable text columns');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_chunks') LIKE '%, block_ids:uuid[], image_ids:uuid[], embed_hash:text', 'document_chunks gains block_ids, image_ids and embed_hash, nullable');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_pages') =
  'id:uuid:nn, document_id:uuid:nn, extract_hash:text:nn, page_number:integer:nn, text:text:nn, char_from:integer:nn, char_to:integer:nn, '
  'header:text, footer:text, header_in_text:boolean:nn, footer_in_text:boolean:nn, width_px:integer, height_px:integer, dpi:integer, created_at:timestamp with time zone:nn',
  'document_pages has the spec''s columns');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_page_blocks') =
  'id:uuid:nn, document_id:uuid:nn, extract_hash:text:nn, page_number:integer:nn, block_index:integer:nn, type:text:nn, '
  'x0:real, y0:real, x1:real, y1:real, char_from:integer, char_to:integer, content:text',
  'document_page_blocks has the spec''s columns');
SELECT pg_temp.assert_true(pg_temp.shape('public.document_page_images') =
  'id:uuid:nn, document_id:uuid:nn, extract_hash:text:nn, page_number:integer:nn, placeholder:text:nn, sha256:text:nn, mime:text:nn, '
  'storage_path:text:nn, byte_size:integer, x0:real, y0:real, x1:real, y1:real',
  'document_page_images has the spec''s columns');
SELECT pg_temp.assert_true((SELECT bool_and(pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()') FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                             WHERE a.attname = 'id' AND d.adrelid IN ('public.document_pages'::regclass, 'public.document_page_blocks'::regclass, 'public.document_page_images'::regclass))
                           AND (SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                                 WHERE a.attname = 'id' AND d.adrelid IN ('public.document_pages'::regclass, 'public.document_page_blocks'::regclass, 'public.document_page_images'::regclass)) = 3
                           AND (SELECT count(*) FROM pg_constraint WHERE contype = 'p' AND conrelid IN ('public.document_pages'::regclass, 'public.document_page_blocks'::regclass, 'public.document_page_images'::regclass)) = 3,
                           'each page table has a generated uuid primary key');
-- Lookups by extraction (and by page for blocks) have an index whose leading
-- columns match; the unique keys provide them. (What each key accepts and
-- refuses is tested by behaviour in section 3.)
SELECT pg_temp.assert_true((SELECT bool_and(EXISTS (SELECT FROM pg_index i WHERE i.indrelid = t.rel
                                                      AND (SELECT array_agg(a.attname ORDER BY k.n) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, n)
                                                             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE k.n <= array_length(t.cols, 1)) = t.cols))
                              FROM (VALUES ('public.document_pages'::regclass, array['document_id', 'extract_hash']::name[]),
                                           ('public.document_page_blocks'::regclass, array['document_id', 'extract_hash', 'page_number']::name[]),
                                           ('public.document_page_images'::regclass, array['document_id', 'extract_hash']::name[])) t(rel, cols)),
                           'pages and images are indexed by (document_id, extract_hash), blocks by (document_id, extract_hash, page_number)');
-- Applied as a non-superuser (run.sh): the new tables' owner has no superuser bit.
SELECT pg_temp.assert_true((SELECT bool_and(NOT r.rolsuper) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                             WHERE c.oid IN ('public.document_pages'::regclass, 'public.document_page_blocks'::regclass, 'public.document_page_images'::regclass)),
                           'the migration was applied by a role that is not a superuser');

-- ===== 2. RLS and the privilege matrix =====
SELECT pg_temp.assert_true((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.document_pages'::regclass, 'public.document_page_blocks'::regclass, 'public.document_page_images'::regclass)),
                           'RLS is enabled on the three page tables');
-- Every privilege for PUBLIC, anon and authenticated: only authenticated SELECT.
-- PUBLIC comes first because a grant to PUBLIC also reaches anon.
-- service_role: exactly select, insert, update, delete.
DO $$
DECLARE tbl text; actor text; privilege text; expected boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['document_pages', 'document_page_blocks', 'document_page_images'] LOOP
    FOREACH actor IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        expected := actor = 'authenticated' AND privilege = 'SELECT';
        PERFORM pg_temp.assert_true(has_table_privilege(actor, 'public.' || tbl, privilege) = expected,
                                    actor || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || privilege || ' ' || tbl);
      END LOOP;
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      expected := privilege IN ('SELECT','INSERT','UPDATE','DELETE');
      PERFORM pg_temp.assert_true(has_table_privilege('service_role', 'public.' || tbl, privilege) = expected,
                                  'service_role' || CASE WHEN expected THEN ' can ' ELSE ' cannot ' END || privilege || ' ' || tbl);
    END LOOP;
  END LOOP;
END; $$;
-- The added columns follow their tables' grants: authenticated reads, anon does not.
SELECT pg_temp.assert_true((SELECT bool_and(has_column_privilege('authenticated', t, c, 'SELECT') AND NOT has_column_privilege('anon', t, c, 'SELECT')
                                            AND NOT has_column_privilege('authenticated', t, c, 'UPDATE') AND NOT has_column_privilege('public', t, c, 'SELECT'))
                              FROM (VALUES ('public.documents', 'storage_path'), ('public.documents', 'file_sha256'), ('public.documents', 'extract_hash'), ('public.documents', 'source_mime'),
                                           ('public.document_chunks', 'block_ids'), ('public.document_chunks', 'image_ids'), ('public.document_chunks', 'embed_hash')) x(t, c)),
                           'the added columns are readable by authenticated only');

-- ===== 3. Constraints and keys, by behaviour =====
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'pc-constraints', 'Constraints', 'national', 'PcFeat', 'sha-c', 'cccc', 3, NULL);
INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to)
  VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'page one', 0, 8);
SELECT pg_temp.assert_true((SELECT header_in_text = false AND footer_in_text = false AND created_at IS NOT NULL FROM document_pages WHERE extract_hash = 'x1'),
                           'page defaults: header_in_text and footer_in_text false, created_at filled');
SELECT pg_temp.rejected($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 0, '', 0, 0)$q$, '23514', 'page_number 0 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 2, '', 9, 8)$q$, '23514', 'a page with char_from > char_to is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 2, '', -1, 8)$q$, '23514', 'a page with a negative char_from is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'again', 10, 15)$q$, '23505', 'a second page 1 in one extraction is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-00000000dead', 'x1', 2, 'p', 0, 1)$q$, '23503', 'a page of an unknown document is rejected');
SELECT pg_temp.accepted($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x2', 1, 'page one again', 0, 14)$q$,
                        'another extraction may repeat a page number');
SELECT pg_temp.accepted($q$INSERT INTO document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x2', 2, '', 16, 16)$q$,
                        'an empty page (char_from = char_to) is accepted');

SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1, char_from, char_to, content) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 0, 'text', 0, 0, 1, 1, 0, 8, 'page one')$q$,
                        'a block box on the page edges is accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1, char_from, char_to, content) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 1, 'text', 0.2, 0.3, 0.2, 0.3, 3, 3, 'degenerate')$q$,
                        'a degenerate block box and an empty span are accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1, char_from, char_to, content) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 2, 'text', NULL, NULL, NULL, NULL, 0, 4, 'no dimensions')$q$,
                        'a block without a box is accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1, char_from, char_to, content) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 3, 'text', 0.1, 0.1, 0.5, 0.5, NULL, NULL, 'not located')$q$,
                        'a block that was not located (null offsets) is accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 2, 0, 'text')$q$,
                        'another page may reuse a block_index');
SELECT pg_temp.accepted($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type) VALUES ('c0000000-0000-4000-8000-000000000001', 'x2', 1, 0, 'text')$q$,
                        'another extraction may reuse a block_index');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.1, 0.1, 1.01, 0.5)$q$, '23514', 'a block with x1 > 1 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', -0.01, 0.1, 0.5, 0.5)$q$, '23514', 'a block with x0 < 0 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.6, 0.1, 0.5, 0.5)$q$, '23514', 'a block with x0 > x1 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.1, 0.6, 0.5, 0.5)$q$, '23514', 'a block with y0 > y1 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.1, -0.1, 0.5, 0.5)$q$, '23514', 'a block with y0 < 0 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.1, 0.1, 0.5, 1.5)$q$, '23514', 'a block with y1 > 1 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 0.1, 0.1, NULL, 0.5)$q$, '23514', 'a block with a partial box is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 5, 4)$q$, '23514', 'a block with char_from > char_to is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', -1, 4)$q$, '23514', 'a block with a negative char_from is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 10, 'text', 4, NULL)$q$, '23514', 'a block located at one end only is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 0, 'text')$q$, '23505', 'a repeated block_index on a page is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_blocks (document_id, extract_hash, page_number, block_index, type) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 0, 11, 'text')$q$, '23514', 'a block on page 0 is rejected');

SELECT pg_temp.accepted($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path, byte_size, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'img:1-1', 'aa', 'image/png', 'c0000000-0000-4000-8000-000000000001/img/aa.png', 10, 0.1, 0.1, 0.9, 0.9)$q$,
                        'an image with a box is accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'img:1-2', 'bb', 'image/jpeg', 'c0000000-0000-4000-8000-000000000001/img/bb.jpeg')$q$,
                        'an image without a box is accepted');
SELECT pg_temp.accepted($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path) VALUES ('c0000000-0000-4000-8000-000000000001', 'x2', 1, 'img:1-1', 'aa', 'image/png', 'c0000000-0000-4000-8000-000000000001/img/aa.png')$q$,
                        'another extraction may repeat a placeholder');
SELECT pg_temp.rejected($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'img:1-9', 'cc', 'image/png', 'p', 0.1, 0.1, 1.2, 0.9)$q$, '23514', 'an image box outside 0..1 is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path, x0, y0, x1, y1) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'img:1-9', 'cc', 'image/png', 'p', 0.5, 0.9, 0.6, 0.1)$q$, '23514', 'an inverted image box is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path, x0) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 1, 'img:1-9', 'cc', 'image/png', 'p', 0.5)$q$, '23514', 'a partial image box is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 2, 'img:1-1', 'cc', 'image/png', 'p')$q$, '23505', 'a repeated placeholder in one extraction is rejected');
SELECT pg_temp.rejected($q$INSERT INTO document_page_images (document_id, extract_hash, page_number, placeholder, sha256, mime, storage_path) VALUES ('c0000000-0000-4000-8000-000000000001', 'x1', 0, 'img:0-1', 'cc', 'image/png', 'p')$q$, '23514', 'an image on page 0 is rejected');

-- Real statements by each client role: effective access, including any
-- column-level grant the table-level matrix above cannot see.
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.document_pages$q$, '42501', 'anon cannot read pages');
SELECT pg_temp.rejected($q$SELECT * FROM public.document_page_blocks$q$, '42501', 'anon cannot read blocks');
SELECT pg_temp.rejected($q$SELECT * FROM public.document_page_images$q$, '42501', 'anon cannot read images');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.document_pages) = 3 AND (SELECT count(*) FROM public.document_page_blocks) = 6
                           AND (SELECT count(*) FROM public.document_page_images) = 3, 'authenticated reads every page, block and image under RLS');
SELECT pg_temp.rejected($q$INSERT INTO public.document_pages (document_id, extract_hash, page_number, text, char_from, char_to) VALUES ('c0000000-0000-4000-8000-000000000001', 'x9', 1, '', 0, 0)$q$, '42501', 'authenticated cannot insert a page');
SELECT pg_temp.rejected($q$UPDATE public.document_page_blocks SET content = 'x'$q$, '42501', 'authenticated cannot update a block');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('document_pages', 'document_page_blocks', 'document_page_images')) = 3
                           AND (SELECT bool_and(cmd = 'SELECT' AND roles = '{authenticated}' AND qual = 'true' AND permissive = 'PERMISSIVE') FROM pg_policies
                                 WHERE schemaname = 'public' AND tablename IN ('document_pages', 'document_page_blocks', 'document_page_images')),
                           'each page table has one policy: select to authenticated using (true)');
-- Deleting the document removes its pages, blocks and images.
DELETE FROM documents WHERE id = 'c0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM document_pages) AND NOT EXISTS (SELECT FROM document_page_blocks) AND NOT EXISTS (SELECT FROM document_page_images),
                           'deleting a document cascades to its pages, blocks and images');

-- ===== 4. chunk_commit =====
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'chunk_commit' AND pronamespace = 'public'::regnamespace) = 1
                           AND to_regprocedure('public.chunk_commit(uuid,jsonb,text[])') IS NOT NULL, 'exactly one chunk_commit(uuid, jsonb, text[])');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig = array['search_path=public, extensions'] AND pg_get_function_result(oid) = 'jsonb'
                              FROM pg_proc WHERE oid = to_regprocedure('public.chunk_commit(uuid,jsonb,text[])')), 'chunk_commit stays security definer with search_path public, extensions');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.chunk_commit(uuid,jsonb,text[])', 'EXECUTE')
                           AND NOT has_function_privilege('authenticated', 'public.chunk_commit(uuid,jsonb,text[])', 'EXECUTE')
                           AND NOT has_function_privilege('public', 'public.chunk_commit(uuid,jsonb,text[])', 'EXECUTE')
                           AND has_function_privilege('service_role', 'public.chunk_commit(uuid,jsonb,text[])', 'EXECUTE'), 'only service_role can execute chunk_commit');

INSERT INTO documents (id, source_key, title, content_sha256, ocr_text, chunker_version) VALUES
  ('c0000000-0000-4000-8000-000000000002', 'pc-commit', 'Commit', 'sha-k', 'oooopppp', 3);
CREATE TEMP TABLE commit_result (step text, r jsonb);
GRANT ALL ON commit_result TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO commit_result SELECT 'first', public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'o1', 'chunk_index', 0, 'char_from', 0, 'char_to', 4, 'content', 'oooo', 'chunker_version', 2, 'embedding', pg_temp.j(pg_temp.v(1))),
  jsonb_build_object('chunk_hash', 'p1', 'chunk_index', 1, 'source_kind', 'pdf_page', 'page_number', 1, 'char_from', 4, 'char_to', 8, 'content', 'pppp', 'chunker_version', 3,
                     'metadata', '{"section": {"heading": "H"}}'::jsonb,
                     'block_ids', '["b0000000-0000-4000-8000-000000000002", "b0000000-0000-4000-8000-000000000001"]'::jsonb,
                     'image_ids', '["a0000000-0000-4000-8000-000000000001"]'::jsonb, 'embed_hash', 'e1', 'embedding', pg_temp.j(pg_temp.v(2))),
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 2, 'source_kind', 'pdf_page', 'page_number', 2, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3,
                     'block_ids', '[]'::jsonb, 'image_ids', '[]'::jsonb, 'embed_hash', 'e2', 'embedding', pg_temp.j(pg_temp.v(3)))
), array['o1', 'p1', 'p2']);
RESET ROLE;
CREATE TEMP TABLE first_rows AS SELECT chunk_hash, id, embedding FROM document_chunks WHERE document_id = 'c0000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_true((SELECT r = '{"inserted": 3, "kept": 0, "deleted": 0}' FROM commit_result WHERE step = 'first'), 'the first commit inserts three rows');
SELECT pg_temp.assert_true((SELECT block_ids = array['b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001']::uuid[] FROM document_chunks WHERE chunk_hash = 'p1'),
                           'an insert writes block_ids, in the row''s order');
SELECT pg_temp.assert_true((SELECT image_ids = array['a0000000-0000-4000-8000-000000000001']::uuid[] FROM document_chunks WHERE chunk_hash = 'p1'), 'an insert writes image_ids');
SELECT pg_temp.assert_true((SELECT embed_hash = 'e1' FROM document_chunks WHERE chunk_hash = 'p1'), 'an insert writes embed_hash');
SELECT pg_temp.assert_true((SELECT block_ids = '{}'::uuid[] AND image_ids = '{}'::uuid[] FROM document_chunks WHERE chunk_hash = 'p2'), 'an insert keeps an empty list as an empty array');
SELECT pg_temp.assert_true((SELECT block_ids IS NULL AND image_ids IS NULL AND embed_hash IS NULL AND embedding = pg_temp.v(1) AND source_kind = 'document' AND metadata = '{}'
                              FROM document_chunks WHERE chunk_hash = 'o1'), 'an old-style insert leaves the page columns null');

-- The second commit: every row hits.
--   o1: old-style, no embedding, a new chunk_index;
--   p1: embed_hash changed and a new embedding (the R4 re-embed case), new links;
--   p2: embed_hash unchanged, no embedding, new links.
SET LOCAL ROLE service_role;
INSERT INTO commit_result SELECT 'second', public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'o1', 'chunk_index', 5, 'char_from', 0, 'char_to', 4, 'content', 'oooo', 'chunker_version', 2),
  jsonb_build_object('chunk_hash', 'p1', 'chunk_index', 6, 'source_kind', 'pdf_page', 'page_number', 1, 'char_from', 4, 'char_to', 8, 'content', 'pppp', 'chunker_version', 3,
                     'metadata', '{"section": {"heading": "H2"}}'::jsonb,
                     'block_ids', '["b0000000-0000-4000-8000-000000000003"]'::jsonb, 'image_ids', '[]'::jsonb,
                     'embed_hash', 'e1b', 'embedding', pg_temp.j(pg_temp.v(7))),
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'source_kind', 'pdf_page', 'page_number', 2, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3,
                     'block_ids', '["b0000000-0000-4000-8000-000000000004"]'::jsonb, 'image_ids', '["a0000000-0000-4000-8000-000000000002"]'::jsonb, 'embed_hash', 'e2')
), array['o1', 'p1', 'p2']);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT r = '{"inserted": 0, "kept": 3, "deleted": 0}' FROM commit_result WHERE step = 'second'), 'the second commit keeps all three rows');
SELECT pg_temp.assert_true((SELECT c.id = f.id FROM document_chunks c JOIN first_rows f USING (chunk_hash) WHERE chunk_hash = 'p1'), 'a re-embed hit keeps the id');
SELECT pg_temp.assert_true((SELECT embedding = pg_temp.v(7) FROM document_chunks WHERE chunk_hash = 'p1'), 'a re-embed hit replaces the vector');
SELECT pg_temp.assert_true((SELECT embed_hash = 'e1b' FROM document_chunks WHERE chunk_hash = 'p1'), 'a re-embed hit stores the new embed_hash');
SELECT pg_temp.assert_true((SELECT block_ids = array['b0000000-0000-4000-8000-000000000003']::uuid[] AND image_ids = '{}'::uuid[] AND chunk_index = 6 AND metadata = '{"section": {"heading": "H2"}}'
                              FROM document_chunks WHERE chunk_hash = 'p1'), 'a hit refreshes block_ids, image_ids, anchors and metadata');
SELECT pg_temp.assert_true((SELECT c.id = f.id AND c.embedding = f.embedding AND c.embed_hash = 'e2' FROM document_chunks c JOIN first_rows f USING (chunk_hash) WHERE chunk_hash = 'p2'),
                           'a hit without an embedding keeps the id and the vector');
SELECT pg_temp.assert_true((SELECT block_ids = array['b0000000-0000-4000-8000-000000000004']::uuid[] AND image_ids = array['a0000000-0000-4000-8000-000000000002']::uuid[]
                              FROM document_chunks WHERE chunk_hash = 'p2'), 'a hit without an embedding still refreshes the links');
SELECT pg_temp.assert_true((SELECT c.id = f.id AND c.embedding = f.embedding AND c.chunk_index = 5 AND c.block_ids IS NULL AND c.image_ids IS NULL AND c.embed_hash IS NULL
                              FROM document_chunks c JOIN first_rows f USING (chunk_hash) WHERE chunk_hash = 'o1'), 'an old-style hit keeps its id and vector and its page columns stay null');

-- Refusals (each rolls back in its own subtransaction).
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3, 'embed_hash', 'e2-changed')), array['o1', 'p1', 'p2'])$q$,
  'P0001', 'a hit whose embed_hash changed without a new embedding is refused');
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3, 'embed_hash', 'e2', 'embedding', '[1, 2, 3]'::jsonb)), array['o1', 'p1', 'p2'])$q$,
  'P0001', 'a replacement vector of the wrong width is refused');
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3, 'embed_hash', 'e2', 'embedding', '"x"'::jsonb)), array['o1', 'p1', 'p2'])$q$,
  'P0001', 'a replacement vector that is not an array is refused');
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3, 'embed_hash', 'e2', 'block_ids', '"b0000000-0000-4000-8000-000000000004"'::jsonb)), array['o1', 'p1', 'p2'])$q$,
  'P0001', 'block_ids that is not an array is refused');
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p2', 'chunk_index', 7, 'char_from', 8, 'char_to', 8, 'content', '', 'chunker_version', 3, 'embed_hash', 'e2', 'image_ids', '{"a": 1}'::jsonb)), array['o1', 'p1', 'p2'])$q$,
  'P0001', 'image_ids that is not an array is refused');
SELECT pg_temp.rejected($q$SELECT public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'n9', 'chunk_index', 9, 'char_from', 0, 'char_to', 1, 'content', 'o', 'chunker_version', 3)), array['o1', 'p1', 'p2', 'n9'])$q$,
  'P0001', 'a new chunk without an embedding is still refused');
RESET ROLE;

-- An old-style row (none of the new keys) on a page chunk: the row is the whole
-- truth on a hit, so its links and embed_hash become null; the vector stays.
-- The keep list leaves out o1, which is deleted, as before.
SET LOCAL ROLE service_role;
INSERT INTO commit_result SELECT 'third', public.chunk_commit('c0000000-0000-4000-8000-000000000002', jsonb_build_array(
  jsonb_build_object('chunk_hash', 'p1', 'chunk_index', 1, 'source_kind', 'pdf_page', 'page_number', 1, 'char_from', 4, 'char_to', 8, 'content', 'pppp', 'chunker_version', 3, 'embedding', NULL)
), array['p1', 'p2']);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT r = '{"inserted": 0, "kept": 1, "deleted": 1}' FROM commit_result WHERE step = 'third')
                           AND NOT EXISTS (SELECT FROM document_chunks WHERE chunk_hash = 'o1'), 'a keep list without a hash still deletes that chunk');
SELECT pg_temp.assert_true((SELECT block_ids IS NULL AND image_ids IS NULL AND embed_hash IS NULL AND embedding = pg_temp.v(7) AND metadata = '{}' FROM document_chunks WHERE chunk_hash = 'p1'),
                           'a hit from a row without the new keys nulls them and keeps the vector (a JSON null embedding is no embedding)');

-- ===== 5. match_documents and its helper =====
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'match_documents' AND pronamespace = 'public'::regnamespace) = 1
                           AND to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)') IS NOT NULL, 'exactly one match_documents, with the retrieval-scope signature');
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'match_documents_feature_hnsw' AND pronamespace = 'public'::regnamespace) = 1
                           AND to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)') IS NOT NULL, 'exactly one match_documents_feature_hnsw, with its signature');
SELECT pg_temp.assert_true(pg_get_function_arguments(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)'))
                           = 'query_embedding vector, match_count integer DEFAULT 40, p_document_ids uuid[] DEFAULT NULL::uuid[], p_desk_tier text DEFAULT NULL::text, p_desk_feature text DEFAULT NULL::text',
                           'match_documents keeps its argument names and defaults');
SELECT pg_temp.assert_true(pg_get_function_result(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)'))
                           = 'TABLE(id uuid, document_id uuid, content text, similarity double precision, chunk_index integer, source_kind text, page_number integer, char_from integer, char_to integer, '
                             'title text, file_name text, file_url text, desk_tier text, desk_feature text, block_ids uuid[], image_ids uuid[], section jsonb)',
                           'match_documents returns the 14 old columns, then block_ids, image_ids and section');
SELECT pg_temp.assert_true(pg_get_function_result(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)'))
                           = pg_get_function_result(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')), 'the helper returns the same columns as match_documents');
SELECT pg_temp.assert_true((SELECT bool_and(NOT prosecdef AND provolatile = 's' AND proconfig = array['search_path=public, extensions']) FROM pg_proc
                             WHERE oid IN (to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)'), to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)'))),
                           'match_documents and the helper stay security invoker, stable, search_path only');
SELECT pg_temp.assert_true(bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('public', f, 'EXECUTE')), 'anon and PUBLIC cannot execute match_documents or the helper')
  FROM unnest(array['public.match_documents(extensions.vector,int,uuid[],text,text)', 'public.match_documents_feature_hnsw(extensions.vector,int,text,text)']) f;
SELECT pg_temp.assert_true(bool_and(has_function_privilege('authenticated', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')), 'authenticated and service_role can execute match_documents and the helper')
  FROM unnest(array['public.match_documents(extensions.vector,int,uuid[],text,text)', 'public.match_documents_feature_hnsw(extensions.vector,int,text,text)']) f;
-- NTER's migration role may not attach a placeholder GUC such as hnsw.ef_search
-- to a function. No function anywhere carries one; the helper keeps set_config.
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_proc p, unnest(p.proconfig) s WHERE s ILIKE 'hnsw.%'), 'no function has an hnsw.* SET clause');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)')) ILIKE '%set_config(''hnsw.ef_search'', c_ef_search, true)%'
                           AND pg_get_functiondef(to_regprocedure('public.match_documents_feature_hnsw(extensions.vector,int,text,text)')) ~* 'c_ef_search\s+constant\s+text\s*:=\s*''400''',
                           'the helper still sets hnsw.ef_search = 400 with set_config');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) NOT ILIKE '%SET clause%', 'the stale "SET clause" comment is gone');
SELECT pg_temp.assert_true(pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) ILIKE '%c_exact_max_chunks constant int := 15000%'
                           AND pg_get_functiondef(to_regprocedure('public.match_documents(extensions.vector,int,uuid[],text,text)')) ILIKE '%halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))%',
                           'match_documents keeps T = 15,000 and the half-precision unscoped ranking');

-- A document with two page rows and one old row. Query = axis 1.
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('c0000000-0000-4000-8000-000000000003', 'pc-match', 'Match', 'national', 'PcFeat', 'sha-m', 'mmmmmmmmmmmm', 3, now());
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, embedding, chunker_version, metadata, block_ids, image_ids, embed_hash) VALUES
  ('c0000000-0000-4000-8000-000000000003', 'm-new', 0, 'pdf_page', 1, 0, 4, 'mmmm', pg_temp.v(1) + pg_temp.v(10, 0.1), 3,
   '{"section": {"heading": "CHAPTER I PRELIMINARY", "note": "Definitions."}}',
   array['b0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b']::uuid[], array['a0000000-0000-4000-8000-00000000000a']::uuid[], 'eh'),
  ('c0000000-0000-4000-8000-000000000003', 'm-nosec', 1, 'pdf_page', 2, 4, 8, 'mmmm', pg_temp.v(1) + pg_temp.v(11, 0.2), 3, '{"other": 1}', '{}', '{}', 'eh2');
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version) VALUES
  ('c0000000-0000-4000-8000-000000000003', 'm-old', 2, 8, 12, 'mmmm', pg_temp.v(1) + pg_temp.v(12, 0.3), 2);
CREATE FUNCTION pg_temp.expected_ok(rows jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT rows = '[{"h": "m-new", "b": ["b0000000-0000-4000-8000-00000000000a", "b0000000-0000-4000-8000-00000000000b"], "i": ["a0000000-0000-4000-8000-00000000000a"],
                   "s": {"heading": "CHAPTER I PRELIMINARY", "note": "Definitions."}},
                  {"h": "m-nosec", "b": [], "i": [], "s": null},
                  {"h": "m-old", "b": null, "i": null, "s": null}]'::jsonb;
$$;
-- Rows of one call as [{h, b, i, s}] in similarity order, keeping only this document's rows.
CREATE FUNCTION pg_temp.md(ids uuid[], feature text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('h', c.chunk_hash, 'b', m.block_ids, 'i', m.image_ids, 's', m.section) ORDER BY m.similarity DESC)
    FROM match_documents(pg_temp.v(1), 40, ids, NULL, feature) m JOIN document_chunks c ON c.id = m.id
   WHERE m.document_id = 'c0000000-0000-4000-8000-000000000003';
$$;
SELECT pg_temp.assert_true(pg_temp.expected_ok(pg_temp.md(array['c0000000-0000-4000-8000-000000000003'::uuid], NULL)), 'scoped: page rows return their block_ids, image_ids and section; old rows return nulls');
SELECT pg_temp.assert_true(pg_temp.expected_ok(pg_temp.md(NULL, NULL)), 'unscoped: page rows return their block_ids, image_ids and section; old rows return nulls');
SELECT pg_temp.assert_true(pg_temp.expected_ok(pg_temp.md(NULL, 'PcFeat')), 'feature (exact path): page rows return their block_ids, image_ids and section; old rows return nulls');
SELECT pg_temp.assert_true(pg_temp.expected_ok((SELECT jsonb_agg(jsonb_build_object('h', c.chunk_hash, 'b', h.block_ids, 'i', h.image_ids, 's', h.section) ORDER BY h.similarity DESC)
                                                  FROM match_documents_feature_hnsw(pg_temp.v(1), 40, NULL, 'PcFeat') h JOIN document_chunks c ON c.id = h.id)),
                           'the helper: page rows return their block_ids, image_ids and section; old rows return nulls');
SELECT pg_temp.assert_true((SELECT bool_and(abs(m.similarity - (1 - (c.embedding <=> pg_temp.v(1)))) < 1e-9 AND m.title = 'Match' AND m.desk_feature = 'PcFeat' AND m.char_from = c.char_from
                                            AND m.page_number IS NOT DISTINCT FROM c.page_number AND m.content = c.content AND m.source_kind = c.source_kind)
                              FROM match_documents(pg_temp.v(1), 40, array['c0000000-0000-4000-8000-000000000003'::uuid]) m JOIN document_chunks c ON c.id = m.id),
                           'the old columns keep their values');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '40', 'the helper''s ef_search does not leak into the session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.expected_ok(pg_temp.md(array['c0000000-0000-4000-8000-000000000003'::uuid], NULL)), 'authenticated gets the new columns under RLS');
RESET ROLE;

-- The large-feature path through match_documents itself: 15,003 chunks in one
-- feature sends the call to the helper, so its columns must line up with
-- match_documents' own (a mismatch fails at run time). The HNSW index is dropped
-- inside this transaction only, to make the load fast; the helper's ordering
-- does not need it to be correct.
DROP INDEX IF EXISTS document_chunks_embedding_halfvec_hnsw;
INSERT INTO documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) VALUES
  ('c0000000-0000-4000-8000-000000000004', 'pc-big', 'Big', 'national', 'PcBig', 'sha-b', 'bbbb', 3, now());
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
SELECT 'c0000000-0000-4000-8000-000000000004', 'big' || k, k, 0, 4, 'bbbb', e, 2
  FROM generate_series(1, 15001) k CROSS JOIN (SELECT pg_temp.v(1) + pg_temp.v(20, 0.9) AS e) x;
INSERT INTO document_chunks (document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, embedding, chunker_version, metadata, block_ids, image_ids, embed_hash) VALUES
  ('c0000000-0000-4000-8000-000000000004', 'big-new', 0, 'pdf_page', 1, 0, 4, 'bbbb', pg_temp.v(1) + pg_temp.v(21, 0.05), 3,
   '{"section": {"note": "Espionage."}}', array['b0000000-0000-4000-8000-0000000000bb']::uuid[], array['a0000000-0000-4000-8000-0000000000bb']::uuid[], 'ebig'),
  ('c0000000-0000-4000-8000-000000000004', 'big-old', 1, 'document', NULL, 0, 4, 'bbbb', pg_temp.v(1) + pg_temp.v(22, 0.1), 2, '{}', NULL, NULL, NULL);
SELECT pg_temp.assert_true((SELECT jsonb_agg(jsonb_build_object('h', c.chunk_hash, 'b', m.block_ids, 'i', m.image_ids, 's', m.section) ORDER BY m.similarity DESC)
                              FROM match_documents(pg_temp.v(1), 2, NULL, NULL, 'PcBig') m JOIN document_chunks c ON c.id = m.id)
                           = '[{"h": "big-new", "b": ["b0000000-0000-4000-8000-0000000000bb"], "i": ["a0000000-0000-4000-8000-0000000000bb"], "s": {"note": "Espionage."}},
                               {"h": "big-old", "b": null, "i": null, "s": null}]'::jsonb,
                           'feature (index path, through match_documents): page rows return their new columns; old rows return nulls');
SELECT pg_temp.assert_true(current_setting('hnsw.ef_search') = '40', 'the index path leaves ef_search as it found it');
-- Prove the routing: swap the helper (inside this transaction) for a stub that
-- returns one marked row; the big feature gets the mark, the small one does not.
CREATE OR REPLACE FUNCTION public.match_documents_feature_hnsw(query_embedding extensions.vector(1536), match_count int, p_desk_tier text, p_desk_feature text)
RETURNS TABLE (id uuid, document_id uuid, content text, similarity float8, chunk_index int, source_kind text, page_number int, char_from int, char_to int,
               title text, file_name text, file_url text, desk_tier text, desk_feature text, block_ids uuid[], image_ids uuid[], section jsonb)
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid, NULL::uuid, 'from the helper', 1::float8, 0, 'document', NULL::int, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL::uuid[], NULL::uuid[], NULL::jsonb $$;
SELECT pg_temp.assert_true((SELECT array_agg(content) FROM match_documents(pg_temp.v(1), 5, NULL, NULL, 'PcBig')) = array['from the helper']
                           AND NOT EXISTS (SELECT FROM match_documents(pg_temp.v(1), 5, NULL, NULL, 'PcFeat') WHERE content = 'from the helper'),
                           'a feature above T is answered by the helper, a smaller one is not');
ROLLBACK;
