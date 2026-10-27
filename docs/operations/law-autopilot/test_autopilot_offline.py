# Offline end-to-end test of the autopilot with fake screener, importer and REST (no network, no Colab): python3 -I test_autopilot_offline.py
import json, os, pathlib, random, hashlib, shutil, sys, tempfile, types, re
D = str(pathlib.Path(__file__).resolve().parent) + '/'
tmp = pathlib.Path(tempfile.mkdtemp())
M = {'__name__': 'auto'}
exec(compile(open(D + 'nter-law-autopilot.py').read(), 'auto', 'exec'), M)
core = {'__name__': 'core'}; exec(compile(open(D + 'nter-law-autopilot-core.py').read(), 'core', 'exec'), core)
M['C'] = type('Core', (), core)
M['ST'] = tmp / 'auto'; M['ST'].mkdir()
M['W'] = tmp / 'w'; M['REPO'] = tmp / 'repo'; M['REPO'].mkdir(parents=True)
M['PRIOR'] = {}
M['BATCHES'] = [7, 8]
M['DOCS_PER_BATCH'] = 30
M['MEMBERS'] = [(f'documents/tribunals/IBBI_NCLT/2024__part-0000{i}.jsonl.gz', 'x') for i in range(1, 6)]
M['time'].sleep = lambda s: None
random.seed(3)
vocab = [f'w{i}' for i in range(5000)]
DB = {}        # source_key -> doc
CHUNKS = {}    # doc id -> n
LINKS = {}
def mk_text(): return ' '.join(random.choice(vocab) for _ in range(800))
POOL = {}
for i in range(1, 6):
    rows = []
    for j in range(20):
        k = f'law:trib:IBBI_NCLT:ibbi_nclt-{i:02d}{j:014d}'
        t = mk_text()
        rows.append({'source_key': k, 'text': t, 'file_url': f'https://ibbi.gov.in/uploads/order/{hashlib.md5(k.encode()).hexdigest()}.pdf',
                     'case': f'CP {i}-{j}/2024', 'date': f'2024-0{1+j%9}-1{j%9}'})
    POOL[f'2024__part-0000{i}'] = rows
# injected problems: a near-duplicate pair in part 2 (same case), a no-case record, a same case+date pair
POOL['2024__part-00002'][5]['text'] = POOL['2024__part-00002'][4]['text']; POOL['2024__part-00002'][5]['case'] = POOL['2024__part-00002'][4]['case'].replace(' ', '')
POOL['2024__part-00001'][3]['case'] = ''
POOL['2024__part-00003'][2]['case'] = POOL['2024__part-00003'][1]['case']; POOL['2024__part-00003'][2]['date'] = POOL['2024__part-00003'][1]['date']
# an already-ingested document whose text equals a part-4 candidate (cross-batch duplicate)
DB['law:trib:IBBI_NCLT:ibbi_nclt-old0000000000001'] = {'id': 'old1', 'source_key': 'law:trib:IBBI_NCLT:ibbi_nclt-old0000000000001',
    'file_url': 'https://ibbi.gov.in/uploads/order/' + 'f' * 32 + '.pdf', 'indexed_at': 'x', 'ocr_text': POOL['2024__part-00004'][0]['text'],
    'citation': {'case_number': POOL['2024__part-00004'][0]['case'], 'order_date': '2020-01-01'}}
for d in DB.values(): d['content_sha256'] = hashlib.sha256(d['ocr_text'].encode()).hexdigest()

