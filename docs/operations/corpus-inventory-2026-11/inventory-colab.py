# Corpus inventory, pass 2 (counts, hashes, chunk estimates, duplicates). Google Colab. Read-only.
# Status: Living (2026-11-01). Developers' Task B. No token, no request to nter.pro or Supabase, no database access.
# It reads the packs under "Data Handover" on Drive and writes only to Drive (Data Handover/_inventory-2026-11/):
#   summary.json                        counts and hashes only (no keys, no text, no titles, no names); committed by the agent
#   keys/<pack>/<collection>.tsv.gz     key, text sha256, chars, chunks, state per record (stays on Drive; never committed)
# Chunk and token estimates use the repository chunker (supabase/functions/_shared/chunking.ts) at the checked-out commit,
# which must be byte-identical to main at ea34b555 for chunking.ts, textNormalise.ts and pageText.ts.
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/corpus-inventory-2026-11/inventory-colab.py').read()
#   print(hashlib.sha256(src).hexdigest()); exec(compile(src, 'inventory-colab.py', 'exec')); inventory(REPO_SHA)
import csv, gzip, hashlib, io, json, multiprocessing as mp, os, pathlib, re, shutil, subprocess, tarfile, threading, time, urllib.request, zipfile
from array import array
from collections import Counter, defaultdict

DH = pathlib.Path('/content/drive/MyDrive/Data Handover')
OUT = DH / '_inventory-2026-11'
W = pathlib.Path('/content/nter-inventory')
REPO = W / 'niyantran'
MAIN_SHA = 'ea34b555484a5e705c6400d9bbee22aa4309d9b5'
CHUNKER_FILES = ['chunking.ts', 'textNormalise.ts', 'pageText.ts']
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
MJS = 'docs/operations/corpus-inventory-2026-11/inventory-records.mjs'
BLOCK = 4 << 20

# Packs in scope (from pass 1, discovery.json). family decides how members are read.
PACKS = [
    dict(id='legal_v1.1_full', kind='zip', family='legal', path='Legal/v1.1/file to ingest/NTER_legal_pack_v1.1_FULL_2026-10-18.zip'),
    dict(id='citation_v1.1', kind='zip', family='citation', path='National/v1.1/file to ingest/NTER_citation_pack_v1.1_2026-10-05.zip'),
    dict(id='citation_v1.2_delta', kind='zip', family='citation', path='National/v1.2/file to ingest/NTER_citation_pack_v1.2_DELTA_2026-10-06.zip'),
    dict(id='citation_v1.3_delta', kind='zip', family='citation', path='National/v1.3/file to ingest/NTER_citation_pack_v1.3_DELTA_2026-10-08.zip'),
    dict(id='citation_v1.4_delta', kind='zip', family='citation', path='National/v1.4/file to ingest/NTER_citation_pack_v1.4_DELTA_2026-10-13.zip'),
    dict(id='citation_v1.5_delta', kind='zip', family='citation', path='National/v1.5/file to ingest/NTER_citation_pack_v1.5_DELTA_2026-10-17.zip'),
    dict(id='processed_2026-09-18', kind='zip', family='processed',
         path='National/v1.1/raw data/Earlier handover - Sep 2026 (full processed data)/NTER-Complete-Processed-Data-2026-09-18.zip'),
    dict(id='tenders_v1.6_side', kind='folder', family='rows', path='NTER_v1.6_side_archive_tenders_aoc'),
    dict(id='citation_v1.1_companion', kind='folder', family='citation', path='NTER_citation_pack_v1.1_2026-10-05'),
]
# Extracted copies of zips: every file is hashed and compared with the zip member at the same internal path.
EXTRACTED = {
    'NTER_citation_pack_v1.3_DELTA_2026-10-08': 'citation_v1.3_delta',
    'NTER_citation_pack_v1.4_DELTA_2026-10-13': 'citation_v1.4_delta',
    'NTER_citation_pack_v1.5_DELTA_2026-10-17': 'citation_v1.5_delta',
}
# Working folders: not packs. Record files in the first three are read (documents found in no pack); the rest are listed.
WORKING = [
    dict(id='work_v14_records', path='_v14_work/records', read=True),
    dict(id='work_v15_ocr16_jobs', path='_v15_mac/ocr16', read=True),
    dict(id='work_refresh_runs', path='_refresh/runs', read=True),
    dict(id='work_v14_other', path='_v14_work', read=False, exclude=('records',)),
    dict(id='work_v15_other', path='_v15_mac', read=False, exclude=('ocr16',)),
    dict(id='work_national_raw_new', path='_national_raw_new', read=False),
    dict(id='staging_legal', path='Legal/v1.1/staging', read=False),
    dict(id='staging_national', path='National/v1.1/staging', read=False),
    dict(id='legal_v1.1_other', path='Legal/v1.1', read=False, exclude=('staging', 'file to ingest')),
]
PERSONAL_COLLECTION = re.compile(r'affidavit|mp_profile', re.I)
RECORD_EXT = re.compile(r'\.(jsonl|ndjson)(\.gz)?$', re.I)


