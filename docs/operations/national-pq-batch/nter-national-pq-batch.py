raise SystemExit('DISABLED 2026-10-29 (owner rules 2 and 7): this driver signs in with a stored password (Colab Secrets) and run_section() chains batches. Kept only as the provenance of PQ batches 1-6; see docs/operations/national-pq-batch/README.md. Use validation-cohort-1/run-validation-cohort-1.py.')
# NTER National: ONE batch of up to 1,000 Lok Sabha question answers from the National citation pack v1.1, then stop.
# Owner: Tamanesh Kauri, 2026-10-27 15:57 IST ("Start with 1,000 parliamentary questions ... Do a batch of 1,000 and stop").
# Route: the existing supplied-text connection (admin-ingest register_text -> ingest queue at index, no OCR), extended to
# national / Parliamentary Question Database by 20261027120000_supplied_text_national_questions (owner approved the
# route the same day). The dedicated ingestion account signs in from Colab Secrets (NTER_INGEST_EMAIL,
# NTER_INGEST_PASSWORD, SUPABASE_PUBLISHABLE_KEY); the short-lived access token lives only in this process's
# environment for one step and is never printed, saved or logged; the refresh token is discarded.
#   MODE = 'plan'   live read -> screen every record -> holds -> probe dry run (exact chunks) -> 1,000 selected ->
#                   5 tranches finalized -> offline dry run per tranche -> plan.json + ledger (status planned). No writes.
#   MODE = 'submit' per tranche: presence check -> submit (resume an incomplete submission by re-reading the database)
#                   -> wait for indexing -> per-document verification (text hash, chunks, vectors, section, URL, desk row)
#                   -> ledger (status verified). Stops at the end of the batch.
#   run_section()   batches 2, 3, ... (owner, 2026-10-27 21:10 IST: "Go ahead and keep doing all in this section"):
#                   each batch is planned, dry-run and submitted exactly as above, from what is still eligible after the
#                   earlier batches; a batch's registrations also drive the indexing of the one before, which is verified
#                   as soon as it is fully indexed. A failed verification stops new submissions. The run ends when no
#                   eligible answer remains; held answers stay held.
# Any deviation stops with the reason in status.json; reports are never overwritten; every step is resumable.
import base64, csv, glob, gzip, hashlib, http.client, io, json, os, pathlib, re, subprocess, tarfile, time, urllib.error, urllib.parse, urllib.request, zipfile
from collections import Counter

REPO_SHA = None  # set by the launching cell (the commit this file was fetched from)
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NATIONAL = '/content/drive/MyDrive/Data Handover/National/v1.1'
ZIP = NATIONAL + '/file to ingest/NTER_citation_pack_v1.1_2026-10-05.zip'
ZIP_BYTES, ZIP_SHA = 252355253, '459b354cb64360655877187c42566b07a21de579e8b97beb49df9117b16dc9b8'
MEMBER = 'citation_pack_v1/documents/parliamentary_questions.jsonl.gz'
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
BATCH = 1
DECISION = 'owner-authorized-20261027-national-pq-b01'
APPROVER = 'Tamanesh Kauri (chat, 2026-10-27 15:57 IST: one batch of 1,000 parliamentary questions, then stop)'
DOCS, TRANCHE, PROBE = 1000, 200, 1150
MAX_BATCH_CEILING_USD = 2.50
INDEX_TIMEOUT_MIN = 360
ST = pathlib.Path(NATIONAL + '/staging/pq-batch-01')
W = pathlib.Path('/content/nter-national-pq')
REPO = W / 'niyantran'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
LAW_CORE = ('docs/operations/law-autopilot/nter-law-autopilot-core.py', '19299c5248128240b18e5134f2929cddfe60658f7e79d88d040d44cf96defe63')
PQ_CORE = 'docs/operations/national-pq-batch/nter-national-pq-core.py'


class Stop(Exception):
    pass


class Exhausted(Exception):
    """No eligible answer remains in the pack (everything else is stored or held)."""


def configure(n, approver=None):
    """Point the driver at batch n: its decision prefix and its own staging folder."""
    global BATCH, DECISION, ST, APPROVER
    BATCH, DECISION = n, f'owner-authorized-20261027-national-pq-b{n:02d}'
    ST = pathlib.Path(NATIONAL + f'/staging/pq-batch-{n:02d}')
    if approver:
        APPROVER = approver


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def write_json(p, obj):
    p = pathlib.Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp'); tmp.write_text(json.dumps(obj, indent=1, default=str)); tmp.replace(p)


