# Offline tests for pq-remainder-cohort.py and pq-near-duplicate.py (synthetic pack; no corpus text, no network).
#   python3 -I -B docs/operations/national-pq-batch/test_pq_remainder_cohort_offline.py
import ast, copy, gzip, hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, unittest, zipfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
NODE = os.environ.get('NODE', 'node')
LAW_CORE = REPO / 'docs/operations/law-autopilot/nter-law-autopilot-core.py'
LAW_CORE_ORIGINAL = '19299c5248128240b18e5134f2929cddfe60658f7e79d88d040d44cf96defe63'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


R = load('pq_remainder', 'pq-remainder-cohort.py')
T = load('pq_fixture', 'test_national_pq_offline.py')


def rec(key, stem, body='The Government has taken several steps to increase seats. ', session='184', row='7830'):
    r = T.record()
    page1 = r['pages'][0]['text'].replace('865', stem[2:].split('_')[0])
    page2 = 'ANSWER\nTHE MINISTER OF STATE: (a) to (c) ' + body * 5 + '\n'
    text = page1 + page2
    n = stem[2:].split('_')[0]
    r.update(source_key=key, file_url=f'https://sansad.in/getFile/loksabhaquestions/annex/{session}/{stem}.pdf?source=pqals',
             file_name=stem + '.pdf', title_stem=f'{session}_{stem}', title=f'Lok Sabha Unstarred Question No. {n}: Shortage',
             text=text, content_sha256=hashlib.sha256(text.encode()).hexdigest(), n_chars=len(text),
             pages=[{'page_number': 1, 'char_from': 0, 'char_to': len(page1), 'text': page1},
                    {'page_number': 2, 'char_from': len(page1), 'char_to': len(text), 'text': page2}])
    r['citation'] = dict(r['citation'], question_no=n, session=session)
    r['links'] = [dict(r['links'][0], row_key=row, document_key=f'pq:ls:{session}:{stem}')]
    return r


def make_pack(d, records):
    data = gzip.compress(''.join(json.dumps(x) + '\n' for x in records).encode())
    p = pathlib.Path(d) / 'pack.zip'
    with zipfile.ZipFile(p, 'w') as z:
        z.writestr('citation_pack_v1/manifest.json', json.dumps({'members': {R.MEMBER: hashlib.sha256(data).hexdigest()}}))
        z.writestr(R.MEMBER, data)
    R.PACK_SHA256, R.PACK_BYTES = R.sha256_file(p), os.path.getsize(p)
    return p


def prepare(d, pack, keys, out='out'):
    kp = pathlib.Path(d) / 'open.txt'; kp.write_text('\n'.join(keys) + '\n')
    R.prepare(type('A', (), dict(pack=str(pack), open_keys=str(kp), decision_id='national-pq-remainder-test-v1',
                                 out=str(pathlib.Path(d) / out))))
    return pathlib.Path(d) / out


DIFFERENT = ['Funds were released to the states for rural health missions. ', 'Railway safety audits covered all zones last year. ',
             'The scheme supports fishermen with boats and nets. ', 'Broadband reached many village panchayats under the mission. ']


class NearDuplicateIsVerbatim(unittest.TestCase):
    def test_every_function_and_constant_equals_the_law_core_original(self):
        orig = LAW_CORE.read_text().split('\n', 1)[1]
        self.assertEqual(hashlib.sha256(orig.encode()).hexdigest(), LAW_CORE_ORIGINAL)
        mine = (HERE / 'pq-near-duplicate.py').read_text()
        seg = lambda src: {n.name if isinstance(n, ast.FunctionDef) else ast.unparse(n.targets[0] if isinstance(n, ast.Assign) else n):
                           ast.get_source_segment(src, n) for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.Assign, ast.Assert))}
        a, b = seg(orig), seg(mine)
        names = ['NPERM', '_P', '_rng', '_A', '_B', 'norm_case', 'url_tail', 'shingles', 'minhash', 'containment', 'similar_hold',
                 'contained_hold', 'reg_add']
        for n in names:
            self.assertEqual(b[n], a[n], n)
        self.assertEqual(sorted(n.name for n in ast.parse(mine).body if isinstance(n, ast.FunctionDef)), sorted(names[5:]))


