
# --- Audit ledger of ingested Law files (read-only DB export above, pasted verbatim) -> CSV + Google Sheet in Drive ---
import csv, hashlib, io, json, os, pathlib, datetime
import base64, gzip
L = json.loads(LEDGER_RAW)
if 'gz_b64' in L:  # large exports travel gzip+base64 compressed; the md5 is over the original JSON text
    L['rows'] = gzip.decompress(base64.b64decode(L['gz_b64'])).decode('utf-8')
assert hashlib.md5(L['rows'].encode()).hexdigest() == L['md5'] and len(L['rows']) == L['len'], 'export damaged in transfer'
ROWS = json.loads(L['rows']); assert len(ROWS) == L['n']
BATCHES = {
 'owner-authorized-20261023-law-five': {'batch': 'B1 pilot (5)', 'approver': 'owner (name not recorded in pilot evidence)', 'authorized': '2026-10-23',
   'receipt': 'docs/operations/law-five-release/'},
 'owner-authorized-20261023-law-cohort-2': {'batch': 'B2 cohort-2 (5)', 'approver': 'Vighnesh Shukla', 'authorized': '2026-10-23',
   'receipt': 'docs/operations/law-cohort-2-release/', 'manifest': '79760acea597716f6bf295a44479d3ac60d0c8ebf4f1725908bffab8074054ef'},
 'owner-authorized-20261024-law-next-100': {'batch': 'B3 next-100 (100)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-24 04:13 IST',
   'receipt': 'docs/operations/law-next-100-release/', 'manifest': 'af57c78d478048c6c06afba6d76e41ed76ae5f0dd52384200424a2d71920d13b'},
}
NEXT1000 = {'batch': 'B4 next-1000 (1000)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-24 14:16 IST',
            'receipt': 'docs/operations/law-next-1000-release/',
            'manifest': 'T1 ed83e437f7839ab5d9fc8b6094909d4704220a5e77b293d6291a103a4d52f29a; T2 972e95b1a856839e42393206bc9b6a119584944c896d0062edd1783f95fd5506; '
                        'T3 dd46363712c898ec9278f4f3f00382cf9555869461dd35b79479094d187f7a9e; T4 5921dce57bfbc840f52af35d38cdd8ed5c7db443d846401089279c5788755354'}
BATCH5 = {'batch': 'B5 batch-5 (1000, 2025 orders)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-26 03:47 IST',
          'receipt': 'docs/operations/law-batch-5-release/',
          'manifest': 'T1 aae686d491f3a011599930b763125a780ab38bdd812c76b7bb104efe558bd8c5; T2 295135caa07f82034ecc8b1df401652b5e8b9b80de5c996d81b7f462d7044e0a; '
                      'T3 8e7a51591f1770e4bdc12bc679d716d2d3f4e3efd1a67c0b6a2a1c50b22466aa; T4 40ce77f897f0fddda882f089c3cfeae82dfee50aa1603b6592ac2b4df33a61c4; '
                      'T5 c76eeb95f4d5821b70185fcb84edda8d338e365e60f7c0197e201d63f33356be'}
BATCH6 = {'batch': 'B6 batch-6 (1000, 2025 + 2024 orders)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-26 16:29 IST',
          'receipt': 'docs/operations/law-batch-6-release/',
          'manifest': 'T1 146739f44772e2a87b0ced0bd3b235764ac21cd3bd411bfcd1d9c83f47e834dd; T2 2f2b0262982a5bdefe4f211ae01f85d14d34a9df2d733cb17621621ecf05ccf3; '
                      'T3 59bc3f9963b75c0d84e631c5c2d273725d1a62f5868f0bba882d404a6b70e498; T4 8cfbec56790e42011c62292e72892f0296cb5e526a2bf57c23f8aae7d93237e2; '
                      'T5 338c70aeb0c2145beef4c620bcca702e2380bfe797519c254e2613030a56771a'}
def batch_of(bdec):
    if str(bdec).startswith('owner-authorized-20261024-law-next-1000'):
        return 'owner-authorized-20261024-law-next-1000', NEXT1000
    if str(bdec).startswith('owner-authorized-20261026-law-batch-5'):
        return 'owner-authorized-20261026-law-batch-5', BATCH5
    if str(bdec).startswith('owner-authorized-20261026-law-batch-6'):
        return 'owner-authorized-20261026-law-batch-6', BATCH6
    return bdec, BATCHES.get(bdec, {'batch': bdec, 'approver': ''})
