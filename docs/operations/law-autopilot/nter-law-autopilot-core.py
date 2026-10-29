raise SystemExit('DISABLED 2026-10-29 (owner rules 2 and 7): this core is loaded only by the Law autopilot and the PQ section driver, which sign in with a stored password and chain batches. Kept only as the provenance of Law batches 7-11 and PQ batches 1-6; see docs/operations/national-pq-batch/README.md.')
# NTER Law autopilot core: pure, offline-testable helpers (no Colab, no network). Loaded by nter-law-autopilot.py.
# Near-duplicate detection (MinHash over 5-word shingles), eligibility holds, tranche planning and REST paging.
import json, math, re, urllib.parse, zlib
import numpy as np

KP = 'law:trib:IBBI_NCLT:ibbi_nclt-'
UP = 'https://ibbi.gov.in/uploads/order/'
NPERM = 256
_P = np.uint64(4294967311)  # prime > 2^32
_rng = np.random.default_rng(20261026)
_A = _rng.integers(1, 4294967311, NPERM, dtype=np.uint64)
_B = _rng.integers(0, 4294967311, NPERM, dtype=np.uint64)
assert int(_A.max()) < 2 ** 32 and int(_B.max()) < 4294967311  # keeps a·h + b below 2^64
MAX_CHUNKS, MAX_CHARS = 256, 300000


def norm_case(x):
    return re.sub(r'[^a-z0-9]', '', (x or '').lower())


def url_tail(u):
    m = re.search(r'([0-9a-f]{32})\.pdf$', u or '')
    return m.group(1) if m else None


def shingles(text, k=5):
    w = re.findall(r'\w+', (text or '').lower())
    if len(w) < k:
        return np.array([zlib.crc32(' '.join(w).encode())] if w else [], dtype=np.uint64)
    return np.unique(np.array([zlib.crc32(' '.join(w[i:i + k]).encode()) for i in range(len(w) - k + 1)], dtype=np.uint64))


def minhash(sh):
    """256 independent min-hashes of a shingle set. a, b < p ≈ 2^32 and h < 2^32; with this fixed seed every a < 2^32, so a·h + b < 2^64."""
    if len(sh) == 0:
        return np.full(NPERM, np.iinfo(np.uint64).max, dtype=np.uint64)
    out = np.empty(NPERM, dtype=np.uint64)
    for i in range(0, NPERM, 16):
        a, b = _A[i:i + 16, None], _B[i:i + 16, None]
        out[i:i + 16] = ((a * sh[None, :] + b) % _P).min(axis=1)
    return out


def containment(sig_a, n_a, sigs, ns):
    """Estimated |A∩B| / min(|A|,|B|) of A against each row of sigs (from MinHash Jaccard and set sizes)."""
    j = (sigs == sig_a[None, :]).mean(axis=1)
    inter = j * (n_a + ns) / (1 + j)
    return inter / np.maximum(1, np.minimum(n_a, ns))


def similar_hold(c, sh, sig, reg, get_sh):
    """Near-duplicate rule. reg: dict(sigs=m×256, ns=m, meta=[{key, case, date, tail}]); get_sh(i) returns registry
    document i's exact shingle set. MinHash only pre-filters (estimated containment ≥ 0.75, set sizes within 3×; the
    estimate is unreliable for very unequal sizes, so such pairs are not compared). The decision uses exact containment:
    ≥ 0.90 with a metadata tie (same normalized case number, same order date or same PDF hash tail), or ≥ 0.97 with at
    least 300 shingles on both sides (essentially identical text)."""
    n = len(sh)
    if not len(reg['ns']) or n == 0:
        return None
    ns = reg['ns']
    ratio_ok = np.maximum(n, ns) <= 3 * np.maximum(1, np.minimum(n, ns))
    est = containment(sig, n, reg['sigs'], ns)
    idx = np.nonzero(ratio_ok & (est >= 0.75))[0]
    for i in idx[np.argsort(-est[idx])][:10]:
        m = reg['meta'][i]
        other = get_sh(int(i))
        exact = len(np.intersect1d(sh, other, assume_unique=True)) / max(1, min(n, len(other)))
        tie = ((norm_case(c['case_number']) and norm_case(c['case_number']) == norm_case(m['case']))
               or (c['order_date'] and c['order_date'] == m['date'])
               or (url_tail(c['file_url']) and url_tail(c['file_url']) == m['tail']))
        if (exact >= 0.90 and tie) or (exact >= 0.97 and min(n, len(other)) >= 300):
            return {'key': m['key'], 'containment': round(float(exact), 3), 'tie': bool(tie)}
    return None


