"""Synthetic ZIP tests for law-cohort-screen.py; no client corpus content, no network.

Run: python3 -I scripts/law-cohort-screen.test.py
The last test runs the real importer dry run (Node 24, --experimental-strip-types) on the
finalized manifest to prove contract compatibility; it is skipped if node is unavailable.
"""
import csv
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location('screen_mod', HERE / 'law-cohort-screen.py')
screen_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen_mod)

ROOT = 'NTER_legal_pack_v9.9_TEST'
MEMBER = 'documents/tribunals/IBBI_NCLT/2026__part-00001.jsonl.gz'
FEATURE = 'NCLT / NCLAT (Insolvency)'


def rec(n, text=None, **over):
    text = text if text is not None else f'# Order {n}\n\nThe application {n} is admitted. Hearing on 2026-01-0{n}.'
    h = hashlib.sha256(text.encode('utf-8')).hexdigest()
    r = {
        'source_key': f'law:trib:IBBI_NCLT:ibbi_nclt-{n:016x}', 'title': f'In the matter of TEST {n}',
        'text': text, 'text_sha256': h, 'content_sha256': h, 'n_chars': len(text), 'n_pages': 1,
        'pages': [{'page_number': 1, 'char_from': 0, 'char_to': len(text)}], 'page_split': 'exact',
        'text_quality': 'ok', 'desk_tier': 'law', 'desk_feature': 'Tribunal orders',
        'citation': {'forum': 'NCLT', 'order_date': f'2026-01-0{n}'}, 'file_name': f'ibbi_nclt-{n:016x}.pdf',
        'file_url': f'https://example.invalid/order-{n}.pdf', 'licence': 'public tribunal order',
        'attribution': 'NCLT', 'document_key_suggested': f'trib:IBBI_NCLT:{n}',
    }
    r.update(over)
    return r


def gz_jsonl(records):
    return gzip.compress(b'\n'.join(json.dumps(r, ensure_ascii=False).encode('utf-8') for r in records) + b'\n')


def gz_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return gzip.compress(buf.getvalue().encode('utf-8'))


def build_zip(path):
    base = [
        rec(1),                                              # clean
        rec(2),                                              # sensitivity flag
        rec(3),                                              # dedupe keep=0
        rec(4, page_split='cut_at_250'),                     # incomplete + __full replacement elsewhere
        rec(5),                                              # competing revision in another member
        rec(6, text_sha256='0' * 64),                        # bad hash
        rec(7),                                              # clean
        rec(8),                                              # clean
        rec(9),                                              # clean (surplus beyond count)
    ]
    other = [rec(5, text='# Order 5\n\nA different revision of order 5.')]
    full = [rec(4, text='# Order 4\n\nThe whole long order 4, no longer cut.')]
    sens = gz_csv(['source_key', 'file', 'doc_type', 'court', 'year', 'tier', 'categories', 'evidence'],
                  [[base[1]['source_key'], MEMBER, 'order', 'NCLT', '2026', 'statute', 'pocso', 'POCSO']])
    dup = gz_csv(['group', 'match', 'keep', 'source_key', 'file', 'extraction', 'why'],
                 [['g1', 'same_text', '1', 'law:trib:IBBI_NCLT:keeper', 'x.jsonl.gz', 'pdf_text', 'case details'],
                  ['g1', 'same_text', '0', base[2]['source_key'], MEMBER, 'pdf_text', 'same text']])
    still = gz_csv(['source_key', 'need'], [['law:trib:IBBI_NCLT:absent', 'DOWNLOAD AGAIN']])
    members = [
        (MEMBER, gz_jsonl(base)),
        ('documents/tribunals/IBBI_NCLT/2026__part-00002.jsonl.gz', gz_jsonl(other)),
        ('documents/tribunals/IBBI_NCLT/2026__part-00001__full.jsonl.gz', gz_jsonl(full)),
        ('flags/sensitive_cases_v1.csv.gz', sens),
        ('dedupe/duplicate_documents_v1.csv.gz', dup),
        ('not_in_pack/still_not_in_pack_v1.csv.gz', still),
    ]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as z:
        for name, data in members:
            z.writestr(f'{ROOT}/{name}', data)
        z.writestr(f'{ROOT}/{MEMBER}', members[0][1])  # a byte-identical repeated member name
    return {name: hashlib.sha256(data).hexdigest() for name, data in members}


class ScreenTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix='law-cohort-test-'))
        self.zip = self.dir / 'pack.zip'
        self.hashes = build_zip(self.zip)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_screen(self, extra=()):
        out = self.dir / 'cohort'
        evidence = self.dir / 'evidence.json'
        evidence.write_text(json.dumps({'member_hashes': {k: v for k, v in self.hashes.items() if k.endswith('.csv.gz')}}))
        screen_mod.main(['screen', '--archive', str(self.zip), '--member', MEMBER, '--output-dir', str(out),
                         '--feature', FEATURE, '--count', '3', '--expect-policy-hashes', str(evidence), *extra])
        return out, json.loads((out / 'screen.json').read_text('utf-8'))

    def test_dispositions(self):
        out, s = self.run_screen()
        by = {c['line']: c for c in s['candidates']}
        self.assertEqual(s['member']['occurrences'], 2)
        self.assertEqual(s['member']['sha256'], self.hashes[MEMBER])
        self.assertEqual(by[1]['disposition'], 'ready_for_review')
        self.assertIn('sensitivity flag: serving-policy review required', by[2]['reasons'])
        self.assertIn('declared duplicate alias (keep=0); not a second searchable document', by[3]['reasons'])
        self.assertIn("incomplete page declaration page_split='cut_at_250'", by[4]['reasons'])
        self.assertIn('superseded by a __full replacement record in another member', by[4]['reasons'])
        self.assertIn('competing text revision in another member', by[5]['reasons'])
        self.assertIn('text_sha256 does not match text', by[6]['reasons'])
        self.assertEqual([c['line'] for c in s['candidates'] if c['disposition'] == 'ready_for_review'], [1, 7, 8])
        self.assertEqual(by[9]['disposition'], 'surplus_not_selected')
        self.assertTrue(all(v['matches_pilot_evidence'] for v in s['policy_members'].values()))
        self.assertFalse(s['production_eligible'])
        lines = (out / 'candidates.jsonl').read_bytes().rstrip(b'\n').split(b'\n')
        self.assertEqual(len(lines), 3)
        self.assertEqual(hashlib.sha256((out / 'candidates.jsonl').read_bytes()).hexdigest(), s['candidates_jsonl_sha256'])
        self.assertEqual(hashlib.sha256(lines[0]).hexdigest(), by[1]['record_sha256'])

    def test_excluded_and_hash_guard(self):
        decided = self.dir / 'decided.jsonl'
        decided.write_text(json.dumps({'source_key': rec(1)['source_key']}) + '\n')
        out, s = self.run_screen(['--exclude-decisions', str(decided)])
        by = {c['line']: c for c in s['candidates']}
        self.assertEqual(by[1]['disposition'], 'held')
        self.assertEqual([c['line'] for c in s['candidates'] if c['disposition'] == 'ready_for_review'], [7, 8, 9])
        with self.assertRaises(ValueError):
            screen_mod.main(['screen', '--archive', str(self.zip), '--member', MEMBER, '--output-dir', str(self.dir / 'x'),
                             '--feature', FEATURE, '--expect-member-sha256', '0' * 64])

    def test_finalize_refuses_held_and_binds_hashes(self):
        out, s = self.run_screen()
        held_key = rec(2)['source_key']
        with self.assertRaises(ValueError):
            screen_mod.main(['finalize', '--screen', str(out / 'screen.json'), '--output', str(out / 'd.jsonl'),
                             '--decision-id', 'test', '--approved-by', 'nobody', '--keys', held_key])
        screen_mod.main(['finalize', '--screen', str(out / 'screen.json'), '--output', str(out / 'decisions.jsonl'),
                         '--decision-id', 'owner-test-1', '--approved-by', 'test owner'])
        rows = [json.loads(l) for l in (out / 'decisions.jsonl').read_text('utf-8').splitlines()]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]['file_sha256'], s['candidates_jsonl_sha256'])
        self.assertEqual(rows[0]['review']['rules_sha256'], hashlib.sha256((out / 'screen.json').read_bytes()).hexdigest())
        self.assertEqual(rows[0]['desk_feature'], FEATURE)
        with self.assertRaises(FileExistsError):
            screen_mod.main(['finalize', '--screen', str(out / 'screen.json'), '--output', str(out / 'decisions.jsonl'),
                             '--decision-id', 'owner-test-1', '--approved-by', 'test owner'])
        # tampering with candidates.jsonl after screening is refused
        (out / 'candidates.jsonl').write_bytes((out / 'candidates.jsonl').read_bytes() + b'\n')
        with self.assertRaises(ValueError):
            screen_mod.main(['finalize', '--screen', str(out / 'screen.json'), '--output', str(out / 'd2.jsonl'),
                             '--decision-id', 'x', '--approved-by', 'y'])

    def test_real_importer_dry_run_accepts_finalized_manifest(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('node not available')
        out, s = self.run_screen()
        screen_mod.main(['finalize', '--screen', str(out / 'screen.json'), '--output', str(out / 'decisions.jsonl'),
                         '--decision-id', 'owner-test-1', '--approved-by', 'test owner'])
        report = out / 'dry-run.jsonl'
        proc = subprocess.run(
            [node, '--experimental-strip-types', str(HERE / 'corpus-text-import.mjs'), '--corpus', str(out / 'candidates.jsonl'),
             '--decisions', str(out / 'decisions.jsonl'), '--report', str(report)],
            cwd=str(HERE.parent), capture_output=True, text=True, timeout=300,
            env={**os.environ, 'NTER_INGEST_ACCESS_TOKEN': '', 'SUPABASE_PUBLISHABLE_KEY': ''},
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        summary = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual((summary['ready'], summary['held'], summary['submitted']), (3, 0, 0))
        self.assertGreater(summary['chunks'], 0)
        self.assertIn('"mode":"offline-dry-run"', report.read_text('utf-8'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