FILEMAP = {'292e68e44a755cf869b54daab8025218cb064dac182c600f56659e69f62c68d1': '2026__part-00006.jsonl.gz (pilot extract)',
           'bc374a90f1c60313d68015845cbe1d2a5583c86c03ea0c4ab3b04f41f324d5f6': '2026__part-00006.jsonl.gz',
           'ed53e061e26b0c7e74f00b7914a2b5d4147edb4b3de649e0dba298e9f5b1e128': '2026__part-00006.jsonl.gz',
           'a35d23a00b7209a776f63da02d0ed9126bd1f2e14bb5acfb8d4f4ddd4edbce99': '2026__part-00001.jsonl.gz',
           '8c1ae33745e061750eeac8aef38fdf96a51957eec7ea9eec347a97128d3cc977': '2026__part-00002.jsonl.gz',
           'ddcae790af29d774cd47533bdfa26304117c6c74e37bacdd1e40568c0316e1d3': '2026__part-00003.jsonl.gz',
           '93137c186c0ee8e49534055050e5072110bbbe9de9a145b0b7270d5fcfa2d820': '2026__part-00004.jsonl.gz',
           'd998f34146409c1afe1dff5e43e15bc70a405ca7fda960452c4c283c436820b4': '2026__part-00005.jsonl.gz',
           'ee85b8f7b25f1545b0c29b33848f98448c0dcfa3403b0ff7240e9231248e76af': '2026__part-00008.jsonl.gz',
           'f6f70f2b9d558a940f69b5ad63b37aafe9863f9c67996690514986b397249e9e': '2026__part-00007.jsonl.gz',
           'f38a16fd9a06f5112fc8eb598643368bb3e3463cb9ee6bcadac032b49163e455': '2025__part-00001.jsonl.gz',
           'cd174623f96ac6a22c0802db7be0d4096630e6e376cf873f5976e5f358efc51a': '2025__part-00002.jsonl.gz',
           'e26d94bf27b5deda25bd333847197bebafe379ee31cd50780b9503e3a0c801b0': '2025__part-00003.jsonl.gz',
           'aaf6f336af897b4ca2ebd788ef613ad20faa56fac8524da2e90d22aba9afda3b': '2025__part-00004.jsonl.gz',
           'e032ce024ccf70fccbcca07fdba85c1840834ace92a74d6476614c1fd7e89fac': '2025__part-00005.jsonl.gz',
           'c7fd10414c53268b0acbfc1e544c12bad7a0d61abbef930d71de10b400f414ac': '2025__part-00006.jsonl.gz',
           'fac94f639cf270279f5d9214e039d4219f778bf5129b6c30107cbeeb58fe66bf': '2025__part-00006.jsonl.gz',
           '8f4eb24503bcdeb9a7c85eb77897d456fd33625cb4e97dc0bee6e414588ef23b': '2025__part-00007.jsonl.gz',
           '3ac8ba8646526146efbd0575cba19a32a4ebbd905bdb063a56cc9197bb92053a': '2025__part-00008.jsonl.gz',
           '373a0b6a9687c245607060d92aa6d04da2dfe10c2a85a592ded27e5d73430af9': '2025__part-00009.jsonl.gz',
           'ef45b44a8fa496404c1476fde3426e211bc0ef1cad830aa8821b97ecbc494990': '2024__part-00001.jsonl.gz',
           '089986abb89e85d14054004ed8672beccd12e278fe2307d724a78d8e9f24923d': '2024__part-00002.jsonl.gz'}
HEADER = ['#', 'Status', 'Batch', 'Batch decision', 'Row decision ID', 'Approver', 'Source key', 'Title', 'Case number', 'Order date', 'Pages',
          'Official PDF URL', 'Document ID', 'Text SHA-256', 'Chunks', 'Job ID', 'Job status', 'Embedding tokens', 'Embedding cost USD',
          'OCR pages', 'Registered at (UTC)', 'Indexed at (UTC)', 'Listing record ID', 'Listing row key', 'Listing origin', 'Listing type',
          'Forum', 'Listing created at (UTC)', 'Source membership', 'Publication status', 'Publication decision', 'Publication approver',
          'Published at (UTC)', 'Review rules SHA-256 (screen.json)', 'Package ID', 'Mapping version', 'Candidates file SHA-256', 'Pack member',
          'Ledger exported at (UTC)']
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
out = []
for i, r in enumerate(ROWS, 1):
    (bdec, rdec, key, title, case, odate, pages, url, doc, tsha, chunks, job, jst, tok, cost, ocr, reg, idx,
     rec, rkey, rtype, forum, rcreated, mem, pst, pdec, pappr, pubat, rules, pkg, mver, fsha) = r
    bkey, b = batch_of(bdec)
    done = jst == 'succeeded' and idx and pst == 'published'
    origin = '' if not rkey else ('new listing created at publication' if str(rkey).startswith('law-order:') else 'existing register listing')
    out.append([i, 'DONE' if done else 'PENDING', b['batch'], bkey, rdec, b['approver'], key, title, case, odate, pages, url, doc, tsha, chunks,
                job, jst, tok, cost, ocr, reg, idx, rec, rkey, origin, rtype, forum, rcreated, mem, pst, pdec, pappr, pubat, rules, pkg, mver, fsha,
                FILEMAP.get(fsha, ''), now])
