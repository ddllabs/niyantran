# Offline tests for last-page-cohort/run-last-page-cohort.py.
#   python3 -I -B docs/operations/national-pq-batch/test_run_last_page_cohort_offline.py
# 1. It is run-remainder-cohort.py with only the listed lines changed: the cohort constants (hashes, decision id, counts,
#    limits, staging folder, work folder), header comments naming them, the committed-cohort folder, and the rebuild command
#    (this cohort's prepare script plus --exclude-cohort and --over-limit arguments), and the shared-code baseline
#    (main at PR #87, 2026-11-01: PR #80's merge carried two billing test fixtures). Any other difference fails.
# 2. The 16 run-script tests of test_run_remainder_cohort_offline.py run unchanged against this script, and the causal
#    test removes each check from this script's source and shows the matching test fails.
import difflib, importlib.util, pathlib, unittest

HERE = pathlib.Path(__file__).resolve().parent
REMAINDER = (HERE / 'remainder-cohort' / 'run-remainder-cohort.py').read_text()
LAST_PAGE = (HERE / 'last-page-cohort' / 'run-last-page-cohort.py').read_text()

spec = importlib.util.spec_from_file_location('run_remainder_tests', HERE / 'test_run_remainder_cohort_offline.py')
T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)

ALLOWED = {
    ('# Lok Sabha remainder cohort (523 answers): ONE submission, then stop. Google Colab, Python 3.',
     '# Lok Sabha last_page_empty cohort (113 answers): ONE submission, then stop. Google Colab, Python 3.'),
    ('# run: --max-chunks 5300 --max-estimated-cost-usd 0.31 (rule 3). Rule 7: the person running it signs in on nter.pro with',
     '# run: --max-chunks 1400 --max-estimated-cost-usd 0.09 (rule 3). Rule 7: the person running it signs in on nter.pro with'),
    ("#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/remainder-cohort/run-remainder-cohort.py').read()",
     "#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/last-page-cohort/run-last-page-cohort.py').read()"),
    ("#   exec(compile(src, 'run-remainder-cohort.py', 'exec')); run(REPO_SHA)",
     "#   exec(compile(src, 'run-last-page-cohort.py', 'exec')); run(REPO_SHA)"),
    ('# A 523-answer run takes 35-50 minutes, so a token may expire mid-run. If the importer stops on an uncertain outcome',
     '# A 113-answer run takes about 8-12 minutes; a token may still expire mid-run. If the importer stops on an uncertain outcome'),
    ("APPROVED_MANIFEST = '8b1ac8f3b9f1cbe856063fc419c091b10f69c0f5e8483ff13fb7113a72750b27'   # decisions.jsonl sha256",
     "APPROVED_MANIFEST = '17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005'   # decisions.jsonl sha256"),
    ("COHORT_CORPUS = '781c224017c3710097d2b899b95e2c5c64f1c93cae2d666fcdbcf03787a46b52'       # rebuilt corpus.jsonl sha256",
     "COHORT_CORPUS = '2958bbaabc261704fa0cd9d7b89708ca2e6b19c0f56b5484d2026fbd6348efe4'       # rebuilt corpus.jsonl sha256"),
    ("DECISION_ID = 'national-pq-remainder-20261030-v1'", "DECISION_ID = 'national-pq-lastpage-20261031-v1'"),
    ("MAIN_SHA = 'e15843463809bb6698347689762dd4e76a9bd1e4'   # main at PR #77: the importer and shared code must be byte-identical",
     "MAIN_SHA = 'e5275e709d375e31775884c6da617ed8d408e242'   # main at PR #87: the importer and shared code must be byte-identical"),
    ('DOCS, CHUNKS, MAX_CHUNKS, MAX_COST_USD = 523, 5234, 5300, 0.31', 'DOCS, CHUNKS, MAX_CHUNKS, MAX_COST_USD = 113, 1390, 1400, 0.09'),
    ("ST = pathlib.Path(NATIONAL + '/staging/pq-remainder-01')", "ST = pathlib.Path(NATIONAL + '/staging/pq-lastpage-01')"),
    ("W = pathlib.Path('/content/nter-pq-remainder')", "W = pathlib.Path('/content/nter-pq-lastpage')"),
    ("    here = REPO / HERE / 'remainder-cohort'", "    here = REPO / HERE / 'last-page-cohort'"),
    ("    r = subprocess.run(['python3', '-I', '-B', str(REPO / HERE / 'pq-remainder-cohort.py'), 'prepare', '--pack', str(PACK),",
     "    r = subprocess.run(['python3', '-I', '-B', str(REPO / HERE / 'pq-last-page-cohort.py'), 'prepare', '--pack', str(PACK),"),
}
INSERTED = {"                        '--exclude-cohort', str(REPO / HERE / 'remainder-cohort' / 'cohort.json'),",
            "                        '--over-limit', str(REPO / HERE / 'last-page-cohort' / 'over-limit-keys.txt'),"}


class OnlyTheseLinesDiffer(unittest.TestCase):
    def test_diff_is_exactly_the_allowed_lines(self):
        a, b = REMAINDER.splitlines(), LAST_PAGE.splitlines()
        changed, inserted = set(), set()
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if tag == 'replace':
                self.assertEqual(i2 - i1, j2 - j1, f'unequal replace at {i1}')
                changed |= set(zip(a[i1:i2], b[j1:j2]))
            elif tag == 'insert':
                inserted |= set(b[j1:j2])
            elif tag == 'delete':
                self.fail(f'deleted lines: {a[i1:i2]}')
        self.assertEqual(changed, ALLOWED)
        self.assertEqual(inserted, INSERTED)


def carried(cls):
    return type(cls.__name__ + 'LastPage', (cls,), {'source': LAST_PAGE})


TokenLastPage, ResumeLastPage = carried(T.Token), carried(T.Resume)
SubmitLastPage, SharedCodeLastPage = carried(T.Submit), carried(T.SharedCode)


class CausalLastPage(unittest.TestCase):
    def test_every_guard_test_fails_with_its_check_removed(self):
        for cls, name, (old, new) in T.MUTATIONS:
            with self.subTest(test=name):
                self.assertEqual(LAST_PAGE.count(old), 1, f'mutation target not unique: {old!r}')
                mutated = type(cls.__name__ + 'Mutated', (cls,), {'source': LAST_PAGE.replace(old, new)})
                result = unittest.TestResult()
                mutated(name).run(result)
                self.assertTrue(result.failures or result.errors, f'{name} still passes with its check removed')



if __name__ == '__main__':
    unittest.main(verbosity=1)
