# The PQ section driver and the Law autopilot core are disabled (owner rules 2 and 7, 2026-10-29).
#   python3 -I -B docs/operations/national-pq-batch/test_national_pq_driver_offline.py
# Proves both refuse to run, by running them, and that everything below the guard line is byte-identical to the
# original recorded in README.md ("Disabled drivers"), so the provenance of batches already run is preserved.
import hashlib, pathlib, subprocess, sys, unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
DISABLED = {
    'docs/operations/national-pq-batch/nter-national-pq-batch.py': 'ff5990f609cae0aef387d758c503f84a9d6b15b1c8eff044bbb27187ddc7fd0a',
    'docs/operations/law-autopilot/nter-law-autopilot-core.py': '19299c5248128240b18e5134f2929cddfe60658f7e79d88d040d44cf96defe63',
}


class Disabled(unittest.TestCase):
    def test_refuses_to_run(self):
        for path in DISABLED:
            r = subprocess.run([sys.executable, '-I', '-B', str(REPO / path)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, path)
            self.assertIn('rules 2 and 7', r.stderr, path)

    def test_refuses_when_loaded_as_a_module(self):
        for path in DISABLED:
            src = (REPO / path).read_bytes()
            with self.assertRaises(SystemExit):
                exec(compile(src, path, 'exec'), {'__name__': 'loaded'})

    def test_guard_is_the_first_line_and_the_rest_is_the_original(self):
        for path, original in DISABLED.items():
            first, rest = (REPO / path).read_bytes().split(b'\n', 1)
            self.assertTrue(first.startswith(b'raise SystemExit('), path)
            self.assertEqual(hashlib.sha256(rest).hexdigest(), original, path)


if __name__ == '__main__':
    unittest.main(verbosity=1)
