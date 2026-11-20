-- F374 (Tasks 1 and 2): five more National desks admitted search-only, each file link checked against its own desk's
-- hosts. Disposable fixture. run.sh uses the national_search_only chain, then
-- 20261123090000_national_search_only_five_desks (as a non-superuser). Spec:
-- docs/specs/2026-11-19-five-desk-search-only-route.md, Design point 1 and acceptance evidence 1.
--
-- It first runs every case of the Bills rules, of Bills, and of questions and Law (through their includes, expanded by
-- run.sh exactly as for national_search_only, with the same one rewritten expectation) on the replaced functions, so the
-- three linked paths are proved unchanged. Then, as the callers do it (registration as corpus_ingest, policies as
-- service_role): each of the five desks admitted with each of its own hosts and with no file_url; every desk, Regulatory
-- included, refused file_url_invalid with every host that is not its own; desks outside the list refused no_adapter;
-- duplicates within a desk refused by name; the indexes, the one desk-and-host table, privileges and cost.
\i supabase/tests/ingest_bills_admission_rules.sql

-- The six search-only desks, each with the hosts the spec gives it, and the collection its policy is approved under.
create temp table so_desk(n int primary key, desk text, coll text, hosts text[]);
insert into so_desk values
  (0, 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'national-regulatory', array['rbidocs.rbi.org.in', 'www.rbi.org.in', 'www.sebi.gov.in']),
  (1, 'Budget Utilisation & Schemes', 'national-budget', array['www.indiabudget.gov.in']),
  (2, 'Cabinet Decisions', 'national-cabinet', array['www.pib.gov.in']),
  (3, U&'Bureaucratic Transfers \2014 AGMUT Cadre', 'national-transfers', array['mha.gov.in']),
  (4, 'Industry Updates (Ministry Data)', 'national-industry', array['www.dpiit.gov.in', 'eaindustry.nic.in', 'www.mospi.gov.in', 'mospi.gov.in']),
  (5, 'MP Profiles & Performance (MPLAD attendance debates)', 'national-mp-profiles', array['sansad.in']);
create temp table so_host as select d.n, h.host from so_desk d, unnest(d.hosts) h(host);

