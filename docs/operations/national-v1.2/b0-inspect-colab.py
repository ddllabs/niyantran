# B0 step 1: read-only structure inspection of the National v1.2 delta pack. Google Colab, Python 3.
# Status: Living (2026-10-31). Offline: no token, no request to nter.pro or Supabase, no loaders, no writes outside the
# staging folder below. Prints and saves the pack's identity, member list, manifest and record schemas (field names,
# types, value examples of short identity fields only). Never prints document text.
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-v1.2/b0-inspect-colab.py').read()
#   print(hashlib.sha256(src).hexdigest()); exec(compile(src, 'b0-inspect-colab.py', 'exec')); inspect_v12()
import collections, gzip, hashlib, io, json, os, pathlib, zipfile

NATIONAL = '/content/drive/MyDrive/Data Handover/National'
OUT = pathlib.Path(NATIONAL + '/v1.1/staging/v1.2-b0')
SHORT = ('source_key', 'doc_type', 'desk_tier', 'desk_feature', 'collection', 'schema', 'page_split', 'servable', 'licence_class',
         'extraction', 'text_engine', 'op', 'action', 'replaces', 'kind', 'status', 'as_of', 'source_host')


def find_pack():
    hits = []
    for root, _, files in os.walk(NATIONAL):
        for f in files:
            if f.startswith('NTER_citation_pack_v1.2') and f.endswith('.zip'):
                hits.append(os.path.join(root, f))
    if len(hits) != 1:
        raise SystemExit(f'expected exactly one v1.2 zip under {NATIONAL}, found {hits}')
    return hits[0]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def lines(zf, name):
    data = zf.read(name)
    if name.endswith('.gz'):
        data = gzip.decompress(data)
    for l in io.StringIO(data.decode('utf-8')):
        if l.strip():
            yield json.loads(l)


def inspect_v12():
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    pack = find_pack()
    out = {'pack': pack, 'bytes': os.path.getsize(pack), 'sha256': sha256(pack), 'members': [], 'schemas': {}}
    zf = zipfile.ZipFile(pack)
    for i in zf.infolist():
        out['members'].append({'name': i.filename, 'bytes': i.file_size, 'compressed': i.compress_size})
    for i in zf.infolist():
        n = i.filename
        if n.endswith(('.json', '.md', '.txt', '.sql', '.csv')) and i.file_size < 2_000_000 and 'manifest' in n.lower():
            out.setdefault('manifests', {})[n] = zf.read(n).decode('utf-8', 'replace')[:20000]
        if n.endswith(('.jsonl', '.jsonl.gz')):
            fields, types, examples, count = collections.Counter(), {}, collections.defaultdict(collections.Counter), 0
            for r in lines(zf, n):
                count += 1
                for k, v in r.items():
                    fields[k] += 1
                    types.setdefault(k, type(v).__name__)
                    if k in SHORT and not isinstance(v, (dict, list)):
                        examples[k][str(v)[:60]] += 1
            out['schemas'][n] = {'records': count, 'fields': dict(fields), 'types': types,
                                 'values': {k: dict(c.most_common(12)) for k, c in examples.items()}}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'b0-structure.json').write_text(json.dumps(out, indent=1))
    print(json.dumps({'pack': out['pack'], 'bytes': out['bytes'], 'sha256': out['sha256'], 'members': len(out['members']),
                      'jsonl': {k: v['records'] for k, v in out['schemas'].items()}}, indent=1))
    print('INSPECTED. Wrote', OUT / 'b0-structure.json', '(no document text). Nothing was sent anywhere.')
