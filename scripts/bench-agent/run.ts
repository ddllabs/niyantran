/**
 * Agent speed benchmark (docs/specs/2026-10-02-answer-speed.md §2). LOCAL ONLY.
 *
 * Runs the real research agent (runAgent), the real system prompt and real OpenRouter models, but
 * searches the local NTER corpus replica (`niyantran_retrieval_replica` in the
 * `niyantran-corpus-test-db` container) through the real retrieval code and the replica's own
 * match_documents. Nothing touches NTER. Needs Docker and OPENROUTER_API_KEY in .env.local; run
 * outside the sandbox:
 *
 *   deno run -A --config supabase/functions/deno.json scripts/bench-agent/run.ts \
 *     --variants baseline,presearch,batch --n 20 --model google/gemini-3.8-flash
 *
 * Writes eval/agent/results/<timestamp>.json and prints a summary. Costs real money: about $0.02
 * per question per variant on Gemini 3.8 Flash.
 */
import { createAgentBudget, runAgent, type AgentEvent, type AgentInput } from '../../supabase/functions/research-chat/agent.ts';
import { buildSystemPrompt, buildUserTurn } from '../../supabase/functions/research-chat/prompt.ts';
import { deskCatalogBlock } from '../../supabase/functions/_shared/deskCatalog.ts';
import { createHandleAssigner, handlesIn } from '../../supabase/functions/_shared/handles.ts';
import { streamChat, type ModelEvent, type StreamRequest } from '../../supabase/functions/_shared/openrouterStream.ts';
import { embedTexts } from '../../supabase/functions/_shared/embed.ts';
import { search } from '../../supabase/functions/_shared/retrieval.ts';

