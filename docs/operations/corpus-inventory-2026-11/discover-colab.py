# Corpus inventory, pass 1 (structure discovery). Google Colab. Read-only.
# Status: Living (2026-11-01). Developers' Task B. No token, no request to nter.pro or Supabase, no writes except one
# JSON file to Drive (Data Handover/_inventory-2026-11/discovery.json). It records, for every archive or JSONL file under
# Data Handover (and, by name only, large archives elsewhere in My Drive): path, bytes, member listing summary and, for
# each JSONL/CSV member, the first record's field names and value types. It never records text. Values are kept only for
# short categorical fields (split, type, kind, collection, feature, licence, status, version, schema, language, servable).
#
# Launch (one cell):
#   REPO_SHA = '<commit of this file>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/corpus-inventory-2026-11/discover-colab.py').read()
#   print(hashlib.sha256(src).hexdigest()); exec(compile(src, 'discover-colab.py', 'exec')); discover()
import csv, gzip, io, json, os, pathlib, re, time, zipfile
from collections import Counter

ROOT = pathlib.Path('/content/drive/MyDrive/Data Handover')
MYDRIVE = pathlib.Path('/content/drive/MyDrive')
OUT = ROOT / '_inventory-2026-11'
ARCHIVE = re.compile(r'\.(zip|tar|tgz|tar\.gz|7z|rar)$', re.I)
RECORDS = re.compile(r'\.(jsonl|ndjson|jsonl\.gz|ndjson\.gz|csv|csv\.gz|json|json\.gz|parquet)$', re.I)
CATEGORICAL = re.compile(r'split|type|kind|collection|feature|licen|status|version|schema|lang|servable|excluded|replaces|tier|court|source_kind|format', re.I)
MAX_SAMPLE_MEMBERS = 400   # first-record schemas per archive (distinct directory/extension shapes first)


def shape(v):
    if isinstance(v, dict):
        return {'dict': sorted(v.keys())[:60]}
    if isinstance(v, list):
        return {'list': len(v), 'of': type(v[0]).__name__ if v else None}
    return type(v).__name__


def first_record(fh, name):
    """Field names and types of the first record of a JSONL/CSV stream; categorical values only."""
    low = name.lower()
    if low.endswith('.gz'):
        fh = gzip.GzipFile(fileobj=fh)
        low = low[:-3]
    if low.endswith('.parquet'):
        return {'format': 'parquet'}
    text = io.TextIOWrapper(fh, encoding='utf-8', errors='replace')
    if low.endswith('.csv'):
        row = next(csv.reader(text), None)
        return {'format': 'csv', 'header': row[:80] if row else None}
    if low.endswith('.json'):
        head = text.read(4096)
        return {'format': 'json', 'starts_with': head.lstrip()[:1]}
    for line in text:
        if line.strip():
            try:
                r = json.loads(line)
            except Exception:
                return {'format': 'jsonl', 'error': 'unparsable first line'}
            if not isinstance(r, dict):
                return {'format': 'jsonl', 'record': type(r).__name__}
            fields = {}
            for k, v in r.items():
                fields[k] = shape(v)
                if CATEGORICAL.search(k) and isinstance(v, (str, bool, int)) and len(str(v)) <= 60:
                    fields[k] = {'type': type(v).__name__, 'value': v}
            return {'format': 'jsonl', 'fields': fields}
    return {'format': 'jsonl', 'empty': True}


def archive_summary(path):
    s = {'members': 0, 'bytes_uncompressed': 0, 'by_ext': Counter(), 'top_dirs': Counter(), 'schemas': {}}
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:
        return {'error': f'not a readable zip: {type(e).__name__}'}
    infos = z.infolist()
    names = Counter(i.filename for i in infos)
    s['repeated_names'] = sum(1 for n, c in names.items() if c > 1)
    seen_shape = set()
    for i in infos:
        if i.is_dir():
            continue
        s['members'] += 1
        s['bytes_uncompressed'] += i.file_size
        parts = i.filename.split('/')
        s['top_dirs']['/'.join(parts[:3]) if len(parts) > 3 else '/'.join(parts[:-1])] += 1
        ext = re.sub(r'^[^.]*', '', parts[-1].lower())[-16:] or '(none)'
        s['by_ext'][ext] += 1
        if RECORDS.search(i.filename) and len(s['schemas']) < MAX_SAMPLE_MEMBERS:
            key = ('/'.join(parts[:-1]), ext)
            if key in seen_shape and len(seen_shape) > 50:
                continue
            seen_shape.add(key)
            try:
                with z.open(i) as fh:
                    s['schemas'][i.filename] = {'bytes': i.file_size, **first_record(fh, i.filename)}
            except Exception as e:
                s['schemas'][i.filename] = {'error': type(e).__name__}
    s['by_ext'] = dict(s['by_ext'].most_common(40))
    s['top_dirs'] = dict(s['top_dirs'].most_common(120))
    return s


def discover():
    if not MYDRIVE.exists():
        from google.colab import drive; drive.mount('/content/drive')
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    found = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not d.startswith('_inventory')]
        for f in filenames:
            p = pathlib.Path(dirpath) / f
            if ARCHIVE.search(f) or RECORDS.search(f):
                found.append(p)
    report = {'root': str(ROOT), 'files': []}
    for p in sorted(found):
        e = {'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size}
        if p.suffix.lower() == '.zip':
            e['archive'] = archive_summary(p)
        elif RECORDS.search(p.name):
            try:
                with open(p, 'rb') as fh:
                    e['first_record'] = first_record(fh, p.name)
            except Exception as ex:
                e['first_record'] = {'error': type(ex).__name__}
        report['files'].append(e)
        print(f"{time.time() - t0:7.0f}s  {e['bytes']:>14,}  {e['path']}")
    elsewhere = []
    for dirpath, dirnames, filenames in os.walk(MYDRIVE):
        if pathlib.Path(dirpath).is_relative_to(ROOT):
            dirnames[:] = []
            continue
        for f in filenames:
            p = pathlib.Path(dirpath) / f
            if ARCHIVE.search(f) or f.lower().endswith(('.jsonl.gz', '.jsonl')):
                try:
                    b = p.stat().st_size
                except OSError:
                    continue
                if b >= 1_000_000:
                    elsewhere.append({'path': str(p.relative_to(MYDRIVE)), 'bytes': b})
    report['outside_data_handover'] = sorted(elsewhere, key=lambda x: x['path'])
    report['seconds'] = round(time.time() - t0)
    body = json.dumps(report, indent=1, sort_keys=True, default=dict)
    (OUT / 'discovery.json').write_text(body)
    print(json.dumps({'files': len(report['files']), 'outside': len(elsewhere), 'seconds': report['seconds'],
                      'written': str(OUT / 'discovery.json')}))
    print('DISCOVERED. No text recorded; nothing sent anywhere.')