def contained_hold(c, sh, sig, reg, get_sh, min_frac=0.80, min_shingles=50):
    """A short order contained in a much longer order of the same date (seen in batches 7, 9 and 10: an I.A. order whose
    text recurs inside the full order). Covers exactly the pairs similar_hold skips: set sizes more than 3x apart and the
    same order date. MinHash pre-filters (estimated containment >= 0.5); the decision is exact: at least min_frac of the
    smaller shingle set inside the larger, with at least min_shingles on the smaller side."""
    n = len(sh)
    if not len(reg['ns']) or n == 0 or not c.get('order_date'):
        return None
    ns = reg['ns']
    dates = np.array([m['date'] for m in reg['meta']], dtype=object)
    far = np.maximum(n, ns) > 3 * np.maximum(1, np.minimum(n, ns))
    cand = np.nonzero(far & (dates == c['order_date']) & (np.minimum(n, ns) >= min_shingles))[0]
    if not len(cand):
        return None
    est = containment(sig, n, reg['sigs'][cand], ns[cand])
    for j in np.argsort(-est):
        if est[j] < 0.5:
            break
        i = int(cand[j]); other = get_sh(i)
        exact = len(np.intersect1d(sh, other, assume_unique=True)) / max(1, min(n, len(other)))
        if exact >= min_frac:
            return {'key': reg['meta'][i]['key'], 'containment': round(float(exact), 3), 'tie': True}
    return None


def reg_add(reg, key, case, date, url, sig, n, sh=None):
    reg['sigs'] = np.vstack([reg['sigs'], sig[None, :]]) if len(reg['ns']) else sig[None, :].copy()
    reg['ns'] = np.append(reg['ns'], n)
    reg['meta'].append({'key': key, 'case': case or '', 'date': date or '', 'tail': url_tail(url)})
    if sh is not None:
        reg.setdefault('sh', []).append(sh)


def base_holds(c, db_keys, db_urls):
    r = []
    if not c['case_number']:
        r.append('no case number')
    u = c['file_url'] or ''
    if not (u.startswith(UP) and u.endswith('.pdf') and ' ' not in u and ',' not in u and "'" not in u):
        r.append('not an official order PDF URL')
    if not (c['source_key'].startswith(KP) and len(c['source_key']) == len(KP) + 16):
        r.append('unexpected source key shape')
    if c['est_status'] != 'chunked':
        r.append(f"estimate {c['est_status']}")
    elif (c['chunks'] or 0) > MAX_CHUNKS or (c['content_chars'] or 0) > MAX_CHARS:
        r.append('over answer-read limits')
    if c['source_key'] in db_keys or u in db_urls:
        r.append('already in the database (key or URL)')
    return r


def plan_tranches(rows, cap=205, close_at=190, min_last=120):
    """rows in screen order, each with 'member'. Returns list of lists (tranches)."""
    tr, cur, by = [], [], {}
    for r in rows:
        by.setdefault(r['member'], []).append(r)
    for m, rs in by.items():
        while rs:
            room = cap - len(cur)
            cur += rs[:room]; rs = rs[room:]
            if len(cur) >= close_at or rs:
                tr.append(cur); cur = []
    if cur:
        if len(cur) < min_last and tr and len(tr[-1]) + len(cur) <= 260:
            tr[-1] += cur
        else:
            tr.append(cur)
    return tr


def max_cost(ceiling):
    return math.ceil(ceiling * 100 + 1e-9) / 100


def in_filter(values):
    return 'in.(' + ','.join('"' + v.replace('"', '') + '"' for v in values) + ')'


def rest_pages(get, table, params, page=1000, limit_pages=2000):
    """get(path_with_query) -> list. Pages with limit/offset (params must include a stable order) until an empty page,
    so a server max-rows below `page` cannot truncate silently."""
    assert 'order' in params, 'paging needs a stable order'
    out, off = [], 0
    for _ in range(limit_pages):
        q = dict(params, limit=str(page), offset=str(off))
        rows = get(f'/rest/v1/{table}?' + urllib.parse.urlencode(q, safe='(),.*:'))
        if not rows:
            return out
        out += rows
        off += len(rows)
    raise RuntimeError(f'{table}: too many pages')
