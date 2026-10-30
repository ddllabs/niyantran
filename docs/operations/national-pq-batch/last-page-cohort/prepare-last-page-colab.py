# Lok Sabha last_page_empty cohort: PREPARE ONLY (screen + offline dry run). Google Colab, Python 3.
#
# Status: Living (2026-10-31). Submits nothing and asks for no token or password: no request reaches nter.pro or
# Supabase. Reads the pinned citation pack from Drive, screens the pack's last_page_empty answers among the open answers
# (open-answer-keys.txt minus the remainder cohort's 523) with pq-last-page-cohort.py, runs main's importer offline (dry
# run), and writes everything to Data Handover/National/v1.1/staging/pq-lastpage-01/prepare/. Never touches
# pq-remainder-01. Refuses to overwrite an earlier preparation.
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file on task/client-corpus-claude-2026-10-29>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/last-page-cohort/prepare-last-page-colab.py').read()
#   print(hashlib.sha256(src).hexdigest())
#   exec(compile(src, 'prepare-last-page-colab.py', 'exec')); prepare(REPO_SHA)
import hashlib, json, os, pathlib, subprocess, tarfile, urllib.request

DECISION_ID = 'national-pq-lastpage-20261031-v1'
NATIONAL = '/content/drive/MyDrive/Data Handover/National/v1.1'
PACK = pathlib.Path(NATIONAL + '/file to ingest/NTER_citation_pack_v1.1_2026-10-05.zip')
OUT = pathlib.Path(NATIONAL + '/staging/pq-lastpage-01/prepare')
W = pathlib.Path('/content/nter-pq-lastpage')
REPO = W / 'niyantran'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
HERE = 'docs/operations/national-pq-batch'
MAIN_SHA = 'e15843463809bb6698347689762dd4e76a9bd1e4'   # main at PR #77: the importer and shared code must be byte-identical
OPEN_KEYS_SHA = '6655391450c0eecbfcb693781f436912d6196f90f20b89a54db5c9b6d5e16092'   # open-answer-keys.txt (793 keys, read 2026-10-30 by open-answer-keys.sql)


class Stop(Exception):
    pass


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def setup(repo_sha):
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        subprocess.run(['git', 'init', '-q', str(REPO)], check=True)
        subprocess.run(['git', '-C', str(REPO), 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'], check=True)
    for ref in (repo_sha, MAIN_SHA):
        subprocess.run(['git', '-C', str(REPO), 'fetch', '--depth', '1', '-q', 'origin', ref], check=True)
    subprocess.run(['git', '-C', str(REPO), 'checkout', '-q', '-f', repo_sha], check=True)
    if subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip() != repo_sha:
        raise Stop('checkout is not the pinned commit')
    if subprocess.run(['git', '-C', str(REPO), 'diff', '--quiet', MAIN_SHA, 'HEAD', '--', 'scripts', 'supabase']).returncode != 0:
        raise Stop('scripts/ or supabase/ differ from main e158434')
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha(tgz) != NODE_SHA:
            raise Stop('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)


def prepare(repo_sha):
    setup(repo_sha)
    if sha(REPO / HERE / 'remainder-cohort' / 'open-answer-keys.txt') != OPEN_KEYS_SHA:
        raise Stop('open-answer-keys.txt is not the reviewed list')
    if OUT.exists() and any(OUT.iterdir()):
        raise Stop(f'{OUT} already holds a preparation; it is never overwritten')
    build = W / 'build'
    subprocess.run(['rm', '-rf', str(build)], check=True)
    r = subprocess.run(['python3', '-I', '-B', str(REPO / HERE / 'pq-last-page-cohort.py'), 'prepare', '--pack', str(PACK),
                        '--open-keys', str(REPO / HERE / 'remainder-cohort' / 'open-answer-keys.txt'),
                        '--exclude-cohort', str(REPO / HERE / 'remainder-cohort' / 'cohort.json'),
                        '--decision-id', DECISION_ID, '--out', str(build)], capture_output=True, text=True)
    print(r.stdout[-2000:], r.stderr[-2000:])
    if r.returncode != 0:
        raise Stop('preparation refused; nothing staged')
    dry = build / 'dry-run.jsonl'
    r = subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(build / 'corpus.jsonl'),
                        '--decisions', str(build / 'decisions.jsonl'), '--report', str(dry)], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop('dry run failed: ' + r.stderr[-600:])
    rows = [json.loads(l) for l in dry.read_text().splitlines() if l.strip()]
    chunks = {x['source_key']: x.get('chunks') for x in rows if x.get('source_key')}
    status = {x['source_key']: x.get('status') for x in rows if x.get('source_key')}
    with open(build / 'review.tsv', 'w') as f:   # compact, no text: key, text hash, stem, chunks, dry-run status
        for line in (build / 'plan.tsv').read_text().splitlines():
            k, t, stem = line.split('\t')
            f.write(f'{k}\t{t}\t{stem}\t{chunks.get(k)}\t{status.get(k)}\n')
    meta = json.loads((build / 'cohort.json').read_text())
    summary = {'repo_sha': repo_sha, 'main_sha': MAIN_SHA, 'decision_id': DECISION_ID,
               'prepare_script_sha256': sha(REPO / HERE / 'pq-last-page-cohort.py'),
               'exclude_cohort_sha256': sha(REPO / HERE / 'remainder-cohort' / 'cohort.json'),
               'open_keys_sha256': sha(REPO / HERE / 'remainder-cohort' / 'open-answer-keys.txt'),
               **{k: meta[k] for k in ('count', 'candidates', 'held', 'hold_reasons', 'excluded_answers', 'member_sha256',
                                       'pack_records', 'near_duplicate_registry', 'cohort_corpus_sha256', 'decisions_sha256')},
               'dry_run': rows[-1], 'files_sha256': {n: sha(build / n) for n in ('corpus.jsonl', 'decisions.jsonl', 'cohort.json',
                                                                                  'holds.json', 'checks.txt', 'review.tsv', 'dry-run.jsonl')}}
    (build / 'summary.json').write_text(json.dumps(summary, indent=1))
    OUT.mkdir(parents=True, exist_ok=True)
    for n in ('corpus.jsonl', 'decisions.jsonl', 'cohort.json', 'holds.json', 'checks.txt', 'review.tsv', 'dry-run.jsonl', 'summary.json'):
        (OUT / n).write_bytes((build / n).read_bytes())
    print(json.dumps({k: summary[k] for k in ('count', 'candidates', 'held', 'hold_reasons', 'decisions_sha256')}, indent=1))
    print('dry run:', json.dumps(rows[-1]))
    print('PREPARED. Nothing was submitted. Tell Claude "prepared"; the developers review before any approval.')
