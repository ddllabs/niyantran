# NTER Law batch-6 (next 1,000) PREPARATION screen (offline, read-only on the ZIP; no database, no credentials, nothing finalized).
# Screens IBBI_NCLT members with the repository's schema-3 screener and complete subtree scan, excludes every completed
# decision manifest (five, cohort-2, next-100, next-1000 T1-T4, batch-5 T1-T5), estimates chunks with the existing chunker and
# writes a compact key/URL list for the live check. Members: the remaining 2025 parts 00006-00009 and 2024 parts 00001-00004.
import hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, time, urllib.request

ZIP = '/content/drive/MyDrive/Data Handover/Legal/v1.1/file to ingest/NTER_legal_pack_v1.1_FULL_2026-10-18.zip'
ZIP_BYTES = 79418376315
LEGAL = '/content/drive/MyDrive/Data Handover/Legal/v1.1'
OLD = LEGAL + '/staging/staging-next100-20261023-2204'
OLD_PINS = {OLD + '/summary.json': '780f35a6abcad2426ea9f60046d88d7aa66336f23cecfcb9968f9606fa985053',
            OLD + '/authorized-20261024/decisions.jsonl': 'af57c78d478048c6c06afba6d76e41ed76ae5f0dd52384200424a2d71920d13b',
            LEGAL + '/nter-law-next100-cell.py': 'd3f62f9e2e2771082180988b14478ca9dd0b283872f597a7b735bdc564453dee'}
N1K = LEGAL + '/staging/staging-next1000-20261024-0853'
OLD_PINS.update({N1K + '/authorized-20261024/T1/decisions.jsonl': 'ed83e437f7839ab5d9fc8b6094909d4704220a5e77b293d6291a103a4d52f29a',
                 N1K + '/authorized-20261024/T2/decisions.jsonl': '972e95b1a856839e42393206bc9b6a119584944c896d0062edd1783f95fd5506',
                 N1K + '/authorized-20261024/T3/decisions.jsonl': 'dd46363712c898ec9278f4f3f00382cf9555869461dd35b79479094d187f7a9e',
                 N1K + '/authorized-20261024/T4/decisions.jsonl': '5921dce57bfbc840f52af35d38cdd8ed5c7db443d846401089279c5788755354'})
B5 = LEGAL + '/staging/staging-batch5-20261025-2224'
OLD_PINS.update({B5 + '/summary.json': 'ae80cada1c7c12a9862f0e6501a5e54d3836e9ded058f87dea890b1ac37c77f1',
                 B5 + '/authorized-20261026/T1/decisions.jsonl': 'aae686d491f3a011599930b763125a780ab38bdd812c76b7bb104efe558bd8c5',
                 B5 + '/authorized-20261026/T2/decisions.jsonl': '295135caa07f82034ecc8b1df401652b5e8b9b80de5c996d81b7f462d7044e0a',
                 B5 + '/authorized-20261026/T3/decisions.jsonl': '8e7a51591f1770e4bdc12bc679d716d2d3f4e3efd1a67c0b6a2a1c50b22466aa',
                 B5 + '/authorized-20261026/T4/decisions.jsonl': '40ce77f897f0fddda882f089c3cfeae82dfee50aa1603b6592ac2b4df33a61c4',
                 B5 + '/authorized-20261026/T5/decisions.jsonl': 'c76eeb95f4d5821b70185fcb84edda8d338e365e60f7c0197e201d63f33356be'})