def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


class Hashing(io.RawIOBase):
    """Wraps a byte stream and hashes exactly the bytes read through it."""
    def __init__(self, raw):
        self.raw, self.h, self.n = raw, hashlib.sha256(), 0
    def readable(self):
        return True
    def readinto(self, b):
        data = self.raw.read(len(b))
        if not data:
            return 0
        self.h.update(data); self.n += len(data)
        b[:len(data)] = data
        return len(data)
    def drain(self):
        while True:
            data = self.raw.read(BLOCK)
            if not data:
                return
            self.h.update(data); self.n += len(data)


def collection_of(family, member):
    """Collection name for a member read as records, or None."""
    m = member
    if family == 'legal':
        x = re.search(r'/documents/([^/]+)/[^/]+\.jsonl\.gz$', m)
        return x.group(1) if x and not m.endswith('.boxes.jsonl.gz') else None
    if family == 'citation':
        x = re.search(r'(?:^|/)documents/([^/]+?)(-\d\d)?\.jsonl\.gz$', m)
        if x:
            return x.group(1)
        x = re.search(r'(?:^|/)gapfill/(?:.*/)?([^/]+?)(_\d{8}T\d{6}Z)?\.jsonl\.gz$', m)
        return ('gapfill:' + x.group(1)) if x else None
    if family == 'processed':
        if re.search(r'01_original_corpus/documents\.jsonl\.gz$', m):
            return 'documents'
        if re.search(r'01_original_corpus/ocr_raw/[^/]+\.jsonl(\.gz)?$', m):
            return 'ocr_raw'
        if re.search(r'03_individual_ocr/[^/]+/[^/]+\.md$', m):
            return 'individual_ocr'
        return None
    if family == 'rows':
        x = re.search(r'^(awards|notices)/.+\.jsonl(\.gz)?$', m)
        return x.group(1) if x else None
    if family == 'work':
        if not RECORD_EXT.search(m):
            return None
        parts = m.split('/')
        if len(parts) > 1 and not re.match(r'^\d{8}T\d{6}Z?$', parts[0]):
            return parts[0]
        return re.sub(r'(-\d+|_\d{8}T\d{6}Z)?\.(jsonl|ndjson)(\.gz)?$', '', parts[-1])
    return None


