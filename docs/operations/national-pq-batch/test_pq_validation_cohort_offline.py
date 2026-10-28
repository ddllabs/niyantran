# Offline tests for pq-validation-cohort.py and pq-cohort-ceilings.mjs (synthetic records; no corpus text, no network).
#   python3 -I docs/operations/national-pq-batch/test_pq_validation_cohort_offline.py
import copy, hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
NODE = os.environ.get('NODE', 'node')


def jl(path):
    with open(path) as f:
        return [json.loads(l) for l in f]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


V = load('pq_cohort', 'pq-validation-cohort.py')
T = load('pq_fixture', 'test_national_pq_offline.py')   # reuse its synthetic pack record


def supplied(key, stem='AU865_koYNJ2'):
    r = T.record()
    url = f'https://sansad.in/getFile/loksabhaquestions/annex/184/{stem}.pdf?source=pqals'
    r.update(source_key=key, file_url=url, file_name=stem + '.pdf', title_stem='184_' + stem)
    return V.C.supplied_record(r)


def write_corpus(d, records):
    p = pathlib.Path(d) / 'in.jsonl'
    p.write_bytes(b''.join(json.dumps(r, ensure_ascii=False).encode() + b'\n' for r in records))
    return p, hashlib.sha256(p.read_bytes()).hexdigest()


def run_prepare(d, corpus, sha, keys, count, out='out'):
    kp = pathlib.Path(d) / 'keys.txt'; kp.write_text('\n'.join(keys) + '\n')
    V.prepare(type('A', (), dict(corpus=str(corpus), expect_corpus_sha256=sha, keys=str(kp), count=count,
                                 decision_id='national-pq-validation-test-v2', out=str(pathlib.Path(d) / out))))
    return pathlib.Path(d) / out


class Signature(unittest.TestCase):
    def test_matches_a_live_verified_row(self):
        # Listing row 217 on NTER (2026-10-29) for AU2287_e2MRni: md5 computed by the database's pq_norm / pq_date.
        c = {'house': 'Lok Sabha', 'subject': 'Funds for Tourism Schemes', 'ministry': 'TOURISM', 'answered_on': '05.08.2024'}
        self.assertEqual(V.f266_signature(c), 'b4dd152e35c09f406056465f0ad8df2f')

    def test_normalisation_follows_the_server(self):
        a = {'house': 'Lok Sabha', 'subject': 'Smart Class in KVs and JNVs  in Chhattisgarh',
             'ministry': 'FISHERIES, ANIMAL HUSBANDRY AND DAIRYING ', 'answered_on': '05.08.2024'}
        b = {'house': 'lok  sabha', 'subject': 'smart class in kvs and jnvs in chhattisgarh',
             'ministry': 'Fisheries Animal Husbandry and Dairying', 'answered_on': '2024-08-05'}
        self.assertEqual(V.f266_signature(a), V.f266_signature(b))
        self.assertNotEqual(V.f266_signature(a), V.f266_signature({**b, 'answered_on': '2024-08-06'}))

    def test_missing_field_has_no_signature(self):
        self.assertIsNone(V.f266_signature({'house': 'Lok Sabha', 'subject': 'x', 'answered_on': '05.08.2024'}))
        self.assertIsNone(V.f266_signature({'house': 'Lok Sabha', 'subject': 'x', 'ministry': 'y', 'answered_on': '5 Aug 2024'}))

    def test_answer_key(self):
        self.assertEqual(V.pq_answer_key('https://sansad.in/getFile/loksabhaquestions/annex/182/AU2287_e2MRni.pdf?source=pqals'),
                         'pq:ls:182:AU2287_e2MRni')
        self.assertIsNone(V.pq_answer_key('https://sansad.in/getFile/rajyasabhaquestions/annex/182/AU2287_e2MRni.pdf'))


