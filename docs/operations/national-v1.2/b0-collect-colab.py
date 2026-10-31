# B0 step 2: read-only per-record facts of the National v1.2 delta pack, for overlap with live documents. Google Colab.
# Status: Living (2026-10-31). Offline: no token, no request to nter.pro or Supabase, no loaders. Reads the pinned v1.2
# delta zip from Drive and writes, to Data Handover/National/v1.1/staging/v1.2-b0/, one TSV row per document record
# (no text): member, source_key, desk_feature, doc_type, content_sha256, old_content_sha256, file_url, servable,
# retrieval_excluded, replaces_text, page_split, n_chars, page_count, and an offline chunk estimate from the shared
# whole-document chunker (b0-chunk-estimate.mjs). Overlap with live documents is computed elsewhere from a read-only export.
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-v1.2/b0-collect-colab.py').read()
#   print(hashlib.sha256(src).hexdigest()); exec(compile(src, 'b0-collect-colab.py', 'exec')); collect(REPO_SHA)
import gzip, hashlib, io, json, os, pathlib, subprocess, tarfile, urllib.request, zipfile

PACK = '/content/drive/MyDrive/Data Handover/National/v1.2/file to ingest/NTER_citation_pack_v1.2_DELTA_2026-10-06.zip'
PACK_SHA256 = '0cc3853f463ecd493e27528a64a961b981c61fd97689a43bd218a870abe3611e'
OUT = pathlib.Path('/content/drive/MyDrive/Data Handover/National/v1.1/staging/v1.2-b0')
W = pathlib.Path('/content/nter-v12-b0')
REPO = W / 'niyantran'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
COLS = ['member', 'source_key', 'desk_feature', 'doc_type', 'content_sha256', 'old_content_sha256', 'file_url', 'servable',
        'retrieval_excluded', 'replaces_text', 'page_split', 'n_chars', 'page_count', 'chunks_est', 'tokens_est']


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def collect(repo_sha):
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    if (OUT / 'b0-records.tsv').exists():
        raise SystemExit('b0-records.tsv exists; never overwritten')
    if sha(PACK) != PACK_SHA256:
        raise SystemExit('v1.2 delta pack hash changed')
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        subprocess.run(['git', 'init', '-q', str(REPO)], check=True)
        subprocess.run(['git', '-C', str(REPO), 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'], check=True)
    subprocess.run(['git', '-C', str(REPO), 'fetch', '--depth', '1', '-q', 'origin', repo_sha], check=True)
    subprocess.run(['git', '-C', str(REPO), 'checkout', '-q', '-f', repo_sha], check=True)
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        if sha(tgz) != NODE_SHA:
            raise SystemExit('node tarball hash mismatch')
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)
    zf = zipfile.ZipFile(PACK)
    manifest = json.loads(zf.read('citation_pack_v1/manifest_delta.json'))
    rows, texts = [], W / 'texts.jsonl'
    with open(texts, 'w', encoding='utf-8') as tf:
        for name in sorted(n for n in zf.namelist() if n.endswith('.jsonl.gz')):
            want = manifest['files'][name.split('citation_pack_v1/', 1)[1]]['sha256']
            data = zf.read(name)
            if hashlib.sha256(data).hexdigest() != want:
                raise SystemExit(f'{name} does not match manifest_delta.json')
            for line in io.StringIO(gzip.decompress(data).decode('utf-8')):
                if not line.strip():
                    continue
                r = json.loads(line)
                rows.append({'member': name.rsplit('/', 1)[1], **{c: r.get(c) for c in COLS[1:13]}})
                tf.write(json.dumps({'k': f"{len(rows) - 1}", 't': r.get('text') or ''}) + '\n')
    est = subprocess.run([str(NODE), '--experimental-strip-types', 'docs/operations/national-v1.2/b0-chunk-estimate.mjs', str(texts)],
                         cwd=REPO, capture_output=True, text=True)
    if est.returncode != 0:
        raise SystemExit('chunk estimate failed: ' + est.stderr[-500:])
    for line in est.stdout.splitlines():
        i, c, t = line.split('\t')
        rows[int(i)]['chunks_est'], rows[int(i)]['tokens_est'] = int(c), int(t)
    texts.unlink()
    OUT.mkdir(parents=True, exist_ok=True)
    clean = lambda v: '' if v is None else str(v).replace('\t', ' ').replace('\n', ' ')
    body = '\t'.join(COLS) + '\n' + ''.join('\t'.join(clean(r.get(c)) for c in COLS) + '\n' for r in rows)
    (OUT / 'b0-records.tsv').write_text(body)
    print(json.dumps({'records': len(rows), 'pack_sha256': PACK_SHA256, 'tsv_sha256': hashlib.sha256(body.encode()).hexdigest()}))
    print('COLLECTED. No text written; nothing sent anywhere.')