def load_state():
    p = ST / 'status.json'
    return json.loads(p.read_text()) if p.exists() else {'started_at': now(), 'approver': APPROVER, 'decision': DECISION, 'manifests': {}, 'tranches': {}}


def save_state(s):
    write_json(ST / 'status.json', s)


def status(**kw):
    s = load_state()
    s.setdefault('log', []).append({'at': now(), **kw}); s['log'] = s['log'][-400:]; s['last'] = {'at': now(), **kw}
    save_state(s)
    print(json.dumps({'at': now(), **kw}, default=str)[:900], flush=True)


# ─── setup ──────────────────────────────────────────────────────────────────
C = P_ = None  # Law core (MinHash, holds helpers, paging) and National question core


def _load(path, want=None):
    b = (REPO / path).read_bytes()
    if want and hashlib.sha256(b).hexdigest() != want:
        raise Stop(f'{path} hash mismatch')
    m = {'__name__': pathlib.Path(path).stem.replace('-', '_')}
    exec(compile(b, path, 'exec'), m)
    return type('Mod', (), m)


def setup(repo_sha):
    global C, P_, REPO_SHA
    REPO_SHA = repo_sha
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    if os.path.getsize(ZIP) != ZIP_BYTES:
        raise Stop('citation pack size changed')
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        subprocess.run(['git', 'init', '-q', str(REPO)], check=True)
        subprocess.run(['git', '-C', str(REPO), 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'], check=True)
    subprocess.run(['git', '-C', str(REPO), 'fetch', '--depth', '1', '-q', 'origin', REPO_SHA], check=True)
    subprocess.run(['git', '-C', str(REPO), 'checkout', '-q', '-f', 'FETCH_HEAD'], check=True)
    if subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip() != REPO_SHA:
        raise Stop('repository checkout is not the pinned commit')
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha(tgz) != NODE_SHA:
            raise Stop('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)
    C = _load(*LAW_CORE)
    P_ = _load(PQ_CORE)
    ST.mkdir(parents=True, exist_ok=True)
    load_secrets()


# ─── credentials (Colab Secrets; nothing typed, printed or stored) ─────────
_SECRETS = {}


def load_secrets():
    from google.colab import userdata
    try:
        vals = {k: userdata.get(k) for k in ('SUPABASE_PUBLISHABLE_KEY', 'NTER_INGEST_EMAIL', 'NTER_INGEST_PASSWORD')}
    except Exception as e:
        raise Stop(f'Colab Secrets not readable ({type(e).__name__}); add them and enable notebook access')
    key, role = vals['SUPABASE_PUBLISHABLE_KEY'] or '', None
    if key.count('.') == 2:
        try:
            p = key.split('.')[1]; role = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4))).get('role')
        except Exception:
            role = 'unreadable'
    if not (key.startswith('sb_publishable_') or role == 'anon'):
        raise Stop('SUPABASE_PUBLISHABLE_KEY must be the publishable (anon) key, never a secret or service key')
    if not vals['NTER_INGEST_EMAIL'] or not vals['NTER_INGEST_PASSWORD']:
        raise Stop('NTER_INGEST_EMAIL / NTER_INGEST_PASSWORD secrets are empty')
    _SECRETS.clear(); _SECRETS.update(vals)


def sign_in():
    key = _SECRETS['SUPABASE_PUBLISHABLE_KEY']
    req = urllib.request.Request(TARGET + '/auth/v1/token?grant_type=password', method='POST',
                                 data=json.dumps({'email': _SECRETS['NTER_INGEST_EMAIL'], 'password': _SECRETS['NTER_INGEST_PASSWORD']}).encode(),
                                 headers={'apikey': key, 'Content-Type': 'application/json'})
    body = None
    for attempt in range(4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=60).read()); break
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 3:
                raise Stop(f'ingestion account sign-in failed: HTTP {e.code}')
        except (urllib.error.URLError, http.client.HTTPException, OSError, json.JSONDecodeError) as e:
            if attempt == 3:
                raise Stop(f'ingestion account sign-in failed: {type(e).__name__}')
        time.sleep(15 * (attempt + 1))
    tok = body.get('access_token')
    if not tok or tok.count('.') != 2:
        raise Stop('sign-in returned no access token')
    os.environ['NTER_INGEST_ACCESS_TOKEN'] = tok
    os.environ['SUPABASE_PUBLISHABLE_KEY'] = key
    body.clear()  # the refresh token is discarded with the response


