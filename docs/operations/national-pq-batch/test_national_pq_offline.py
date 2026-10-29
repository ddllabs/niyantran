# Offline tests for the National question batch core (synthetic records only; no corpus text, no network).
#   python3 -I docs/operations/national-pq-batch/test_national_pq_offline.py
# The last test runs the repository's own importer in offline dry-run mode (node, no network) on a record and decision
# built by the core, so the core's output is checked against the real supplied-text adapter.
import copy, hashlib, json, os, pathlib, subprocess, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
m = {'__name__': 'pq_core'}
exec(compile((HERE / 'nter-national-pq-core.py').read_bytes(), 'nter-national-pq-core.py', 'exec'), m)
P = type('P', (), m)

URL = 'https://sansad.in/getFile/loksabhaquestions/annex/184/AU865_koYNJ2.pdf?source=pqals'


def record():
    page1 = ('GOVERNMENT OF INDIA\nMINISTRY OF HEALTH AND FAMILY WELFARE\nLOK SABHA\nUNSTARRED QUESTION NO. 865\n'
             'TO BE ANSWERED ON 07.02.2025\nSHORTAGE OF MEDICAL PROFESSIONALS\n865. SHRI X: Will the Minister be pleased to state: '
             + 'whether the Government is aware of a shortage of doctors in rural areas. ' * 4 + '\n')
    page2 = 'ANSWER\nTHE MINISTER OF STATE: (a) to (c) ' + 'The Government has taken several steps to increase seats. ' * 5 + '\n'
    text = page1 + page2
    return {
        'schema': 'nter.citation_pack/1.1', 'source_key': 'ab' * 20, 'desk_tier': 'national',
        'desk_feature': 'Parliamentary Question Database', 'desk_rows_feature': 'Parliamentary Question Database',
        'doc_type': 'parl_question', 'title': 'Lok Sabha Unstarred Question No. 865: Shortage of Medical Professionals',
        'title_stem': '184_AU865_koYNJ2', 'file_name': 'AU865_koYNJ2.pdf', 'file_url': URL,
        'file_url_alt': 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/184/AU865_koYNJ2.pdf?source=lsapps',
        'source_host': 'sansad.in', 'licence_class': 'gazette_s52_1_q_i_unconfirmed', 'as_of': '2026-09-09',
        'extraction': 'pdf_text', 'text_engine': 'pdftotext -layout (text layer)',
        'content_sha256': hashlib.sha256(text.encode()).hexdigest(), 'n_chars': len(text), 'page_count': 2, 'page_split': 'exact',
        'citation_text': 'Lok Sabha, Unstarred Question No. 865, answered 07.02.2025',
        'citation': {'kind': 'parliamentary_question', 'house': 'Lok Sabha', 'session': '184', 'question_type': 'UNSTARRED',
                     'question_no': '865', 'subject': 'Shortage of Medical Professionals', 'ministry': 'HEALTH AND FAMILY WELFARE',
                     'answered_on': '07.02.2025', 'asked_by': ['Isha Khan Choudhury'], 'source': 'sansad.in'},
        'links': [{'tier': 'national', 'feature': 'Parliamentary Question Database', 'row_key': '7830',
                   'document_key': 'pq:ls:184:AU865_koYNJ2', 'role': 'answer_annexure'}],
        'pages': [{'page_number': 1, 'char_from': 0, 'char_to': len(page1), 'text': page1},
                  {'page_number': 2, 'char_from': len(page1), 'char_to': len(text), 'text': page2}],
        'text': text,
    }


ROW = {'source_url': URL, 'subject': 'Shortage of Medical Professionals', 'date': '2025-02-07', 'question_type': 'UNSTARRED',
       'ministry': 'HEALTH AND FAMILY WELFARE', 'mp_name': 'Isha Khan Choudhury', 'house': 'Lok Sabha'}
DB = {'keys': set(), 'urls': set(), 'file_names': set()}


def holds(r, db=DB, rows=None):
    return P.record_holds(r, db, {'7830': dict(ROW)} if rows is None else rows)


def retext(r, text):
    r = copy.deepcopy(r); r['text'] = text; r['content_sha256'] = hashlib.sha256(text.encode()).hexdigest(); r['n_chars'] = len(text)
    r['pages'] = [{'page_number': 1, 'char_from': 0, 'char_to': len(text), 'text': text}]; r['page_count'] = 1
    return r


