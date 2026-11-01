# Synthetic test for inventory-colab.py + inventory-records.mjs. Status: Living (2026-11-01). Local only; no network, no Drive.
# Builds a small fake "Data Handover" tree, runs the inventory against it and checks every count against a hand-computed value.
#   python3 -I test-inventory.py <inventory-colab.py> <node binary> <repo root> <empty work dir>
# Exit 0 when every check passes; 1 otherwise. Records carry only invented placeholder text.
import gzip, json, os, pathlib, shutil, sys, zipfile

script, node, repo, work = sys.argv[1:5]
work = pathlib.Path(work); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
R = work / 'DH'


def gz(recs):
    return gzip.compress(''.join((r if isinstance(r, str) else json.dumps(r)) + '\n' for r in recs).encode())


def mkzip(path, members):
    path = R / path; path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w') as z:
        for n, b in members:
            z.writestr(n, b)


T = 'word ' * 3000   # 3 chunks with the repository chunker
L = 'NTER_legal_pack_v1.2_FULL_2026-10-18/'
mkzip('Legal/v1.1/file to ingest/NTER_legal_pack_v1.1_FULL_2026-10-18.zip', [
    (L + 'documents/sc_judgments/sc-00.jsonl.gz', gz([{'source_key': 'law:sc/1', 'text': T}, {'source_key': 'law:sc/2', 'text': 'short'}])),
    # nested like the real pack: documents/high_courts/<court>/<file>, and one level deeper
    (L + 'documents/high_courts/Court_A_HC/1987__a__p000.jsonl.gz', gz([{'source_key': 'law:hc/1', 'text': T}, {'source_key': 'law:hc/2', 'file_url': 'u'}])),
    (L + 'documents/high_courts/Court_B_HC/bench/1990__b__p000.jsonl.gz', gz([{'source_key': 'law:hc/3', 'text': 'x'}, '{broken', {'source_key': 'law:hc/4', 'text': 'y'}])),
    (L + 'documents/tribunals/Trib_X/2001__c__p000.jsonl.gz', gz([{'source_key': 'law:tr/1', 'text': T}])),
    # a raw carriage return inside a string (invalid strict JSON, accepted by json.loads(strict=False)), then a broken line 3
    (L + 'documents/acts/acts-00.jsonl.gz', gz(['{"source_key": "law:act/1", "text": "a\rb"}', {'source_key': 'law:act/2', 'text': 'c'}, '{broken'])),
    (L + 'documents/high_courts/Court_A_HC/1987__a__p000.boxes.jsonl.gz', gz([{'x': 1}])),
    (L + 'boxes/high_courts/Court_A_HC/1987__a__p000.boxes.jsonl.gz', gz([{'x': 1}])),
    (L + 'flags/sensitive_cases_v1.csv.gz', gzip.compress(b'source_key,tier\nlaw:hc/1,statute\n')),
    (L + 'dedupe/duplicate_documents_v1.csv.gz', gzip.compress(b'group,keep,source_key\n1,0,law:hc/3\n')),
])
C = 'citation_pack_v1/'
for v, d in [('1.1', '2026-10-05'), ('1.2_DELTA', '2026-10-06'), ('1.3_DELTA', '2026-10-08'), ('1.4_DELTA', '2026-10-13'), ('1.5_DELTA', '2026-10-17')]:
    ver = v.split('_')[0]
    members = [(C + 'documents/bills-00.jsonl.gz', gz([{'source_key': f'nat:bill/{ver}', 'text': 'b' + ver, 'servable': False}]))]
    if ver == '1.2':
        members += [(C + 'documents/bills_recovered.jsonl.gz', gz([{'source_key': 'nat:rec/1', 'text': 'r'}])),
                    (C + 'documents/ocr_repaged.jsonl.gz', gz([{'source_key': 'nat:rep/1', 'text': 'p'}, {'source_key': 'nat:rep/2', 'text': 'q'}]))]
    mkzip(f'National/v{ver}/file to ingest/NTER_citation_pack_v{v}_{d}.zip', members)
    if ver in ('1.3', '1.4', '1.5'):
        f = R / f'NTER_citation_pack_v{v}_{d}' / C / 'documents' / 'bills-00.jsonl.gz'; f.parent.mkdir(parents=True)
        f.write_bytes(dict(members)[C + 'documents/bills-00.jsonl.gz'])
