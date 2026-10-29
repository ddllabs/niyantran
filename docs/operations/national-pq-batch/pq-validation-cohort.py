#!/usr/bin/env python3
"""Prepare ONE bounded Lok Sabha answer cohort for owner approval (owner's rules of 2026-10-29). Offline; no network.

    python3 -I pq-validation-cohort.py prepare --corpus <staged corpus.jsonl> --expect-corpus-sha256 <hash> \
        --keys <ordered candidate keys, one per line> --count 100 --decision-id <id> --out <new empty dir>

Writes into --out:
  corpus.jsonl     the selected records' original lines, byte for byte, in --keys order (the importer's input);
  decisions.jsonl  one reviewed decision per record, bound to corpus.jsonl's sha256 (the manifest the owner approves);
  cohort.json      inputs, hashes, keys, answer keys and the F266 corroboration signatures (no corpus text);
  f266-signatures.txt  '<stem>:<md5>' list for the read-only live check in cohort-live-check.sql.

It never submits, never reads credentials and never chains to another cohort. Submission is the importer's own
--submit with the owner-approved manifest hash, --max-chunks and --max-estimated-cost-usd, and a short-lived token
the owner issues for that run (see validation-cohort README).

Each selected record is re-checked against the same text and identity rules as the section screen
(nter-national-pq-core.py, rules sha256 bound into every decision), in the supplied-record form. The F266 signature
reproduces the server's pq_norm / pq_date comparison (house, subject, ministry, answer date). It is a pre-check, not
the admission itself: if Python's isalnum and Postgres [:alnum:] ever disagree on a character, the live check could pass
while admission refuses. That is safe: the server then refuses with a named reason, writes nothing, and the importer stops.
"""
import argparse, hashlib, importlib.util, json, os, pathlib, re, sys, unicodedata

HERE = pathlib.Path(__file__).resolve().parent


