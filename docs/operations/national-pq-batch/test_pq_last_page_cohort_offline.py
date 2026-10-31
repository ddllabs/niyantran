# Offline tests for pq-last-page-cohort.py: the one screen change (a trailing last page is accepted only when it is empty
# after whitespace normalisation), its causal test, and the negative cases. Synthetic pack; no corpus text, no network.
#   python3 -I -B docs/operations/national-pq-batch/test_pq_last_page_cohort_offline.py
import copy, hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
NODE = os.environ.get('NODE', 'node')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


L = load('pq_last_page', 'pq-last-page-cohort.py')
TR = load('pq_remainder_tests', 'test_pq_remainder_cohort_offline.py')   # its synthetic records and pack builder
R = L.R


def last_page_empty(r, tail=''):
    """The pack's shape (inspected 2026-10-31): page_count counts the blank last page; `pages` omits it."""
    r = copy.deepcopy(r)
    if tail:
        r['text'] += tail
        r['content_sha256'] = hashlib.sha256(r['text'].encode()).hexdigest(); r['n_chars'] = len(r['text'])
    r['page_count'] = len(r['pages']) + 1
    r['page_split'] = 'last_page_empty'
    return r


def make_pack(d, records):
    p = TR.make_pack(d, records)
    L.R.PACK_SHA256, L.R.PACK_BYTES = TR.R.PACK_SHA256, TR.R.PACK_BYTES
    return p


def prepare(d, pack, keys, out='out', exclude=None, over=None):
    kp = pathlib.Path(d) / 'open.txt'; kp.write_text('\n'.join(keys) + '\n')
    L.prepare(type('A', (), dict(pack=str(pack), open_keys=str(kp), exclude_cohort=exclude, over_limit=over, decision_id='national-pq-lastpage-test-v1',
                                 out=str(pathlib.Path(d) / out))))
    return pathlib.Path(d) / out


KEY = 'pq:ls:184:AU866_zzzzz1'


def candidate(tail=''):
    return last_page_empty(TR.rec('bb' * 20, 'AU866_zzzzz1', TR.DIFFERENT[1], row='7831'), tail)


class ScreenChange(unittest.TestCase):
    def test_accepts_a_trailing_empty_page_and_makes_it_explicit(self):
        r = candidate()
        fixed, holds = L.accept_trailing_empty_page(r)
        self.assertEqual(holds, [])
        self.assertEqual((fixed['page_split'], fixed['page_count'], len(fixed['pages'])), ('exact', 3, 3))
        self.assertEqual(fixed['pages'][-1], {'page_number': 3, 'char_from': len(r['text']), 'char_to': len(r['text']), 'text': ''})
        self.assertEqual((fixed['text'], fixed['content_sha256']), (r['text'], r['content_sha256']))   # text untouched
        self.assertEqual(R.pack_holds(fixed), [])

    def test_whitespace_only_tail_counts_as_empty(self):
        fixed, holds = L.accept_trailing_empty_page(candidate(tail=' \n\t\n'))
        self.assertEqual(holds, [])
        self.assertEqual(fixed['pages'][-1]['text'], ' \n\t\n')

    def test_causal_the_remainder_screen_holds_it_and_this_screen_admits_it(self):
        # Without the change (the remainder screen) the record is held; with it, the cohort admits it.
        self.assertIn('page split last_page_empty', R.pack_holds(candidate()))
        with tempfile.TemporaryDirectory() as d:
            out = prepare(d, make_pack(d, [TR.rec('aa' * 20, 'AU865_koYNJ2', TR.DIFFERENT[0]), candidate()]), [KEY])
            self.assertEqual(json.loads((out / 'cohort.json').read_text())['count'], 1)

    def test_causal_fails_with_the_change_removed(self):
        keep = L.accept_trailing_empty_page
        L.accept_trailing_empty_page = lambda r: (None, [f"page split {r.get('page_split')}"])   # the old rule
        try:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(SystemExit):   # nothing eligible: the record is held again
                    prepare(d, make_pack(d, [TR.rec('aa' * 20, 'AU865_koYNJ2', TR.DIFFERENT[0]), candidate()]), [KEY])
        finally:
            L.accept_trailing_empty_page = keep


