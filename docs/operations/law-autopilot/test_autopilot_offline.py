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

def fake_importer(n, P, t, report, *extra):
    v = P['tranches'][t]; report = pathlib.Path(report)
    if report.exists(): raise M['Stop']('exists')
    rows = []
    for k in v['keys']:
        rows.append({'source_key': k, 'status': 'ready', 'mapping': {'status': 'ready', 'action': 'create-listing', 'fingerprint': 'a' * 64}})
    summ = {'type': 'summary', 'ready': v['docs'], 'held': 0, 'chunks': v['chunks'], 'estimated_cost_ceiling_usd': v['cost_ceiling'],
            'submitted': 0, 'uncertain': 0, 'registration_held': 0}
    if '--submit' in extra:
        summ['submitted'] = v['docs']
        for k in v['keys']:
            pr = P['plan_rows'][k]; did = 'id-' + k[-16:]
            text = next(x for x in sum(POOL.values(), []) if x['source_key'] == k)['text']
            DB[k] = {'id': did, 'source_key': k, 'file_url': pr['url'], 'indexed_at': 'now', 'content_sha256': pr['text_sha256'], 'ocr_text': text,
                     'citation': {}}
            CHUNKS[did] = pr['chunks']; LINKS[did] = 1
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
        else:
            ks = keys_in(q['source_key']); rows = [DB[k] for k in ks if k in DB]
        sel = q['select'].split(',')
        out = [{('citation' if s.startswith('metadata') else s): d.get('citation' if s.startswith('metadata') else s) for s in sel} for d in rows]
        return out[off:off + lim]
    if table == 'document_chunks':
        ids = keys_in(q['document_id'])
        if q.get('embedding') == 'is.null': return []
        out = [{'document_id': i} for i in ids for _ in range(CHUNKS.get(i, 0))]
        return out[off:off + lim]
    if table == 'law_document_links':
        ids = keys_in(q['document_id']); out = [{'document_id': i, 'record_id': 'r'} for i in ids for _ in range(LINKS.get(i, 0))]
        return out[off:off + lim]
    raise AssertionError(path)
M['rest_get'] = fake_get
M['sign_in'] = lambda: os.environ.update(NTER_INGEST_ACCESS_TOKEN='a.b.c', SUPABASE_PUBLISHABLE_KEY='k')
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
