# Offline tests for remainder-cohort/run-remainder-cohort.py: stubbed getpass, google.colab (userdata, drive) and
# subprocess; no network, no token, no Drive.
#   python3 -I -B docs/operations/national-pq-batch/test_run_remainder_cohort_offline.py
# Each guard test is paired with a mutation that removes exactly that check from the script's source; the Causal class
# runs the test against the mutated script and requires it to FAIL, which shows the test depends on the check.
import base64, hashlib, json, pathlib, sys, tempfile, time, types, unittest

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE / 'remainder-cohort' / 'run-remainder-cohort.py'
SOURCE = SCRIPT.read_text()


def jwt(exp):
    body = base64.urlsafe_b64encode(json.dumps({'exp': exp, 'sub': 'test'}).encode()).decode().rstrip('=')
    return f'eyJhbGciOiJIUzI1NiJ9.{body}.c2ln'


class Proc:
    def __init__(self, returncode=0, stdout='', stderr=''):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def load(source=SOURCE, typed='', key='publishable', run=None):
    """Exec the script with stubs; returns its namespace. typed: what getpass returns; run: subprocess.run stub."""
    colab = types.ModuleType('google.colab')
    colab.userdata = types.SimpleNamespace(get=lambda name: key if name == 'SUPABASE_PUBLISHABLE_KEY' else None)
    colab.drive = types.SimpleNamespace(mount=lambda path: None)
    google = types.ModuleType('google'); google.colab = colab
    sys.modules['google'], sys.modules['google.colab'] = google, colab
    ns = {'__name__': 'run_remainder_test'}
    exec(compile(source, str(SCRIPT), 'exec'), ns)
    ns['getpass'] = types.SimpleNamespace(getpass=lambda prompt='': typed)
    ns['subprocess'] = types.SimpleNamespace(run=run or (lambda *a, **k: Proc()))

    def no_network(*a, **k):
        raise AssertionError('network access attempted in an offline test')
    ns['urllib'] = types.SimpleNamespace(request=types.SimpleNamespace(urlretrieve=no_network, urlopen=no_network))
    return ns


def staged(ns, d, decisions=b'{"m":1}\n', corpus=b'{"c":1}\n'):
    """A temporary staging folder whose manifest and corpus hashes are the namespace's approved ones."""
    st = pathlib.Path(d) / 'st'; st.mkdir()
    (st / 'decisions.jsonl').write_bytes(decisions); (st / 'corpus.jsonl').write_bytes(corpus)
    ns['ST'], ns['W'] = st, pathlib.Path(d) / 'w'
    ns['APPROVED_MANIFEST'] = hashlib.sha256(decisions).hexdigest()
    ns['COHORT_CORPUS'] = hashlib.sha256(corpus).hexdigest()
    ns['setup'] = lambda repo_sha: None
    return st


def prior(st, n, exit_code, status=True):
    (st / f'submit-{n}.jsonl').write_text('{"type":"summary"}\n')
    if status:
        (st / f'submit-{n}-status.json').write_text(json.dumps({'exit': exit_code}))


class Token(unittest.TestCase):
    source = SOURCE

    def test_refuses_a_token_near_expiry(self):
        ns = load(self.source, typed=jwt(time.time() + 10 * 60))
        with self.assertRaisesRegex(ns['Stop'], 'minutes left'):
            ns['token_env']()

    def test_refuses_a_malformed_token_without_echoing_it(self):
        ns = load(self.source, typed='not-a-token')
        with self.assertRaisesRegex(ns['Stop'], 'does not look like') as cm:
            ns['token_env']()
        self.assertTrue(cm.exception.__suppress_context__)   # 'from None': no chained traceback
        self.assertNotIn('not-a-token', str(cm.exception))

    def test_accepts_a_fresh_token(self):
        tok = jwt(time.time() + 59 * 60)
        env = load(self.source, typed=tok)['token_env']()
        self.assertEqual(env['NTER_INGEST_ACCESS_TOKEN'], tok)


class Resume(unittest.TestCase):
    source = SOURCE

    def _resume(self, setup_files, decisions_changed=False):
        with tempfile.TemporaryDirectory() as d:
            ns = load(self.source, typed=jwt(time.time() + 3600))
            st = staged(ns, d)
            setup_files(st)
            if decisions_changed:
                (st / 'decisions.jsonl').write_bytes(b'{"m":2}\n')
            calls = []
            ns['submit'] = lambda n, env: calls.append(n)
            ns['resume']('sha')
            return calls

    def test_refuses_with_no_report(self):
        with self.assertRaises(Exception) as cm:
            self._resume(lambda st: None)
        self.assertRegex(str(cm.exception), 'nothing to resume')

    def test_refuses_after_exit_0(self):
        with self.assertRaisesRegex(Exception, 'only after an uncertain stop'):
            self._resume(lambda st: prior(st, 1, 0))

    def test_refuses_after_exit_1(self):
        with self.assertRaisesRegex(Exception, 'only after an uncertain stop'):
            self._resume(lambda st: prior(st, 1, 1))

    def test_refuses_after_exit_3(self):
        with self.assertRaisesRegex(Exception, 'only after an uncertain stop'):
            self._resume(lambda st: prior(st, 1, 3))

    def test_missing_status_is_uncertain_and_stops(self):
        with self.assertRaisesRegex(Exception, 'no status file'):
            self._resume(lambda st: prior(st, 1, 2, status=False))

    def test_refuses_a_changed_staged_hash(self):
        with self.assertRaisesRegex(Exception, 'resume refused'):
            self._resume(lambda st: prior(st, 1, 2), decisions_changed=True)

    def test_resumes_after_exit_2_into_the_next_report(self):
        self.assertEqual(self._resume(lambda st: (prior(st, 1, 2), prior(st, 2, 2))), [3])


