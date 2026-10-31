#!/usr/bin/env python3
"""Prepare ONE Lok Sabha answer cohort of the pack's `last_page_empty` answers for owner approval. Offline: no network,
no credentials, never submits.

    python3 -I pq-last-page-cohort.py prepare --pack <NTER_citation_pack_v1.1_2026-10-05.zip> \
        --open-keys remainder-cohort/open-answer-keys.txt --exclude-cohort remainder-cohort/cohort.json \
        [--over-limit last-page-cohort/over-limit-keys.txt] --decision-id <id> --out <new empty dir>

Status: Living (2026-10-31). The one screen change (developers, 2026-10-31): accept a trailing last page only if it is
empty after whitespace normalisation. Every other rule is the remainder cohort's, unchanged (pq-remainder-cohort.py).

What `last_page_empty` means in the pack (inspected read-only 2026-10-31, last-page-cohort/README.md): the record's
page_count counts the PDF's blank last page, but `pages` lists only the pages before it (page_count = len(pages) + 1),
and the text ends at the last listed page. The importer's adapter requires page_count = len(pages) and an exact split,
so an accepted record is supplied with that blank page made explicit: one more page, numbered page_count, spanning the
(whitespace-only, normally empty) text after the last listed page. Text, text hash and page count are unchanged.

A `last_page_empty` record is held, with a named reason, when:
  - page_count is not len(pages) + 1 ('last_page_empty: page count is not listed pages + 1');
  - any listed page is empty after whitespace normalisation ('last_page_empty: an empty page before the last');
  - the text after the last listed page has any non-whitespace character ('last_page_empty: the last page has text');
  - or any rule of the remainder screen fails (spans, hash, identity, links, near-duplicates, ...);
  - or its answer key is in --over-limit: answers the importer's exact offline dry run measured at more than 256 chunks
    (C.MAX_CHUNKS, the section screen's 'at most 256 chunks' rule, which the section driver applied after its dry run).
Records with any other page split are screened exactly as before; only last_page_empty records are candidates here.
"""
import argparse, copy, hashlib, importlib.util, json, pathlib, re, sys
from collections import Counter

HERE = pathlib.Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


R = _load('pq_remainder', 'pq-remainder-cohort.py')
C, V, N = R.C, R.V, R.N
SPLIT = 'last_page_empty'


def blank(s):
    return not re.sub(r'\s+', '', s or '')


def accept_trailing_empty_page(r):
    """(record with the blank last page made explicit, []) or (None, [hold reasons]). Only for last_page_empty records."""
    text, pages = r.get('text') or '', r.get('pages') or []
    if r.get('page_split') != SPLIT:
        return None, [f"page split {r.get('page_split')}"]
    if not pages or r.get('page_count') != len(pages) + 1:
        return None, [f'{SPLIT}: page count is not listed pages + 1']
    if any(blank(p.get('text')) for p in pages):
        return None, [f'{SPLIT}: an empty page before the last']
    end = pages[-1].get('char_to')
    if not isinstance(end, int) or not 0 <= end <= len(text):
        return None, ['page spans do not match the text']
    if not blank(text[end:]):
        return None, [f'{SPLIT}: the last page has text']
    out = copy.deepcopy(r)
    out['pages'] = pages + [{'page_number': len(pages) + 1, 'char_from': end, 'char_to': len(text), 'text': text[end:]}]
    out['page_split'] = 'exact'
    return out, []