def count_kind(family, member):
    """Members counted by lines only: listing rows, links, supplied chunks."""
    m = '/' + member
    if family == 'citation' and re.search(r'/rows/[^/]+\.jsonl(\.gz)?$', m):
        return 'rows'
    if family == 'citation' and re.search(r'/links/[^/]+\.csv(\.gz)?$', m):
        return 'links'
    if family == 'processed' and re.search(r'/01_original_corpus/(chunks|not_servable_chunks)\.jsonl(\.gz)?$', m):
        return 'supplied_chunks'
    return None


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
    paths = [f'supabase/functions/_shared/{f}' for f in CHUNKER_FILES]
    if subprocess.run(['git', '-C', str(REPO), 'diff', '--quiet', MAIN_SHA, repo_sha, '--', *paths]).returncode != 0:
        raise SystemExit('chunker files differ from main ea34b555: refusing')
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha_file(tgz) != NODE_SHA:
            raise SystemExit('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24', filter='data')
        os.chmod(NODE, 0o755)
    return {f: sha_file(REPO / 'supabase/functions/_shared' / f) for f in CHUNKER_FILES}


def _task(**k):
    k.setdefault('copy_of', None)
    return k


def plan():
    tasks = []
    for p in PACKS:
        full = DH / p['path']
        if p['kind'] == 'zip':
            with zipfile.ZipFile(full) as z:
                for i, info in enumerate(z.infolist()):
                    if info.is_dir():
                        continue
                    n = info.filename
                    col, ck = collection_of(p['family'], n), count_kind(p['family'], n)
                    if col == 'individual_ocr':
                        mode = 'md'
                    elif col:
                        mode = 'records'
                    elif ck:
                        mode = 'count'
                    elif p['family'] == 'legal' and n.endswith('.boxes.jsonl.gz'):
                        mode = 'skip'   # page-box sidecars: listed with bytes; covered by the pack hash
                    elif p['family'] == 'processed' and '/backup_' in n:
                        mode = 'skip'   # historical backups inside the processed zip: listed with bytes; not additive
                    else:
                        mode = 'hash'
                    tasks.append(_task(task=f"{p['id']}#{i}", pack=p['id'], family=p['family'], src='zip', path=str(full), index=i,
                                       member=n, size=info.compress_size, usize=info.file_size, mode=mode, collection=col or ck))
        else:
            for f in sorted(full.rglob('*')):
                if f.is_file():
                    rel = str(f.relative_to(full))
                    col, ck = collection_of(p['family'], rel), count_kind(p['family'], rel)
                    sz = f.stat().st_size
                    tasks.append(_task(task=f"{p['id']}:{rel}", pack=p['id'], family=p['family'], src='file', path=str(f), index=None,
                                       member=rel, size=sz, usize=sz, mode='records' if col else ('count' if ck else 'hash'),
                                       collection=col or ck))
    for folder, pack in EXTRACTED.items():
        for f in sorted((DH / folder).rglob('*')):
            if f.is_file():
                rel = str(f.relative_to(DH / folder)); sz = f.stat().st_size
                tasks.append(_task(task=f'extracted:{folder}:{rel}', pack='extracted:' + folder, family='extracted', src='file',
                                   path=str(f), index=None, member=rel, size=sz, usize=sz, mode='hash', collection=None, copy_of=pack))
    for wk in WORKING:
        base = DH / wk['path']
        if not base.exists():
            continue
        for f in sorted(base.rglob('*')):
            if not f.is_file():
                continue
            rel = str(f.relative_to(base))
            if rel.split('/')[0] in wk.get('exclude', ()):
                continue
            col = collection_of('work', rel) if wk['read'] else None
            sz = f.stat().st_size
            tasks.append(_task(task=f"{wk['id']}:{rel}", pack=wk['id'], family='work', src='file', path=str(f), index=None,
                               member=rel, size=sz, usize=sz, mode='records' if col else 'list', collection=col))
    return tasks