decided = set()
def fake_run(cmd, env=None):
    cmd = [str(c) for c in cmd]
    if 'screen' in cmd and 'law-cohort-screen.py' in ' '.join(cmd) and 'finalize' not in cmd:
        member = cmd[cmd.index('--member') + 1]; out = pathlib.Path(cmd[cmd.index('--output-dir') + 1]); out.mkdir(parents=True)
        name = pathlib.Path(member).name.split('.')[0]
        excl = set()
        for i, c in enumerate(cmd):
            if c == '--exclude-decisions':
                for l in open(cmd[i + 1]): excl.add(json.loads(l)['source_key'])
        cands, lines = [], []
        for n, r in enumerate(POOL[name], 1):
            disp = 'held' if r['source_key'] in excl else 'ready_for_review'
            cands.append({'line': n, 'source_key': r['source_key'], 'disposition': disp, 'text_sha256': hashlib.sha256(r['text'].encode()).hexdigest(),
                          'n_pages': 3, 'file_url': r['file_url'], 'reasons': []})
            if disp == 'ready_for_review': lines.append(json.dumps({'source_key': r['source_key'], 'text': r['text']}))
        body = ('\n'.join(lines) + '\n') if lines else ''
        (out / 'candidates.jsonl').write_text(body)
        (out / 'screen.json').write_text(json.dumps({'finalizable': True, 'candidates': cands, 'lines_scanned': len(cands), 'counts': {},
            'held_reasons': {}, 'candidates_jsonl_sha256': hashlib.sha256(body.encode()).hexdigest()}))
        return ''
    if 'next100-estimate.mjs' in cmd:
        sj = pathlib.Path(cmd[-2]); s = json.loads(sj.read_text()); name = sj.parent.name
        rows = []
        for c in s['candidates']:
            r = next(x for x in sum(POOL.values(), []) if x['source_key'] == c['source_key'])
            rows.append({'source_key': c['source_key'], 'status': 'chunked', 'chunks': 5, 'content_chars': 4000, 'embedding_input_bytes': 4000,
                         'cost_ceiling_usd': 0.0003, 'citation': {'case_number': r['case'], 'order_date': r['date']}})
        pathlib.Path(cmd[-1]).write_text(json.dumps({'rows': rows})); return ''
    if 'finalize' in cmd:
        out = pathlib.Path(cmd[cmd.index('--output') + 1]); keys = cmd[cmd.index('--keys') + 1:]
        did = cmd[cmd.index('--decision-id') + 1]
        out.write_text(''.join(json.dumps({'source_key': k, 'review': {'decision_id': f'{did}-{i}'}}) + '\n' for i, k in enumerate(keys, 1)))
        return ''
    raise AssertionError(cmd)
M['run'] = fake_run

FAIL = {'after': None}; ORDER = []; HIDE = {'keys': set(), 'left': 0}   # HIDE: unpublished documents the API cannot show yet   # submit: stop as uncertain after this many new registrations (models a 503 on the status read)
def fake_importer(n, P, t, report, *extra):
    v = P['tranches'][t]; report = pathlib.Path(report)
    if report.exists(): raise M['Stop']('exists')
    rows = []
    for k in v['keys']:
        m = {'status': 'ready', 'action': 'create-listing', 'fingerprint': 'a' * 64}
        if k in DB: m['document_id'] = DB[k]['id']
        rows.append({'source_key': k, 'status': 'ready', 'chunks': P['plan_rows'][k]['chunks'], 'mapping': m})
    summ = {'type': 'summary', 'ready': v['docs'], 'held': 0, 'chunks': v['chunks'], 'estimated_cost_ceiling_usd': v['cost_ceiling'],
            'submitted': 0, 'uncertain': 0, 'registration_held': 0, 'already_registered': 0,
            'manifest_sha256': M['sha'](M['ST'] / f'b{n:02d}' / t / 'decisions.jsonl')}
    if '--submit' in extra:
        stopped = False
        for k in v['keys']:
            if k in DB:
                summ['already_registered'] += 1; continue
            if stopped: continue
            pr = P['plan_rows'][k]; did = 'id-' + k[-16:]
            text = next(x for x in sum(POOL.values(), []) if x['source_key'] == k)['text']
            DB[k] = {'id': did, 'source_key': k, 'file_url': pr['url'], 'indexed_at': 'now', 'content_sha256': pr['text_sha256'], 'ocr_text': text,
                     'citation': {}}
            CHUNKS[did] = pr['chunks']; LINKS[did] = 1; ORDER.append(k)
            summ['submitted'] += 1
            if FAIL['after'] is not None and summ['submitted'] == FAIL['after']:
                summ['uncertain'] = 1; stopped = True; FAIL['after'] = None
        decided.update(v['keys'])
    rows.append(summ)
    report.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    return (2 if '--submit' in extra else 0), rows
M['importer'] = fake_importer

