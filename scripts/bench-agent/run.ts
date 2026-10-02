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
 *     --variants baseline,presearch,presearch2 --narrow 10 --broad 15 --followups 10 \
 *     --model google/gemini-3.8-flash   [--kinds broad,followup]
 *
 *   chat-turn-cost (F41): --variants v44,capped --kinds narrow,broad,widened [--widened 10]
 *   `v44` runs the live code with both prompt limits off; `capped` with WIDENED_TOP_K and
 *   TOOL_REPLY_CHARS on. A `widened` question is a narrow one under "Attached only" with no
 *   document named, so every search is widened (unkeyed), as in F41's slow turn.
 *
 * Variants (amendment 1): `baseline` has no pre-search; `presearch` is v43 (every turn that is
 * not small talk, without the note); `presearch2` adds the note and skips follow-ups. `batch`
 * is the measured-only sweep-in-one-round prompt.
 *
 * Writes eval/agent/results/<timestamp>.json and prints a summary. Costs real money: about $0.02
 * per question per variant on Gemini 3.8 Flash.
 */
import { createAgentBudget, PRESEARCH_NOTE, runAgent, TOOL_REPLY_CHARS, type AgentEvent, type AgentInput } from '../../supabase/functions/research-chat/agent.ts';
import type { Message } from '../../supabase/functions/_shared/openrouterStream.ts';
import { buildSystemPrompt, buildUserTurn } from '../../supabase/functions/research-chat/prompt.ts';
import { deskCatalogBlock } from '../../supabase/functions/_shared/deskCatalog.ts';
import { createHandleAssigner, handlesIn } from '../../supabase/functions/_shared/handles.ts';
import { streamChat, type ModelEvent, type StreamRequest } from '../../supabase/functions/_shared/openrouterStream.ts';
import { embedTexts } from '../../supabase/functions/_shared/embed.ts';
import { search } from '../../supabase/functions/_shared/retrieval.ts';

