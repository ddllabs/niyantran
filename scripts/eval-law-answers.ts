/** Opt-in, read-only model evaluation; never ingests or writes to Supabase.
 * Input JSON: {cases:[{id,question,previousQuestions?:string[],chunks:Chunk[]}]}
 * Private chunks come from a separately authorized read/export. Output contains source text;
 * keep it outside Git. No automatic semantic score: independently review answer + cited passages.
 * deno run --allow-read --allow-write=/tmp --allow-net=openrouter.ai \
 *   --allow-env=OPENROUTER_API_KEY --env-file=.env.local scripts/eval-law-answers.ts \
 *   --input=/tmp/law-cases.json --output=/tmp/law-results.json
 */
import { reviewLawAnswer } from '../supabase/functions/research-chat/lawAnswer.ts';
import { streamChat, type ModelEvent, type StreamRequest } from '../supabase/functions/_shared/openrouterStream.ts';
import type { Chunk } from '../supabase/functions/_shared/retrieval.ts';
import type { EvidenceMap } from '../supabase/functions/research-chat/sources.ts';
const arg = (name: string) => Deno.args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = arg('input'), output = arg('output');
if (!input || !output) throw new Error('Explicit --input and --output paths are required. Keep results outside Git.');
// Resolve the parent before creating a fresh private file; never overwrite inputs or repository files.
const outUrl = new URL(output, `file://${Deno.cwd()}/`);
const parent = await Deno.realPath(new URL('.', outUrl));
const repo = await Deno.realPath(new URL('..', import.meta.url));
if (parent === repo || parent.startsWith(repo + '/')) throw new Error('Results must be outside the repository.');
const outputFile = await Deno.open(outUrl, {write:true,createNew:true,mode:0o600});
const key = Deno.env.get('OPENROUTER_API_KEY');
if (!key) throw new Error('OPENROUTER_API_KEY is required; never put it in arguments or reports.');
const model = arg('model') ?? 'deepseek/deepseek-v4-flash';
// Admission threshold only: the last admitted call can exceed the remaining amount.
const maxCalls = 18, capUsd = 0.10;
const data = JSON.parse(await Deno.readTextFile(input));
if (!Array.isArray(data.cases) || !data.cases.length || data.cases.length > 6) throw new Error('Provide 1–6 cases per bounded evaluation.');
let calls = 0, spent = 0, unknownCost = false;
const results: unknown[] = [];
for (const c of data.cases) {
  if (typeof c.id !== 'string' || typeof c.question !== 'string' || !Array.isArray(c.chunks) || c.chunks.length > 256) throw new Error('Invalid evaluation case.');
  const evidence: EvidenceMap = new Map(c.chunks.map((chunk: Chunk, i: number) => [`ref:evalxx-${i + 1}`, {kind:'text',chunk}]));
  const attempts: unknown[] = [], reasons: string[] = [];
  const started = Date.now();
  let answer = null, error: string | undefined;
  async function* provider(req: StreamRequest): AsyncGenerator<ModelEvent> {
    calls++;
    const supplied = JSON.parse(String(req.messages[1].content));
    attempts.push({stagePassageIds:supplied.passages?.map((p:{id:string})=>p.id)});
    let finished = false, responseText = '';
    const response = { responseText: '' }; attempts.push(response);
    try { for await (const e of streamChat({fetch,apiKey:key!},req)) {
      if (e.type === 'text') { responseText = (responseText + e.text).slice(0, 24000); response.responseText = responseText; }
      if (e.type === 'finish') {
        finished = true;
        const cost = e.usage?.cost;
        if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) spent += cost; else unknownCost = true;
        attempts.push({finish:e.reason,usage:e.usage});
      }
      yield e;
    } } finally { if (!finished) unknownCost = true; }
  }
  try {
    answer = await reviewLawAnswer(provider, {model,question:c.question,previousQuestions:c.previousQuestions,evidence,
      signal:AbortSignal.timeout(120_000),selectionReasoning:{effort:arg('selection-effort') ?? arg('effort') ?? 'high'},
      reasoning:{effort:arg('effort') ?? 'high'},report:r=>reasons.push(r),
      takeAttempt: n => !unknownCost && spent < capUsd && maxCalls-calls >= n,
    });
  } catch (e) { error = e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'provider_or_runtime_failure'; }
  const cited = answer?.sources.map(s => ({...s,chunk:evidence.get(s.source)})) ?? [];
  results.push({id:c.id,question:c.question,answer,cited,reasons,error,attempts,ms:Date.now()-started});
  await outputFile.truncate(0);
  await outputFile.seek(0,Deno.SeekMode.Start);
  const bytes = new TextEncoder().encode(JSON.stringify({model,calls,spent,unknownCost,semanticAcceptance:'requires independent source review',results},null,2));
  for (let offset=0; offset<bytes.length;) offset += await outputFile.write(bytes.subarray(offset));
  await outputFile.sync();
  console.log(JSON.stringify({id:c.id,complete:!!answer,ms:Date.now()-started,reasons,error}));
  if (error || unknownCost || spent >= capUsd || calls >= maxCalls) break;
}

outputFile.close();