class Submit(unittest.TestCase):
    source = SOURCE

    def test_double_submit_guard_refuses_any_submit_file(self):
        with tempfile.TemporaryDirectory() as d:
            ns = load(self.source)
            st = staged(ns, d)
            (st / 'submit-1-status.json').write_text('{"exit": null}')   # a status alone is enough to refuse
            with self.assertRaisesRegex(ns['Stop'], 'already holds a submission'):
                ns['run']('sha')

    def test_submit_refuses_an_existing_status(self):
        with tempfile.TemporaryDirectory() as d:
            ns = load(self.source)
            st = staged(ns, d)
            (st / 'submit-1-status.json').write_text('{"exit": 2}')
            ns['importer'] = lambda *a, **k: Proc(0)
            with self.assertRaisesRegex(ns['Stop'], 'never overwritten'):
                ns['submit'](1, {'NTER_INGEST_ACCESS_TOKEN': 't'})
            self.assertEqual(json.loads((st / 'submit-1-status.json').read_text()), {'exit': 2})

    def test_status_is_written_even_when_the_importer_crashes(self):
        with tempfile.TemporaryDirectory() as d:
            ns = load(self.source)
            st = staged(ns, d)

            def boom(*a, **k):
                raise KeyboardInterrupt
            ns['importer'] = boom
            env = {'NTER_INGEST_ACCESS_TOKEN': 't'}
            with self.assertRaises(KeyboardInterrupt):
                ns['submit'](1, env)
            self.assertEqual(json.loads((st / 'submit-1-status.json').read_text())['exit'], None)
            self.assertNotIn('NTER_INGEST_ACCESS_TOKEN', env)


class SharedCode(unittest.TestCase):
    source = SOURCE

    def test_refuses_when_scripts_or_supabase_differ_from_main(self):
        with tempfile.TemporaryDirectory() as d:
            def run(cmd, *a, **k):
                if 'rev-parse' in cmd:
                    return Proc(0, 'pinned\n')
                if 'diff' in cmd:
                    return Proc(1)
                return Proc(0)
            ns = load(self.source, run=run)
            ns['W'] = pathlib.Path(d); ns['REPO'] = pathlib.Path(d) / 'niyantran'
            with self.assertRaisesRegex(ns['Stop'], 'differ from main'):
                ns['setup']('pinned')


# (test class, test name, exact text removed or neutralised in the script)
MUTATIONS = [
    (Token, 'test_refuses_a_token_near_expiry', ('    if left < MIN_TOKEN_MINUTES:', '    if False:')),
    (Token, 'test_refuses_a_malformed_token_without_echoing_it',
     ("        raise Stop('that does not look like a session access token') from None", '        exp = time.time() + 7200')),
    (Resume, 'test_refuses_with_no_report', ('    if not numbers:\n', '    if False:\n')),
    (Resume, 'test_refuses_after_exit_0', ('    if code != 2:', '    if False:')),
    (Resume, 'test_refuses_after_exit_1', ('    if code != 2:', '    if False:')),
    (Resume, 'test_refuses_after_exit_3', ('    if code != 2:', '    if False:')),
    (Resume, 'test_missing_status_is_uncertain_and_stops', ('    if not status.exists():', '    if False:')),
    (Resume, 'test_refuses_a_changed_staged_hash',
     ("        raise Stop('staged cohort differs from the approved manifest: resume refused')", '        pass')),
    (Submit, 'test_double_submit_guard_refuses_any_submit_file', ("    if any(ST.glob('submit-*')):", '    if False:')),
    (Submit, 'test_submit_refuses_an_existing_status', ('    if report.exists() or status.exists():', '    if False:')),
    (Submit, 'test_status_is_written_even_when_the_importer_crashes', ('    finally:\n', '    except ZeroDivisionError:\n')),
    (SharedCode, 'test_refuses_when_scripts_or_supabase_differ_from_main',
     ("        raise Stop('scripts/ or supabase/ differ from main e158434: refusing to submit with changed shared code')",
      '        pass')),
]


class Causal(unittest.TestCase):
    def test_every_guard_test_fails_with_its_check_removed(self):
        for cls, name, (old, new) in MUTATIONS:
            with self.subTest(test=name):
                self.assertEqual(SOURCE.count(old), 1, f'mutation target not unique: {old!r}')
                mutated = type(cls.__name__ + 'Mutated', (cls,), {'source': SOURCE.replace(old, new)})
                result = unittest.TestResult()
                mutated(name).run(result)
                self.assertTrue(result.failures or result.errors, f'{name} still passes with its check removed')

    def test_every_test_passes_on_the_real_script(self):
        for cls, name, _ in MUTATIONS:
            result = unittest.TestResult()
            cls(name).run(result)
            self.assertTrue(result.wasSuccessful(), f'{name}: {result.failures + result.errors}')


if __name__ == '__main__':
    unittest.main(verbosity=1)