def forget_creds():
    for k in ('NTER_INGEST_ACCESS_TOKEN', 'SUPABASE_PUBLISHABLE_KEY'):
        os.environ.pop(k, None)


def token_minutes_left():
    try:
        p = os.environ['NTER_INGEST_ACCESS_TOKEN'].split('.')[1]
        return round((json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))['exp'] - time.time()) / 60, 1)
    except Exception:
        return None


def rest_get(path):
    req = urllib.request.Request(TARGET + path, headers={'apikey': os.environ['SUPABASE_PUBLISHABLE_KEY'],
                                                         'Authorization': 'Bearer ' + os.environ['NTER_INGEST_ACCESS_TOKEN']})
    for attempt in range(5):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 4:
                raise Stop(f'read {path.split("?")[0]} failed: HTTP {e.code}')
        except (urllib.error.URLError, http.client.HTTPException, OSError, json.JSONDecodeError) as e:
            if attempt == 4:
                raise Stop(f'read {path.split("?")[0]} failed: {type(e).__name__}')
        time.sleep(15 * (attempt + 1))


def signed(fn, *a):
    sign_in()
    try:
        return fn(*a)
    finally:
        forget_creds()


# ─── live reads ────────────────────────────────────────────────────────────
def live_national():
    docs = C.rest_pages(rest_get, 'documents', {'select': 'id,source_key,file_url,file_name,content_sha256,desk_feature',
                                                 'desk_tier': 'eq.national', 'order': 'id'})
    rows = C.rest_pages(rest_get, 'desk_rows', {'select': 'row_key,row', 'tier': 'eq.national', 'feature': 'eq.' + P_.FEATURE,
                                                 'order': 'row_key'})
    pq = [d['source_key'] for d in docs if d.get('desk_feature') == P_.FEATURE]
    texts = []
    for i in range(0, len(pq), 25):
        texts += rest_get('/rest/v1/documents?' + urllib.parse.urlencode(
            {'select': 'source_key,content_sha256,ocr_text', 'source_key': C.in_filter(pq[i:i + 25])}, safe='(),.*:'))
    for t in texts:
        if hashlib.sha256((t.get('ocr_text') or '').encode()).hexdigest() != t.get('content_sha256'):
            raise Stop(f"stored text hash mismatch for {t['source_key'][-16:]}")
    return docs, {str(r['row_key']): r['row'] for r in rows}, texts


def pack_records():
    if sha(ZIP) != ZIP_SHA:
        raise Stop('citation pack sha256 changed')
    zf = zipfile.ZipFile(ZIP)
    man = json.loads(zf.read('citation_pack_v1/manifest.json'))
    want = json.dumps(man)  # the manifest lists every member's sha256; the question file must match it
    data = zf.read(MEMBER)
    got = hashlib.sha256(data).hexdigest()
    if got not in want:
        raise Stop('parliamentary_questions.jsonl.gz does not match the pack manifest')
    recs = [json.loads(l) for l in gzip.decompress(data).decode('utf-8').splitlines() if l.strip()]
    return recs, got


# ─── importer ──────────────────────────────────────────────────────────────
def importer(corpus, decisions, report, *extra):
    if os.path.exists(report):
        raise Stop(f'{report} exists; reports are never overwritten')
    r = subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', '--corpus', str(corpus),
                        '--decisions', str(decisions), '--report', str(report), '--target', TARGET, *extra],
                       cwd=REPO, capture_output=True, text=True, env=os.environ)
    rows = [json.loads(l) for l in open(report)] if os.path.exists(report) else []
    if r.returncode not in (0, 2):
        status(event='importer exit', exit=r.returncode, report=os.path.basename(str(report)), stderr=r.stderr[-400:])
    return r.returncode, rows