LEDGER_DIR = '/content/drive/MyDrive/Data Handover/Legal/v1.1/ledger'; os.makedirs(LEDGER_DIR, exist_ok=True)
buf = io.StringIO(); w = csv.writer(buf); w.writerow(HEADER); w.writerows(out)
csv_bytes = buf.getvalue().encode('utf-8')
pathlib.Path(LEDGER_DIR + '/nter-law-ingestion-ledger.csv').write_bytes(csv_bytes)
csv_sha = hashlib.sha256(csv_bytes).hexdigest()
pathlib.Path(LEDGER_DIR + '/nter-law-ingestion-ledger.csv.sha256').write_text(csv_sha + '\n')
summ = {}
for row in out:
    s = summ.setdefault(row[3], {'docs': 0, 'done': 0, 'chunks': 0, 'tokens': 0, 'cost': 0.0})
    s['docs'] += 1; s['done'] += row[1] == 'DONE'; s['chunks'] += int(row[14] or 0); s['tokens'] += int(row[17] or 0); s['cost'] += float(row[18] or 0)
BHEAD = ['Batch', 'Decision', 'Approver', 'Authorized', 'Documents', 'DONE', 'Chunks', 'Embedding tokens', 'Embedding cost USD', 'Decision manifest SHA-256', 'Receipt (repo)']
brows = [[batch_of(k)[1].get('batch', k), k, batch_of(k)[1].get('approver', ''), batch_of(k)[1].get('authorized', ''), v['docs'], v['done'],
          v['chunks'], v['tokens'], round(v['cost'], 8), batch_of(k)[1].get('manifest', ''), batch_of(k)[1].get('receipt', '')] for k, v in summ.items()]
tot = ['TOTAL', '', '', '', sum(v['docs'] for v in summ.values()), sum(v['done'] for v in summ.values()), sum(v['chunks'] for v in summ.values()),
       sum(v['tokens'] for v in summ.values()), round(sum(v['cost'] for v in summ.values()), 8), '', '']
# Google Sheet (owner's Drive, next to the legal pack). One sheet, overwritten in full on each update.
from google.colab import auth; auth.authenticate_user()
import gspread, google.auth
creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'])
gc = gspread.authorize(creds)
ID_FILE = LEDGER_DIR + '/sheet-id.txt'
if os.path.exists(ID_FILE):
    sh = gc.open_by_key(open(ID_FILE).read().strip())
else:
    sh = gc.create('NTER Law ingestion ledger', folder_id='1eGkTBvSyMWx7Ld1R9PB5bbnP-qgt_mQ0')
    pathlib.Path(ID_FILE).write_text(sh.id)
def put(title, header, rows, extra=None):
    try:
        ws = sh.worksheet(title); ws.clear()
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title, rows=max(len(rows) + 10, 100), cols=len(header) + 2)
    ws.resize(rows=max(len(rows) + 10, 100), cols=len(header) + 2)
    ws.update(values=[header] + [[('' if v is None else v) for v in r] for r in rows] + (extra or []), range_name='A1', value_input_option='RAW')
    ws.freeze(rows=1)
    ws.format('1:1', {'textFormat': {'bold': True}})
    return ws
put('Ingested (DONE)', HEADER, out)
put('Batches', BHEAD, brows, [tot, [], ['Ledger CSV', 'Data Handover/Legal/v1.1/ledger/nter-law-ingestion-ledger.csv', 'sha256', csv_sha], ['Exported at (UTC)', now],
                              ['Source', 'read-only SQL over documents, ingest_text_inputs, ingest_jobs, law_publications, law_document_links, law_records, law_source_memberships']])
try:
    sh.del_worksheet(sh.worksheet('Sheet1'))
except Exception:
    pass
print(json.dumps({'sheet_url': sh.url, 'rows': len(out), 'done': sum(r[1] == 'DONE' for r in out), 'csv_sha256': csv_sha, 'batches': brows, 'total': tot}, indent=1, default=str))
