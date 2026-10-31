# Lok Sabha last_page_empty cohort (113 answers): ONE submission, then stop. Google Colab, Python 3.
#
# Status: Living (2026-10-30). Runs only after the developers have reviewed it and the owner has approved, in writing,
# the exact manifest hash below (rule 1). It never chains to another cohort (rule 2). Limits come from the reviewed dry
# run: --max-chunks 1400 --max-estimated-cost-usd 0.09 (rule 3). Rule 7: the person running it signs in on nter.pro with
# their own admin account and types that session's access token at the prompt; it is never stored or printed, and no
# password is used. One token covers the whole run: the script refuses to start unless the token has at least
# MIN_TOKEN_MINUTES left (expected run time about 35 minutes), reading only the token's own expiry claim.
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file on task/client-corpus-claude-2026-10-29>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/last-page-cohort/run-last-page-cohort.py').read()
#   print(hashlib.sha256(src).hexdigest())   # compare with the hash in the approval message before running
#   exec(compile(src, 'run-last-page-cohort.py', 'exec')); run(REPO_SHA)
#
# A 113-answer run takes about 8-12 minutes; a token may still expire mid-run. If the importer stops on an uncertain outcome
# (exit 2), the script records the status and stops; nothing is retried. The only remedy is resume(REPO_SHA), after the
# owner's written decision, with a fresh owner token: it re-runs the importer's own idempotent submission of the same
# approved manifest into the next report (already registered answers come back as existing). Never a hand-typed cell.
# resume() refuses unless the last submission recorded exit 2. The launch commit is the merge commit the developers give.
import base64, getpass, hashlib, json, os, pathlib, re, subprocess, tarfile, time, urllib.request

APPROVED_MANIFEST = '17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005'   # decisions.jsonl sha256
COHORT_CORPUS = '2958bbaabc261704fa0cd9d7b89708ca2e6b19c0f56b5484d2026fbd6348efe4'       # rebuilt corpus.jsonl sha256
OPEN_KEYS = '6655391450c0eecbfcb693781f436912d6196f90f20b89a54db5c9b6d5e16092'            # open-answer-keys.txt sha256
DECISION_ID = 'national-pq-lastpage-20261031-v1'
DOCS, CHUNKS, MAX_CHUNKS, MAX_COST_USD = 113, 1390, 1400, 0.09
MIN_TOKEN_MINUTES = 50
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
NATIONAL = '/content/drive/MyDrive/Data Handover/National/v1.1'
PACK = pathlib.Path(NATIONAL + '/file to ingest/NTER_citation_pack_v1.1_2026-10-05.zip')
ST = pathlib.Path(NATIONAL + '/staging/pq-lastpage-01')
W = pathlib.Path('/content/nter-pq-lastpage')
REPO = W / 'niyantran'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
HERE = 'docs/operations/national-pq-batch'
MAIN_SHA = 'e15843463809bb6698347689762dd4e76a9bd1e4'   # main at PR #77: the importer and shared code must be byte-identical


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
        rows = [json.loads(l) for l in f if l.strip()]
    return rows[-1] if rows else None


def importer(args, env=None):
    return subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', *args], cwd=REPO,
                          env=env, capture_output=True, text=True)


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
        raise Stop('scripts/ or supabase/ differ from main e158434: refusing to submit with changed shared code')
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha(tgz) != NODE_SHA:
            raise Stop('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)
    here = REPO / HERE / 'last-page-cohort'
    if sha(here / 'decisions.jsonl') != APPROVED_MANIFEST or sha(here / 'open-answer-keys.txt') != OPEN_KEYS:
        raise Stop('committed manifest or open-answer list is not the approved one')


def token_env():
    """The runner's own nter.pro session token (rule 7): typed, never stored, never printed. Only its expiry is read."""
    env = dict(os.environ)
    from google.colab import userdata
    env['SUPABASE_PUBLISHABLE_KEY'] = userdata.get('SUPABASE_PUBLISHABLE_KEY')
    tok = getpass.getpass('Access token of your own nter.pro admin session, for this run only: ').strip()
    if not env['SUPABASE_PUBLISHABLE_KEY'] or not tok:
        raise Stop('publishable key or access token missing')
    try:
        part = tok.split('.')[1]
        exp = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))['exp']
    except Exception:
        raise Stop('that does not look like a session access token') from None
    left = (exp - time.time()) / 60
    print(f'token valid for about {left:.0f} more minutes')
    if left < MIN_TOKEN_MINUTES:
        raise Stop(f'token has under {MIN_TOKEN_MINUTES} minutes left: sign out and in again on nter.pro, copy a fresh token, re-run')
    env['NTER_INGEST_ACCESS_TOKEN'] = tok
    return env