def write_set(d, recs, decision_prefix):
    """Corpus (supplied-text lines) and decisions for a list of pack records; the corpus hash is bound in each decision."""
    d.mkdir(parents=True, exist_ok=True)
    corpus, man = d / 'corpus.jsonl', d / 'decisions.jsonl'
    if not corpus.exists():
        with open(str(corpus) + '.tmp', 'w', encoding='utf-8') as fh:
            for r in recs:
                fh.write(json.dumps(P_.supplied_record(r), ensure_ascii=False) + '\n')
        os.replace(str(corpus) + '.tmp', corpus)
    fsha = sha(corpus)
    if not man.exists():
        body = ''.join(json.dumps(P_.decision(r, f'{decision_prefix}-{i:04d}', fsha)) + '\n' for i, r in enumerate(recs, 1))
        with open(man, 'x') as fh:
            fh.write(body)
    keys = [json.loads(l)['source_key'] for l in man.read_text().splitlines() if l.strip()]
    if keys != [r['source_key'] for r in recs]:
        raise Stop(f'{man} does not hold the planned keys')
    s = load_state()
    if s['manifests'].setdefault(str(man), sha(man)) != sha(man):
        raise Stop(f'{man} changed since it was recorded')
    save_state(s)
    return corpus, man


# ─── plan ──────────────────────────────────────────────────────────────────
def plan():
    if (ST / 'plan.json').exists():
        return json.loads((ST / 'plan.json').read_text())
    import numpy as np
    recs, member_sha = pack_records()
    docs, rows, texts = signed(live_national)
    db = {'keys': {d['source_key'] for d in docs}, 'urls': {d['file_url'] for d in docs if d.get('file_url')},
          'file_names': {d['file_name'] for d in docs if d.get('file_name')}}
    status(event='live read', national_docs=len(docs), question_rows=len(rows), question_docs=len(texts), pack_records=len(recs))
    reg = {'sigs': np.zeros((0, C.NPERM), dtype=np.uint64), 'ns': np.array([]), 'meta': [], 'sh': []}
    for t in texts:
        sh = C.shingles(t['ocr_text'])
        C.reg_add(reg, t['source_key'], '', '', '', C.minhash(sh), len(sh), sh)
    holds, elig, examples = Counter(), [], {}
    for r in P_.screen_order(recs):
        reasons = P_.record_holds(r, db, rows)
        if not reasons:
            u, cit = P_.url_parts(r['file_url']), r['citation']
            c = {'case_number': f"LS:{u['session']}:{u['prefix']}:{u['number']}", 'order_date': P_.iso(cit.get('answered_on')) or '',
                 'file_url': r['file_url']}
            sh = C.shingles(r['text']); sig = C.minhash(sh)
            hit = C.similar_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
            if hit:
                reasons.append('near-duplicate text of ' + hit['key'][-16:] + f" (containment {hit['containment']})")
            else:
                hit = C.contained_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
                if hit:
                    reasons.append('contained in a same-date answer ' + hit['key'][-16:] + f" (containment {hit['containment']})")
            C.reg_add(reg, r['source_key'], c['case_number'], c['order_date'], '', sig, len(sh), sh)
        for x in reasons:
            g = x.split(' of ')[0].split(' (')[0] if x.startswith(('near-duplicate', 'contained')) else x
            holds[g] += 1
            if len(examples.setdefault(g, [])) < 5:
                examples[g].append(r['source_key'][-16:])
        if not reasons:
            elig.append(r)
    status(event='screened', eligible=len(elig), holds=dict(holds))
    # exact chunk counts from the importer's own offline dry run over a probe set, then the size limit
    probe, chunks = elig[:PROBE], {}
    for i in range(0, len(probe), 1000):
        d = ST / f'probe-{i // 1000 + 1}'
        corpus, man = write_set(d, probe[i:i + 1000], f'{DECISION}-probe{i // 1000 + 1}')
        rpt = d / 'dry-run.jsonl'
        rows_ = [json.loads(l) for l in open(rpt)] if rpt.exists() else importer(corpus, man, rpt)[1]
        for x in rows_:
            if x.get('source_key'):
                chunks[x['source_key']] = x.get('chunks') if x.get('status') == 'ready' else None
                if x.get('status') != 'ready':
                    holds['adapter: ' + str(x.get('reason'))] += 1
    sel = []
    for r in probe:
        n = chunks.get(r['source_key'])
        if n is None:
            continue
        if n > P_.MAX_CHUNKS:
            holds['over answer-read limits'] += 1; continue
        if len(sel) < DOCS:
            sel.append(r)
    if len(sel) < DOCS and len(elig) > len(probe):
        raise Stop(f'only {len(sel)} eligible documents in the probe; widen PROBE')
    if not sel:
        raise Exhausted()
    T = {}
    for ti in range(0, len(sel), TRANCHE):
        t = f'T{ti // TRANCHE + 1}'
        rs = sel[ti:ti + TRANCHE]
        T[t] = {'docs': len(rs), 'chunks': sum(chunks[r['source_key']] for r in rs), 'keys': [r['source_key'] for r in rs]}
    plan_rows = {r['source_key']: {'chunks': chunks[r['source_key']], 'text_sha256': r['content_sha256'], 'url': r['file_url'],
                                   'row_keys': [str(l['row_key']) for l in r['links']], 'file_name': r['file_name']} for r in sel}
    P = {'batch': BATCH, 'decision': DECISION, 'approver': APPROVER, 'repo_sha': REPO_SHA, 'pack_sha256': ZIP_SHA, 'member_sha256': member_sha,
         'rules_sha256': P_.RULES_SHA256, 'docs': len(sel), 'chunks': sum(v['chunks'] for v in T.values()), 'tranches': T, 'holds': dict(holds),
         'hold_examples': examples, 'eligible_before_chunking': len(elig), 'pack_records': len(recs),
         'fingerprint_sorted_key_chunks_text': P_.fingerprint((k, v['chunks'], v['text_sha256']) for k, v in plan_rows.items()),
         'plan_rows': plan_rows}
    write_json(ST / 'plan.json', P)
    by_key = {r['source_key']: r for r in sel}
    write_ledger(P, by_key)
    return P, by_key


