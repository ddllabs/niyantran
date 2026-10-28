# Offline end-to-end test of the National question batch driver: plan (screen, holds, probe dry run, tranches, offline
# dry runs, ledger) and submit (presence check, submission, resume of an incomplete submission, indexing wait and
# verification) against a synthetic pack and a fake database. The real importer runs in dry-run mode; the submit step's
# network writes are replaced by a fake importer, so nothing here leaves the machine.
#   python3 -I docs/operations/national-pq-batch/test_national_pq_driver_offline.py
import copy, csv, gzip, hashlib, io, json, os, pathlib, sys, tempfile, unittest, zipfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
spec = {'__name__': 'pq_test', '__file__': str(HERE / 'test_national_pq_offline.py')}
exec(compile((HERE / 'test_national_pq_offline.py').read_bytes(), 'test_national_pq_offline.py', 'exec'), spec)
record, ROW, URL = spec['record'], spec['ROW'], spec['URL']


def load_driver():
    g = {'__name__': 'pq_driver'}
    exec(compile((HERE / 'nter-national-pq-batch.py').read_bytes(), 'nter-national-pq-batch.py', 'exec'), g)
    return g


def variant(i):
    """Record i: question number 865+i, its own URL, desk row 7830+i, answered on day 1+i."""
    r = record()
    n, day = 865 + i, 1 + i
    stem = f'AU{n}_koYNJ{i}'
    old_no, old_date = 'NO. 865', '07.02.2025'
    text = r['text'].replace(old_no, f'NO. {n}').replace('865.', f'{n}.').replace(old_date, f'{day:02d}.02.2025')
    text = text.replace('shortage of doctors', f'shortage of doctors (case {i})')
    r = spec['retext'](r, text)
    url = URL.replace('AU865_koYNJ2', stem)
    r.update({'source_key': hashlib.sha1(stem.encode()).hexdigest(), 'file_url': url, 'file_name': stem + '.pdf',
              'title_stem': '184_' + stem, 'title': f'Lok Sabha Unstarred Question No. {n}: Shortage of Medical Professionals'})
    r['citation'] = dict(r['citation'], question_no=str(n), answered_on=f'{day:02d}.02.2025')
    r['links'] = [dict(r['links'][0], row_key=str(7830 + i), document_key=f'pq:ls:184:{stem}')]
    row = dict(ROW, source_url=url, date=f'2025-02-{day:02d}')
    return r, row


