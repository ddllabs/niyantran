"""research-coverage: pool coverage results (two passes) per variant and apply pass mark 1.
Scores from each answer's cited_chunk_ids against the current set.
  python3 scripts/bench-agent/coverage_eval.py eval/agent/results/<pass1>.json eval/agent/results/<pass2>.json"""
import json, statistics as st, sys
files = sys.argv[1:]
V = ['v46', 'check', 'nudge', 'both']
cov = {json.loads(l)['id']: json.loads(l) for l in open('eval/agent/coverage.v1.jsonl')}
def score(q, cited):
    c = set(cited); pts = cov[q]['points']
    got = [p['id'] for p in pts if any(x['chunk_id'] in c for x in p['passages'])]
    return len(got) / len(pts), len(got) == len(pts)
rows = []
for i, f in enumerate(files, 1):
    for r in json.load(open(f))['rows']:
        r['pass'] = i; rows.append(r)
errs = [(r['id'], r['variant'], r['error'][:60]) for r in rows if r['error']]
print('errors', errs, '| total cost', round(sum(r['cost_usd'] for r in rows), 2))
def pct(xs, p):
    xs = sorted(xs); k = (len(xs)-1)*p; lo = int(k); hi = min(lo+1, len(xs)-1); return xs[lo] + (xs[hi]-xs[lo])*(k-lo)
base = None
print(f"{'':6} {'cov%':>6} {'full/30':>7} {'full/pass':>9} {'srch':>5} {'nudged':>6} {'first p50/p90':>14} {'total p50/p90':>14} {'cost':>7} {'valid':>5} {'gold':>5}")
res = {}
for v in V:
    rs = [r for r in rows if r['variant'] == v and not r['error']]
    sc = [score(r['id'], r['cited_chunk_ids']) for r in rs]
    share = 100 * st.mean(s for s, _ in sc); full = sum(f for _, f in sc)
    perpass = [sum(score(r['id'], r['cited_chunk_ids'])[1] for r in rs if r['pass'] == p) for p in (1, 2)]
    fa = [r['first_answer_ms']/1000 for r in rs if r['first_answer_ms']]; tt = [r['total_ms']/1000 for r in rs]
    res[v] = dict(share=share, full=full, perpass=perpass, cost=st.mean(r['cost_usd'] for r in rs))
    print(f"{v:6} {share:6.1f} {full:>4}/{len(rs)} {str(perpass):>9} {st.mean(r['searches'] for r in rs):5.2f} {sum(r['nudged'] for r in rs):>3}/{len(rs)} {pct(fa,.5):6.1f}/{pct(fa,.9):5.1f}s {pct(tt,.5):6.1f}/{pct(tt,.9):5.1f}s {st.mean(r['cost_usd'] for r in rs):7.4f} {sum(r['valid_citations'] for r in rs):>2}/{len(rs)} {sum(r['cites_gold'] for r in rs):>2}/{len(rs)}")
b = res['v46']
print('\npass mark 1 (coverage +10 points, or full +3 per pass):')
for v in V[1:]:
    x = res[v]; dshare = x['share'] - b['share']; dfull = (x['full'] - b['full']) / 2
    print(f"  {v}: coverage {dshare:+.1f} points, full {dfull:+.1f} per pass -> {'PASS' if dshare >= 10 or dfull >= 3 else 'fail'}  (cost {100*(x['cost']/b['cost']-1):+.0f}%)")
# per-question full coverage, pass1|pass2
print('\nper question, points covered (pass1,pass2):')
for q in sorted(cov):
    line = f"  {q} ({len(cov[q]['points'])}pts)"
    for v in V:
        cs = [round(score(q, r['cited_chunk_ids'])[0]*len(cov[q]['points'])) for p in (1,2) for r in rows if r['variant']==v and r['id']==q and r['pass']==p and not r['error']]
        line += f"  {v}:{cs}"
    print(line)