def write_ledger(P, by_key, live=None):
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=P_.LEDGER_COLUMNS); w.writeheader()
    order = 0
    for t, v in P['tranches'].items():
        for k in v['keys']:
            order += 1
            g = (live or {}).get(k) or {}
            w.writerow(P_.ledger_row(BATCH, t, order, by_key[k], P['plan_rows'][k]['chunks'], g.get('status', 'planned'),
                                     g.get('id', ''), g.get('indexed_at', '')))
    p = ST / f'ledger-national-pq-b{BATCH:02d}.csv'
    tmp = p.with_name(p.name + '.tmp'); tmp.write_text(out.getvalue(), encoding='utf-8'); tmp.replace(p)


def dry_runs(P, by_key):
    total = 0.0
    for t, v in P['tranches'].items():
        d = ST / t
        corpus, man = write_set(d, [by_key[k] for k in v['keys']], f'{DECISION}-{t.lower()}')
        rpt = d / 'dry-run.jsonl'
        rows = [json.loads(l) for l in open(rpt)] if rpt.exists() else importer(corpus, man, rpt)[1]
        s = rows[-1] if rows else {}
        per = {x['source_key']: x.get('chunks') for x in rows if x.get('source_key')}
        off = [k[-16:] for k in v['keys'] if per.get(k) != P['plan_rows'][k]['chunks']]
        if off or not (s.get('ready') == v['docs'] and s.get('held') == 0 and s.get('chunks') == v['chunks']):
            raise Stop(f'{t}: dry run differs (ready {s.get("ready")}/{v["docs"]}, held {s.get("held")}, chunks {s.get("chunks")}/{v["chunks"]}, {len(off)} per-document)')
        v['cost_ceiling'] = s['estimated_cost_ceiling_usd']; v['manifest_sha256'] = sha(man); v['corpus_sha256'] = sha(corpus)
        total += v['cost_ceiling']
    if total > MAX_BATCH_CEILING_USD:
        raise Stop(f'conservative ceiling ${total:.4f} exceeds ${MAX_BATCH_CEILING_USD}')
    P['cost_ceiling_usd'] = round(total, 6)
    write_json(ST / 'plan.json', P)


def records_for(P):
    recs, _ = pack_records()
    keys = set(P['plan_rows'])
    return {r['source_key']: r for r in recs if r['source_key'] in keys}


# ─── submit, wait, verify ──────────────────────────────────────────────────
MAX_SUBMIT_REPORTS, RESUME_PAUSE_S, PRE_WRITE_RETRIES = 5, 120, 3


def docs_for(keys):
    out = {}
    for i in range(0, len(keys), 80):
        for r in rest_get('/rest/v1/documents?' + urllib.parse.urlencode(
                {'select': 'id,source_key,indexed_at,content_sha256,file_url,desk_tier,desk_feature,metadata->>origin',
                 'source_key': C.in_filter(keys[i:i + 80])}, safe='(),*.:>-')):
            out[r['source_key']] = r
    return out