def submit(n, env):
    """One importer submission into submit-<n>.jsonl. Its status file is always written (try/finally), in exclusive mode."""
    report, status = ST / f'submit-{n}.jsonl', ST / f'submit-{n}-status.json'
    if report.exists() or status.exists():
        raise Stop(f'{report.name} or {status.name} exists; reports are never overwritten')
    out = {'exit': None, 'report_sha256': None, 'summary': None, 'stderr_tail': ''}
    try:
        r = importer(['--corpus', str(ST / 'corpus.jsonl'), '--decisions', str(ST / 'decisions.jsonl'), '--report', str(report),
                      '--submit', '--approval', APPROVED_MANIFEST, '--target', TARGET,
                      '--max-chunks', str(MAX_CHUNKS), '--max-estimated-cost-usd', str(MAX_COST_USD)], env)
        out['exit'], out['stderr_tail'] = r.returncode, (r.stderr[-300:] if r.returncode else '')
    finally:
        env.pop('NTER_INGEST_ACCESS_TOKEN', None)
        if report.exists():
            out['report_sha256'], out['summary'] = sha(report), last(report)
        with open(status, 'x') as f:
            f.write(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    print('STOP. Report the result to the owner; indexing, verification and website acceptance follow. No further cohort.')


def run(repo_sha):
    setup(repo_sha)
    ST.mkdir(parents=True, exist_ok=True)
    if any(ST.glob('submit-*')):
        raise Stop(f'{ST} already holds a submission report: reconcile it with the owner; never resubmit from here')
    # Rebuild the cohort from the pinned pack; it must reproduce the approved manifest and corpus exactly.
    build = W / 'build'
    subprocess.run(['rm', '-rf', str(build)], check=True)
    r = subprocess.run(['python3', '-I', '-B', str(REPO / HERE / 'pq-last-page-cohort.py'), 'prepare', '--pack', str(PACK),
                        '--open-keys', str(REPO / HERE / 'remainder-cohort' / 'open-answer-keys.txt'),
                        '--exclude-cohort', str(REPO / HERE / 'remainder-cohort' / 'cohort.json'),
                        '--over-limit', str(REPO / HERE / 'last-page-cohort' / 'over-limit-keys.txt'),
                        '--decision-id', DECISION_ID, '--out', str(build)], capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop('rebuild refused: ' + (r.stdout + r.stderr)[-600:])
    if sha(build / 'decisions.jsonl') != APPROVED_MANIFEST or sha(build / 'corpus.jsonl') != COHORT_CORPUS:
        raise Stop('rebuilt cohort does not reproduce the approved manifest')
    for n in ('corpus.jsonl', 'decisions.jsonl', 'cohort.json'):
        if not (ST / n).exists():
            (ST / n).write_bytes((build / n).read_bytes())
    if sha(ST / 'decisions.jsonl') != APPROVED_MANIFEST or sha(ST / 'corpus.jsonl') != COHORT_CORPUS:
        raise Stop('staged cohort differs from the approved manifest')
    # Offline dry run again: must equal the reviewed counts.
    dry = ST / 'dry-run-colab.jsonl'
    if dry.exists():
        dry.unlink()
    r = importer(['--corpus', str(ST / 'corpus.jsonl'), '--decisions', str(ST / 'decisions.jsonl'), '--report', str(dry)])
    if r.returncode != 0:
        raise Stop('dry run failed: ' + r.stderr[-400:])
    s = last(dry)
    if not s or (s['manifest_sha256'], s['ready'], s['held'], s['chunks']) != (APPROVED_MANIFEST, DOCS, 0, CHUNKS) \
            or s['estimated_cost_ceiling_usd'] > MAX_COST_USD:
        raise Stop(f'dry run differs from the approved cohort: {s}')
    print('dry run equals the approved cohort:', json.dumps(s))
    submit(1, token_env())


def resume(repo_sha):
    """Only after an uncertain stop (exit 2) and the owner's written decision to finish the same approved manifest."""
    setup(repo_sha)
    numbers = sorted({int(m.group(1)) for p in ST.glob('submit-*') for m in [re.fullmatch(r'submit-(\d+)(?:\.jsonl|-status\.json)', p.name)] if m})
    if not numbers:
        raise Stop('nothing to resume: no submission report exists')
    n = numbers[-1]
    status = ST / f'submit-{n}-status.json'
    if not status.exists():
        raise Stop(f'submit-{n} has no status file: treat it as uncertain and report it to the owner and developers; '
                   'resume() does not run without a recorded exit 2')
    code = json.loads(status.read_text()).get('exit')
    if code != 2:
        raise Stop(f'resume() runs only after an uncertain stop (exit 2); submit-{n} exited {code}: report and stop')
    if sha(ST / 'decisions.jsonl') != APPROVED_MANIFEST or sha(ST / 'corpus.jsonl') != COHORT_CORPUS:
        raise Stop('staged cohort differs from the approved manifest: resume refused')
    submit(n + 1, token_env())