P = 'NTER-Complete-Processed-Data/'
mkzip('National/v1.1/raw data/Earlier handover - Sep 2026 (full processed data)/NTER-Complete-Processed-Data-2026-09-18.zip', [
    (P + '01_original_corpus/documents.jsonl.gz', gz([{'id': 'a' * 40, 'feature': 'F1', 'text': T}])),
    (P + '03_individual_ocr/' + 'd' * 40 + '/doc.md', b'one'),
    (P + '03_individual_ocr/' + 'e' * 40 + '/pages/p1.md', b'two'),        # nested deeper than <id>/
    (P + '03_individual_ocr/' + 'e' * 40 + '/metadata.json', b'{}'),
])
t = R / 'NTER_v1.6_side_archive_tenders_aoc' / 'awards'; t.mkdir(parents=True)
(t / 'part-0000.jsonl.gz').write_bytes(gz([{'row_key': 't1', 'servable': False, 'bidder_address_in_source': True},
                                          {'row_key': 't2', 'servable': False, 'bidder_address_in_source': False},
                                          {'row_key': 't3', 'servable': False, 'bidder_address_in_source': 'placeholder'}]))
g = R / 'NTER_citation_pack_v1.1_2026-10-05' / 'gapfill' / 'out'; g.mkdir(parents=True)
(g / 'bills_recovered.jsonl.gz').write_bytes(b'\x1f\x8b\x08corrupt')
(g / 'ocr_repaged.jsonl.gz').write_bytes(b'\x1f\x8b\x08corrupt')

os.environ['INVENTORY_TEST'] = '1'
ns = {'__name__': 'inv'}
exec(compile(open(script, 'rb').read(), 'inventory-colab.py', 'exec'), ns)
ns.update(DH=R, OUT=R / '_inventory-2026-11', W=work / 'w', REPO=pathlib.Path(repo), NODE=pathlib.Path(node), setup=lambda sha: {'test': True})
ns['inventory']('TEST', workers=3)
s = json.load(open(R / '_inventory-2026-11' / 'summary.json'))
col = {(c['pack'], c['collection']): c for c in s['collections']}
get = lambda p, c, k: col.get((p, c), {}).get(k)
checks = [
    ('legal high_courts records (nested court folders)', get('legal_v1.1_full', 'high_courts', 'records'), 4),
    ('legal high_courts supplied text', get('legal_v1.1_full', 'high_courts', 'supplied_text'), 3),
    ('legal high_courts OCR needed', get('legal_v1.1_full', 'high_courts', 'ocr_needed'), 1),
    ('legal high_courts chunks', get('legal_v1.1_full', 'high_courts', 'chunks'), 5),
    ('legal tribunals records (nested)', get('legal_v1.1_full', 'tribunals', 'records'), 1),
    ('legal sc_judgments records', get('legal_v1.1_full', 'sc_judgments', 'records'), 2),
    ('legal sensitivity join on high courts', get('legal_v1.1_full', 'high_courts', 'sensitivity_flagged_keys'), 1),
    ('legal dedupe alias join on high courts', get('legal_v1.1_full', 'high_courts', 'dedupe_alias_keys'), 1),
    ('boxes members never read as records', sum(c['records'] for c in s['collections'] if 'boxes' in str(c['collection'])), 0),
    ('per-document OCR records (incl. nested)', get('processed_2026-09-18', 'individual_ocr', 'records'), 2),
    ('per-document OCR distinct documents', get('processed_2026-09-18', 'individual_ocr', 'distinct_keys'), 2),
    ('unparsable line reported with its line number',
     sorted((u['collection'], u['line']) for u in s.get('unreadable_lines', [])), [('acts', 3), ('high_courts', 2)]),
    ('raw carriage return: one record, counted, flagged lenient', (get('legal_v1.1_full', 'acts', 'records'),
     get('legal_v1.1_full', 'acts', 'parsed_leniently')), (2, 1)),
    ('corrupt companion files counted via v1.2 copies (no errors)', s['task_errors'], 0),
    ('substitutes listed', sorted(x['member'] for x in s.get('substitutes', [])),
     ['gapfill/out/bills_recovered.jsonl.gz', 'gapfill/out/ocr_repaged.jsonl.gz']),
    ('v1.2 ocr_repaged counted', get('citation_v1.2_delta', 'ocr_repaged', 'records'), 2),
    ('tender personal field counts values, not boolean flags', get('tenders_v1.6_side', 'awards', 'personal_by_fields'), 1),
    ('extracted copies identical', [v['identical'] for v in s['extracted_copies'].values()], [1, 1, 1]),
]
bad = 0
for name, got, want in checks:
    ok = got == want
    bad += not ok
    print(('PASS' if ok else 'FAIL'), name, '| got', got, '| want', want)
print('ALL PASS' if not bad else f'{bad} FAILED')
sys.exit(1 if bad else 0)