class Driver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); d = pathlib.Path(self.tmp.name)
        recs, rows = zip(*[variant(i) for i in range(9)])
        recs = list(recs); rows = {str(7830 + i): r for i, r in enumerate(rows)}
        recs[8] = copy.deepcopy(recs[8]); recs[8]['page_split'] = 'approximate'   # one hold
        data = gzip.compress(''.join(json.dumps(r) + '\n' for r in recs).encode())
        zp = d / 'pack.zip'
        with zipfile.ZipFile(zp, 'w') as z:
            z.writestr('citation_pack_v1/manifest.json', json.dumps({'files': {'documents/parliamentary_questions.jsonl.gz': hashlib.sha256(data).hexdigest()}}))
            z.writestr('citation_pack_v1/documents/parliamentary_questions.jsonl.gz', data)
        g = self.g = load_driver()
        g.update(ZIP=str(zp), ZIP_BYTES=os.path.getsize(zp), ZIP_SHA=g['sha'](zp), ST=d / 'staging', REPO=REPO, NODE=os.environ.get('NODE', 'node'),
                 DOCS=4, TRANCHE=2, PROBE=6, REPO_SHA='test')
        g['C'] = g['_load'](*g['LAW_CORE']); g['P_'] = g['_load'](g['PQ_CORE'])
        self.db = {'documents': [{'id': 'legacy', 'source_key': 'f' * 40, 'file_url': None, 'file_name': '182_AS1_x.pdf',
                                  'content_sha256': hashlib.sha256(b'Legacy answer text').hexdigest(), 'desk_feature': g['P_'].FEATURE,
                                  'ocr_text': 'Legacy answer text', 'desk_tier': 'national'}], 'rows': rows, 'chunks': {}}
        db = self.db
        g['sign_in'] = lambda: os.environ.update(NTER_INGEST_ACCESS_TOKEN='x.y.z', SUPABASE_PUBLISHABLE_KEY='sb_publishable_test')
        g['token_minutes_left'] = lambda: 59.0

        def rest_get(path):
            from urllib.parse import urlparse, parse_qs
            u = urlparse(path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
            table = u.path.rsplit('/', 1)[-1]
            if int(q.get('offset', 0)) > 0:
                return []
            if table == 'desk_rows':
                return [{'row_key': k, 'row': v} for k, v in db['rows'].items()]
            if table == 'documents':
                docs = db['documents']
                if 'source_key' in q:
                    keys = set(x.strip('"') for x in q['source_key'][4:-1].split(','))
                    docs = [x for x in docs if x['source_key'] in keys]
                out = []
                for x in docs:
                    y = dict(x); y['origin'] = x.get('origin'); out.append(y)
                return out
            if table == 'document_chunks':
                ids = set(x.strip('"') for x in q['document_id'][4:-1].split(','))
                if q.get('embedding') == 'is.null':
                    return []
                return [{'id': f'{i}-{n}', 'document_id': i} for i in ids for n in range(db['chunks'].get(i, 0))]
            raise AssertionError(path)
        g['rest_get'] = rest_get

    def tearDown(self):
        self.tmp.cleanup()

    def test_plan_then_submit_with_one_resume(self):
        g, db = self.g, self.db
        out = g['plan']()
        P, by_key = out
        self.assertEqual(P['docs'], 4)
        self.assertEqual(list(P['tranches']), ['T1', 'T2'])
        self.assertEqual(P['holds'].get('page split approximate'), 1)
        # newest answers first: questions answered on days 8, 7, 6, 5 (record 8, the newest, is held)
        self.assertEqual([by_key[k]['citation']['question_no'] for k in P['tranches']['T1']['keys']], ['872', '871'])
        g['dry_runs'](P, by_key)
        self.assertTrue(all(v['manifest_sha256'] and v['cost_ceiling'] > 0 for v in P['tranches'].values()))
        led = list(csv.DictReader(io.StringIO((g['ST'] / 'ledger-national-pq-b01.csv').read_text())))
        self.assertEqual([r['status'] for r in led], ['planned'] * 4)
        # submit: T1 completes; T2's first report is incomplete (1 of 2 registered, 1 uncertain), the resume completes it
        calls = []

        def fake_importer(corpus, decisions, report, *extra):
            t = pathlib.Path(report).parent.name
            keys = [json.loads(l)['source_key'] for l in open(decisions)]
            calls.append((t, pathlib.Path(report).name))
            first = t == 'T2' and pathlib.Path(report).name == 'submit-1.jsonl'
            done = keys[:1] if first else keys
            for k in done:
                if not any(x['source_key'] == k for x in db['documents']):
                    r = by_key[k]
                    db['documents'].append({'id': 'id-' + k[:6], 'source_key': k, 'file_url': r['file_url'], 'file_name': r['file_name'],
                                            'content_sha256': r['content_sha256'], 'desk_tier': 'national', 'desk_feature': g['P_'].FEATURE,
                                            'origin': 'supplied-text', 'indexed_at': '2026-10-27T12:00:00Z'})
                    db['chunks']['id-' + k[:6]] = P['plan_rows'][k]['chunks']
            s = {'type': 'summary', 'submitted': len(done), 'uncertain': 0 if not first else 1, 'held': 0, 'registration_held': 0}
            pathlib.Path(report).write_text(json.dumps({'type': 'manifest'}) + '\n' + json.dumps(s) + '\n')
            return (2 if first else 0), [s]
        g['importer'] = fake_importer
        g['RESUME_PAUSE_S'] = 0
        for t in P['tranches']:
            g['submit_tranche'](P, t)
        self.assertEqual(calls, [('T1', 'submit-1.jsonl'), ('T2', 'submit-1.jsonl'), ('T2', 'submit-2.jsonl')])
        g['wait_indexed'](P)
        res = g['verify'](P, by_key)
        self.assertEqual((res['problem_count'], res['fingerprint_matches_plan'], res['indexed']), (0, True, 4))
        led = list(csv.DictReader(io.StringIO((g['ST'] / 'ledger-national-pq-b01.csv').read_text())))
        self.assertEqual([r['status'] for r in led], ['verified'] * 4)
        # a wrong section is caught by verification
        db['documents'][-1]['desk_feature'] = 'Bill Passage Probability Index'
        self.assertEqual(g['verify'](P, by_key)['problem_count'], 1)

    def test_submit_refuses_a_key_already_present_on_first_submission(self):
        g, db = self.g, self.db
        P, by_key = g['plan'](); g['dry_runs'](P, by_key)
        k = P['tranches']['T1']['keys'][0]
        db['documents'].append({'id': 'pre', 'source_key': k, 'content_sha256': P['plan_rows'][k]['text_sha256'], 'desk_tier': 'national',
                                'desk_feature': g['P_'].FEATURE, 'origin': 'supplied-text'})
        g['importer'] = lambda *a: self.fail('must not submit')
        with self.assertRaises(g['Stop']):
            g['submit_tranche'](P, 'T1')


    def test_section_runs_batches_until_no_eligible_answer_remains(self):
        g, db = self.g, self.db
        g['NATIONAL'] = self.tmp.name
        g['SECTION_LOG'] = pathlib.Path(self.tmp.name) / 'staging' / 'pq-section-status.json'
        g['setup'] = lambda sha: None
        real_importer = g['importer']

        def importer(corpus, decisions, report, *extra):
            if '--submit' not in extra:
                return real_importer(corpus, decisions, report, *extra)   # dry runs use the real importer
            plan = json.loads((pathlib.Path(report).parents[1] / 'plan.json').read_text())
            n = 0
            for line in open(corpus):
                r = json.loads(line)
                if not any(x['source_key'] == r['source_key'] for x in db['documents']):
                    i = 'id-' + r['source_key'][:8]
                    db['documents'].append({'id': i, 'source_key': r['source_key'], 'file_url': r['file_url'], 'file_name': r['file_name'],
                                            'content_sha256': r['text_sha256'], 'ocr_text': r['text'], 'desk_tier': 'national',
                                            'desk_feature': g['P_'].FEATURE, 'origin': 'supplied-text', 'indexed_at': '2026-10-27T16:00:00Z'})
                    db['chunks'][i] = plan['plan_rows'][r['source_key']]['chunks']
                n += 1
            s = {'type': 'summary', 'submitted': n, 'uncertain': 0, 'held': 0, 'registration_held': 0}
            pathlib.Path(report).write_text(json.dumps(s) + '\n')
            return 0, [s]
        g['importer'] = importer
        last = g['run_section']('test', 'Tamanesh Kauri (test)', first=2)
        self.assertTrue(last['event'].startswith('finished'))
        log = json.loads(g['SECTION_LOG'].read_text())['log']
        self.assertIn((4, 'no eligible answer remains; section complete'), [(x.get('batch'), x['event']) for x in log])
        self.assertEqual([(x['batch'], x['event']) for x in log if x['event'] in ('submitted', 'verified')],
                         [(2, 'submitted'), (2, 'verified'), (3, 'submitted'), (3, 'verified')])
        self.assertEqual(len([d for d in db['documents'] if d.get('origin') == 'supplied-text']), 8)  # 9 records, 1 held
        b3 = json.loads((pathlib.Path(self.tmp.name) / 'staging' / 'pq-batch-03' / 'plan.json').read_text())
        self.assertEqual((b3['decision'], b3['docs']), ('owner-authorized-20261027-national-pq-b03', 4))
        self.assertTrue((pathlib.Path(self.tmp.name) / 'staging' / 'pq-batch-03' / 'ledger-national-pq-b03.csv').exists())
        # a rerun resumes from the recorded state and submits nothing new
        g['importer'] = lambda *a: self.fail('nothing left to submit') if '--submit' in a else real_importer(*a)
        self.assertTrue(g['run_section']('test', 'Tamanesh Kauri (test)', first=2)['event'].startswith('finished'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