def worker(wid, tasks, node, mjs, cwd, outdir):
    out = open(outdir / f'w{wid}.tsv', 'wb')
    err = open(outdir / f'w{wid}.err', 'wb')
    proc = subprocess.Popen([node, '--experimental-strip-types', '--no-warnings', mjs], cwd=cwd, stdin=subprocess.PIPE,
                            stdout=out, stderr=err)
    meta = open(outdir / f'w{wid}.meta.jsonl', 'a')
    zips = {}
    for t in tasks:
        t0 = time.time()
        m = dict(task=t['task'], mode=t['mode'])
        try:
            if t['mode'] in ('skip', 'list'):
                m['bytes'] = t['usize']
            else:
                if t['src'] == 'zip':
                    z = zips.get(t['path']) or zips.setdefault(t['path'], zipfile.ZipFile(t['path']))
                    raw = z.open(z.infolist()[t['index']])
                else:
                    raw = open(t['path'], 'rb')
                with raw:
                    hr = Hashing(raw)
                    if t['mode'] in ('records', 'md', 'count'):
                        body = io.BufferedReader(hr, BLOCK)
                        stream = gzip.GzipFile(fileobj=body) if t['member'].endswith('.gz') else body
                        if t['mode'] == 'records':
                            proc.stdin.write(b'\n' + json.dumps({'__task': t['task']}).encode() + b'\n')
                            last = b'\n'
                            for b in iter(lambda: stream.read(BLOCK), b''):
                                proc.stdin.write(b); last = b[-1:]
                            if last != b'\n':
                                proc.stdin.write(b'\n')
                        elif t['mode'] == 'md':
                            text = stream.read().decode('utf-8', 'replace')
                            proc.stdin.write(b'\n' + json.dumps({'__task': t['task']}).encode() + b'\n')
                            proc.stdin.write(json.dumps({'id': t['member'].split('/')[-2], 'text': text, 'source_path': 'pdf'}).encode() + b'\n')
                        else:
                            lines, last = 0, b'\n'
                            for b in iter(lambda: stream.read(BLOCK), b''):
                                lines += b.count(b'\n'); last = b[-1:]
                            m['lines'] = lines + (1 if last != b'\n' else 0)
                        while body.read(BLOCK):   # bytes after the gzip stream, if any
                            pass
                    hr.drain()
                    m.update(bytes=hr.n, sha256=hr.h.hexdigest())
        except Exception as e:
            m['error'] = f'{type(e).__name__}: {str(e)[:200]}'
            if isinstance(e, BrokenPipeError):
                meta.write(json.dumps(m) + '\n'); break
        m['seconds'] = round(time.time() - t0, 2)
        meta.write(json.dumps(m) + '\n'); meta.flush()
    try:
        proc.stdin.close()
    except Exception:
        pass
    proc.wait()
    meta.write(json.dumps({'worker_done': wid, 'node_exit': proc.returncode}) + '\n'); meta.close()


def khash(s):
    return int.from_bytes(hashlib.blake2b(s.encode('utf-8', 'replace'), digest_size=8).digest(), 'little') if s else 0


def policy_legal(path):
    """Counts from the legal pack's own policy files, plus key-hash sets to join (keys are not kept)."""
    out, flagged, aliases, not_in_pack = {}, set(), set(), 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n = info.filename
            if not re.search(r'/(flags|dedupe|not_in_pack)/[^/]+\.csv(\.gz)?$', n):
                continue
            rows, by = 0, Counter()
            with z.open(info) as raw:
                fh = gzip.open(raw, 'rt', encoding='utf-8', errors='replace') if n.endswith('.gz') else io.TextIOWrapper(raw, 'utf-8', 'replace')
                r = csv.DictReader(fh)
                cols = r.fieldnames
                for row in r:
                    rows += 1
                    k = row.get('source_key') or row.get('doc_id') or row.get('id') or ''
                    if '/flags/' in n:
                        flagged.add(khash(k)); by['tier:' + str(row.get('tier') or '')] += 1
                    elif '/dedupe/' in n:
                        if str(row.get('keep')) == '0':
                            aliases.add(khash(k))
                        by['keep=' + str(row.get('keep'))] += 1
                    else:
                        by['collection:' + str(row.get('collection') or row.get('kind') or row.get('court') or '')] += 1
            if '/not_in_pack/' in n:
                not_in_pack += rows
            out[n.split('/', 1)[1]] = {'rows': rows, 'columns': [c for c in (cols or []) if c], 'counts': dict(by.most_common(40))}
    return out, flagged, aliases, not_in_pack