-- A pack record of desk n (synthetic). g picks the source key (through pq's question number) and the text; over
-- replaces fields; t replaces the text. Its file is on the desk's first host.
create function pg_temp.so(n int, g int, over jsonb default '{}', t text default null, pages int default 1) returns jsonb language sql as $$
 select pg_temp.pq(40000 + 1000 * n + g, jsonb_build_object('desk_feature',(select desk from so_desk where so_desk.n = so.n),
   'title','Fixture document ' || n || '-' || g,
   'file_url','https://' || (select hosts[1] from so_desk where so_desk.n = so.n) || '/fixture/F' || n || '-' || g || '.pdf',
   'file_name','F' || n || '-' || g || '.pdf','document_key_suggested','fx' || n || ':' || g,'doc_type','fixture',
   'licence_class','gov_open','completeness_basis','page_check',
   'citation',jsonb_build_object('kind','fixture','source',(select hosts[1] from so_desk where so_desk.n = so.n))) || over,
   coalesce(t, 'FIXTURE DOCUMENT ' || n || '-' || g || '. The text of a synthetic search-only document.'), pages) $$;
create function pg_temp.coll_of(n int) returns text language sql as $$ select d.coll from so_desk d where d.n = coll_of.n $$;
create function pg_temp.doc_of(q jsonb) returns public.documents language sql as $$
 select d from public.documents d where d.source_key = (q->>'payload')::jsonb->>'source_key' $$;
create function pg_temp.locked(v text) returns boolean language sql as $$
 select exists(select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
   and l.classid::bigint = ((hashtextextended(v, 724893) >> 32) & 4294967295)
   and l.objid::bigint = (hashtextextended(v, 724893) & 4294967295)) $$;

-- ═══ One table of desks and hosts ═════════════════════
select pg_temp.ok((select array_agg(s.desk_feature || '=' || array_to_string(s.hosts, ',') order by s.desk_feature)
     from public.ingest_search_only_desks() s)
   = (select array_agg(desk || '=' || array_to_string(hosts, ',') order by desk) from so_desk),
  'ingest_search_only_desks holds exactly the six desks, each with its own hosts');
select pg_temp.ok((select desk from so_desk where n = 3) = 'Bureaucratic Transfers ' || chr(8212) || ' AGMUT Cadre'
   and exists(select 1 from public.ingest_search_only_desks() s where s.desk_feature = 'Bureaucratic Transfers ' || chr(8212) || ' AGMUT Cadre'),
  'the Transfers desk is spelt with the em dash, U+2014');
select pg_temp.ok((select p.provolatile = 'i' and not p.prosecdef and p.proconfig = array['search_path=public, extensions, pg_temp']
     and p.proacl::text = '{nter_migrator=X/nter_migrator}'
   from pg_proc p where p.oid = 'public.ingest_search_only_desks()'::regprocedure)
   and not exists(select 1 from unnest(array['public','anon','authenticated','service_role','corpus_ingest']) r
                   where has_function_privilege(r, 'public.ingest_search_only_desks()', 'execute')),
  'the helper: immutable, invoker, its search path set, owner-only');
-- The lookups and the index predicates cannot read the helper: their literal lists name exactly its desks.
select pg_temp.ok((select bool_and((length(p.prosrc) - length(replace(p.prosrc, '''' || s.desk_feature || '''', ''))) / length('''' || s.desk_feature || '''') = 2)
     from pg_proc p, public.ingest_search_only_desks() s where p.oid = 'public.ingest_admit_document(jsonb,jsonb)'::regprocedure)
   and (select (length(p.prosrc) - length(replace(p.prosrc, 'x.desk_feature in (', ''))) / length('x.desk_feature in (') = 2
     from pg_proc p where p.oid = 'public.ingest_admit_document(jsonb,jsonb)'::regprocedure)
   and (select (length(p.prosrc) - length(replace(p.prosrc, '''Regulatory Body Watch (RBI SEBI TRAI CCI)''', '')))
     from pg_proc p where p.oid = 'public.ingest_admit_document(jsonb,jsonb)'::regprocedure) = 2 * length('''Regulatory Body Watch (RBI SEBI TRAI CCI)'''),
  'the two "already held" lookups list each of the six desks, once each');

-- ═══ Tier and adapter ═════════════════════════════════
select pg_temp.ok(bool_and(public.ingest_admit_adapter(jsonb_build_object('desk_tier','national','desk_feature',desk)) = 'national_search_only'
     and public.ingest_admit_tier(jsonb_build_object('source_key',repeat('a',40),'desk_tier','national','desk_feature',desk)) = 'national'
     and public.ingest_admit_adapter(jsonb_build_object('desk_tier','state','desk_feature',desk)) is null
     and public.ingest_admit_tier(jsonb_build_object('source_key','fx:1','desk_tier','national','desk_feature',desk)) is null
     and public.ingest_admit_tier(jsonb_build_object('source_key',repeat('A',40),'desk_tier','national','desk_feature',desk)) is null),
  'each of the six: adapter national_search_only and tier national, on the National tier with a 40-hex key only') from so_desk;
select pg_temp.ok(bool_and(public.ingest_admit_adapter(jsonb_build_object('desk_tier','national','desk_feature',f)) is null
     and public.ingest_admit_tier(jsonb_build_object('source_key',repeat('a',40),'desk_tier','national','desk_feature',f)) is null),
  'other spellings and other desks have no adapter and no tier')
  from unnest(array['Bureaucratic Transfers - AGMUT Cadre', 'Bureaucratic Transfers – AGMUT Cadre', 'Budget Utilisation and Schemes',
    'MP Profiles & Performance (MPLAD, attendance, debates)', 'cabinet decisions', 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
    'Ministry Press Releases', '']) f;
select pg_temp.ok(public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":"Parliamentary Question Database"}') = 'lok_sabha_answers'
   and public.ingest_admit_adapter('{"desk_tier":"national","desk_feature":"Bill Passage Probability Index"}') = 'national_bills'
   and public.ingest_admit_adapter('{"desk_tier":"law","desk_feature":"Supreme Court Judgments"}') = 'law',
  'questions, bills and Law keep their adapters');

-- ═══ Policies, one per desk ═══════════════════════════
select pg_temp.ok(bool_and((pg_temp.policy(coll, jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
    'desk_tier','national','desk_feature',desk,'adapter','national_search_only')))))->>'active' = 'true'),
  'a search-only policy is approved for each of the six desks') from so_desk;
select pg_temp.refused($q$select pg_temp.policy('transfers-hyphen', jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
  'desk_tier','national','desk_feature','Bureaucratic Transfers - AGMUT Cadre','adapter','national_search_only'))))$q$, 'invalid admitted desk');