class StillHeld(unittest.TestCase):
    def test_an_empty_middle_page_is_held(self):
        r = candidate()
        p1, p2 = r['pages']
        r['pages'] = [p1, {'page_number': 2, 'char_from': p1['char_to'], 'char_to': p1['char_to'], 'text': ''},
                      dict(p2, page_number=3)]
        r['page_count'] = 4
        self.assertEqual(L.accept_trailing_empty_page(r), (None, ['last_page_empty: an empty page before the last']))

    def test_a_last_page_with_text_is_held(self):
        self.assertEqual(L.accept_trailing_empty_page(candidate(tail='\nAnnexure page follows.')),
                         (None, ['last_page_empty: the last page has text']))

    def test_a_page_count_off_by_more_than_one_is_held(self):
        r = candidate(); r['page_count'] += 1
        self.assertEqual(L.accept_trailing_empty_page(r), (None, ['last_page_empty: page count is not listed pages + 1']))

    def test_other_rules_still_apply(self):
        r = candidate(); r['links'][0]['document_key'] = 'pq:ls:184:AU1_other1'
        fixed, _ = L.accept_trailing_empty_page(r)
        self.assertIn('desk link names another module or key', R.pack_holds(fixed))

    def test_only_last_page_empty_records_are_candidates(self):
        with tempfile.TemporaryDirectory() as d:
            exact = TR.rec('cc' * 20, 'AU867_yyyyy2', TR.DIFFERENT[2], row='7832')
            out = prepare(d, make_pack(d, [candidate(), exact]), [KEY, 'pq:ls:184:AU867_yyyyy2'])
            self.assertEqual(json.loads((out / 'cohort.json').read_text())['candidates'], 1)

    def test_excluded_cohort_answers_are_not_candidates(self):
        with tempfile.TemporaryDirectory() as d:
            ex = pathlib.Path(d) / 'ex.json'; ex.write_text(json.dumps({'documents': [{'answer_key': KEY}]}))
            with self.assertRaises(SystemExit):
                prepare(d, make_pack(d, [candidate()]), [KEY], exclude=[str(ex)])


class OverLimit(unittest.TestCase):
    def test_an_answer_measured_over_256_chunks_is_held(self):
        with tempfile.TemporaryDirectory() as d:
            ol = pathlib.Path(d) / 'over.txt'; ol.write_text(KEY + '\n')
            other = last_page_empty(TR.rec('cc' * 20, 'AU867_yyyyy2', TR.DIFFERENT[2], row='7832'))
            out = prepare(d, make_pack(d, [candidate(), other]), [KEY, 'pq:ls:184:AU867_yyyyy2'], over=str(ol))
            self.assertEqual(json.loads((out / 'holds.json').read_text())['held'], {KEY: ['over answer-read limits (more than 256 chunks)']})
            self.assertEqual(json.loads((out / 'cohort.json').read_text())['count'], 1)


class Importer(unittest.TestCase):
    def test_real_importer_dry_run_accepts_the_explicit_empty_page(self):
        with tempfile.TemporaryDirectory() as d:
            recs = [last_page_empty(TR.rec(c * 40, f'AU{865 + i}_abcde{i}', TR.DIFFERENT[i], row=str(7830 + i))) for i, c in enumerate('abc')]
            out = prepare(d, make_pack(d, recs), [f'pq:ls:184:AU{865 + i}_abcde{i}' for i in range(3)])
            rpt = pathlib.Path(d) / 'dry.jsonl'
            r = subprocess.run([NODE, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(out / 'corpus.jsonl'),
                                '--decisions', str(out / 'decisions.jsonl'), '--report', str(rpt)], cwd=REPO, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-500:])
            last = json.loads(rpt.read_text().splitlines()[-1])
            self.assertEqual((last['ready'], last['held']), (3, 0))


if __name__ == '__main__':
    unittest.main(verbosity=1)