def _summary(path):
    try:
        rows = [json.loads(l) for l in open(path) if l.strip()]
    except Exception:
        return {}
    return rows[-1] if rows and rows[-1].get('type') == 'summary' else {}


def submit_tranche(P, t):
    v, d = P['tranches'][t], ST / t
    while True:
        reports = sorted(glob.glob(str(d / 'submit-*.jsonl')), key=lambda p: int(re.search(r'submit-(\d+)\.jsonl$', p).group(1)))
        if reports:
            s = _summary(reports[-1])
            if s.get('submitted', 0) == v['docs'] and s.get('uncertain') == 0 and s.get('held') == 0 and s.get('registration_held') == 0:
                return
        if len(reports) >= MAX_SUBMIT_REPORTS:
            raise Stop(f'{t}: {len(reports)} submissions without completing; reconcile by hand')
        if reports:
            status(tranche=t, event='resuming an incomplete submission', earlier=os.path.basename(reports[-1]),
                   earlier_summary={k: _summary(reports[-1]).get(k) for k in ('submitted', 'uncertain', 'registration_held', 'held')})
            time.sleep(RESUME_PAUSE_S)
        _submit_once(P, t, v, d, len(reports) + 1, bool(reports))


def _submit_once(P, t, v, d, j, resume):
    sign_in()
    try:
        live = docs_for(v['keys'])
        bad = [k[-16:] for k, g in live.items() if not (resume and g.get('content_sha256') == P['plan_rows'][k]['text_sha256']
                                                        and g.get('origin') == 'supplied-text' and g.get('desk_tier') == 'national'
                                                        and g.get('desk_feature') == P_.FEATURE)]
        write_json(d / f'presence-{j}.json', {'at': now(), 'resume': resume, 'present': len(live), 'mismatch': bad})
        if bad:
            raise Stop(f'{t}: {len(bad)} keys already exist in the database other than as this plan; not submitted')
        forget_creds(); sign_in()
        need = (v['docs'] - len(live)) * 3 / 60 + 10
        if (token_minutes_left() or 0) < need:
            raise Stop(f'{t}: fresh token has {token_minutes_left()} minutes, below the {need:.0f} needed')
        rpt = d / f'submit-{j}.jsonl'
        for attempt in range(PRE_WRITE_RETRIES + 1):
            code, rows = importer(d / 'corpus.jsonl', d / 'decisions.jsonl', rpt, '--submit', '--approval', v['manifest_sha256'],
                                  '--max-chunks', str(v['chunks']), '--max-estimated-cost-usd', str(C.max_cost(v['cost_ceiling'])))
            if not (code == 1 and not os.path.exists(rpt)) or attempt == PRE_WRITE_RETRIES:
                break
            status(tranche=t, event='importer stopped before writing; retrying', attempt=attempt + 1)
            forget_creds(); time.sleep(90 * (attempt + 1)); sign_in()
        s = rows[-1] if rows else {}
        write_json(d / f'submit-{j}-status.json', {'tranche': t, 'exit': code, 'report_sha256': sha(rpt) if rows else None,
                                                   'summary': s, 'resume': resume, 'present_before': len(live)})
        if s.get('registration_held') or s.get('held') or code == 3:
            raise Stop(f'{t}: submission held documents ({s.get("registration_held")} registration, {s.get("held")} held)')
        if s.get('submitted', 0) == v['docs'] and s.get('uncertain') == 0:
            status(tranche=t, event='submitted', docs=v['docs'], chunks=v['chunks'], already_present=len(live), report=rpt.name)
        else:
            status(tranche=t, event='submission incomplete', exit=code, submitted=s.get('submitted'), uncertain=s.get('uncertain'))
    finally:
        forget_creds()


def wait_indexed(P):
    keys, t0 = list(P['plan_rows']), time.time()
    while True:
        got = signed(docs_for, keys)
        done = sum(1 for k in keys if (got.get(k) or {}).get('indexed_at'))
        status(event='indexing', indexed=done, of=len(keys))
        if done == len(keys):
            return
        if (time.time() - t0) / 60 > INDEX_TIMEOUT_MIN:
            raise Stop(f'only {done}/{len(keys)} indexed after {INDEX_TIMEOUT_MIN} minutes')
        time.sleep(180)