select pg_temp.refused($q$select pg_temp.policy('budget-bills', jsonb_build_object('admitted',jsonb_build_array(jsonb_build_object(
  'desk_tier','national','desk_feature','Budget Utilisation & Schemes','adapter','national_bills'))))$q$, 'invalid admitted desk');

-- ═══ Admission with each desk's own hosts ═════════════
create temp table links0 as select count(*) n from public.record_document_links;
-- The first record of each desk, Regulatory as before, compared field by field.
do $$ declare d record; q jsonb; res jsonb; doc public.documents; begin
 for d in select * from so_desk order by n loop
   q := pg_temp.so(d.n, 1);
   res := pg_temp.reg(d.coll, q);
   doc := pg_temp.doc_of(q);
   perform pg_temp.ok(res = jsonb_build_object('source_key',(q->>'payload')::jsonb->>'source_key','outcome','admitted','document_id',doc.id,
       'job_id',(select j.id from public.ingest_jobs j where j.document_id = doc.id),'job_status','queued','links',null)
     and doc.desk_tier = 'national' and doc.desk_feature = d.desk and doc.file_url = 'https://' || d.hosts[1] || '/fixture/F' || d.n || '-1.pdf'
     and doc.metadata->>'completeness_basis' = 'page_check' and doc.metadata->>'document_key_suggested' = 'fx' || d.n || ':1'
     and doc.metadata->>'origin' = 'supplied-text' and pg_temp.links(q) = 0
     and (select count(*) from public.ingest_text_inputs t where t.document_id = doc.id) = 1
     and pg_temp.locked('fx' || d.n || ':1') and pg_temp.locked(doc.file_url),
     d.desk || ': admitted search-only on ' || d.hosts[1] || ', queued, stored under its spelling, no link, key and file locked');
 end loop;
end $$;
-- Every other host of each desk, Regulatory's three included.
select pg_temp.ok(pg_temp.reg(pg_temp.coll_of(h.n), pg_temp.so(h.n, 10 + (row_number() over (partition by h.n order by h.host))::int,
    jsonb_build_object('file_url','https://' || h.host || '/fixture/H' || h.n || '-' || h.host || '.pdf?x=1')))->>'outcome' = 'admitted',
  (select desk from so_desk where n = h.n) || ': admitted on ' || h.host) from so_host h;
-- No file_url: admissible on either basis, as for Regulatory (Cabinet and Transfers carry no suggested key in the packs).
select pg_temp.ok(pg_temp.reg(coll, pg_temp.so(n, 30, '{"file_url":null,"file_name":null,"completeness_basis":"density_only"}'))->>'outcome' = 'admitted'
   and (pg_temp.doc_of(pg_temp.so(n, 30))).file_url is null
   and pg_temp.reg(coll, pg_temp.so(n, 31, '{"file_url":null,"document_key_suggested":null}'))->>'outcome' = 'admitted',
  desk || ': admitted with no file_url, and with neither file_url nor suggested key') from so_desk;
