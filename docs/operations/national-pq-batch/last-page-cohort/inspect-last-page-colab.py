# Read-only inspection of the pack's `last_page_empty` Lok Sabha answers. Google Colab, Python 3. Offline: no token, no
# network to production. Prints shapes only (page counts, span checks, character counts of the last page), never text.
#
# Status: Living (2026-10-31). Launch (one cell):
#   REPO_SHA = '<commit of this file>'
#   import urllib.request, hashlib
#   src = urllib.request.urlopen(f'https://raw.githubusercontent.com/ddllabs/niyantran/{REPO_SHA}/docs/operations/national-pq-batch/last-page-cohort/inspect-last-page-colab.py').read()
#   print(hashlib.sha256(src).hexdigest()); exec(compile(src, 'inspect-last-page-colab.py', 'exec')); inspect(REPO_SHA)
import collections, gzip, hashlib, json, os, pathlib, re, subprocess, urllib.request, zipfile

NATIONAL = '/content/drive/MyDrive/Data Handover/National/v1.1'
PACK = NATIONAL + '/file to ingest/NTER_citation_pack_v1.1_2026-10-05.zip'
MEMBER = 'citation_pack_v1/documents/parliamentary_questions.jsonl.gz'
OUT = pathlib.Path(NATIONAL + '/staging/pq-lastpage-inspect')


def inspect(repo_sha):
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    base = f'https://raw.githubusercontent.com/ddllabs/niyantran/{repo_sha}/docs/operations/national-pq-batch/'
    open_keys = set(urllib.request.urlopen(base + 'remainder-cohort/open-answer-keys.txt').read().decode().split())
    remainder = {d['answer_key'] for d in json.loads(urllib.request.urlopen(base + 'remainder-cohort/cohort.json').read())['documents']}
    zf = zipfile.ZipFile(PACK)
    recs = [json.loads(l) for l in gzip.decompress(zf.read(MEMBER)).decode('utf-8').splitlines() if l.strip()]
    key_re = re.compile(r'^https://sansad\.in/getFile/loksabhaquestions/annex/([0-9]{1,4})/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$')
    rows, shapes = [], collections.Counter()
    for r in recs:
        if r.get('page_split') != 'last_page_empty':
            continue
        m = key_re.match(r.get('file_url') or '')
        k = f'pq:ls:{m.group(1)}:{m.group(2)}' if m else None
        text, pages = r.get('text') or '', r.get('pages') or []
        spans = bool(pages) and all(p.get('text') == text[p.get('char_from', -1):p.get('char_to', -1)] for p in pages)
        numbered = [p.get('page_number') for p in pages] == list(range(1, len(pages) + 1))
        empties = [i + 1 for i, p in enumerate(pages) if not re.sub(r'\s+', '', p.get('text') or '')]
        last = pages[-1] if pages else {}
        row = {'answer_key': k, 'open': k in open_keys, 'in_remainder': k in remainder, 'page_count': r.get('page_count'),
               'pages_listed': len(pages), 'spans_match': spans, 'numbered': numbered, 'empty_pages': empties,
               'last_chars': len(last.get('text') or ''), 'last_span': [last.get('char_from'), last.get('char_to')], 'n_chars': len(text),
               'text_hash_ok': hashlib.sha256(text.encode()).hexdigest() == r.get('content_sha256'), 'page_split_detail': r.get('page_split_detail')}
        rows.append(row)
        shapes[(row['open'], row['page_count'] == len(pages), spans, numbered, tuple(empties) == (len(pages),), row['last_chars'])] += 1
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'last-page-shapes.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in rows))
    print('records', len(rows), 'open', sum(x['open'] for x in rows), 'in remainder', sum(x['in_remainder'] for x in rows))
    print('(open, page_count==listed, spans_match, numbered, only last empty, last_chars): count')
    for s, n in sorted(shapes.items(), key=lambda kv: -kv[1]):
        print(s, n)
    keys = sorted({k for r in recs for k in r.keys()})
    print('record fields:', keys)
    print('INSPECTED. Wrote', OUT / 'last-page-shapes.jsonl', '(no text). Nothing was sent anywhere.')