import urllib.parse
def fake_get(path):
    u = urllib.parse.urlparse(path); q = dict(urllib.parse.parse_qsl(u.query)); table = u.path.rsplit('/', 1)[-1]
    lim, off = int(q.get('limit', 10 ** 9)), int(q.get('offset', 0))
    def keys_in(f): return re.findall(r'"([^"]+)"', f)
    if table == 'documents':
        if 'source_key' in q and q['source_key'].startswith('like.'):
            rows = sorted(DB.values(), key=lambda d: d['source_key'])
        elif q.get('source_key', '').startswith('eq.'):
            rows = [DB[q['source_key'][3:]]] if q['source_key'][3:] in DB else []
        else:
            ks = keys_in(q['source_key']); rows = [DB[k] for k in ks if k in DB]
            if HIDE['left'] > 0 and any(k in HIDE['keys'] for k in ks):
                HIDE['left'] -= 1; rows = [r for r in rows if r['source_key'] not in HIDE['keys']]
        sel = q['select'].split(',')
        out = [{('citation' if s.startswith('metadata') else s): d.get('citation' if s.startswith('metadata') else s) for s in sel} for d in rows]
        return out[off:off + lim]
    if table == 'document_chunks':
        ids = keys_in(q['document_id'])
        if q.get('embedding') == 'is.null': return []
        out = [{'id': f'{i}-{c}', 'document_id': i} for i in ids for c in range(CHUNKS.get(i, 0))]
        return out[off:off + lim]
    if table == 'law_document_links':
        ids = keys_in(q['document_id']); out = [{'document_id': i, 'record_id': 'r'} for i in ids for _ in range(LINKS.get(i, 0))]
        return out[off:off + lim]
    raise AssertionError(path)
M['rest_get'] = fake_get
import base64, time as _t
_tok = 'x.' + base64.urlsafe_b64encode(json.dumps({'exp': int(_t.time()) + 3600}).encode()).decode().rstrip('=') + '.y'
M['sign_in'] = lambda: os.environ.update(NTER_INGEST_ACCESS_TOKEN=_tok, SUPABASE_PUBLISHABLE_KEY='k')
M['sha'] = M['sha']
# manifests(): REPO paths absent; PRIOR empty; state manifests pinned
for n in M['BATCHES']:
    M['run_batch'](n)
st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
print('batches', st['batches'], 'cursor', st.get('cursor'))
for n in M['BATCHES']:
    P = json.loads((M['ST'] / f'b{n:02d}' / 'plan.json').read_text())
    print(n, P['docs'], {t: v['docs'] for t, v in P['tranches'].items()}, P['holds'], P['members_screened'])
    v = json.loads((M['ST'] / f'b{n:02d}' / 'verify.json').read_text()); print(' verify', v['found'], v['chunks'], v['problem_count'], v['fingerprint_matches_plan'])
# overlap check
k7 = set(json.loads((M['ST'] / 'b07' / 'plan.json').read_text())['plan_rows']); k8 = set(json.loads((M['ST'] / 'b08' / 'plan.json').read_text())['plan_rows'])
print('overlap', len(k7 & k8))
held_dup = [k for k in k7 | k8 if k.endswith('0000000000005') and k.startswith('law:trib:IBBI_NCLT:ibbi_nclt-02')]
print('near-dup selected?', held_dup)
print('part4[0] selected?', POOL['2024__part-00004'][0]['source_key'] in k7 | k8)

# ── stop scenarios ──
# 1. a reconcile mismatch stops before any submission; a clean resume then completes the batch
M['BATCHES'] = [9]
orig = M['importer']
def bad_importer(n, P, t, report, *extra):
    code, rows = orig(n, P, t, report, *extra)
    if '--reconcile' in extra:
        rows[0]['mapping']['action'] = 'link-existing'
        pathlib.Path(report).write_text(''.join(json.dumps(r) + '\n' for r in rows))
    return code, rows
M['importer'] = bad_importer; M['link_ok'] = lambda url: False
before = len(DB)
try:
    M['run_batch'](9); print('FAIL: no stop')
except M['Stop'] as e:
    print('stop 1 ok:', 'not submitted' in str(e), len(DB) == before)
M['importer'] = orig
M['run_batch'](9)
print('resume ok:', json.loads((M['ST'] / 'autopilot-status.json').read_text())['batches']['9']['phase'])
# 2. an incomplete earlier submission is never treated as done
M['BATCHES'] = [10]
def crash_importer(n, P, t, report, *extra):
    if '--submit' in extra:
        pathlib.Path(report).write_text(json.dumps({'source_key': P['tranches'][t]['keys'][0], 'status': 'submitting'}) + '\n')
        raise KeyboardInterrupt('runtime reset')
    return orig(n, P, t, report, *extra)
M['importer'] = crash_importer
try:
    M['run_batch'](10)
except KeyboardInterrupt:
    pass
M['importer'] = orig
M['run_batch'](10)
st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
print('crash resume ok:', st['batches']['10']['phase'] == 'verified',
      any(x.get('batch') == 10 and x.get('event') == 'resuming an incomplete submission' for x in st['log']),
      (M['ST'] / 'b10' / 'T1' / 'submit-2.jsonl').exists())