import { fromFileUrl } from 'jsr:@std/path@1';
const root = fromFileUrl(new URL('../../', import.meta.url));
const args = Object.fromEntries(Deno.args.map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const VARIANTS = (args.variants ?? 'baseline,presearch').split(',');
const N = Number(args.n ?? 20);
const MODEL = args.model ?? 'google/gemini-3.8-flash';
const EFFORT = args.effort ?? 'low';
const env = Deno.readTextFileSync(`${root}.env.local`);
const key = (env.match(/^OPENROUTER_API_KEY=(.*)$/m)?.[1] ?? '').replace(/^["']|["']$/g, '').trim();
if (!key) throw new Error('OPENROUTER_API_KEY missing from .env.local');

// ─── The replica ─────────────────────────────────────────────────────────────
async function replicaSql(sql: string): Promise<string> {
  const cmd = new Deno.Command('docker', {
    args: ['exec', '-i', 'niyantran-corpus-test-db', 'psql', '-U', 'postgres', '-d', 'niyantran_retrieval_replica', '-At', '-v', 'ON_ERROR_STOP=1'],
    stdin: 'piped', stdout: 'piped', stderr: 'piped',
  });
  const child = cmd.spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const out = await child.output();
  if (!out.success) throw new Error(`replica: ${new TextDecoder().decode(out.stderr).slice(0, 300)}`);
  return new TextDecoder().decode(out.stdout).trim();
}
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
const retrievalDeps = {
  embed: async (q: string) => {
    const r = await embedTexts({ fetch, apiKey: key }, [q]);
    return { vector: r.vectors[0], model: r.model };
  },
  rpc: async (_name: string, p: Record<string, unknown>) => {
    const ids = Array.isArray(p.p_document_ids) && p.p_document_ids.length
      ? `array[${(p.p_document_ids as string[]).map(lit).join(',')}]::uuid[]` : 'null';
    const sql = `select coalesce(json_agg(t), '[]') from public.match_documents('[${(p.query_embedding as number[]).join(',')}]'::extensions.vector(1536), ${Number(p.match_count)}, ${ids}, ${lit((p.p_desk_tier as string) ?? null)}, ${lit((p.p_desk_feature as string) ?? null)}) t;`;
    return { data: JSON.parse(await replicaSql(sql)), error: null };
  },
};

// ─── Questions ───────────────────────────────────────────────────────────────
interface Q { id: string; question: string; gold: string[]; broad?: boolean }
const all = Deno.readTextFileSync(`${root}eval/retrieval/questions.v1.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A deterministic spread: every ninth question, then broad briefs (a quarter of N, up to five) on
// the documents of the first of them.
const BROAD = Math.min(5, Math.floor(N / 4));
const picked: Q[] = all.filter((_: unknown, i: number) => i % 9 === 0).slice(0, N - BROAD)
  .map((q: { id: string; question: string; gold_document_ids: string[] }) => ({ id: q.id, question: q.question, gold: q.gold_document_ids }));
const titles = BROAD ? JSON.parse(await replicaSql(`select coalesce(json_object_agg(id, title), '{}') from public.documents where id in (${picked.slice(0, BROAD).map((q) => lit(q.gold[0])).join(',')});`)) : {};
const broad: Q[] = picked.slice(0, BROAD).map((q) => ({
  id: `${q.id}-brief`, gold: q.gold, broad: true,
  question: `Brief me on ${titles[q.gold[0]] ?? 'this bill'}: what it does, its key clauses, penalties and who administers it.`,
}));
const questions = [...picked, ...broad].slice(0, N);

// ─── Prompt ──────────────────────────────────────────────────────────────────
const personas = JSON.parse(Deno.readTextFileSync(`${root}supabase/functions/_shared/personas.json`));
const MODULES = ['Bill Passage Probability Index', 'Budget Utilisation & Schemes', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Industry Updates (Ministry Data)', 'Parliamentary Question Database'];
const baseSystem = buildSystemPrompt({ persona: personas['policy.md'], today: '2026-10-02', catalogue: deskCatalogBlock('national'), focus: 'broad', documentModules: MODULES });
const SWEEP = 'Sweep the subject part by part, one query per part, reading the passages before choosing the next query.';
const BATCH = 'Sweep the subject part by part: issue every query the sweep needs at once, as parallel search calls in one turn, rather than one query per turn.';
if (!baseSystem.includes(SWEEP)) throw new Error('the sweep sentence moved; update the batch variant');

// ─── One run ─────────────────────────────────────────────────────────────────
async function runOne(q: Q, variant: string) {
  const t0 = performance.now();
  let calls = 0, firstAnswer = 0, retracts = 0;
  const callMs: number[] = [];
  const usage: { prompt: number; completion: number; cached: number; cost: number }[] = [];
  const handles = createHandleAssigner();
  const chunkDoc = new Map<string, string>();
  const input: AgentInput = {
    system: variant === 'batch' ? baseSystem.replace(SWEEP, BATCH) : baseSystem,
    window: [],
    userTurn: buildUserTurn(q.question),
    scopedDocumentIds: [],
    focus: 'broad',
    scopeSent: false,
    conversational: false,
    ...(variant === 'baseline' ? {} : { presearch: q.question }),
  };
  const onEvent = (e: AgentEvent) => {
    if (('text' in e || 'draftText' in e) && !firstAnswer) firstAnswer = performance.now() - t0;
    if ('retract' in e) { retracts++; firstAnswer = 0; }
  };
  let error = '';
  let text = '';
  let searches = 0;
  try {
    const result = await runAgent({
      request: { model: MODEL, reasoning: { effort: EFFORT } },
      model: async function* (req: StreamRequest): AsyncGenerator<ModelEvent> {
        calls++;
        const c0 = performance.now();
        for await (const ev of streamChat({ fetch, apiKey: key }, req)) {
          if (ev.type === 'finish' && ev.usage) {
            usage.push({ prompt: ev.usage.prompt_tokens ?? 0, completion: ev.usage.completion_tokens ?? 0, cached: ev.usage.cached_prompt_tokens ?? 0, cost: ev.usage.cost ?? 0 });
          }
          yield ev;
        }
        callMs.push(Math.round(performance.now() - c0));
      },
      searchDocuments: async (a, ids) => {
        const chunks = await search(retrievalDeps, { query: a.query, deskTier: a.desk_tier, deskFeature: a.desk_feature, documentIds: ids });
        for (const c of chunks) chunkDoc.set(c.id, c.document_id);
        return chunks;
      },
      searchDeskRows: () => Promise.resolve({ rows: [], total: 0, snapshot_at: null }),
      handles,
      budget: createAgentBudget(),
      onEvent,
    }, input);
    text = result.text;
    searches = result.searches;
  } catch (e) {
    error = String((e as Error).message ?? e).slice(0, 200);
  }
  const total = performance.now() - t0;
  // Quality: the envelope parses; every cited handle was assigned this turn; the gold document is cited.
  let parsed = false, validCitations = false, citesGold = false, answerChars = 0, cited = 0;
  try {
    const env = JSON.parse(text);
    parsed = typeof env.answer === 'string' && env.answer.trim().length > 0;
    answerChars = env.answer?.length ?? 0;
    const used = new Set([...handlesIn(JSON.stringify(env.sources ?? [])), ...handlesIn(env.answer ?? '')]);
    cited = used.size;
    validCitations = [...used].every((h) => handles.lookup(h) !== undefined);
    citesGold = [...used].some((h) => q.gold.includes(chunkDoc.get(handles.lookup(h) ?? '') ?? ''));
  } catch { /* unparsed */ }
  const sum = (k: keyof typeof usage[number]) => usage.reduce((n, u) => n + u[k], 0);
  return {
    id: q.id, broad: !!q.broad, variant, calls, searches, retracts, error,
    first_answer_ms: Math.round(firstAnswer), total_ms: Math.round(total), call_ms: callMs,
    prompt_tokens: sum('prompt'), completion_tokens: sum('completion'), cached_tokens: sum('cached'), cost_usd: Number(sum('cost').toFixed(5)),
    parsed, valid_citations: validCitations, cites_gold: citesGold, cited, answer_chars: answerChars,
  };
}

const rows = [];
for (const q of questions) {
  for (const v of VARIANTS) {
    const r = await runOne(q, v);
    rows.push(r);
    console.log(`${q.id.padEnd(16)} ${v.padEnd(10)} calls=${r.calls} searches=${r.searches} first=${(r.first_answer_ms / 1000).toFixed(1)}s total=${(r.total_ms / 1000).toFixed(1)}s $${r.cost_usd} valid=${r.valid_citations} gold=${r.cites_gold}${r.error ? ' ERR ' + r.error : ''}`);
  }
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = `${root}eval/agent/results/${stamp}.json`;
Deno.writeTextFileSync(out, JSON.stringify({ model: MODEL, effort: EFFORT, variants: VARIANTS, n: questions.length, rows }, null, 1));
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log('\nvariant     calls(avg) searches(avg) first_word(p50) total(p50) cost(avg)  valid  gold  errors');
for (const v of VARIANTS) {
  const r = rows.filter((x) => x.variant === v);
  const ok = r.filter((x) => !x.error);
  const avg = (f: (x: typeof r[number]) => number) => ok.reduce((n, x) => n + f(x), 0) / Math.max(1, ok.length);
  console.log(`${v.padEnd(11)} ${avg((x) => x.calls).toFixed(2).padStart(10)} ${avg((x) => x.searches).toFixed(2).padStart(13)} ${(med(ok.filter((x) => x.first_answer_ms).map((x) => x.first_answer_ms)) / 1000).toFixed(1).padStart(14)}s ${(med(ok.map((x) => x.total_ms)) / 1000).toFixed(1).padStart(9)}s $${avg((x) => x.cost_usd).toFixed(4)}  ${ok.filter((x) => x.valid_citations).length}/${r.length}  ${ok.filter((x) => x.cites_gold).length}/${r.length}  ${r.length - ok.length}`);
}
console.log(`\nwritten ${out.replace(root, '')}`);