select pg_temp.ok((select count(*) from public.record_document_links) = (select n from links0), 'no search-only admission wrote a link');
-- A web page (Cabinet, MP Profiles): page_split none, page_count null, no page spans, the density-only basis. Admitted
-- when the desk's policy does not require a page count (these policies, the fixture default); refused no_page_count when
-- it does, for every desk alike, Regulatory included (its live policy requires one).
select pg_temp.ok(pg_temp.reg(coll, pg_temp.so(n, 32, '{"page_split":"none","page_count":null,"completeness_basis":"density_only"}', null, 0))->>'outcome' = 'admitted'
   and (select jsonb_array_length(d.metadata->'supplied_pages') = 0 and d.metadata->>'page_split' = 'none'
          from pg_temp.doc_of(pg_temp.so(n, 32)) d),
  desk || ': a web page with no page spans and no page count is admitted on the density-only basis') from so_desk;
select pg_temp.ok(bool_and((pg_temp.policy(coll || '-paged', jsonb_build_object('require_page_count',true,'admitted',jsonb_build_array(jsonb_build_object(
    'desk_tier','national','desk_feature',desk,'adapter','national_search_only')))))->>'active' = 'true'), 'a policy requiring a page count, per desk') from so_desk;
select pg_temp.refusal(coll || '-paged', pg_temp.so(n, 33, '{"page_split":"none","page_count":null,"completeness_basis":"density_only"}', null, 0), 'no_page_count') from so_desk;

-- ═══ Another desk's host is refused ═══════════════════
-- Every desk against every host that is not its own: 6 desks, 11 hosts, 55 pairs. Each writes nothing.
create temp table cross_pairs as
 select d.n, h.host, row_number() over (order by d.n, h.host) k from so_desk d cross join (select distinct host from so_host) h
  where not (h.host = any(d.hosts));
select pg_temp.ok((select count(*) from cross_pairs) = 55, 'fifty-five pairs of a desk and a host that is not its own');
select pg_temp.refusal(pg_temp.coll_of(c.n), pg_temp.so(c.n, 100 + c.k::int, jsonb_build_object('file_url','https://' || c.host || '/fixture/X' || c.k || '.pdf')),
  'file_url_invalid') from cross_pairs c;
-- Within the host rule: sub-domains, user, port, case, http and the segment rule, on a new desk's host.
select pg_temp.refusal('national-industry', pg_temp.so(4, 200 + g, jsonb_build_object('file_url', u)), 'file_url_invalid')
  from (values (1, 'http://www.dpiit.gov.in/a.pdf'), (2, 'https://WWW.dpiit.gov.in/a.pdf'), (3, 'https://dpiit.gov.in/a.pdf'),
    (4, 'https://x.mospi.gov.in/a.pdf'), (5, 'https://mospi.gov.in.example.com/a.pdf'), (6, 'https://user@mospi.gov.in/a.pdf'),
    (7, 'https://mospi.gov.in:443/a.pdf'), (8, 'https://mospi.gov.in'), (9, 'https://mospi.gov.in?x=/a.pdf'),
    (10, 'https://mospi.gov.in/a/../b.pdf'), (11, 'https://mospi.gov.in/a/%2e%2e/b.pdf'), (12, 'https://mospi.gov.in/a%2fb.pdf'),
    (13, E'https://mospi.gov.in/a\\b.pdf'), (14, 'https://example.com/https://mospi.gov.in/a.pdf'), (15, ''),
    (16, 'https://' || repeat('a', 10) || '.sansad.in/a.pdf')) v(g, u);