class Holds(unittest.TestCase):
    def test_eligible(self):
        self.assertEqual(holds(record()), [])

    def test_already_in_database(self):
        r = record()
        self.assertIn('already in the database (source_key)', holds(r, {**DB, 'keys': {r['source_key']}}))
        self.assertIn('already in the database (file_url)', holds(r, {**DB, 'urls': {URL}}))
        self.assertIn('already in the database (file name)', holds(r, {**DB, 'file_names': {'184_AU865_koYNJ2.pdf'}}))

    def test_text_integrity(self):
        r = record(); r['content_sha256'] = '0' * 64
        self.assertIn('text hash mismatch', holds(r))
        r = record(); r['n_chars'] += 1
        self.assertIn('n_chars mismatch', holds(r))
        r = record(); r['page_split'] = 'approximate'
        self.assertIn('page split approximate', holds(r))
        r = record(); r['pages'][1]['text'] = 'other'
        self.assertIn('page spans do not match the text', holds(r))
        r = record(); r['page_count'] = 3
        self.assertIn('page spans do not match the text', holds(r))

    def test_completeness(self):
        r = record()
        self.assertIn('no answer section', holds(retext(r, r['text'].replace('ANSWER', 'REPLY'))))
        self.assertIn('text too short', holds(retext(r, 'UNSTARRED QUESTION NO. 865 07.02.2025 ANSWER yes')))

    def test_identity(self):
        r = record(); r['file_url'] = 'https://example.org/AU865_koYNJ2.pdf'
        self.assertIn('not an official Lok Sabha question PDF URL', holds(r))
        r = record(); r['citation']['question_no'] = '866'
        self.assertIn('citation question type or number does not match the URL', holds(r))
        r = record(); r['citation']['question_type'] = 'STARRED'
        self.assertIn('citation question type or number does not match the URL', holds(r))
        r = record(); r['citation']['session'] = '183'
        self.assertIn('citation session or house does not match the URL', holds(r))
        r = record(); r['file_name'] = 'AU866_koYNJ2.pdf'
        self.assertIn('file name does not match the URL', holds(r))
        r = record(); r['title'] = 'Lok Sabha Unstarred Question No. 866: X'
        self.assertIn('title does not carry the question number', holds(r))
        r = record()
        self.assertIn('question number not found in the text', holds(retext(r, r['text'].replace('NO. 865', 'NO. 856').replace('865.', '856.'))))
        self.assertIn('answer date not found in the text', holds(retext(r, r['text'].replace('07.02.2025', '08.02.2025'))))

    def test_desk_mapping(self):
        r = record()
        self.assertIn('desk row not found', holds(r, rows={}))
        for field, value in [('source_url', URL + 'x'), ('subject', 'Other'), ('date', '2025-02-08'), ('question_type', 'STARRED'),
                             ('ministry', 'FINANCE'), ('mp_name', 'Someone Else'), ('house', 'Rajya Sabha')]:
            row = dict(ROW); row[field] = value
            self.assertTrue(any(h.startswith('desk row disagrees') for h in holds(r, rows={'7830': row})), field)
        r = record(); r['links'][0]['document_key'] = 'pq:ls:184:other'
        self.assertIn('desk link names another module or key', holds(r))
        r = record(); r['links'] = []
        self.assertIn('no desk row link', holds(r))


class Helpers(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(P.iso('07.02.2025'), '2025-02-07')
        self.assertEqual(P.iso('2024-07-30'), '2024-07-30')
        self.assertIsNone(P.iso('32.13.2025'))
        for s in ['07.02.2025', '7/2/2025', '07-02-2025', '07.02.25', '7th February, 2025', 'February 7, 2025', '07 FEB 2025']:
            self.assertTrue(P.date_in_text('ANSWERED ON ' + s, '2025-02-07'), s)
        self.assertFalse(P.date_in_text('ANSWERED ON 17.02.2025', '2025-02-07'))
        self.assertFalse(P.date_in_text('ANSWERED ON 07.12.2025', '2025-02-07'))

    def test_question_number(self):
        self.assertTrue(P.qno_in_text('UNSTARRED QUESTION NO. †865', '865'))
        self.assertTrue(P.qno_in_text('STARRED QUESTION NO: *42', '42'))
        self.assertFalse(P.qno_in_text('UNSTARRED QUESTION NO. 8650', '865'))

    def test_order_and_fingerprint(self):
        a, b = record(), record()
        b['source_key'] = 'cd' * 20; b['citation']['answered_on'] = '08.02.2025'
        self.assertEqual([x['source_key'] for x in P.screen_order([a, b])], [b['source_key'], a['source_key']])
        self.assertEqual(P.fingerprint([('k', 3, 't')]), hashlib.sha256(b'k|3|t').hexdigest())

    def test_ledger_row(self):
        row = P.ledger_row(1, 'T1', 1, record(), 7)
        self.assertEqual(list(row), P.LEDGER_COLUMNS)
        self.assertEqual((row['document_key'], row['answered_on'], row['desk_row_keys']), ('pq:ls:184:AU865_koYNJ2', '2025-02-07', '7830'))


class AgainstTheRealAdapter(unittest.TestCase):
    def test_importer_dry_run_accepts_core_output(self):
        node = os.environ.get('NODE', 'node')
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            r = record()
            corpus = d / 'corpus.jsonl'
            corpus.write_text(json.dumps(P.supplied_record(r)) + '\n')
            fsha = hashlib.sha256(corpus.read_bytes()).hexdigest()
            (d / 'decisions.jsonl').write_text(json.dumps(P.decision(r, 'test-0001', fsha)) + '\n')
            out = subprocess.run([node, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(corpus),
                                  '--decisions', str(d / 'decisions.jsonl'), '--report', str(d / 'r.jsonl')],
                                 cwd=REPO, capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr[-500:])
            rows = [json.loads(l) for l in open(d / 'r.jsonl')]
            self.assertEqual(rows[-1]['ready'], 1)
            self.assertGreater(rows[-1]['estimated_cost_ceiling_usd'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=1)