def _core():
    spec = importlib.util.spec_from_file_location('pq_core', HERE / 'nter-national-pq-core.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


C = _core()


# ─── F266 corroboration, as supabase/migrations/20261028130000_pq_admission_links.sql compares ──────────────
def pq_norm(v):
    s = unicodedata.normalize('NFKC', v or '').lower()
    s = re.sub(r' +', ' ', ''.join(ch if ch.isalnum() else ' ' for ch in s)).strip()
    return s or None


def pq_date(v):
    if v and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
        return v
    if v and re.fullmatch(r'\d{2}\.\d{2}\.\d{4}', v):
        return f'{v[6:10]}-{v[3:5]}-{v[0:2]}'
    return None


PQ_URL = re.compile(r'^https://sansad\.in/getFile/loksabhaquestions/annex/([0-9]{1,4})/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$')


def pq_answer_key(url):
    m = PQ_URL.match(url or '')
    return f'pq:ls:{m.group(1)}:{m.group(2)}' if m else None


def f266_signature(citation):
    parts = [pq_norm(citation.get('house')), pq_norm(citation.get('subject')), pq_norm(citation.get('ministry')),
             pq_date(citation.get('answered_on'))]
    return None if any(p is None for p in parts) else hashlib.md5('|'.join(parts).encode()).hexdigest()


# ─── the screen's text and identity rules, for a supplied record ─────────────────────────────────────────
def supplied_holds(r):
    out, text, cit = [], r.get('text') or '', r.get('citation') or {}
    key, url = r.get('source_key') or '', r.get('file_url') or ''
    if not re.fullmatch(r'[0-9a-f]{40}', key):
        out.append('unexpected source key shape')
    if r.get('desk_tier') != C.TIER or r.get('desk_feature') != C.FEATURE:
        out.append('not a National question record')
    if hashlib.sha256(text.encode('utf-8')).hexdigest() != r.get('text_sha256'):
        out.append('text hash mismatch')
    if r.get('n_chars') != len(text):
        out.append('n_chars mismatch')
    pages = r.get('pages') or []
    if r.get('page_split') != 'exact':
        out.append(f"page split {r.get('page_split')}")
    elif not pages or r.get('page_count') != len(pages) or any(
            p.get('text') != text[p.get('char_from', -1):p.get('char_to', -1)] or (i and p.get('char_from', -1) < pages[i - 1].get('char_to', 0))
            or p.get('page_number') != i + 1 for i, p in enumerate(pages)):
        out.append('page spans do not match the text')
    if len(text) < C.MIN_CHARS:
        out.append('text too short')
    if len(text) > C.MAX_CHARS:
        out.append('over answer-read limits')
    if not re.search(r'\bANSWER\b', text, re.I):
        out.append('no answer section')
    u = C.url_parts(url)
    if not u:
        return out + ['not an official Lok Sabha question PDF URL']
    if (r.get('file_name') or '') != u['stem'] + '.pdf':
        out.append('file name does not match the URL')
    if r.get('document_key_suggested') != pq_answer_key(url) or pq_answer_key(url) != f"pq:ls:{u['session']}:{u['stem']}":
        out.append('answer key does not match the URL')
    if str(cit.get('session')) != u['session'] or cit.get('house') != 'Lok Sabha':
        out.append('citation session or house does not match the URL')
    if str(cit.get('question_type') or '').upper() != C.QTYPE[u['prefix']] or str(cit.get('question_no') or '') != u['number']:
        out.append('citation question type or number does not match the URL')
    if not re.search(rf'\bNo\.\s*{int(u["number"])}\b', r.get('title') or ''):
        out.append('title does not carry the question number')
    if not C.qno_in_text(text, u['number']):
        out.append('question number not found in the text')
    when = C.iso(cit.get('answered_on'))
    if not when:
        out.append('no answer date in the citation')
    elif not C.date_in_text(text, when):
        out.append('answer date not found in the text')
    if f266_signature(cit) is None:
        out.append('citation lacks a house, subject, ministry or answer date the server can compare')
    return out


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def prepare(a):
    out = pathlib.Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit('--out must be a new or empty directory')
    if not 1 <= a.count <= 100:
        raise SystemExit('a validation cohort is at most 100 documents (owner rule 3)')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{8,120}', a.decision_id):
        raise SystemExit('decision id: lowercase letters, digits and hyphens')
    got = sha256_file(a.corpus)
    if got != a.expect_corpus_sha256:
        raise SystemExit(f'corpus sha256 {got} does not match --expect-corpus-sha256')
    with open(a.keys) as f:
        keys = [k.strip() for k in f if k.strip()]
    if len(set(keys)) != len(keys):
        raise SystemExit('duplicate key in --keys')
    lines = {}
    with open(a.corpus, 'rb') as f:
        for raw in f:
            r = json.loads(raw)
            if r['source_key'] in lines:
                raise SystemExit(f"repeated source_key in corpus: {r['source_key']}")
            lines[r['source_key']] = (raw if raw.endswith(b'\n') else raw + b'\n', r)
    chosen, held = [], {}
    for k in keys:
        if len(chosen) == a.count:
            break
        if k not in lines:
            held[k] = ['not in the corpus file']; continue
        h = supplied_holds(lines[k][1])
        if h:
            held[k] = h
        else:
            chosen.append(k)
    if len(chosen) < a.count:
        raise SystemExit(f'only {len(chosen)} eligible of the {len(keys)} candidates; nothing written')
    out.mkdir(parents=True, exist_ok=True)
    cp = out / 'corpus.jsonl'
    with open(cp, 'xb') as f:
        for k in chosen:
            f.write(lines[k][0])
    corpus_sha = sha256_file(cp)
    rows = []
    for k in chosen:
        r = lines[k][1]
        rows.append(C.decision({'source_key': k, 'content_sha256': r['text_sha256']}, a.decision_id, corpus_sha))
    dp = out / 'decisions.jsonl'
    with open(dp, 'x') as f:
        for d in rows:
            f.write(json.dumps(d, separators=(',', ':')) + '\n')
    sigs, docs = [], []
    for k in chosen:
        r = lines[k][1]
        u = C.url_parts(r['file_url'])
        s = f266_signature(r['citation'])
        sigs.append(f"{u['session']}/{u['stem']}:{s}")
        docs.append({'source_key': k, 'file_name': r['file_name'], 'file_url': r['file_url'], 'answer_key': pq_answer_key(r['file_url']),
                     'text_sha256': r['text_sha256'], 'n_chars': r['n_chars'], 'pages': r['page_count'], 'f266_signature': s,
                     'title': r['title'], 'answered_on': r['citation'].get('answered_on'), 'ministry': r['citation'].get('ministry')})
    (out / 'f266-signatures.txt').write_text(','.join(sigs) + '\n')
    meta = {'decision_id': a.decision_id, 'count': len(chosen), 'rules_sha256': C.RULES_SHA256, 'package_id': C.PACKAGE,
            'mapping_version': C.MAPPING_VERSION, 'source_corpus': os.path.basename(a.corpus), 'source_corpus_sha256': got,
            'cohort_corpus_sha256': corpus_sha, 'decisions_sha256': sha256_file(dp), 'candidates': len(keys),
            'held_before_count_reached': held, 'documents': docs}
    with open(out / 'cohort.json', 'x') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print(json.dumps({'count': len(chosen), 'cohort_corpus_sha256': corpus_sha, 'decisions_sha256': meta['decisions_sha256'],
                      'held': len(held)}))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('prepare')
    q.add_argument('--corpus', required=True); q.add_argument('--expect-corpus-sha256', required=True)
    q.add_argument('--keys', required=True); q.add_argument('--count', type=int, default=100)
    q.add_argument('--decision-id', required=True); q.add_argument('--out', required=True)
    a = p.parse_args(argv)
    if a.cmd == 'prepare':
        prepare(a)


if __name__ == '__main__':
    sys.exit(main())
