#!/usr/bin/env python3
"""Prepare ONE Lok Sabha answer cohort from the National citation pack for owner approval. Offline: no network, no
credentials, never submits.

    python3 -I pq-remainder-cohort.py prepare --pack <NTER_citation_pack_v1.1_2026-10-05.zip> \
        --open-keys remainder-cohort/open-answer-keys.txt --decision-id <id> --out <new empty dir>

Status: Living (2026-10-30). Inputs:
  --pack       the pinned pack (sha256 459b354c...dc9b8). The question member must match the pack's own manifest.
  --open-keys  answer keys (pq:ls:<session>:<stem>) of answer files that have a listing row and no document, read live
               and read-only by remainder-cohort/open-answer-keys.sql. Only these pack records are candidates.

The screen, per candidate, in the section screen's order (newest first):
  1. the section screen's record rules that need no live state (nter-national-pq-core.py, rules sha256 bound into each
     decision): pack schema and module; page split exact with matching page spans; then the supplied-record text and
     identity rules of pq-validation-cohort.py (hash, size, ANSWER section, URL, file name, answer key, session, house,
     question type and number, title, number and date in the text, an F266-comparable citation); every pack link names
     this module and this answer key;
  2. no repeated source key or answer key among the candidates;
  3. the near-duplicate and same-date containment rule (pq-near-duplicate.py, verbatim from the Law core) against every
     pack record that is NOT a candidate (all stored answers are in the pack, so this is at least as strict as the
     section screen's comparison with stored texts), then against earlier candidates in order.
Listing-row agreement (rows exist, URL, F266 house/subject/ministry/date, question type, member, answer key) and "not
already held" are checked live, read-only, by remainder-cohort/cohort-live-check.sql from checks.txt, and again by the
server at admission (F266).

Writes into --out: corpus.jsonl (importer input; corpus text, never committed), decisions.jsonl (the manifest),
cohort.json and holds.json (no text), checks.txt (input to the live check) and plan.tsv (key, text hash, stem).
"""
import argparse, gzip, hashlib, importlib.util, json, os, pathlib, re, sys, zipfile
from collections import Counter

HERE = pathlib.Path(__file__).resolve().parent
PACK_SHA256, PACK_BYTES = '459b354cb64360655877187c42566b07a21de579e8b97beb49df9117b16dc9b8', 252355253
MEMBER = 'citation_pack_v1/documents/parliamentary_questions.jsonl.gz'


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


C = _load('pq_core', 'nter-national-pq-core.py')
V = _load('pq_validation', 'pq-validation-cohort.py')
N = _load('pq_near_duplicate', 'pq-near-duplicate.py')


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def pack_records(path):
    if os.path.getsize(path) != PACK_BYTES or sha256_file(path) != PACK_SHA256:
        raise SystemExit('the citation pack is not the pinned one')
    zf = zipfile.ZipFile(path)
    manifest = zf.read('citation_pack_v1/manifest.json').decode('utf-8')
    data = zf.read(MEMBER)
    member_sha = hashlib.sha256(data).hexdigest()
    if member_sha not in manifest:
        raise SystemExit('parliamentary_questions.jsonl.gz does not match the pack manifest')
    return [json.loads(l) for l in gzip.decompress(data).decode('utf-8').splitlines() if l.strip()], member_sha


def answer_key(r):
    return V.pq_answer_key(r.get('file_url'))


def pack_holds(r):
    """The section screen's record rules that need no live state, for a pack record."""
    out = []
    if r.get('schema') != 'nter.citation_pack/1.1' or r.get('desk_tier') != C.TIER or r.get('desk_feature') != C.FEATURE \
            or r.get('desk_rows_feature') != C.FEATURE:
        out.append('not a National question record')
    text, pages = r.get('text') or '', r.get('pages') or []
    if r.get('page_split') != 'exact':
        return out + [f"page split {r.get('page_split')}"]
    if not pages or r.get('page_count') != len(pages) or any(
            p.get('text') != text[p.get('char_from', -1):p.get('char_to', -1)] or (i and p.get('char_from', -1) < pages[i - 1].get('char_to', 0))
            or p.get('page_number') != i + 1 for i, p in enumerate(pages)):
        return out + ['page spans do not match the text']
    if C.url_parts(r.get('file_url') or '') is None:
        return out + ['not an official Lok Sabha question PDF URL']
    if (r.get('title_stem') or '') != f"{C.url_parts(r['file_url'])['session']}_{C.url_parts(r['file_url'])['stem']}":
        out.append('file name does not match the URL')
    if r.get('content_sha256') is None or not r.get('citation'):
        return out + ['record incomplete']
    out += V.supplied_holds(C.supplied_record(r))
    links = r.get('links') or []
    if not links:
        out.append('no desk row link')
    for l in links:
        if l.get('tier') != C.TIER or l.get('feature') != C.FEATURE or l.get('document_key') != answer_key(r):
            out.append('desk link names another module or key'); break
    return out


def near_case(r):
    u, cit = C.url_parts(r['file_url']), r.get('citation') or {}
    return {'case_number': f"LS:{u['session']}:{u['prefix']}:{u['number']}", 'order_date': C.iso(cit.get('answered_on')) or '',
            'file_url': r['file_url']}


def checks_line(r):
    u, cit = C.url_parts(r['file_url']), r['citation']
    rows = '+'.join(sorted({str(l['row_key']) for l in r['links']}, key=lambda x: (len(x), x)))
    asked = '+'.join(sorted({hashlib.md5((V.pq_norm(a) or '').encode()).hexdigest()[:8] for a in cit.get('asked_by') or []}))
    return f"{u['session']}/{u['stem']}:{V.f266_signature(cit)}:{rows}:{asked}"


