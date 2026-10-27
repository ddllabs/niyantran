# NTER National parliamentary-question batch core: pure, offline-testable checks (no Colab, no network).
# Loaded by nter-national-pq-batch.py, pinned by commit and sha256. Records are the National citation pack v1.1
# `documents/parliamentary_questions.jsonl.gz` (schema nter.citation_pack/1.1); desk rows are the live
# `desk_rows` of national / Parliamentary Question Database.
import hashlib, re, unicodedata

FEATURE = 'Parliamentary Question Database'
TIER = 'national'
PACKAGE = 'NTER_citation_pack_v1.1_2026-10-05.zip:citation_pack_v1/documents/parliamentary_questions.jsonl.gz'
MAPPING_VERSION = 'national-pq-v1'
MAX_CHUNKS, MAX_CHARS, MIN_CHARS = 256, 300_000, 300
URL_RE = re.compile(r'^https://sansad\.in/getFile/loksabhaquestions/annex/(\d{2,4})/(A[SU])(\d{1,5})_([A-Za-z0-9]{3,16})\.pdf\?source=pqals$')
QTYPE = {'AS': 'STARRED', 'AU': 'UNSTARRED'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

# The admission rules every selected document passed. Their hash is bound into every decision (review.rules_sha256).
RULES = '\n'.join([
    'national-pq-v1 admission rules (owner decision 2026-10-27, Tamanesh Kauri)',
    'source: National citation pack v1.1, parliamentary_questions.jsonl.gz, schema nter.citation_pack/1.1',
    'identity: official URL https://sansad.in/getFile/loksabhaquestions/annex/<session>/<AS|AU><no>_<id>.pdf?source=pqals;'
    ' session, question type and number in the URL, file name, title and citation agree; the question number and the'
    ' answer date appear in the text; house is Lok Sabha',
    'mapping: every pack link names an existing desk row of national / Parliamentary Question Database whose source_url'
    ' equals the file_url and whose subject, date, question type, ministry and member agree with the citation',
    'completeness: sha256(text) = content_sha256; n_chars = code points; page_split exact with every page span equal to'
    ' its page text; at least 300 characters; an ANSWER section; at most 256 chunks and 300,000 characters',
    'dedupe: not in the database by source_key, file_url or legacy file name; near-duplicate and same-date containment'
    ' holds as for Law (MinHash pre-filter, exact shingle containment)',
    'sensitivity and rights: public Lok Sabha answers; licence_class gazette_s52_1_q_i_unconfirmed, the class of the 82'
    ' question answers already served; nothing BARRED',
])
RULES_SHA256 = hashlib.sha256(RULES.encode()).hexdigest()


def norm(s):
    s = unicodedata.normalize('NFKC', str(s or '')).lower()
    return re.sub(r'[^a-z0-9]', '', s)


def iso(d):
    """'07.02.2025' -> '2025-02-07'; an ISO date as is; anything else -> None."""
    s = str(d or '').strip()
    m = re.fullmatch(r'(\d{1,2})[./-](\d{1,2})[./-](\d{4})', s)
    if m:
        dd, mm, yy = int(m[1]), int(m[2]), int(m[3])
        return f'{yy:04d}-{mm:02d}-{dd:02d}' if 1 <= dd <= 31 and 1 <= mm <= 12 else None
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?', s)
    return f'{m[1]}-{m[2]}-{m[3]}' if m else None


def date_in_text(text, iso_date):
    """The answer date as the document prints it: 07.02.2025, 07/02/2025, 7-2-2025, 07.02.25 or 7th February, 2025."""
    if not iso_date:
        return False
    y, m, d = (int(x) for x in iso_date.split('-'))
    head = text[:6000]
    num = re.compile(rf'(?<!\d)0?{d}\s*[./-]\s*0?{m}\s*[./-]\s*(?:{y}|{y % 100:02d})(?!\d)')
    if num.search(head):
        return True
    month = MONTHS[m - 1]
    words = re.compile(rf'(?<!\d)0?{d}(?:st|nd|rd|th)?\s*(?:of\s+)?{month[:3]}[a-z]*\.?,?\s*{y}|{month[:3]}[a-z]*\.?\s+0?{d}(?:st|nd|rd|th)?,?\s*{y}', re.I)
    return bool(words.search(head))


def qno_in_text(text, qno):
    head = re.sub(r'\s+', ' ', text[:6000])
    return bool(re.search(rf'QUESTION\s*NO\s*\.?\s*[:\-]?\s*[^\w\s]{{0,3}}\s*0*{int(qno)}(?!\d)', head, re.I))


def url_parts(url):
    m = URL_RE.match(url or '')
    return {'session': m[1], 'prefix': m[2], 'number': m[3], 'stem': f'{m[2]}{m[3]}_{m[4]}'} if m else None


def record_holds(r, db, rows):
    """Every hold for one pack record. db: {'keys','urls','file_names'} of live documents; rows: live desk rows of the
    question module by row_key -> row object. Returns a list of reasons (empty: eligible before dedupe and chunking)."""
    out = []
    key, text, cit = r.get('source_key') or '', r.get('text') or '', r.get('citation') or {}
    url = r.get('file_url') or ''
    if key in db['keys']:
        out.append('already in the database (source_key)')
    if url in db['urls'] or (r.get('file_url_alt') or '') in db['urls']:
        out.append('already in the database (file_url)')
    if (r.get('title_stem') or '') + '.pdf' in db['file_names'] or (r.get('file_name') or '') in db['file_names']:
        out.append('already in the database (file name)')
    if not re.fullmatch(r'[0-9a-f]{40}', key):
        out.append('unexpected source key shape')
    if r.get('schema') != 'nter.citation_pack/1.1' or r.get('desk_tier') != TIER or r.get('desk_feature') != FEATURE \
            or r.get('desk_rows_feature') != FEATURE:
        out.append('not a National question record')
    if hashlib.sha256(text.encode('utf-8')).hexdigest() != r.get('content_sha256'):
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
    if len(text) < MIN_CHARS:
        out.append('text too short')
    if len(text) > MAX_CHARS:
        out.append('over answer-read limits')
    if not re.search(r'\bANSWER\b', text, re.I):
        out.append('no answer section')
    u = url_parts(url)
    if not u:
        out.append('not an official Lok Sabha question PDF URL')
        return out
    stem = u['stem']
    if (r.get('file_name') or '') != stem + '.pdf' or (r.get('title_stem') or '') != f"{u['session']}_{stem}":
        out.append('file name does not match the URL')
    if str(cit.get('session')) != u['session'] or cit.get('house') != 'Lok Sabha':
        out.append('citation session or house does not match the URL')
    if str(cit.get('question_type') or '').upper() != QTYPE[u['prefix']] or str(cit.get('question_no') or '') != u['number']:
        out.append('citation question type or number does not match the URL')
    if not re.search(rf'\bNo\.\s*{int(u["number"])}\b', r.get('title') or ''):
        out.append('title does not carry the question number')
    if not qno_in_text(text, u['number']):
        out.append('question number not found in the text')
    when = iso(cit.get('answered_on'))
    if not when:
        out.append('no answer date in the citation')
    elif not date_in_text(text, when):
        out.append('answer date not found in the text')
    links = r.get('links') or []
    if not links:
        out.append('no desk row link')
    asked = {norm(x) for x in (cit.get('asked_by') or [])}
    for l in links:
        row = rows.get(str(l.get('row_key')))
        if l.get('tier') != TIER or l.get('feature') != FEATURE or l.get('document_key') != f"pq:ls:{u['session']}:{stem}":
            out.append('desk link names another module or key'); break
        if row is None:
            out.append('desk row not found'); break
        problems = [n for n, ok in [
            ('url', row.get('source_url') == url),
            ('subject', norm(row.get('subject')) == norm(cit.get('subject'))),
            ('date', iso(row.get('date')) == when),
            ('type', str(row.get('question_type') or '').upper() == QTYPE[u['prefix']]),
            ('ministry', norm(row.get('ministry')) == norm(cit.get('ministry'))),
            ('member', norm(row.get('mp_name')) in asked),
            ('house', row.get('house') == 'Lok Sabha')] if not ok]
        if problems:
            out.append('desk row disagrees: ' + ','.join(problems)); break
    return out


def screen_order(records):
    """Newest answers first, then session and question number, then key: deterministic."""
    def k(r):
        c = r.get('citation') or {}
        return (iso(c.get('answered_on')) or '', str(c.get('session') or ''), -int(c.get('question_no') or 0) if str(c.get('question_no') or '').isdigit() else 0, r.get('source_key') or '')
    return sorted(records, key=k, reverse=True)


def supplied_record(r):
    """The corpus line the importer reads (the review is bound by the decision manifest)."""
    u = url_parts(r['file_url'])
    out = {
        'source_key': r['source_key'], 'title': r['title'], 'text': r['text'], 'text_sha256': r['content_sha256'],
        'desk_tier': TIER, 'desk_feature': FEATURE, 'citation': r['citation'],
        'pages': [{'page_number': p['page_number'], 'char_from': p['char_from'], 'char_to': p['char_to'], 'text': p['text']} for p in r['pages']],
        'page_count': r['page_count'], 'n_chars': r['n_chars'], 'page_split': 'exact',
        'file_name': r['file_name'], 'file_url': r['file_url'],
        'document_key_suggested': f"pq:ls:{u['session']}:{u['stem']}",
    }
    for k in ('file_url_alt', 'doc_type', 'licence_class', 'citation_text', 'as_of', 'source_host', 'source_path', 'text_engine', 'extraction'):
        if r.get(k) is not None:
            out[k] = str(r[k])
    return out


def decision(r, decision_id, file_sha256):
    return {'source_key': r['source_key'], 'text_sha256': r['content_sha256'], 'file_sha256': file_sha256, 'desk_feature': FEATURE,
            'review': {'status': 'eligible', 'source_key': r['source_key'], 'text_sha256': r['content_sha256'], 'rules_sha256': RULES_SHA256,
                       'package_id': PACKAGE, 'mapping_version': MAPPING_VERSION, 'decision_id': decision_id,
                       'checks': {'identity': True, 'completeness': True, 'sensitivity': True, 'dedupe': True, 'rights': True}}}


LEDGER_COLUMNS = ['batch', 'tranche', 'order', 'source_key', 'file_name', 'title', 'house', 'session', 'question_type', 'question_no',
                  'answered_on', 'ministry', 'asked_by', 'desk_row_keys', 'document_key', 'file_url', 'n_chars', 'pages', 'chunks',
                  'text_sha256', 'status', 'document_id', 'indexed_at']


def ledger_row(batch, tranche, order, r, chunks, status='planned', document_id='', indexed_at=''):
    c, u = r.get('citation') or {}, url_parts(r['file_url'])
    return {'batch': batch, 'tranche': tranche, 'order': order, 'source_key': r['source_key'], 'file_name': r['file_name'], 'title': r['title'],
            'house': c.get('house'), 'session': c.get('session'), 'question_type': c.get('question_type'), 'question_no': c.get('question_no'),
            'answered_on': iso(c.get('answered_on')), 'ministry': c.get('ministry'), 'asked_by': '; '.join(c.get('asked_by') or []),
            'desk_row_keys': ' '.join(str(l.get('row_key')) for l in r.get('links') or []), 'document_key': f"pq:ls:{u['session']}:{u['stem']}",
            'file_url': r['file_url'], 'n_chars': r['n_chars'], 'pages': r['page_count'], 'chunks': chunks, 'text_sha256': r['content_sha256'],
            'status': status, 'document_id': document_id, 'indexed_at': indexed_at}


def fingerprint(rows):
    """sha256 over sorted 'source_key|chunks|text_sha256' lines (the Law receipts' cohort fingerprint)."""
    return hashlib.sha256('\n'.join(sorted(f"{k}|{c}|{t}" for k, c, t in rows)).encode()).hexdigest()