def verify(P, by_key):
    keys = list(P['plan_rows'])

    def read():
        got = docs_for(keys)
        ids = {got[k]['id']: k for k in keys if k in got}
        chunks, nullv, idl = Counter(), Counter(), list(ids)
        for i in range(0, len(idl), 60):
            f = C.in_filter(idl[i:i + 60])
            for r in C.rest_pages(rest_get, 'document_chunks', {'select': 'id,document_id', 'document_id': f, 'order': 'id'}):
                chunks[r['document_id']] += 1
            for r in C.rest_pages(rest_get, 'document_chunks', {'select': 'id,document_id', 'document_id': f, 'embedding': 'is.null', 'order': 'id'}):
                nullv[r['document_id']] += 1
        rows = C.rest_pages(rest_get, 'desk_rows', {'select': 'row_key,row', 'tier': 'eq.national', 'feature': 'eq.' + P_.FEATURE, 'order': 'row_key'})
        return got, chunks, nullv, {str(r['row_key']): r['row'] for r in rows}
    got, chunks, nullv, rows = signed(read)
    bad, live = [], {}
    for k, pr in P['plan_rows'].items():
        g = got.get(k)
        if not g:
            bad.append([k[-16:], 'missing']); continue
        problems = [x for x, ok in [
            ('not indexed', g.get('indexed_at')), ('text hash', g.get('content_sha256') == pr['text_sha256']),
            ('chunks', chunks[g['id']] == pr['chunks']), ('null vectors', nullv[g['id']] == 0),
            ('section', g.get('desk_tier') == 'national' and g.get('desk_feature') == P_.FEATURE),
            ('url', g.get('file_url') == pr['url']),
            ('desk row', all((rows.get(rk) or {}).get('source_url') == pr['url'] for rk in pr['row_keys']))] if not ok]
        if problems:
            bad.append([k[-16:], problems])
        live[k] = {'status': 'verified' if not problems else 'problem: ' + ','.join(problems), 'id': g['id'], 'indexed_at': g.get('indexed_at') or ''}
    fp = P_.fingerprint((k, chunks[got[k]['id']], got[k]['content_sha256']) for k in keys if k in got)
    res = {'batch': BATCH, 'checked_at': now(), 'docs': len(keys), 'found': len(got), 'indexed': sum(1 for k in got if got[k].get('indexed_at')),
           'chunks': sum(chunks.values()), 'null_vectors': sum(nullv.values()), 'fingerprint': fp,
           'fingerprint_matches_plan': fp == P['fingerprint_sorted_key_chunks_text'], 'problems': bad[:100], 'problem_count': len(bad)}
    write_json(ST / 'verify.json', res)
    write_ledger(P, by_key, live)
    return res


# ─── entry points ──────────────────────────────────────────────────────────
def run(mode, repo_sha):
    setup(repo_sha)
    try:
        if mode == 'plan':
            out = plan()
            P, by_key = out if isinstance(out, tuple) else (out, records_for(out))
            if not all(v.get('manifest_sha256') for v in P['tranches'].values()):
                dry_runs(P, by_key)
            status(event='planned', docs=P['docs'], chunks=P['chunks'], ceiling=P.get('cost_ceiling_usd'), holds=P['holds'],
                   fingerprint=P['fingerprint_sorted_key_chunks_text'])
        elif mode == 'submit':
            P = json.loads((ST / 'plan.json').read_text())
            if not all(v.get('manifest_sha256') for v in P['tranches'].values()):
                raise Stop('plan has no dry-run manifests; run MODE plan first')
            for t, v in P['tranches'].items():
                if sha(ST / t / 'decisions.jsonl') != v['manifest_sha256'] or sha(ST / t / 'corpus.jsonl') != v['corpus_sha256']:
                    raise Stop(f'{t}: manifest or corpus changed since the dry run')
            by_key = records_for(P)
            for t in P['tranches']:
                submit_tranche(P, t)
            wait_indexed(P)
            res = verify(P, by_key)
            if res['problems'] or not res['fingerprint_matches_plan']:
                raise Stop(f"verification failed for {res['problem_count']} documents")
            status(event='verified', docs=res['docs'], chunks=res['chunks'], fingerprint=res['fingerprint'])
            status(event='finished; batch of 1,000 complete, stopping as instructed')
        else:
            raise Stop('MODE must be plan or submit')
    except Stop as e:
        status(event='STOPPED', reason=str(e))
    except Exception as e:
        status(event='STOPPED (unexpected error)', reason=f'{type(e).__name__}: {e}'[:600])
        raise
    finally:
        forget_creds()
        _SECRETS.clear()
    return load_state().get('last')