def prepare(a):
    out = pathlib.Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit('--out must be a new or empty directory')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{8,120}', a.decision_id):
        raise SystemExit('decision id: lowercase letters, digits and hyphens')
    with open(a.open_keys) as f:
        open_keys = [k.strip() for k in f if k.strip()]
    if len(set(open_keys)) != len(open_keys) or any(not re.fullmatch(r'pq:ls:\d{2,4}:A[SU]\d{1,5}_[A-Za-z0-9]{3,16}', k) for k in open_keys):
        raise SystemExit('--open-keys: repeated or malformed answer key')
    open_set = set(open_keys)
    recs, member_sha = pack_records(a.pack)
    cands = [r for r in recs if answer_key(r) in open_set]
    others = [r for r in recs if answer_key(r) not in open_set]

    # Near-duplicate registry: every pack record that is not a candidate (stored answers included), in screen order.
    reg, texts = {'sigs': N.np.zeros((0, N.NPERM), dtype=N.np.uint64), 'ns': N.np.array([]), 'meta': [], 'sh': []}, 0
    for r in C.screen_order(others):
        if not r.get('text') or C.url_parts(r.get('file_url') or '') is None:
            continue
        sh = N.shingles(r['text'])
        N.reg_add(reg, r['source_key'], near_case(r)['case_number'], near_case(r)['order_date'], '', N.minhash(sh), len(sh), sh)
        texts += 1

    holds, reasons, eligible, seen_keys, seen_answers = {}, Counter(), [], set(), set()
    for r in C.screen_order(cands):
        h = pack_holds(r)
        if r.get('source_key') in seen_keys or answer_key(r) in seen_answers:
            h.append('repeated source key or answer key among candidates')
        seen_keys.add(r.get('source_key')); seen_answers.add(answer_key(r))
        if not h:
            c = near_case(r)
            sh = N.shingles(r['text']); sig = N.minhash(sh)
            hit = N.similar_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
            if hit:
                h.append(f"near-duplicate text of {hit['key'][-16:]} (containment {hit['containment']})")
            else:
                hit = N.contained_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
                if hit:
                    h.append(f"contained in a same-date answer {hit['key'][-16:]} (containment {hit['containment']})")
            N.reg_add(reg, r['source_key'], c['case_number'], c['order_date'], '', sig, len(sh), sh)
        if h:
            holds[answer_key(r)] = h
            for x in h:
                reasons[x.split(' of ')[0].split(' (')[0]] += 1
        else:
            eligible.append(r)
    missing = sorted(open_set - {answer_key(r) for r in cands})
    if not eligible:
        raise SystemExit('no eligible answer; nothing written')

    out.mkdir(parents=True, exist_ok=True)
    cp = out / 'corpus.jsonl'
    with open(cp, 'x', encoding='utf-8') as f:
        for r in eligible:
            f.write(json.dumps(C.supplied_record(r), ensure_ascii=False) + '\n')
    corpus_sha = sha256_file(cp)
    dp = out / 'decisions.jsonl'
    with open(dp, 'x') as f:
        for r in eligible:
            f.write(json.dumps(C.decision(r, a.decision_id, corpus_sha), separators=(',', ':')) + '\n')
    (out / 'checks.txt').write_text(','.join(checks_line(r) for r in eligible) + '\n')
    with open(out / 'plan.tsv', 'x') as f:
        for r in eligible:
            u = C.url_parts(r['file_url'])
            f.write(f"{r['source_key']}\t{r['content_sha256']}\t{u['session']}/{u['stem']}\n")
    with open(out / 'holds.json', 'x') as f:
        json.dump({'held': holds, 'open_keys_without_pack_record': missing}, f, indent=1, sort_keys=True)
    meta = {'decision_id': a.decision_id, 'count': len(eligible), 'rules_sha256': C.RULES_SHA256, 'package_id': C.PACKAGE,
            'mapping_version': C.MAPPING_VERSION, 'pack_sha256': PACK_SHA256, 'member_sha256': member_sha,
            'pack_records': len(recs), 'near_duplicate_registry': texts, 'open_keys': len(open_keys),
            'open_keys_sha256': sha256_file(a.open_keys), 'candidates': len(cands), 'held': len(holds),
            'hold_reasons': dict(sorted(reasons.items())), 'open_keys_without_pack_record': len(missing),
            'cohort_corpus_sha256': corpus_sha, 'decisions_sha256': sha256_file(dp),
            'documents': [{'source_key': r['source_key'], 'answer_key': answer_key(r), 'file_url': r['file_url'],
                           'text_sha256': r['content_sha256'], 'n_chars': r['n_chars'], 'pages': r['page_count'],
                           'answered_on': r['citation'].get('answered_on'), 'title': r['title']} for r in eligible]}
    with open(out / 'cohort.json', 'x') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: meta[k] for k in ('count', 'candidates', 'held', 'hold_reasons', 'open_keys_without_pack_record',
                                           'cohort_corpus_sha256', 'decisions_sha256')}))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('prepare')
    q.add_argument('--pack', required=True); q.add_argument('--open-keys', required=True)
    q.add_argument('--decision-id', required=True); q.add_argument('--out', required=True)
    a = p.parse_args(argv)
    if a.cmd == 'prepare':
        prepare(a)


if __name__ == '__main__':
    sys.exit(main())