class Prepare(unittest.TestCase):
    def test_writes_exact_lines_and_a_bound_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            recs = [supplied('aa' * 20, 'AU865_koYNJ2'), supplied('bb' * 20, 'AU865_zzzzz1'), supplied('cc' * 20, 'AU865_yyyyy2')]
            corpus, sha = write_corpus(d, recs)
            out = run_prepare(d, corpus, sha, ['cc' * 20, 'aa' * 20, 'bb' * 20], 2)
            src = corpus.read_bytes().splitlines(keepends=True)
            self.assertEqual((out / 'corpus.jsonl').read_bytes(), src[2] + src[0])   # --keys order, byte for byte
            meta = json.loads((out / 'cohort.json').read_text())
            dec = jl(out / 'decisions.jsonl')
            self.assertEqual([x['source_key'] for x in dec], ['cc' * 20, 'aa' * 20])
            self.assertTrue(all(x['file_sha256'] == meta['cohort_corpus_sha256'] for x in dec))
            self.assertEqual(meta['decisions_sha256'], hashlib.sha256((out / 'decisions.jsonl').read_bytes()).hexdigest())
            self.assertTrue(all(x['review']['rules_sha256'] == V.C.RULES_SHA256 for x in dec))
            self.assertNotIn('"text"', (out / 'cohort.json').read_text())                  # no corpus text in the record
            # The real importer accepts the output, offline, and reports the manifest hash the owner approves.
            r = subprocess.run([NODE, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(out / 'corpus.jsonl'),
                                '--decisions', str(out / 'decisions.jsonl'), '--report', str(pathlib.Path(d) / 'dry.jsonl')],
                               cwd=REPO, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-400:])
            s = jl(pathlib.Path(d) / 'dry.jsonl')[-1]
            self.assertEqual((s['ready'], s['held'], s['manifest_sha256']), (2, 0, meta['decisions_sha256']))

    def test_ceiling_helper_reproduces_the_importer(self):
        with tempfile.TemporaryDirectory() as d:
            corpus, sha = write_corpus(d, [supplied('aa' * 20), supplied('bb' * 20, 'AU865_zzzzz1')])
            out = run_prepare(d, corpus, sha, ['aa' * 20, 'bb' * 20], 2)
            subprocess.run([NODE, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(out / 'corpus.jsonl'),
                            '--decisions', str(out / 'decisions.jsonl'), '--report', str(pathlib.Path(d) / 'dry.jsonl')], cwd=REPO, check=True,
                           capture_output=True)
            s = jl(pathlib.Path(d) / 'dry.jsonl')[-1]
            kp = pathlib.Path(d) / 'k.txt'; kp.write_text('aa' * 20 + '\n' + 'bb' * 20 + '\n')
            h = subprocess.run([NODE, '--experimental-strip-types', str(HERE / 'pq-cohort-ceilings.mjs'), str(out / 'corpus.jsonl'), str(kp)],
                               cwd=REPO, capture_output=True, text=True, check=True)
            rows = [json.loads(l) for l in h.stdout.splitlines()]
            self.assertEqual(sum(r['chunks'] for r in rows), s['chunks'])
            self.assertAlmostEqual(sum(r['ceiling_usd'] for r in rows), s['estimated_cost_ceiling_usd'], places=12)

    def test_holds_a_record_the_server_would_refuse_and_takes_the_next(self):
        with tempfile.TemporaryDirectory() as d:
            bad = supplied('aa' * 20); bad['document_key_suggested'] = 'pq:ls:184:AU865_other'
            corpus, sha = write_corpus(d, [bad, supplied('bb' * 20, 'AU865_zzzzz1')])
            out = run_prepare(d, corpus, sha, ['aa' * 20, 'bb' * 20], 1)
            meta = json.loads((out / 'cohort.json').read_text())
            self.assertEqual([x['source_key'] for x in meta['documents']], ['bb' * 20])
            self.assertIn('answer key does not match the URL', meta['held_before_count_reached']['aa' * 20])
            # Causal check: without the hold, the real adapter refuses this record (F266 answer_key rule).
            dd = pathlib.Path(d) / 'raw'; dd.mkdir()
            c2, s2 = write_corpus(dd, [bad])
            (dd / 'dec.jsonl').write_text(json.dumps(V.C.decision({'source_key': 'aa' * 20, 'content_sha256': bad['text_sha256']}, 'x-test-0001', s2)) + '\n')
            r = subprocess.run([NODE, '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(c2),
                                '--decisions', str(dd / 'dec.jsonl'), '--report', str(dd / 'r.jsonl')], cwd=REPO, capture_output=True, text=True)
            rows = jl(dd / 'r.jsonl')
            self.assertEqual(rows[-1]['held'], 1)
            self.assertIn('document_key_suggested', rows[1]['reason'])

    def test_text_tampering_is_held(self):
        with tempfile.TemporaryDirectory() as d:
            bad = supplied('aa' * 20); bad['text'] = bad['text'].replace('rural', 'urban')
            corpus, sha = write_corpus(d, [bad, supplied('bb' * 20, 'AU865_zzzzz1')])
            meta = json.loads((run_prepare(d, corpus, sha, ['aa' * 20, 'bb' * 20], 1) / 'cohort.json').read_text())
            self.assertIn('text hash mismatch', meta['held_before_count_reached']['aa' * 20])

    def test_refusals_write_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            corpus, sha = write_corpus(d, [supplied('aa' * 20)])
            with self.assertRaises(SystemExit):           # over the validation-cohort size
                run_prepare(d, corpus, sha, ['aa' * 20], 101, 'o1')
            with self.assertRaises(SystemExit):           # input file is not the reviewed one
                run_prepare(d, corpus, '0' * 64, ['aa' * 20], 1, 'o2')
            with self.assertRaises(SystemExit):           # fewer eligible than asked
                run_prepare(d, corpus, sha, ['aa' * 20, 'ff' * 20], 2, 'o3')
            for o in ('o1', 'o2', 'o3'):
                self.assertFalse((pathlib.Path(d) / o / 'decisions.jsonl').exists())
            run_prepare(d, corpus, sha, ['aa' * 20], 1, 'o4')
            with self.assertRaises(SystemExit):           # never into a used directory
                run_prepare(d, corpus, sha, ['aa' * 20], 1, 'o4')


if __name__ == '__main__':
    unittest.main(verbosity=1)