def prepare(a):
    out = pathlib.Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit('--out must be a new or empty directory')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{8,120}', a.decision_id):
        raise SystemExit('decision id: lowercase letters, digits and hyphens')
    with open(a.open_keys) as f:
        open_keys = [k.strip() for k in f if k.strip()]
    excluded = set()
    for p in a.exclude_cohort or []:
        with open(p) as f:
            excluded |= {d['answer_key'] for d in json.load(f)['documents']}
    open_set = set(open_keys) - excluded
    over = set()
    if a.over_limit:
        with open(a.over_limit) as f:
            over = {k.strip() for k in f if k.strip()}
    recs, member_sha = R.pack_records(a.pack)
    cands = [r for r in recs if R.answer_key(r) in open_set and r.get('page_split') == SPLIT]
    cand_keys = {R.answer_key(r) for r in cands}
    others = [r for r in recs if R.answer_key(r) not in cand_keys]

    reg, texts = {'sigs': N.np.zeros((0, N.NPERM), dtype=N.np.uint64), 'ns': N.np.array([]), 'meta': [], 'sh': []}, 0
    for r in C.screen_order(others):
        if not r.get('text') or C.url_parts(r.get('file_url') or '') is None:
            continue
        sh = N.shingles(r['text'])
        N.reg_add(reg, r['source_key'], R.near_case(r)['case_number'], R.near_case(r)['order_date'], '', N.minhash(sh), len(sh), sh)
        texts += 1

    holds, reasons, eligible, seen_keys, seen_answers = {}, Counter(), [], set(), set()
    for r in C.screen_order(cands):
        fixed, h = accept_trailing_empty_page(r)
        if fixed is not None:
            h = R.pack_holds(fixed)
        if r.get('source_key') in seen_keys or R.answer_key(r) in seen_answers:
            h.append('repeated source key or answer key among candidates')
        seen_keys.add(r.get('source_key')); seen_answers.add(R.answer_key(r))
        if not h:
            c = R.near_case(fixed)
            sh = N.shingles(fixed['text']); sig = N.minhash(sh)
            hit = N.similar_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
            if hit:
                h.append(f"near-duplicate text of {hit['key'][-16:]} (containment {hit['containment']})")
            else:
                hit = N.contained_hold(c, sh, sig, reg, lambda j: reg['sh'][j])
                if hit:
                    h.append(f"contained in a same-date answer {hit['key'][-16:]} (containment {hit['containment']})")
            N.reg_add(reg, fixed['source_key'], c['case_number'], c['order_date'], '', sig, len(sh), sh)
            if not h and R.answer_key(r) in over:
                h.append(f'over answer-read limits (more than {C.MAX_CHUNKS} chunks)')
        if h:
            holds[R.answer_key(r)] = h
            for x in h:
                reasons[x.split(' of ')[0].split(' (')[0]] += 1
        else:
            eligible.append(fixed)
    if not eligible:
        raise SystemExit('no eligible answer; nothing written')

    out.mkdir(parents=True, exist_ok=True)
    cp = out / 'corpus.jsonl'
    with open(cp, 'x', encoding='utf-8') as f:
        for r in eligible:
            f.write(json.dumps(C.supplied_record(r), ensure_ascii=False) + '\n')
    corpus_sha = R.sha256_file(cp)
    dp = out / 'decisions.jsonl'
    with open(dp, 'x') as f:
        for r in eligible:
            f.write(json.dumps(C.decision(r, a.decision_id, corpus_sha), separators=(',', ':')) + '\n')
    (out / 'checks.txt').write_text(','.join(R.checks_line(r) for r in eligible) + '\n')
    with open(out / 'plan.tsv', 'x') as f:
        for r in eligible:
            u = C.url_parts(r['file_url'])
            f.write(f"{r['source_key']}\t{r['content_sha256']}\t{u['session']}/{u['stem']}\n")
    with open(out / 'holds.json', 'x') as f:
        json.dump({'held': holds}, f, indent=1, sort_keys=True)
    meta = {'decision_id': a.decision_id, 'count': len(eligible), 'rules_sha256': C.RULES_SHA256,
            'screen_change': 'accept a trailing last page only if empty after whitespace normalisation (made explicit as one empty page)',
            'package_id': C.PACKAGE, 'mapping_version': C.MAPPING_VERSION, 'pack_sha256': R.PACK_SHA256, 'member_sha256': member_sha,
            'pack_records': len(recs), 'near_duplicate_registry': texts, 'open_keys': len(open_keys),
            'open_keys_sha256': R.sha256_file(a.open_keys), 'excluded_cohorts': [str(p) for p in a.exclude_cohort or []],
            'excluded_answers': len(excluded), 'over_limit_keys': sorted(over), 'candidates': len(cands), 'held': len(holds),
            'hold_reasons': dict(sorted(reasons.items())), 'cohort_corpus_sha256': corpus_sha, 'decisions_sha256': R.sha256_file(dp),
            'documents': [{'source_key': r['source_key'], 'answer_key': R.answer_key(r), 'file_url': r['file_url'],
                           'text_sha256': r['content_sha256'], 'n_chars': r['n_chars'], 'pages': r['page_count'],
                           'answered_on': r['citation'].get('answered_on'), 'title': r['title']} for r in eligible]}
    with open(out / 'cohort.json', 'x') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: meta[k] for k in ('count', 'candidates', 'held', 'hold_reasons', 'excluded_answers',
                                           'cohort_corpus_sha256', 'decisions_sha256')}))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('prepare')
    q.add_argument('--pack', required=True); q.add_argument('--open-keys', required=True)
    q.add_argument('--exclude-cohort', action='append'); q.add_argument('--over-limit')
    q.add_argument('--decision-id', required=True)
    q.add_argument('--out', required=True)
    a = p.parse_args(argv)
    if a.cmd == 'prepare':
        prepare(a)


if __name__ == '__main__':
    sys.exit(main())