REPO_SHA = 'cf3e7533209858dadde08274f49fe996dd7179d5'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
FEATURE = 'NCLT / NCLAT (Insolvency)'
MEMBERS = [  # hashes from the archive's CONTENTS.csv; the screener verifies them against actual bytes
    ('documents/tribunals/IBBI_NCLT/2025__part-00006.jsonl.gz', '5ad5aae7fd6b14337d5cb6db5a304bc2bb7ba78530bf2cf25717fb02db01b7bb'),
    ('documents/tribunals/IBBI_NCLT/2025__part-00007.jsonl.gz', '8b53f22f6b464fca56a0d8db609873bade297cb1115ded0435233816f030a573'),
    ('documents/tribunals/IBBI_NCLT/2025__part-00008.jsonl.gz', '5d35e5ac6a115fe7bb5d3fed4aef85bc5aea2daf15d3418c9acb1ca19ab5fe1e'),
    ('documents/tribunals/IBBI_NCLT/2025__part-00009.jsonl.gz', 'cda143831e3f80fae205dc53a7dd1302a108501a6cdfe44b3aebff6a435376f2'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00001.jsonl.gz', '9fb17b2c4d338c479cac964ef1cdc193031bb8d3922ecbf22f08a189b3427a7b'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00002.jsonl.gz', 'b4c28d303ec3111affcfe5193859e490cd4a71d023a3a220925b0ab40773e029'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00003.jsonl.gz', '4fbcd56ce9fb77c03340459ba9b5e59590e8bd2e48add34cc890f9876367a26d'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00004.jsonl.gz', '5d92b77b9df16f027966b7503282b4d6a5e91f292f546847f5a05c5a9650f359'),
]
W = pathlib.Path('/content/nter-law-next100')
REPO = W / 'niyantran'
NODE = W / 'node24' / 'package' / 'bin' / 'node'


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def run(cmd, cwd=None):
    print('$', ' '.join(str(c) for c in cmd)[:300], flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit(f'step failed with exit {r.returncode}')
    return r.stdout


def setup():
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    assert os.path.getsize(ZIP) == ZIP_BYTES
    for p, want in OLD_PINS.items():
        assert sha256_file(p) == want, f'pinned file changed: {p}'
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        run(['git', 'init', '-q', REPO]); run(['git', '-C', REPO, 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'])
    run(['git', '-C', REPO, 'fetch', '--depth', '1', '-q', 'origin', REPO_SHA])
    run(['git', '-C', REPO, 'checkout', '-q', '-f', 'FETCH_HEAD'])
    assert run(['git', '-C', REPO, 'rev-parse', 'HEAD']).strip() == REPO_SHA
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        assert sha256_file(tgz) == NODE_SHA
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)
    # the reviewed estimator (existing chunker, unsigned placeholder review) lives in the next-100 driver
    g = {'__name__': 'nter_next100_cell'}
    exec(compile(open(LEGAL + '/nter-law-next100-cell.py', 'rb').read(), 'nter-law-next100-cell.py', 'exec'), g)
    (REPO / 'next100-estimate.mjs').write_text(g['ESTIMATE_MJS'], 'utf-8')


def compact_screen(s, out, est):
    e = json.loads(est.read_text('utf-8'))
    by_key = {r['source_key']: r for r in e['rows']}
    cands = []
    for c in s['candidates']:
        r = by_key.get(c.get('source_key'), {}) if c['disposition'] == 'ready_for_review' else {}
        cands.append({k: c.get(k) for k in ('line', 'source_key', 'disposition', 'reasons', 'title', 'text_sha256', 'record_sha256',
                                             'n_pages', 'n_chars', 'file_url', 'document_key_suggested')}
                     | {'occ': [(o['member'].rsplit('/', 1)[-1], o['line']) for o in c.get('occurrences', [])],
                        'dedupe': c.get('dedupe'), 'sensitivity': c.get('sensitivity'),
                        'est': {k: r.get(k) for k in ('status', 'reason', 'chunks', 'content_chars', 'embedding_input_bytes',
                                                      'cost_ceiling_usd', 'citation')} if r else None})
    return {'member': s['member'], 'dir': str(out), 'screen_sha256': sha256_file(out / 'screen.json'),
            'candidates_jsonl_sha256': s['candidates_jsonl_sha256'], 'estimate_sha256': sha256_file(est),
            'lines_scanned': s['lines_scanned'], 'counts': s['counts'], 'held_reasons': s['held_reasons'],
            'production_checks': s['production_checks'], 'finalizable': s['finalizable'],
            'policy_members': {k: {kk: v.get(kk) for kk in ('sha256', 'occurrences', 'verified', 'matches_pilot_evidence', 'candidate_rows')}
                               for k, v in s['policy_members'].items()},
            'subtree_scan': {k: v for k, v in s['subtree_scan'].items() if k != 'unreadable_examples'},
            'excluded_keys': s['excluded_keys'], 'candidates': cands}


def main():
    t0 = time.time()
    setup()
    excl = [str(REPO / 'docs/operations/law-five-release/decisions.jsonl'), str(REPO / 'docs/operations/law-cohort-2-release/decisions.jsonl'),
            OLD + '/authorized-20261024/decisions.jsonl'] + [N1K + f'/authorized-20261024/{t}/decisions.jsonl' for t in ('T1', 'T2', 'T3', 'T4')] \
         + [B5 + f'/authorized-20261026/{t}/decisions.jsonl' for t in ('T1', 'T2', 'T3', 'T4', 'T5')]
    stamp = time.strftime('%Y%m%d-%H%M')
    stage = pathlib.Path(LEGAL + f'/staging/staging-batch6-{stamp}'); stage.mkdir(parents=True)
    local = W / f'screens-{stamp}'; local.mkdir()
    screens = []
    for member, msha in MEMBERS:
        name = pathlib.Path(member).name.split('.')[0]
        out = local / f'screen-{name}'
        cmd = [sys.executable, '-I', 'scripts/law-cohort-screen.py', 'screen', '--archive', ZIP, '--member', member,
               '--expect-member-sha256', msha, '--start-line', '1', '--count', '5000', '--max-scan', '5000', '--feature', FEATURE,
               '--expect-policy-hashes', 'docs/operations/law-five-release/eligibility-evidence.json', '--output-dir', out]
        for x in excl:
            cmd += ['--exclude-decisions', x]
        run(cmd, cwd=REPO)
        est = out / 'estimate-UNSIGNED.json'
        run([NODE, '--experimental-strip-types', 'next100-estimate.mjs', out / 'screen.json', est], cwd=REPO)
        s = json.loads((out / 'screen.json').read_text('utf-8'))
        dest = stage / out.name
        shutil.copytree(out, dest)
        sc = compact_screen(s, dest, dest / 'estimate-UNSIGNED.json')
        screens.append(sc)
        print(json.dumps({'member': name, 'lines': sc['lines_scanned'], 'counts': sc['counts'], 'checks': sc['production_checks'],
                          'held': sc['held_reasons']}), flush=True)
    summary = {'repo_sha': REPO_SHA, 'archive_bytes': ZIP_BYTES, 'excluded_decision_files': {x: sha256_file(x) for x in excl},
               'screens': screens, 'minutes': round((time.time() - t0) / 60, 1)}
    (stage / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False), 'utf-8')
    # compact key/URL list (no corpus text) for the read-only live check
    KP, UP = 'law:trib:IBBI_NCLT:ibbi_nclt-', 'https://ibbi.gov.in/uploads/order/'
    lines, odd, seen = [], [], set()
    for sc in screens:
        for c in sc['candidates']:
            if c['disposition'] != 'ready_for_review' or c['source_key'] in seen:
                continue
            seen.add(c['source_key'])
            k, u = c['source_key'], c.get('file_url') or ''
            if k.startswith(KP) and len(k) == len(KP) + 16 and u.startswith(UP) and ' ' not in u and ',' not in u and "'" not in u:
                lines.append(k[len(KP):] + ' ' + u[len(UP):])
            else:
                odd.append([k, u])
    body = ','.join(lines)
    (stage / 'compact.txt').write_text(json.dumps({'n': len(lines), 'sha256': hashlib.sha256(body.encode()).hexdigest(), 'odd': odd, 'body': body}))
    st = {'stage': str(stage), 'summary_sha256': sha256_file(stage / 'summary.json'), 'ready_unique': len(seen), 'compact_n': len(lines),
          'odd': len(odd), 'screens': [{'member': sc['member']['name'].rsplit('/', 1)[-1], 'lines': sc['lines_scanned'], 'counts': sc['counts'],
                                        'finalizable': sc['finalizable'], 'held': sc['held_reasons']} for sc in screens],
          'minutes': summary['minutes']}
    (stage / 'status.json').write_text(json.dumps(st, indent=1))
    print(json.dumps(st, indent=1))
    return st