def _overlap(a, b):
    import numpy as np
    if len(a) == 0 or len(b) == 0:
        return 0
    if len(a) > len(b):
        a, b = b, a
    i = np.searchsorted(b, a)
    i[i == len(b)] = len(b) - 1
    return int((b[i] == a).sum())


def aggregate(tasks, outdir, flagged, aliases):
    import numpy as np
    tmap = {t['task']: t for t in tasks}
    blank = lambda: dict(occ=0, text=0, ocr_needed=0, no_text=0, chars=0, chunks=0, tokens=0, serv_f=0, serv_t=0, rexcl=0,
                         replaces=0, personal_licence=0, personal_fields=0, nokey=0, unreadable=0, full_members_occ=0,
                         licence=Counter(), split=Counter(), extraction=Counter(), pfields=Counter())
    cols = defaultdict(blank)
    keyarr = defaultdict(lambda: array('Q')); txtarr = defaultdict(lambda: array('Q')); chunkarr = defaultdict(lambda: array('I'))
    keysdir = W / 'keys'
    if keysdir.exists():
        shutil.rmtree(keysdir)
    writers = {}
    for wf in sorted(outdir.glob('w*.tsv')):
        cur = None
        with open(wf, 'r', encoding='utf-8', errors='replace') as fh:
            for line in fh:
                p = line.rstrip('\n').split('\t')
                if p[0] == 'T':
                    cur = tmap.get(p[1]); continue
                if cur is None:
                    continue
                pack, col = cur['pack'], cur['collection']
                if p[0] == 'E':
                    cols[(pack, col)]['unreadable'] += 1; continue
                p += [''] * (17 - len(p))
                (_, key, tsha, dsha, chars, chunks, tokens, state, serv, rexcl, repl, lic, split, extr, feat, dtype, pf) = p[:17]
                if cur['family'] == 'processed' and col in ('documents', 'ocr_raw'):
                    col = f'{col}:{feat or dtype or "unknown"}'
                c = cols[(pack, col)]
                c['occ'] += 1; c[state] += 1
                if state == 'text':
                    c['chars'] += int(chars); c['chunks'] += int(chunks); c['tokens'] += int(tokens)
                c['serv_f'] += serv == 'F'; c['serv_t'] += serv == 'T'; c['rexcl'] += rexcl == 'T'; c['replaces'] += repl == 'T'
                c['personal_licence'] += 'PERSONAL' in lic.upper()
                if pf:
                    c['personal_fields'] += 1
                    for f in pf.split(','):
                        c['pfields'][f] += 1
                c['nokey'] += not key
                c['licence'][lic] += 1; c['split'][split] += 1; c['extraction'][extr] += 1
                if '__full' in cur['member']:
                    c['full_members_occ'] += 1
                keyarr[(pack, col)].append(khash(key))
                txtarr[(pack, col)].append(int(tsha[:16], 16) if tsha else 0)
                chunkarr[(pack, col)].append(int(chunks) if state == 'text' else 0)
                wk = (pack, col)
                if wk not in writers:
                    d = keysdir / pack; d.mkdir(parents=True, exist_ok=True)
                    writers[wk] = gzip.open(d / (re.sub(r'[^A-Za-z0-9_.-]+', '_', col) + '.tsv.gz'), 'wt', encoding='utf-8')
                    writers[wk].write('key\ttext_sha256\tchars\tchunks\tstate\n')
                writers[wk].write(f'{key}\t{tsha}\t{chars}\t{chunks}\t{state}\n')
    for w in writers.values():
        w.close()
    flagged_a = np.sort(np.fromiter(flagged, dtype=np.uint64, count=len(flagged)))
    alias_a = np.sort(np.fromiter(aliases, dtype=np.uint64, count=len(aliases)))
    result, ukeys, utxts, firsttxt = [], {}, {}, []
    for (pack, col), c in sorted(cols.items(), key=lambda kv: (kv[0][0], str(kv[0][1]))):
        k = np.frombuffer(keyarr[(pack, col)], dtype=np.uint64)
        t = np.frombuffer(txtarr[(pack, col)], dtype=np.uint64)
        ch = np.frombuffer(chunkarr[(pack, col)], dtype=np.uint32)
        uk, kc = np.unique(k[k != 0], return_counts=True)
        ut, first = np.unique(t, return_index=True)
        keep = ut != 0
        ut, first = ut[keep], first[keep]
        pairh = k ^ (t * np.uint64(0x9E3779B97F4A7C15))
        _, pi = np.unique(pairh, return_index=True)
        kp = k[pi]
        _, pc = np.unique(kp[kp != 0], return_counts=True)
        legal = pack.startswith('legal')
        result.append(dict(
            pack=pack, collection=col, records=c['occ'], records_without_key=c['nokey'], distinct_keys=int(len(uk)),
            keys_repeated=int((kc > 1).sum()), repeat_occurrences=int((kc[kc > 1] - 1).sum()), keys_with_differing_texts=int((pc > 1).sum()),
            supplied_text=c['text'], ocr_needed=c['ocr_needed'], no_text=c['no_text'],
            distinct_texts=int(len(ut)), duplicate_text_records=int(c['text'] - len(ut)),
            characters=c['chars'], chunks=c['chunks'], chunks_distinct_texts=int(ch[first].sum()), tokens=c['tokens'],
            servable_false=c['serv_f'], servable_true=c['serv_t'], retrieval_excluded=c['rexcl'], replaces_text=c['replaces'],
            personal_by_licence=c['personal_licence'], personal_by_fields=c['personal_fields'], personal_field_names=dict(c['pfields']),
            personal_by_collection=c['occ'] if PERSONAL_COLLECTION.search(str(col)) else 0,
            sensitivity_flagged_keys=_overlap(uk, flagged_a) if legal else 0, dedupe_alias_keys=_overlap(uk, alias_a) if legal else 0,
            replacement_member_records=c['full_members_occ'], unreadable_lines=c['unreadable'],
            licence_classes=dict(c['licence'].most_common(8)), page_split=dict(c['split'].most_common(6)),
            extraction=dict(c['extraction'].most_common(8))))
        ukeys[(pack, col)] = uk; utxts[(pack, col)] = ut
        firsttxt.append((pack, t[first], ch[first]))
    units = sorted(ukeys, key=lambda u: (u[0], str(u[1])))
    overlaps = []
    for i, a in enumerate(units):
        for b in units[i + 1:]:
            ok, ot = _overlap(ukeys[a], ukeys[b]), _overlap(utxts[a], utxts[b])
            if ok or ot:
                overlaps.append(dict(a=f'{a[0]} / {a[1]}', b=f'{b[0]} / {b[1]}', same_pack=a[0] == b[0], shared_keys=ok, shared_texts=ot))
    def totals(select):
        sel = [r for r in result if select(r['pack'])]
        ks = [ukeys[(r['pack'], r['collection'])] for r in sel]
        tt = [(x, y) for (p, x, y) in firsttxt if select(p)]
        allk = np.unique(np.concatenate(ks)) if ks else np.zeros(0, np.uint64)
        if tt:
            th = np.concatenate([x for x, _ in tt]); tc = np.concatenate([y for _, y in tt])
            u, f = np.unique(th, return_index=True)
            dt, dch = int(len(u)), int(tc[f].sum())
        else:
            dt = dch = 0
        s = lambda f: sum(r[f] for r in sel)
        return dict(collections=len(sel), records=s('records'), distinct_keys_within_collections=s('distinct_keys'),
                    distinct_keys_overall=int(len(allk)), supplied_text=s('supplied_text'), ocr_needed=s('ocr_needed'),
                    no_text=s('no_text'), characters=s('characters'), chunks=s('chunks'), tokens=s('tokens'),
                    distinct_texts_overall=dt, chunks_over_distinct_texts=dch, servable_false=s('servable_false'),
                    retrieval_excluded=s('retrieval_excluded'), personal_by_licence=s('personal_by_licence'),
                    personal_by_fields=s('personal_by_fields'), personal_by_collection=s('personal_by_collection'),
                    sensitivity_flagged_keys=s('sensitivity_flagged_keys'), dedupe_alias_keys=s('dedupe_alias_keys'))
    pack_ids = [p['id'] for p in PACKS]
    tot = dict(packs=totals(lambda p: p in pack_ids), working_folders=totals(lambda p: p.startswith('work_')),
               everything=totals(lambda p: not p.startswith('extracted')))
    for p in pack_ids:
        tot['pack:' + p] = totals(lambda q, p=p: q == p)
    return result, overlaps, tot