# 4. an importer exit 1 before the report exists (nothing written, e.g. one mapping request timing out) is retried
M['BATCHES'] = [11]
for i in range(6, 20):
    POOL[f'2024__part-{i:05d}'] = [{'source_key': f'law:trib:IBBI_NCLT:ibbi_nclt-{i:02d}{j:014d}', 'text': mk_text(),
        'file_url': f'https://ibbi.gov.in/uploads/order/{hashlib.md5(f"{i}-{j}".encode()).hexdigest()}.pdf', 'case': f'CP {i}-{j}/2024',
        'date': f'2024-0{1+j%9}-1{j%9}'} for j in range(20)]
    M['MEMBERS'].append((f'documents/tribunals/IBBI_NCLT/2024__part-{i:05d}.jsonl.gz', 'x'))
fails = {'reconcile': 1, 'submit': 2}; calls = []
def flaky_importer(n, P, t, report, *extra):
    kind = 'submit' if '--submit' in extra else 'reconcile' if '--reconcile' in extra else 'dry'
    calls.append(kind)
    if fails.get(kind, 0) > 0 and t == 'T1':
        fails[kind] -= 1
        return 1, []
    return orig(n, P, t, report, *extra)
M['importer'] = flaky_importer
M['run_batch'](11)
st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
retries = [x for x in st['log'] if x.get('event', '').startswith('importer stopped before writing')]
print('pre-write retry ok:', st['batches']['11']['phase'], len(retries) == 3, calls.count('submit') >= 3)
# 5. an exit 1 after the report exists is never retried
M['BATCHES'] = [12]
def late_fail(n, P, t, report, *extra):
    if '--submit' in extra:
        pathlib.Path(report).write_text(json.dumps({'type': 'manifest'}) + '\n')
        return 1, [{'type': 'manifest'}]
    return orig(n, P, t, report, *extra)
M['importer'] = late_fail; calls.clear()
try:
    M['run_batch'](12); print('FAIL: late failure not stopped')
except M['Stop'] as e:
    st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
    print('no retry after write ok:', 'without completing' in str(e), not any(x.get('batch') == 12 and 'retrying' in x.get('event', '') for x in st['log']))
M['importer'] = orig
# 6. a submission that stops part-way (registered 12, then an uncertain status read) is resumed: 12 already registered + the rest
M['BATCHES'] = [13]
before = len(DB); FAIL['after'] = 12
M['run_batch'](13)
st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
s2 = json.loads((M['ST'] / 'b13' / 'T1' / 'submit-2-status.json').read_text())['summary']
print('partial resume ok:', st['batches']['13']['phase'] == 'verified', s2['already_registered'] == 12,
      s2['submitted'] + s2['already_registered'] == 30, len(DB) - before == 30)
# 7. a resume refuses a registered document whose stored text differs from the plan
M['BATCHES'] = [14]
FAIL['after'] = 5
real_submit_once = M['_submit_once']; TAMPERED = {}
def tamper(n, P, t, v, d, j, resume):
    if resume:
        k = next(k for k in v['keys'] if k in DB); TAMPERED[k] = DB[k]['content_sha256']; DB[k]['content_sha256'] = '0' * 64
    return real_submit_once(n, P, t, v, d, j, resume)
M['_submit_once'] = tamper
try:
    M['run_batch'](14); print('FAIL: tampered document accepted')
except M['Stop'] as e:
    print('resume refuses changed text ok:', 'live reconcile differs' in str(e))
M['_submit_once'] = real_submit_once
for k, h in TAMPERED.items(): DB[k]['content_sha256'] = h
# 8. a tranche that never completes stops after MAX_SUBMIT_REPORTS attempts
M['BATCHES'] = [15]
def never(n, P, t, report, *extra):
    if '--submit' in extra:
        FAIL['after'] = 1
    return orig(n, P, t, report, *extra)
M['importer'] = never
try:
    M['run_batch'](15); print('FAIL: endless resume')
except M['Stop'] as e:
    print('  stop reason:', e)
    print('resume bound ok:', 'without completing' in str(e), len(list((M['ST'] / 'b15' / 'T1').glob('submit-*.jsonl'))) == M['MAX_SUBMIT_REPORTS'])