class Prepare(unittest.TestCase):
    def test_selects_open_answers_only_and_binds_the_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            stored = rec('aa' * 20, 'AU865_koYNJ2', DIFFERENT[0])
            c1, c2 = rec('bb' * 20, 'AU866_zzzzz1', DIFFERENT[1], row='7831'), rec('cc' * 20, 'AU867_yyyyy2', DIFFERENT[2], row='7832')
            out = prepare(d, make_pack(d, [stored, c1, c2]), ['pq:ls:184:AU866_zzzzz1', 'pq:ls:184:AU867_yyyyy2', 'pq:ls:184:AU999_absent1'])
            dec = [json.loads(l) for l in (out / 'decisions.jsonl').read_text().splitlines()]
            meta = json.loads((out / 'cohort.json').read_text())
            self.assertEqual(sorted(x['source_key'] for x in dec), ['bb' * 20, 'cc' * 20])
            self.assertTrue(all(x['file_sha256'] == meta['cohort_corpus_sha256'] == R.sha256_file(out / 'corpus.jsonl') for x in dec))
            self.assertEqual(meta['decisions_sha256'], R.sha256_file(out / 'decisions.jsonl'))
            self.assertEqual((meta['candidates'], meta['held'], meta['open_keys_without_pack_record']), (2, 0, 1))
            checks = (out / 'checks.txt').read_text().strip().split(',')
            self.assertEqual(len(checks), 2)
            self.assertRegex(checks[0], r'^184/AU86[67]_\w+:[0-9a-f]{32}:783[12]:[0-9a-f]{8}$')
            for n in ('cohort.json', 'holds.json', 'checks.txt', 'plan.tsv'):   # no corpus text outside corpus.jsonl
                self.assertNotIn('several steps', (out / n).read_text())
                self.assertNotIn('Railway safety', (out / n).read_text())

    def test_holds_a_near_duplicate_of_a_stored_answer_and_fails_without_the_rule(self):
        with tempfile.TemporaryDirectory() as d:
            long = ' '.join(f'Item {w} covers district number {i} with allocation {i * 7} crore.' for i, w in enumerate(
                ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'] * 6)) + ' '
            stored = rec('aa' * 20, 'AU865_koYNJ2', long)
            dup = rec('bb' * 20, 'AU866_zzzzz1', long, row='7831')
            pack = make_pack(d, [stored, dup])
            with self.assertRaises(SystemExit):   # the only candidate is held: nothing written
                prepare(d, pack, ['pq:ls:184:AU866_zzzzz1'], 'o1')
            keep = R.N.similar_hold
            R.N.similar_hold = lambda *a: None   # causal check: with the rule disabled the duplicate would be admitted
            try:
                out = prepare(d, pack, ['pq:ls:184:AU866_zzzzz1'], 'o2')
            finally:
                R.N.similar_hold = keep
            self.assertEqual(json.loads((out / 'cohort.json').read_text())['count'], 1)

    def test_holds_text_rules_page_split_and_foreign_links(self):
        with tempfile.TemporaryDirectory() as d:
            ok = rec('aa' * 20, 'AU865_koYNJ2', DIFFERENT[0])
            split = copy.deepcopy(rec('bb' * 20, 'AU866_zzzzz1', DIFFERENT[1], row='7831')); split['page_split'] = 'last_page_empty'
            noans = rec('cc' * 20, 'AU867_yyyyy2', DIFFERENT[2], row='7832')
            p1, p2 = noans['pages'][0]['text'], noans['pages'][1]['text'].replace('ANSWER', 'REPLY!')
            noans.update(text=p1 + p2, n_chars=len(p1 + p2), content_sha256=hashlib.sha256((p1 + p2).encode()).hexdigest())
            noans['pages'][1].update(text=p2, char_to=len(p1 + p2))
            foreign = rec('dd' * 20, 'AU868_xxxxx3', DIFFERENT[3], row='7833'); foreign['links'][0]['document_key'] = 'pq:ls:184:AU1_other1'
            keys = ['pq:ls:184:AU865_koYNJ2', 'pq:ls:184:AU866_zzzzz1', 'pq:ls:184:AU867_yyyyy2', 'pq:ls:184:AU868_xxxxx3']
            out = prepare(d, make_pack(d, [ok, split, noans, foreign]), keys)
            held = json.loads((out / 'holds.json').read_text())['held']
            self.assertEqual(sorted(held), keys[1:])
            self.assertIn('page split last_page_empty', held[keys[1]])
            self.assertIn('no answer section', held[keys[2]])
            self.assertIn('desk link names another module or key', held[keys[3]])

    def test_refuses_an_unpinned_pack(self):
        with tempfile.TemporaryDirectory() as d:
            pack = make_pack(d, [rec('aa' * 20, 'AU865_koYNJ2')])
            R.PACK_SHA256 = '0' * 64
            with self.assertRaises(SystemExit):
                prepare(d, pack, ['pq:ls:184:AU865_koYNJ2'])

    def test_real_importer_dry_run_accepts_the_output(self):
        with tempfile.TemporaryDirectory() as d:
            recs = [rec(c * 40, f'AU{865 + i}_abcde{i}', DIFFERENT[i], row=str(7830 + i)) for i, c in enumerate('abcd')]
            out = prepare(d, make_pack(d, recs), [f'pq:ls:184:AU{865 + i}_abcde{i}' for i in range(4)])
            rpt = pathlib.Path(d) / 'dry.jsonl'
            r = subprocess.run([NODE, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(out / 'corpus.jsonl'),
                                '--decisions', str(out / 'decisions.jsonl'), '--report', str(rpt)], cwd=REPO, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-500:])
            last = json.loads(rpt.read_text().splitlines()[-1])
            self.assertEqual((last['ready'], last['held']), (4, 0))
            self.assertEqual(last['manifest_sha256'], R.sha256_file(out / 'decisions.jsonl'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