def inventory(repo_sha, workers=None):
    t0 = time.time()
    chunker = setup(repo_sha)
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT / 'summary.json').exists():
        raise SystemExit('summary.json exists; it is never overwritten (move it aside to re-run)')
    tasks = plan()
    work = [t for t in tasks if t['mode'] not in ('skip', 'list')]
    print(json.dumps({'tasks': len(tasks), 'read': len(work), 'read_bytes': sum(t['size'] for t in work)}), flush=True)
    outdir = W / 'out'
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)
    n = workers or min(8, max(4, 2 * (os.cpu_count() or 2)))
    buckets, load = [[] for _ in range(n)], [0] * n
    for t in sorted(tasks, key=lambda t: -t['size']):
        i = load.index(min(load)); buckets[i].append(t)
        load[i] += t['size'] if t['mode'] not in ('skip', 'list') else 0
    ctx = mp.get_context('fork')
    procs = [ctx.Process(target=worker, args=(i, b, str(NODE), MJS, str(REPO), outdir)) for i, b in enumerate(buckets)]
    for p in procs:
        p.start()
    pack_hash, threads = {}, []
    for pk in PACKS:
        if pk['kind'] == 'zip':
            f = DH / pk['path']
            th = threading.Thread(target=lambda f=f, i=pk['id']: pack_hash.__setitem__(i, {'bytes': f.stat().st_size, 'sha256': sha_file(f)}))
            th.start(); threads.append(th)
    while any(p.is_alive() for p in procs) or any(th.is_alive() for th in threads):
        time.sleep(60 if not os.environ.get('INVENTORY_TEST') else 0.2)
        done = sum(1 for f in outdir.glob('w*.meta.jsonl') for l in open(f) if l.startswith('{"task"'))
        print(f'{time.time() - t0:7.0f}s  tasks done {done}/{len(tasks)}  packs hashed {len(pack_hash)}', flush=True)
    for p in procs:
        p.join()
    for th in threads:
        th.join()
    metas = [json.loads(l) for f in sorted(outdir.glob('w*.meta.jsonl')) for l in open(f)]
    errs = [m for m in metas if m.get('error')]
    node_exit = [m['node_exit'] for m in metas if 'worker_done' in m]
    by_task = {m['task']: m for m in metas if 'task' in m}
    missing = [t['task'] for t in tasks if t['task'] not in by_task]
    legal = next(p for p in PACKS if p['family'] == 'legal')
    policy, flagged, aliases, not_in_pack = policy_legal(DH / legal['path'])
    collections, overlaps, totals = aggregate(tasks, outdir, flagged, aliases)
    member_sha = {(t['pack'], t['member']): by_task.get(t['task'], {}).get('sha256') for t in tasks if t['src'] == 'zip'}
    extracted = {}
    for folder, pack in EXTRACTED.items():
        rows = [t for t in tasks if t['pack'] == 'extracted:' + folder]
        same = diff = notin = 0; details = []
        for t in rows:
            zsha, fsha = member_sha.get((pack, t['member'])), by_task.get(t['task'], {}).get('sha256')
            if zsha is None:
                notin += 1; details.append({'file': t['member'], 'bytes': t['size'], 'why': 'not a member of the zip'})
            elif zsha == fsha:
                same += 1
            else:
                diff += 1; details.append({'file': t['member'], 'bytes': t['size'], 'why': 'bytes differ from the zip member'})
        extracted[folder] = {'copy_of': pack, 'files': len(rows), 'bytes': sum(t['size'] for t in rows), 'identical': same,
                             'differing': diff, 'not_in_zip': notin, 'details': details[:60]}
    packs = []
    for p in PACKS:
        pt = [t for t in tasks if t['pack'] == p['id']]
        ph = pack_hash.get(p['id'], {})
        packs.append(dict(
            id=p['id'], kind=p['kind'], path=p['path'], members=len(pt), member_modes=dict(Counter(t['mode'] for t in pt)),
            bytes=ph.get('bytes', sum(t['size'] for t in pt)), uncompressed_member_bytes=sum(t['usize'] for t in pt), sha256=ph.get('sha256'),
            repeated_member_names=sum(1 for _, c in Counter(t['member'] for t in pt).items() if c > 1),
            skipped_bytes=sum(t['usize'] for t in pt if t['mode'] == 'skip'),
            files_manifest_sha256=hashlib.sha256(''.join(sorted(f"{t['member']}\t{by_task.get(t['task'], {}).get('sha256')}\n"
                                                                for t in pt)).encode()).hexdigest() if p['kind'] == 'folder' else None,
            counted_lines={k: sum(by_task.get(t['task'], {}).get('lines', 0) for t in pt if t['collection'] == k)
                           for k in sorted({t['collection'] for t in pt if t['mode'] == 'count'})},
            member_errors=[{'member': t['member'], 'error': by_task[t['task']]['error']} for t in pt
                           if by_task.get(t['task'], {}).get('error')][:40]))
    working = []
    for wk in WORKING:
        pt = [t for t in tasks if t['pack'] == wk['id']]
        working.append(dict(id=wk['id'], path=wk['path'], files=len(pt), bytes=sum(t['size'] for t in pt), read=wk['read'],
                            record_files=sum(1 for t in pt if t['mode'] == 'records'),
                            member_errors=[{'file': t['member'], 'error': by_task[t['task']]['error']} for t in pt
                                           if by_task.get(t['task'], {}).get('error')][:40]))
    summary = dict(
        generated_utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), repo_sha=repo_sha, main_sha=MAIN_SHA, chunker_sha256=chunker,
        chunker='chunkUnit({unitKey: document, sourceKind: document}) with CHUNK defaults; tokens = sum of estimateTokens per chunk',
        seconds=round(time.time() - t0), workers=n, node_exit=node_exit, task_errors=len(errs), tasks_without_result=len(missing),
        packs=packs, extracted_copies=extracted, working_folders=working, legal_policy=policy, legal_not_in_pack_rows=not_in_pack,
        totals=totals, collections=collections, overlaps=overlaps)
    body = json.dumps(summary, indent=1, sort_keys=True, default=int)
    (OUT / 'summary.json').write_text(body)
    shutil.copytree(W / 'keys', OUT / 'keys', dirs_exist_ok=True)
    print(json.dumps({'summary_sha256': hashlib.sha256(body.encode()).hexdigest(), 'collections': len(collections),
                      'records': totals['everything']['records'], 'task_errors': len(errs), 'tasks_without_result': len(missing),
                      'node_exit': node_exit, 'seconds': summary['seconds']}))
    print('INVENTORIED. Keys and hashes only; no text written; nothing sent anywhere.')
