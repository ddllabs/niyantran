/**
 * research-coverage (docs/specs/2026-10-02-research-coverage.md): the coverage test set and its
 * score. LOCAL ONLY, read only.
 *
 * Each question in eval/agent/coverage.v1.jsonl lists the points a full answer needs. Each point
 * names the passages that hold it: every operative passage of the bill (or a same-named copy)
 * containing one of the point's anchor phrases, pinned by chunk id and chunk_hash. Text from the
 * Statement of Objects and Reasons onward does not count. A point is covered when the answer cites
 * one of its passages. coverage_build.py builds the set from the local replica.
 *
 *   deno run -A --config supabase/functions/deno.json scripts/bench-agent/coverage.ts
 *
 * checks every pinned passage against the local replica (it exists, its hash matches, it holds one
 * of the point's anchors), checks that no question has all its points in one passage, and prints the five
 * questions drawn for the owner's spot-check.
 */

export interface CoveragePassage { document_id: string; chunk_id: string; chunk_index: number; chunk_hash: string }
export interface CoveragePoint { id: string; fact: string; anchors: string[]; passages: CoveragePassage[] }
export interface CoverageQuestion {
  id: string;
  question: string;
  document_id: string;
  title: string;
  alternate_document_ids: string[];
  points: CoveragePoint[];
}

export const COVERAGE_SET = new URL('../../eval/agent/coverage.v1.jsonl', import.meta.url);
/** Drawn for the owner's spot-check: one of each kind of question (penalties, a process, an
 * amendment, entitlements, consequences). */
export const SPOT_CHECK = ['cov-01', 'cov-04', 'cov-09', 'cov-11', 'cov-14'];

export function loadCoverageSet(path: URL | string = COVERAGE_SET): CoverageQuestion[] {
  return Deno.readTextFileSync(path).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The points an answer covers, given the chunk ids it cites. */
export function scoreCoverage(q: CoverageQuestion, citedChunkIds: Iterable<string>) {
  const cited = new Set(citedChunkIds);
  const covered = q.points.filter((p) => p.passages.some((x) => cited.has(x.chunk_id))).map((p) => p.id);
  return { points: q.points.length, covered: covered.length, missing: q.points.map((p) => p.id).filter((id) => !covered.includes(id)), full: covered.length === q.points.length };
}

const normalise = (s: string) => s.replaceAll('’', "'").replaceAll('‘', "'").replaceAll('“', '"').replaceAll('”', '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** Problems with the set: a missing or changed passage, an anchor not in its passage, a question
 * whose points all sit in one passage. Empty when the set is sound. */
export function checkSet(set: CoverageQuestion[], replica: Map<string, { chunk_hash: string; content: string }>): string[] {
  const problems: string[] = [];
  for (const q of set) {
    if (new Set(q.points.map((p) => p.passages.map((x) => x.chunk_id).sort().join(','))).size < 2) problems.push(`${q.id}: every point sits in one passage`);
    for (const p of q.points) {
      if (!p.passages.length) problems.push(`${q.id} ${p.id}: no passage`);
      for (const x of p.passages) {
        const row = replica.get(x.chunk_id);
        if (!row) problems.push(`${q.id} ${p.id}: passage ${x.chunk_id} is missing`);
        else if (row.chunk_hash !== x.chunk_hash) problems.push(`${q.id} ${p.id}: passage ${x.chunk_id} changed`);
        else if (!p.anchors.some((a) => normalise(row.content).includes(normalise(a)))) problems.push(`${q.id} ${p.id}: no anchor in passage ${x.chunk_id}`);
      }
    }
  }
  return problems;
}

async function replicaRows(ids: string[]): Promise<Map<string, { chunk_hash: string; content: string }>> {
  const sql = `select coalesce(json_object_agg(id, json_build_object('chunk_hash', chunk_hash, 'content', content)), '{}') from public.document_chunks where id in (${ids.map((i) => `'${i}'`).join(',')});`;
  const child = new Deno.Command('docker', {
    args: ['exec', '-i', 'niyantran-corpus-test-db', 'psql', '-U', 'postgres', '-d', 'niyantran_retrieval_replica', '-At', '-v', 'ON_ERROR_STOP=1'],
    stdin: 'piped', stdout: 'piped', stderr: 'piped',
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const out = await child.output();
  if (!out.success) throw new Error(`replica: ${new TextDecoder().decode(out.stderr).slice(0, 300)}`);
  return new Map(Object.entries(JSON.parse(new TextDecoder().decode(out.stdout).trim())));
}

if (import.meta.main) {
  const set = loadCoverageSet();
  const ids = [...new Set(set.flatMap((q) => q.points.flatMap((p) => p.passages.map((x) => x.chunk_id))))];
  const problems = checkSet(set, await replicaRows(ids));
  console.log(`${set.length} questions, ${set.reduce((n, q) => n + q.points.length, 0)} points, ${ids.length} pinned passages`);
  if (problems.length) {
    console.log(problems.join('\n'));
    Deno.exit(1);
  }
  console.log('every pinned passage exists, matches its hash and holds its anchor\n\nspot-check:');
  for (const q of set.filter((x) => SPOT_CHECK.includes(x.id))) {
    console.log(`\n${q.id} ${q.title}\n  Q: ${q.question}`);
    for (const p of q.points) console.log(`  ${p.id} ${p.fact}\n       passages ${p.passages.map((x) => `#${x.chunk_index}`).join(', ')}`);
  }
}