M['importer'] = orig; FAIL['after'] = None
# 9. a resume that finds registered documents not yet visible (unpublished) waits, re-checks them, then completes
M['BATCHES'] = [16]
before = len(DB); FAIL['after'] = 12; ORDER.clear()
orig_once = M['_submit_once']
def hide_then(n, P, t, v, d, j, resume):
    if resume and not HIDE['keys']:
        HIDE['keys'] = set(ORDER[-4:]); HIDE['left'] = 2   # the last 4 registered stay unreadable for two reads
    return orig_once(n, P, t, v, d, j, resume)
M['_submit_once'] = hide_then
M['run_batch'](16)
M['_submit_once'] = orig_once
st = json.loads((M['ST'] / 'autopilot-status.json').read_text())
waits = [x for x in st['log'] if x.get('batch') == 16 and x.get('event', '').startswith('registered documents not yet visible')]
s2 = json.loads((M['ST'] / 'b16' / 'T1' / 'submit-2-status.json').read_text())['summary']
print('not-yet-visible wait ok:', st['batches']['16']['phase'] == 'verified', len(waits) == 2, s2['already_registered'] == 12,
      len(DB) - before == 30, not (M['ST'] / 'b16' / 'T1' / 'submit-3.jsonl').exists())
HIDE['keys'] = set(); HIDE['left'] = 0
# 10. a short order contained in a much longer ingested order of the same date is held (batches 7, 9, 10 pattern)
M['BATCHES'] = [17]
long_text = ' '.join(random.choice(vocab) for _ in range(4000))
DB['law:trib:IBBI_NCLT:ibbi_nclt-long000000000001'] = {'id': 'long1', 'source_key': 'law:trib:IBBI_NCLT:ibbi_nclt-long000000000001',
    'file_url': 'https://ibbi.gov.in/uploads/order/' + 'e' * 32 + '.pdf', 'indexed_at': 'x', 'ocr_text': long_text,
    'citation': {'case_number': 'CP 999/2024', 'order_date': '2024-03-03'}}
DB['law:trib:IBBI_NCLT:ibbi_nclt-long000000000001']['content_sha256'] = hashlib.sha256(long_text.encode()).hexdigest()
short_key = 'law:trib:IBBI_NCLT:ibbi_nclt-20' + '0' * 14
POOL['2024__part-00020'] = [{'source_key': short_key, 'text': ' '.join(long_text.split()[1000:1500]), 'file_url':
    'https://ibbi.gov.in/uploads/order/' + 'd' * 32 + '.pdf', 'case': 'IA 12 in CP 999/2024', 'date': '2024-03-03'}] + [
    {'source_key': f'law:trib:IBBI_NCLT:ibbi_nclt-20{j:014d}', 'text': mk_text(), 'file_url': f'https://ibbi.gov.in/uploads/order/{hashlib.md5(f"20-{j}".encode()).hexdigest()}.pdf',
     'case': f'CP 20-{j}/2024', 'date': '2024-03-03'} for j in range(1, 40)]
M['MEMBERS'].insert(json.loads((M['ST'] / 'autopilot-status.json').read_text()).get('cursor', 0), ('documents/tribunals/IBBI_NCLT/2024__part-00020.jsonl.gz', 'x'))
M['run_batch'](17)
P17 = json.loads((M['ST'] / 'b17' / 'plan.json').read_text())
print('contained hold ok:', P17['holds'].get('contained in a same-date order') == 1, short_key not in P17['plan_rows'])
# 3. very unequal sizes are never compared; a short order fully inside a long one is not held by the estimate alone
import numpy as np
big = ' '.join(random.choice(vocab) for _ in range(20000)); small = ' '.join(big.split()[:400])
reg = {'sigs': np.zeros((0, 256), dtype=np.uint64), 'ns': np.array([]), 'meta': []}
bs = M['C'].shingles(big); M['C'].reg_add(reg, 'big', 'A', '2024-01-01', '', M['C'].minhash(bs), len(bs))
ss = M['C'].shingles(small)
print('size guard ok:', M['C'].similar_hold({'case_number': 'A', 'order_date': '2024-01-01', 'file_url': ''}, ss, M['C'].minhash(ss), reg, lambda i: bs) is None)
cs = M['C'].shingles(small)
print('contained rule ok:', M['C'].contained_hold({'order_date': '2024-01-01'}, cs, M['C'].minhash(cs), reg, lambda i: bs) is not None,
      M['C'].contained_hold({'order_date': '2024-02-02'}, cs, M['C'].minhash(cs), reg, lambda i: bs) is None)