import { fromFileUrl } from 'jsr:@std/path@1';
const root = fromFileUrl(new URL('../../', import.meta.url));
const args = Object.fromEntries(Deno.args.map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const VARIANTS = (args.variants ?? 'baseline,presearch,presearch2').split(',');
const NARROW = Number(args.narrow ?? 10);
const BROAD = Number(args.broad ?? 15);
const FOLLOWUPS = Number(args.followups ?? 10);
const WIDENED = Number(args.widened ?? 10);
const KINDS = (args.kinds ?? 'narrow,broad,followup').split(',');
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
type Kind = 'narrow' | 'broad' | 'followup' | 'widened';
interface Q { id: string; kind: Kind; question: string; gold: string[]; first?: string }
interface Eval { id: string; question: string; desk_feature: string; gold_document_ids: string[] }
const all: Eval[] = Deno.readTextFileSync(`${root}eval/retrieval/questions.v1.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Deterministic spreads. Narrow: every thirteenth question, any desk. Broad briefs and follow-ups
// are on bills (clauses, penalties and administration are what a bill has), on distinct documents.
const narrow: Q[] = all.filter((_, i) => i % 13 === 0).slice(0, NARROW)
  .map((q) => ({ id: q.id, kind: 'narrow', question: q.question, gold: q.gold_document_ids }));
const bills: Eval[] = [];
for (const q of all.filter((q) => q.desk_feature === 'Bill Passage Probability Index')) {
  if (!bills.some((b) => b.gold_document_ids[0] === q.gold_document_ids[0])) bills.push(q);
}
const broadSrc = bills.filter((_, i) => i % 2 === 0).slice(0, BROAD);
const followSrc = bills.filter((_, i) => i % 2 === 1).slice(0, FOLLOWUPS);
const titles: Record<string, string> = broadSrc.length
  ? JSON.parse(await replicaSql(`select coalesce(json_object_agg(id, title), '{}') from public.documents where id in (${broadSrc.map((q) => lit(q.gold_document_ids[0])).join(',')});`))
  : {};
const broad: Q[] = broadSrc.map((q) => ({
  id: `${q.id}-brief`, kind: 'broad', gold: q.gold_document_ids,
  question: `Brief me on ${titles[q.gold_document_ids[0]] ?? 'this bill'}: what it does, its key clauses, penalties and who administers it.`,
}));
// A follow-up names no document: it only makes sense with the first question in view.
const FOLLOW = [
  'What penalties does it set, and who enforces them?',
  'Who administers it, and what powers does that authority get?',
  'When does it come into force, and which earlier law does it change?',
];
const followups: Q[] = followSrc.map((q, i) => ({
  id: `${q.id}-follow`, kind: 'followup', gold: q.gold_document_ids, first: q.question, question: FOLLOW[i % FOLLOW.length],
}));
const widened: Q[] = narrow.slice(0, WIDENED).map((q) => ({ ...q, id: `${q.id}-wide`, kind: 'widened' }));
const questions = [...narrow, ...broad, ...followups, ...widened].filter((q) => KINDS.includes(q.kind));

// ─── Prompt ──────────────────────────────────────────────────────────────────
const personas = JSON.parse(Deno.readTextFileSync(`${root}supabase/functions/_shared/personas.json`));
const MODULES = ['Bill Passage Probability Index', 'Budget Utilisation & Schemes', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'Industry Updates (Ministry Data)', 'Parliamentary Question Database'];
const baseSystem = buildSystemPrompt({ persona: personas['policy.md'], today: '2026-10-02', catalogue: deskCatalogBlock('national'), focus: 'broad', documentModules: MODULES });
const SWEEP = 'Sweep the subject part by part, one query per part, reading the passages before choosing the next query.';
const BATCH = 'Sweep the subject part by part: issue every query the sweep needs at once, as parallel search calls in one turn, rather than one query per turn.';
if (!baseSystem.includes(SWEEP)) throw new Error('the sweep sentence moved; update the batch variant');

// ─── One run ─────────────────────────────────────────────────────────────────
const AMENDMENT_1 = new Set(['presearch2', 'v44', 'capped', 'wideonly', 'v45', 'thru', 'lat']);
// chat-turn-cost amendment 1: OpenRouter provider routing. `v45` is the deployed code (widened limit
// on, reply cap off, default routing); `thru` and `lat` add provider.sort. Every one sends a
// session_id, as the handler does, so sticky routing is part of what is measured.
const ROUTING: Record<string, 'throughput' | 'latency'> = { thru: 'throughput', lat: 'latency' };
const DEPLOYED = new Set(['v45', 'thru', 'lat']);
// The prompt limits (chat-turn-cost): on only for `capped`; every earlier variant predates them.
// `wideonly`: the widened-search limit alone (the reply cap off), as shipped once the reply cap
// missed the depth pass mark on narrow questions.
// The reply cap is off by default since that decision, so `capped` asks for it explicitly.
const limitsOf = (variant: string) => (variant === 'capped' ? { toolReplyChars: TOOL_REPLY_CHARS } : variant === 'wideonly' || DEPLOYED.has(variant) ? { toolReplyChars: null } : { widenedTopK: null, toolReplyChars: null });
async function runOne(q: Q, variant: string, history: Message[] = []) {
  const t0 = performance.now();
  let calls = 0, firstAnswer = 0, retracts = 0;
  const callMs: number[] = [];
  const usage: { prompt: number; completion: number; cached: number; cost: number }[] = [];
  const handles = createHandleAssigner();
  const chunkOf = new Map<string, { doc: string; page: string }>();
  const input: AgentInput = {
    system: variant === 'batch' ? baseSystem.replace(SWEEP, BATCH) : baseSystem,
    window: history,
    userTurn: buildUserTurn(q.question),
    scopedDocumentIds: [],
    // A widened question: "Attached only" with nothing named, so every search is widened (unkeyed).
    focus: q.kind === 'widened' ? 'attached' : 'broad',
    scopeSent: false,
    conversational: false,
    // Mirrors the handler: v43 pre-searched every turn; amendment 1 (presearch2, and v44 and capped,
    // which are that code) skips a follow-up.
    ...(variant === 'baseline' || (AMENDMENT_1.has(variant) && history.length) ? {} : { presearch: q.question }),
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
      request: {
        model: MODEL,
        reasoning: { effort: EFFORT },
        ...(DEPLOYED.has(variant) ? { session_id: crypto.randomUUID() } : {}),
        ...(ROUTING[variant] ? { providerSort: ROUTING[variant] } : {}),
      },
      model: async function* (req: StreamRequest): AsyncGenerator<ModelEvent> {
        calls++;
        // v43 had no note on the pre-search reply: take it off to reproduce that variant.
        if (variant === 'presearch') {
          req = { ...req, messages: req.messages.map((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(PRESEARCH_NOTE) ? { ...m, content: m.content.slice(PRESEARCH_NOTE.length) } : m) };
        }
        const c0 = performance.now();
        for await (const ev of streamChat({ fetch, apiKey: key }, req)) {
          if (ev.type === 'finish' && ev.usage) {
            usage.push({ prompt: ev.usage.prompt_tokens ?? 0, completion: ev.usage.completion_tokens ?? 0, cached: ev.usage.cached_prompt_tokens ?? 0, cost: ev.usage.cost ?? 0 });
          }
          yield ev;
        }
        callMs.push(Math.round(performance.now() - c0));
      },
      ...limitsOf(variant),
      searchDocuments: async (a, ids, topK) => {
        const chunks = await search(retrievalDeps, { query: a.query, deskTier: a.desk_tier, deskFeature: a.desk_feature, documentIds: ids, topK });
        for (const c of chunks) chunkOf.set(c.id, { doc: c.document_id, page: `${c.document_id}:${c.page_number ?? `c${c.chunk_index}`}` });
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
  let parsed = false, validCitations = false, citesGold = false, answerChars = 0, cited = 0, docs = 0, pages = 0, answer = '';
  try {
    const env = JSON.parse(text);
    parsed = typeof env.answer === 'string' && env.answer.trim().length > 0;
    answerChars = env.answer?.length ?? 0;
    answer = env.answer ?? '';
    const used = new Set([...handlesIn(JSON.stringify(env.sources ?? [])), ...handlesIn(env.answer ?? '')]);
    cited = used.size;
    validCitations = [...used].every((h) => handles.lookup(h) !== undefined);
    const hits = [...used].map((h) => chunkOf.get(handles.lookup(h) ?? '')).filter((x) => x !== undefined);
    citesGold = hits.some((x) => q.gold.includes(x.doc));
    docs = new Set(hits.map((x) => x.doc)).size;
    pages = new Set(hits.map((x) => x.page)).size;
  } catch { /* unparsed */ }
  const sum = (k: keyof typeof usage[number]) => usage.reduce((n, u) => n + u[k], 0);
  return {
    id: q.id, kind: q.kind, variant, calls, searches, retracts, error, answer,
    first_answer_ms: Math.round(firstAnswer), total_ms: Math.round(total), call_ms: callMs,
    call_prompt_tokens: usage.map((u) => u.prompt),
    prompt_tokens: sum('prompt'), completion_tokens: sum('completion'), cached_tokens: sum('cached'), cost_usd: Number(sum('cost').toFixed(5)),
    parsed, valid_citations: validCitations, cites_gold: citesGold, cited, docs, pages, answer_chars: answerChars,
  };
}

const rows = [];
let setupCost = 0;
for (const [qi, q] of questions.entries()) {
  // A follow-up's history: its first question and that question's answer, from one baseline run
  // shared by every variant.
  let history: Message[] = [];
  if (q.first) {
    const first = await runOne({ ...q, kind: 'narrow', question: q.first }, 'baseline');
    setupCost += first.cost_usd;
    history = [{ role: 'user', content: q.first }, { role: 'assistant', content: first.answer || 'Not in record.' }];
  }
  // The order rotates per question, so no variant always runs second, on a prompt the provider has
  // just cached for another.
  for (const v of VARIANTS.map((_, k) => VARIANTS[(k + qi) % VARIANTS.length])) {
    const r = await runOne(q, v, history);
    rows.push(r);
    console.log(`${q.id.padEnd(16)} ${v.padEnd(10)} calls=${r.calls} searches=${r.searches} first=${(r.first_answer_ms / 1000).toFixed(1)}s total=${(r.total_ms / 1000).toFixed(1)}s $${r.cost_usd} docs=${r.docs} pages=${r.pages} valid=${r.valid_citations} gold=${r.cites_gold}${r.error ? ' ERR ' + r.error : ''}`);
  }
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = `${root}eval/agent/results/${stamp}.json`;
Deno.writeTextFileSync(out, JSON.stringify({ model: MODEL, effort: EFFORT, variants: VARIANTS, n: questions.length, setup_cost_usd: Number(setupCost.toFixed(5)), rows }, null, 1));
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0; };
for (const kind of ['narrow', 'broad', 'followup', 'widened'] as Kind[]) {
  console.log(`\n${kind}\nvariant     calls  searches  docs  pages  first_word(p50)  total(p50)  cost(avg)  valid  gold  errors`);
  for (const v of VARIANTS) {
    const r = rows.filter((x) => x.variant === v && x.kind === kind);
    if (!r.length) continue;
    const ok = r.filter((x) => !x.error);
    const avg = (f: (x: typeof r[number]) => number) => ok.reduce((n, x) => n + f(x), 0) / Math.max(1, ok.length);
    const perCall = ok.flatMap((x) => x.call_prompt_tokens);
    console.log(`${''.padEnd(11)} prompt tokens per call: p50 ${pct(perCall, 0.5)}  p90 ${pct(perCall, 0.9)}  max ${Math.max(0, ...perCall)}  (n=${perCall.length})`);
    console.log(`${v.padEnd(11)} ${avg((x) => x.calls).toFixed(2).padStart(5)} ${avg((x) => x.searches).toFixed(2).padStart(9)} ${avg((x) => x.docs).toFixed(2).padStart(5)} ${avg((x) => x.pages).toFixed(2).padStart(6)} ${(med(ok.filter((x) => x.first_answer_ms).map((x) => x.first_answer_ms)) / 1000).toFixed(1).padStart(15)}s ${(med(ok.map((x) => x.total_ms)) / 1000).toFixed(1).padStart(10)}s $${avg((x) => x.cost_usd).toFixed(4)}  ${ok.filter((x) => x.valid_citations).length}/${r.length}  ${ok.filter((x) => x.cites_gold).length}/${r.length}  ${r.length - ok.length}`);
  }
}
console.log(`\nsetup (follow-up first answers) $${setupCost.toFixed(4)}\nwritten ${out.replace(root, '')}`);