select pg_temp.refusal('national-mp-profiles', pg_temp.so(5, 220, '{"file_url":"https://www.sansad.in/a.pdf"}'), 'file_url_invalid');
select pg_temp.refusal('national-transfers', pg_temp.so(3, 221, '{"file_url":"https://www.mha.gov.in/a.pdf"}'), 'file_url_invalid');
-- The basis is still judged before the URL, and the URL before the key.
select pg_temp.refusal('national-cabinet', pg_temp.so(2, 222, '{"completeness_basis":null,"file_url":"https://mha.gov.in/a.pdf"}'), 'completeness_basis_missing');
select pg_temp.refusal('national-budget', pg_temp.so(1, 223, '{"file_url":"https://www.pib.gov.in/a.pdf","document_key_suggested":""}'), 'file_url_invalid');
select pg_temp.refusal('national-budget', pg_temp.so(1, 224, '{"document_key_suggested":"  "}'), 'suggested_key_invalid');

-- ═══ Desks outside the list, and other collections ════
select pg_temp.refusal('national-transfers', pg_temp.so(3, 230, '{"desk_feature":"Bureaucratic Transfers - AGMUT Cadre"}'), 'no_adapter');
select pg_temp.refusal('national-budget', pg_temp.so(1, 231, '{"desk_feature":"Budget Utilisation and Schemes"}'), 'no_adapter');
select pg_temp.refusal('national-cabinet', pg_temp.so(2, 232, '{"desk_feature":"Ministry Press Releases"}'), 'no_adapter');
select pg_temp.refusal('national-cabinet', pg_temp.so(2, 233, '{"desk_tier":"state"}'), 'no_adapter');
-- One desk's record is not another desk's collection, nor a question's or a bill's; theirs are not these.
select pg_temp.refusal('national-budget', pg_temp.so(2, 234), 'collection_not_admitted');
select pg_temp.refusal('national-regulatory', pg_temp.so(4, 235), 'collection_not_admitted');
select pg_temp.refusal('national-industry', pg_temp.so(0, 236), 'collection_not_admitted');
select pg_temp.refusal('national-pq', pg_temp.so(5, 237), 'collection_not_admitted');
select pg_temp.refusal('national-bills', pg_temp.so(1, 238), 'collection_not_admitted');
select pg_temp.refusal('national-mp-profiles', pg_temp.pq(9998), 'collection_not_admitted');
select pg_temp.refusal('national-cabinet', pg_temp.bill(9997, '{"tag":"five"}'), 'collection_not_admitted');
-- A question and a bill still take their linked paths (the included cases ran all of them on these functions).
select pg_temp.refusal('national-pq', pg_temp.pq(9990), 'no_desk_row');

-- ═══ Held within a desk ═══════════════════════════════
select pg_temp.refusal(coll, pg_temp.so(n, 240, jsonb_build_object('file_url','https://' || hosts[1] || '/fixture/F' || n || '-1.pdf')), 'file_url_held') from so_desk;
select pg_temp.refusal(coll, pg_temp.so(n, 241, jsonb_build_object('document_key_suggested','fx' || n || ':1')), 'suggested_key_held') from so_desk;
-- The same suggested key in another desk is not held: the lookups and the indexes are per desk.
select pg_temp.ok(pg_temp.reg('national-budget', pg_temp.so(1, 242, '{"document_key_suggested":"fx4:1"}'))->>'outcome' = 'admitted',
  'a suggested key held only by another desk does not hold');
-- One call, two records with one file or one key: the first is admitted, the second sees it.
do $$ declare qs jsonb := jsonb_build_array(pg_temp.so(5, 243), pg_temp.so(5, 244, '{"file_url":"https://sansad.in/fixture/F5-243.pdf"}'),
   pg_temp.so(5, 245, '{"document_key_suggested":"fx5:243"}')); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-mp-profiles', qs), qs);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'admitted' and res#>>'{results,1,reason}' = 'file_url_held'
   and res#>>'{results,2,reason}' = 'suggested_key_held', 'within one call, a later record sees an earlier one''s file and key: ' || (res->'totals')::text);
