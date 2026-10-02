"""research-coverage stage 2: `v46` against `nudge` on narrow questions and briefs; pass marks 2-4.
  python3 scripts/bench-agent/coverage_stage2.py eval/agent/results/<stage2>.json"""
import json, statistics as st, sys
rows = [r for r in json.load(open(sys.argv[1]))['rows']]
print('errors', [(r['id'], r['variant'], r['error'][:60]) for r in rows if r['error']], '| cost', round(sum(r['cost_usd'] for r in rows), 2))
def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; lo = int(k); hi = min(lo + 1, len(xs) - 1); return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)
ok = True
for kind in ('narrow', 'broad'):
    ids = {r['id'] for r in rows if r['kind'] == kind}
    # matched questions: both variants answered without error
    m = [q for q in ids if all(any(r['id'] == q and r['variant'] == v and not r['error'] for r in rows) for v in ('v46', 'nudge'))]
    get = lambda v: [next(r for r in rows if r['id'] == q and r['variant'] == v) for q in m]
    b, n = get('v46'), get('nudge')
    s = lambda rs, k: st.mean(r[k] for r in rs)
    print(f"\n{kind} (n={len(m)})")
    for k in ('searches', 'docs', 'pages'): print(f"  {k:8} {s(b, k):.2f} -> {s(n, k):.2f}")
    for k in ('valid_citations', 'cites_gold'): print(f"  {k:15} {sum(r[k] for r in b)}/{len(m)} -> {sum(r[k] for r in n)}/{len(m)}")
    tb, tn = pct([r['total_ms'] / 1000 for r in b], .5), pct([r['total_ms'] / 1000 for r in n], .5)
    fb, fn = pct([r['first_answer_ms'] / 1000 for r in b if r['first_answer_ms']], .5), pct([r['first_answer_ms'] / 1000 for r in n if r['first_answer_ms']], .5)
    cb, cn = s(b, 'cost_usd'), s(n, 'cost_usd')
    fired = sum(r['nudged'] for r in n)
    print(f"  total p50 {tb:.1f}s -> {tn:.1f}s ({tn - tb:+.1f}s)   first word p50 {fb:.1f}s -> {fn:.1f}s   nudge fired {fired}/{len(m)}   cost ${cb:.4f} -> ${cn:.4f} ({100 * (cn / cb - 1):+.0f}%)")
    depth = all(s(n, k) >= s(b, k) for k in ('searches', 'docs', 'pages')) and sum(r['valid_citations'] for r in n) == len(m) and sum(r['cites_gold'] for r in n) >= sum(r['cites_gold'] for r in b)
    speed = True if kind != 'narrow' else (tn - tb <= 1.0 and fired <= 0.2 * len(m))
    cost = cn <= cb * 1.10
    print(f"  pass mark 2 (depth): {'PASS' if depth else 'fail'}   3 (narrow speed): {'PASS' if speed else 'fail'}   4 (cost): {'PASS' if cost else 'fail'}")
    ok = ok and depth and speed and cost
print('\nnudge ships:', 'YES' if ok else 'NO')