# ─── the rest of the section ───────────────────────────────────────────────
SECTION_LOG = pathlib.Path(NATIONAL + '/staging/pq-section-status.json')


def section_status(**kw):
    s = json.loads(SECTION_LOG.read_text()) if SECTION_LOG.exists() else {'started_at': now(), 'log': []}
    s['log'].append({'at': now(), **kw}); s['last'] = {'at': now(), **kw}
    write_json(SECTION_LOG, s)
    print(json.dumps({'at': now(), **kw}, default=str)[:900], flush=True)


def _verify_batch(n, approver):
    configure(n, approver)
    P = json.loads((ST / 'plan.json').read_text())
    res = verify(P, records_for(P))
    if res['problems'] or not res['fingerprint_matches_plan']:
        raise Stop(f"batch {n}: verification failed for {res['problem_count']} documents")
    status(event='verified', docs=res['docs'], chunks=res['chunks'], fingerprint=res['fingerprint'])
    section_status(batch=n, event='verified', docs=res['docs'], chunks=res['chunks'], fingerprint=res['fingerprint'])


def _indexed(n, approver):
    configure(n, approver)
    keys = list(json.loads((ST / 'plan.json').read_text())['plan_rows'])
    got = signed(docs_for, keys)
    return sum(1 for k in keys if (got.get(k) or {}).get('indexed_at')), len(keys)


def _phase(n):
    p = pathlib.Path(NATIONAL + f'/staging/pq-batch-{n:02d}/status.json')
    log = json.loads(p.read_text()).get('log', []) if p.exists() else []
    events = {x.get('event') for x in log}
    return 'verified' if 'verified' in events else 'submitted' if 'all tranches submitted' in events else None


def run_section(repo_sha, approver, first=2, last=99):
    """Batches first..last until the pack has no eligible answer left; see the header."""
    setup(repo_sha)
    pending = []
    try:
        n = first
        while n <= last:
            configure(n, approver)
            ph = _phase(n)
            if ph == 'verified':
                n += 1; continue
            if ph != 'submitted':
                try:
                    out = plan()
                except Exhausted:
                    section_status(batch=n, event='no eligible answer remains; section complete')
                    break
                P, by_key = out if isinstance(out, tuple) else (out, records_for(out))
                if not all(v.get('manifest_sha256') for v in P['tranches'].values()):
                    dry_runs(P, by_key)
                section_status(batch=n, event='planned', docs=P['docs'], chunks=P['chunks'], ceiling=P.get('cost_ceiling_usd'),
                               fingerprint=P['fingerprint_sorted_key_chunks_text'])
                for t, v in P['tranches'].items():
                    if sha(ST / t / 'decisions.jsonl') != v['manifest_sha256'] or sha(ST / t / 'corpus.jsonl') != v['corpus_sha256']:
                        raise Stop(f'batch {n} {t}: manifest or corpus changed since the dry run')
                for t in P['tranches']:
                    submit_tranche(P, t)
                status(event='all tranches submitted', docs=P['docs'])
                section_status(batch=n, event='submitted', docs=P['docs'], chunks=P['chunks'])
            pending.append(n)
            # verify every earlier batch that is fully indexed before starting the next one
            for m in list(pending):
                done, total = _indexed(m, approver)
                if done == total:
                    _verify_batch(m, approver); pending.remove(m)
            configure(n, approver)
            if json.loads((ST / 'plan.json').read_text())['docs'] < DOCS:
                break  # the last, partial batch
            n += 1
        t0 = time.time()
        while pending:
            m = pending[0]
            done, total = _indexed(m, approver)
            section_status(batch=m, event='indexing', indexed=done, of=total)
            if done == total:
                _verify_batch(m, approver); pending.pop(0); continue
            if (time.time() - t0) / 60 > INDEX_TIMEOUT_MIN * 2:
                raise Stop(f'batch {m}: only {done}/{total} indexed after {INDEX_TIMEOUT_MIN * 2} minutes')
            time.sleep(180)
        section_status(event='finished: every eligible question answer in the section is stored and verified')
    except Stop as e:
        section_status(event='STOPPED', reason=str(e))
    except Exception as e:
        section_status(event='STOPPED (unexpected error)', reason=f'{type(e).__name__}: {e}'[:600])
        raise
    finally:
        forget_creds()
        _SECRETS.clear()
    return json.loads(SECTION_LOG.read_text()).get('last')