end $$;
-- A document of the desk from an older path (no stored payload) holds its file and key too.
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values ('f374' || repeat('7',36),'Older path','https://www.dpiit.gov.in/legacy/L1.pdf','national','Industry Updates (Ministry Data)',
  repeat('7',64),'x','{"document_key_suggested":"industry:legacy1"}');
select pg_temp.refusal('national-industry', pg_temp.so(4, 246, '{"file_url":"https://www.dpiit.gov.in/legacy/L1.pdf"}'), 'file_url_held');
select pg_temp.refusal('national-industry', pg_temp.so(4, 247, '{"document_key_suggested":"industry:legacy1","file_url":null}'), 'suggested_key_held');
-- Registered again: existing, nothing written. A dry run writes nothing.
do $$ declare before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.reg('national-cabinet', pg_temp.so(2, 1));
 perform pg_temp.ok(res->>'outcome' = 'existing' and pg_temp.corpus() = before, 'registering a Cabinet record again finds it: existing, nothing written');
end $$;
do $$ declare q jsonb := pg_temp.so(3, 248); before text := pg_temp.corpus(); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-transfers', jsonb_build_array(q)), jsonb_build_array(q), true);
 perform pg_temp.ok(res#>>'{results,0,outcome}' = 'would_admit' and pg_temp.corpus() = before, 'a dry run reports would_admit and writes nothing');
end $$;
select pg_temp.refusal('national-budget', pg_temp.so(1, 249, '{}', 'FIXTURE DOCUMENT 2-1. The text of a synthetic search-only document.'), 'duplicate_text');

-- ═══ Every other gate still runs ══════════════════════
select pg_temp.refusal('national-cabinet', pg_temp.so(2, 250, '{"licence_class":"other"}'), 'licence_not_admitted');
select pg_temp.refusal('national-mp-profiles', pg_temp.so(5, 251, '{"licence_class":"gov_open_PERSONAL_DATA"}'), 'licence_not_admitted');
select pg_temp.refusal('national-cabinet', pg_temp.so(2, 252, '{"servable":false}'), 'not_servable');
select pg_temp.refusal('national-budget', pg_temp.so(1, 253, '{"n_chars":1}'), 'n_chars_mismatch');
select pg_temp.refusal('national-budget', pg_temp.so(1, 254, '{}', repeat('t', 2999), 5), 'thin_text');
select pg_temp.refusal('national-industry', pg_temp.so(4, 255, '{}', E'A shifted \x01 font'), 'control_codes');

-- ═══ One way in ═══════════════════════════════════════
select pg_temp.refused(format('select public.ingest_register_text_unmapped(%L::jsonb)', pg_temp.so(n, 260)), 'search-only documents enter through a sealed batch') from so_desk;
select pg_temp.refused(format('select public.ingest_register_text(%L::jsonb)', pg_temp.so(n, 261)), 'search-only documents enter through a sealed batch') from so_desk;

-- ═══ A shared host: MP Profiles on sansad.in ═════════
-- sansad.in also serves the question answers and the bill files, which have linked adapters. A search-only record may
-- not carry one: a question-answer file (pq_answer_key) or a bill file (as bill_admission_key recognises its URL).
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
 values ('national','Parliamentary Question Database','q9500',jsonb_build_object('id','q9500','house','Lok Sabha','date','2026-04-02',
   'ministry','MINISTRY OF FIXTURES','subject','Subject 9500','mp_name','Member','source_url',pg_temp.pq_url(9500)),'Subject 9500',now());
select pg_temp.refusal('national-mp-profiles', pg_temp.so(5, 270, jsonb_build_object('file_url', pg_temp.pq_url(9500))), 'file_url_invalid');
select pg_temp.refusal('national-mp-profiles', pg_temp.so(5, 271, jsonb_build_object('file_url',
  'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf')), 'file_url_invalid');
select pg_temp.refusal('national-mp-profiles', pg_temp.so(5, 272, jsonb_build_object('file_url', u)), 'file_url_invalid')
  from unnest(array['https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/9_2025.pdf?source=legislation',
    'https://sansad.in/getFile/BillsPDFFiles/synopsis/9-2025.pdf']) u;
-- The answer's own linked admission is then not blocked by anything the search-only desk could hold.
select pg_temp.ok((pg_temp.reg('national-pq', pg_temp.pq(9500)))->>'outcome' = 'admitted', 'the question answer itself is admitted on its linked path');
-- Other sansad.in pages stay admissible for MP Profiles, including other getFile paths.
select pg_temp.ok(pg_temp.reg('national-mp-profiles', pg_temp.so(5, 273 + g, jsonb_build_object('file_url', u)))->>'outcome' = 'admitted',
  'MP Profiles admitted on ' || u)
  from (values (0, 'https://sansad.in/ls/members/biography/4567?from=members'), (1, 'https://sansad.in/rs/members/mplads/4567'),
    (2, 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=other'),
    (3, 'https://sansad.in/getFile/debates/members/4567.pdf')) v(g, u);

-- ═══ Empty suggested keys from an older path ══════════
-- Admission never writes '' (suggested_key_invalid), but an older path may have; two such rows of one desk coexist.
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values ('f374' || repeat('e',36),'Empty key 1','national','Budget Utilisation & Schemes',repeat('e',64),'x','{"document_key_suggested":""}'),
        ('f374' || repeat('f',36),'Empty key 2','national','Budget Utilisation & Schemes',repeat('f',64),'x','{"document_key_suggested":""}');
select pg_temp.ok(true, 'two older-path documents of one desk with an empty suggested key coexist');
select pg_temp.refusal('national-budget', pg_temp.so(1, 280, '{"document_key_suggested":""}'), 'suggested_key_invalid');
select pg_temp.ok(pg_temp.reg('national-budget', pg_temp.so(1, 281, '{"document_key_suggested":null}'))->>'outcome' = 'admitted',
  'a record with no suggested key is still admitted beside them');

-- ═══ The indexes ══════════════════════════════════════
-- If a race gets past the lookups, the database still holds one file and one suggested key per desk.
select pg_temp.refused($q$insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
  values ('f374' || repeat('1',36),'Race','https://www.pib.gov.in/fixture/F2-1.pdf','national','Cabinet Decisions',repeat('1',64),'x')$q$,
  'documents_search_only_file_url');
select pg_temp.refused($q$insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
  values ('f374' || repeat('0',36),'Race','national','Budget Utilisation & Schemes',repeat('0',64),'x','{"document_key_suggested":"fx1:1"}')$q$,
  'documents_search_only_key_suggested');
select pg_temp.refused($q$insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
  values ('f374' || repeat('9',36),'Race','https://rbidocs.rbi.org.in/fixture/H0-rbidocs.rbi.org.in.pdf?x=1','national','Regulatory Body Watch (RBI SEBI TRAI CCI)',repeat('9',64),'x')$q$,
  'documents_search_only_file_url');
-- Per desk: one file in two desks (only an older path could write it, the hosts being disjoint) is not refused by them.
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values ('f374' || repeat('8',36),'Other desk','https://www.pib.gov.in/fixture/F2-1.pdf','national','Budget Utilisation & Schemes',repeat('8',64),'x',
   '{"document_key_suggested":"fx2:1"}');
select pg_temp.ok(true, 'one file and one key in two desks: the unique indexes are per desk');
select pg_temp.ok((select string_agg(indexname || ': ' || regexp_replace(indexdef, '^.* USING ', ''), ' | ' order by indexname) from pg_indexes
   where indexname in ('documents_search_only_file_url', 'documents_search_only_key_suggested'))
  = 'documents_search_only_file_url: btree (desk_feature, file_url) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ANY (ARRAY['
    || (select string_agg(quote_literal(desk) || '::text', ', ' order by n) from so_desk) || '])) AND (file_url IS NOT NULL))'
  || ' | documents_search_only_key_suggested: btree (desk_feature, ((metadata ->> ''document_key_suggested''::text))) WHERE ((desk_tier = ''national''::text) AND (desk_feature = ANY (ARRAY['
    || (select string_agg(quote_literal(desk) || '::text', ', ' order by n) from so_desk) || '])) AND ((metadata ->> ''document_key_suggested''::text) <> ''''::text))'
  and (select count(*) from pg_class c where c.relkind = 'i' and c.relname like 'documents_search_only%') = 2
  and (select indisunique and indisvalid from pg_index where indexrelid = 'public.documents_search_only_file_url'::regclass)
  and (select indisunique and indisvalid from pg_index where indexrelid = 'public.documents_search_only_key_suggested'::regclass),
  'a unique file_url index and a unique suggested-key index, per desk, partial to the six desks');

-- ═══ Privileges, security mode, search path ═══════════
select pg_temp.ok(not exists(select 1 from unnest(array['public.ingest_admit_tier(jsonb)','public.ingest_admit_adapter(jsonb)',
     'public.ingest_admit_document(jsonb,jsonb)','public.ingest_register_text_unmapped(jsonb)']) f,
     unnest(array['public','anon','authenticated','service_role','corpus_ingest']) r
   where has_function_privilege(r, f, 'execute')),
  'the replaced helpers and the single path stay owner-only');
select pg_temp.ok((select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'null'), ' ' order by p.proname) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ingest_admit_tier','ingest_admit_adapter','ingest_admit_document',
     'ingest_register_batch','ingest_register_text_unmapped'))
  = 'ingest_admit_adapter={nter_migrator=X/nter_migrator} ingest_admit_document={nter_migrator=X/nter_migrator} '
    'ingest_admit_tier={nter_migrator=X/nter_migrator} '
    'ingest_register_batch={nter_migrator=X/nter_migrator,corpus_ingest=X/nter_migrator,service_role=X/nter_migrator} '
    'ingest_register_text_unmapped={nter_migrator=X/nter_migrator}',
  'grants exactly as before: the batch call for the runner and service_role, the rest owner-only');
select pg_temp.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=public, extensions, pg_temp'])
     and string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname)
       = 'ingest_admit_adapter:i,ingest_admit_document:v,ingest_admit_tier:i,ingest_register_batch:v,ingest_register_text_unmapped:v'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('ingest_admit_tier','ingest_admit_adapter','ingest_admit_document','ingest_register_batch','ingest_register_text_unmapped')),
  'definer, search path and volatility unchanged');

-- ═══ Cost: no walk of the desk ════════════════════════
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
select repeat('d',8) || md5('budget-seed' || g), 'Budget seed ' || g, 'https://www.indiabudget.gov.in/seed/S' || g || '.pdf',
       'national','Budget Utilisation & Schemes', md5('budgetseedtext' || g) || md5('b' || g),'x',
       jsonb_build_object('document_key_suggested','budget:seed' || g)
  from generate_series(1,3000) g;
analyze public.documents;
create temp table so_cost as select pg_temp.reads('documents') d0;
do $$ declare qs jsonb := (select jsonb_agg(pg_temp.so(1, 300 + g)) from generate_series(1,50) g); res jsonb; begin
 res := pg_temp.i_reg(pg_temp.batch('national-budget', qs), qs);
 perform pg_temp.ok((res#>>'{totals,admitted}')::int = 50, '50 Budget records admitted in one call: ' || (res->'totals')::text);
end $$;
select pg_temp.ok(pg_temp.reads('documents') - d0 < 1500, 'documents read by lookups, not walked: ' || (pg_temp.reads('documents') - d0)) from so_cost;

rollback;
