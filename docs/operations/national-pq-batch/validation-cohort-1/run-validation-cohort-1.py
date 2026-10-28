# Validation cohort 1 (100 Lok Sabha answers): ONE submission, then stop. Google Colab, Python 3.
#
# Status: Living (2026-10-29). Runs only after the owner has approved, in writing, the exact manifest hash below
# (rule 1). It never chains to another cohort (rule 2), states --max-chunks 2000 and --max-estimated-cost-usd 0.05
# (rule 3), and uses a short-lived platform-admin access token that the owner issues for this run and types at the
# prompt; nothing is read from stored secrets except the public publishable key, and no password is used (rule 7).
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file on task/client-corpus-claude-2026-10-29>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/validation-cohort-1/run-validation-cohort-1.py').read()
#   print(hashlib.sha256(src).hexdigest())   # compare with the hash in the approval message before running
#   exec(compile(src, 'run-validation-cohort-1.py', 'exec')); run(REPO_SHA)
import getpass, hashlib, json, os, pathlib, subprocess, tarfile, urllib.request

APPROVED_MANIFEST = 'a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c'   # decisions.jsonl sha256
COHORT_CORPUS = '521d434c35072915e36988d77bc828690c6fec1c60bf18c036b1518e6ec4c8eb'       # rebuilt corpus.jsonl sha256
SOURCE_CORPUS = '44704d71a67d771217b0fec969cae639b145b0711300d2bade987a999c23652b'       # pq-batch-06/T5/corpus.jsonl
DECISION_ID = 'national-pq-validation-20261029-v100'
DOCS, CHUNKS, MAX_CHUNKS, MAX_COST_USD = 100, 829, 2000, 0.05
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
NATIONAL = '/content/drive/MyDrive/Data Handover/National/v1.1'
SRC = pathlib.Path(NATIONAL + '/staging/pq-batch-06/T5/corpus.jsonl')
ST = pathlib.Path(NATIONAL + '/staging/pq-validation-01')
W = pathlib.Path('/content/nter-pq-validation')
REPO = W / 'niyantran'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
HERE = 'docs/operations/national-pq-batch'


class Stop(Exception):
    pass


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def last(report):
    with open(report) as f:
        return [json.loads(l) for l in f][-1]


def importer(args, env=None):
    return subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', *args], cwd=REPO,
                          env=env, capture_output=True, text=True)


def run(repo_sha):
    # 1. Pinned code, pinned Node.
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        subprocess.run(['git', 'init', '-q', str(REPO)], check=True)
        subprocess.run(['git', '-C', str(REPO), 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'], check=True)
    subprocess.run(['git', '-C', str(REPO), 'fetch', '--depth', '1', '-q', 'origin', repo_sha], check=True)
    subprocess.run(['git', '-C', str(REPO), 'checkout', '-q', '-f', 'FETCH_HEAD'], check=True)
    if subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip() != repo_sha:
        raise Stop('checkout is not the pinned commit')
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha(tgz) != NODE_SHA:
            raise Stop('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)
    if sha(REPO / HERE / 'validation-cohort-1' / 'decisions.jsonl') != APPROVED_MANIFEST:
        raise Stop('committed manifest is not the approved one')

    # 2. Rebuild the cohort input from the staged batch-6 T5 corpus; it must reproduce the approved manifest exactly.
    if sha(SRC) != SOURCE_CORPUS:
        raise Stop('source corpus changed')
    ST.mkdir(parents=True, exist_ok=True)
    if any(ST.glob('submit-*.jsonl')):
        raise Stop(f'{ST} already holds a submission report: reconcile it with the owner; never resubmit from here')
    build = W / 'build'
    if build.exists():
        subprocess.run(['rm', '-rf', str(build)], check=True)
    subprocess.run(['python3', '-I', str(REPO / HERE / 'pq-validation-cohort.py'), 'prepare', '--corpus', str(SRC),
                    '--expect-corpus-sha256', SOURCE_CORPUS, '--keys', str(REPO / HERE / 'validation-cohort-1' / 'candidate-keys.txt'),
                    '--count', str(DOCS), '--decision-id', DECISION_ID, '--out', str(build)], check=True)
    if sha(build / 'decisions.jsonl') != APPROVED_MANIFEST or sha(build / 'corpus.jsonl') != COHORT_CORPUS:
        raise Stop('rebuilt cohort does not reproduce the approved manifest')
    for n in ('corpus.jsonl', 'decisions.jsonl', 'cohort.json'):
        if not (ST / n).exists():
            (ST / n).write_bytes((build / n).read_bytes())
    if sha(ST / 'decisions.jsonl') != APPROVED_MANIFEST or sha(ST / 'corpus.jsonl') != COHORT_CORPUS:
        raise Stop('staged cohort differs from the approved manifest')

    # 3. Offline dry run again: must equal the reviewed counts.
    dry = ST / 'dry-run-colab.jsonl'
    if dry.exists():
        dry.unlink()
    r = importer(['--corpus', str(ST / 'corpus.jsonl'), '--decisions', str(ST / 'decisions.jsonl'), '--report', str(dry)])
    if r.returncode != 0:
        raise Stop('dry run failed: ' + r.stderr[-400:])
    s = last(dry)
    if (s['manifest_sha256'], s['ready'], s['held'], s['chunks']) != (APPROVED_MANIFEST, DOCS, 0, CHUNKS) \
            or s['estimated_cost_ceiling_usd'] > MAX_COST_USD:
        raise Stop(f'dry run differs from the approved cohort: {s}')
    print('dry run equals the approved cohort:', json.dumps(s))

    # 4. The owner's short-lived token for this run; typed, never stored, never printed.
    env = dict(os.environ)
    from google.colab import userdata
    env['SUPABASE_PUBLISHABLE_KEY'] = userdata.get('SUPABASE_PUBLISHABLE_KEY')
    env['NTER_INGEST_ACCESS_TOKEN'] = getpass.getpass('Short-lived platform-admin access token for this run: ').strip()
    if not env['SUPABASE_PUBLISHABLE_KEY'] or not env['NTER_INGEST_ACCESS_TOKEN']:
        raise Stop('publishable key or access token missing')

    # 5. One submission. The importer re-checks limits before any request and stops on the first uncertain outcome.
    report = ST / 'submit-1.jsonl'
    r = importer(['--corpus', str(ST / 'corpus.jsonl'), '--decisions', str(ST / 'decisions.jsonl'), '--report', str(report),
                  '--submit', '--approval', APPROVED_MANIFEST, '--target', TARGET,
                  '--max-chunks', str(MAX_CHUNKS), '--max-estimated-cost-usd', str(MAX_COST_USD)], env)
    env.pop('NTER_INGEST_ACCESS_TOKEN', None)
    out = {'exit': r.returncode, 'report_sha256': sha(report) if report.exists() else None,
           'summary': last(report) if report.exists() else None, 'stderr_tail': r.stderr[-300:] if r.returncode else ''}
    (ST / 'submit-1-status.json').write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    print('STOP. Report the result to the owner; indexing, verification and website acceptance follow. No further cohort.')
