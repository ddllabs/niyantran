// F123 measurement (owner-approved 2026-10-15: 20 records, total spend under $0.10).
//
// Writes the record brief for 20 fixed real rows (Global, National, Law) from
// public/data/embedded_csv, read-only, with each candidate model, using exactly the
// prompt and request body the desk-brief Edge Function sends (supabase/functions/
// desk-brief/record.ts). Prints, as Markdown, only the provider's usage (prompt,
// completion and reasoning tokens, cost), latency and the brief text. It never prints
// the key or any environment value, and stops before a call that could pass the cap.
//
//   deno run --allow-net=openrouter.ai --allow-read --allow-env=OPENROUTER_API_KEY \
//     --env-file=<main checkout>/.env.local scripts/measure-record-briefs.ts > out.md

import {
  buildRecordPrompt,
  normaliseRecordBrief,
  normaliseTier,
  parseBrief,
  recordRequestBody,
} from '../supabase/functions/desk-brief/record.ts';

const MODELS = ['google/gemini-2.5-flash-lite', 'anthropic/claude-haiku-5.5'];
const SPEND_CAP_USD = 0.09;
const PANELLED_RECORDS = 21_094;

// [desk tier as the browser sends it, module, pack file, row index]
const PICKS: [string, string, string, number][] = [
  ['geopolitics', 'Open Fronts', 'geopolitics_war_tracker', 0],
  ['geopolitics', 'Open Fronts', 'geopolitics_war_tracker', 5],
  ['geopolitics', 'Open Fronts', 'geopolitics_war_tracker', 40],
  ['geopolitics', 'Global Intelligence', 'geopolitics_defense_procurement', 0],
  ['geopolitics', 'Global Intelligence', 'geopolitics_defense_procurement', 4],
  ['geopolitics', 'Infra', 'geopolitics_infra_projects', 0],
  ['geopolitics', 'Infra', 'geopolitics_infra_projects', 3],
  ['national', 'Bill Passage Probability Index', 'national_bill_tracker', 0],
  ['national', 'Bill Passage Probability Index', 'national_bill_tracker', 2500],
  ['national', 'Policy Pipeline Tracker (Draft-to-Gazette)', 'national_policy_pipeline', 0],
  ['national', 'Parliamentary Question Database', 'national_question_database', 0],
  ['national', 'Parliamentary Question Database', 'national_question_database', 4000],
  ['national', 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)', 'national_regulatory_watch', 10],
  ['national', 'Cabinet Decisions', 'national_cabinet_decisions', 0],
  ['national', 'MP Profiles & Performance (MPLAD, attendance, debates)', 'national_mp_report_card', 0],
  ['judiciary', 'Supreme Court Order & Judgment Feed', 'judiciary_sc_orders', 0],
  ['judiciary', 'Supreme Court Order & Judgment Feed', 'judiciary_sc_orders', 100],
  ['judiciary', 'NCLT / NCLAT (Insolvency)', 'judiciary_nclt_orders', 0],
  ['judiciary', 'NCLT / NCLAT (Insolvency)', 'judiciary_nclt_orders', 60],
  ['judiciary', 'WTO Dispute Settlement', 'judiciary_wto_disputes', 600],
];

interface Result {
  model: string;
  served: string;
  ok: boolean;
  prompt: number | null;
  completion: number | null;
  reasoning: number | null;
  cost: number | null;
  ms: number;
  headline: string;
  points: string[];
  note: string;
}

const root = new URL('..', import.meta.url);
async function rowFor(file: string, index: number): Promise<Record<string, unknown>> {
  const data = JSON.parse(await Deno.readTextFile(new URL(`public/data/embedded_csv/${file}.json`, root)));
  const rows = Array.isArray(data) ? data : data.rows;
  return rows[index];
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const key = Deno.env.get('OPENROUTER_API_KEY')?.trim();
if (!key) {
  console.error('OPENROUTER_API_KEY is not set (pass --env-file).');
  Deno.exit(1);
}

let spent = 0;
const records = await Promise.all(PICKS.map(async ([tier, feature, file, i]) => ({
  tier: normaliseTier(tier)!,
  feature,
  file,
  index: i,
  row: await rowFor(file, i),
})));

const results: Result[][] = [];
for (const model of MODELS) {
  const out: Result[] = [];
  for (const r of records) {
    if (spent >= SPEND_CAP_USD) throw new Error(`stopped: spend ${spent.toFixed(6)} reached the cap`);
    const { prompt } = buildRecordPrompt({ tier: r.tier, feature: r.feature, row: r.row });
    const started = performance.now();
    let payload: Record<string, unknown> | null = null;
    let status = 0;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://niyantran.local',
          'X-Title': 'Niyantran Terminal Record Brief Measurement',
        },
        body: JSON.stringify(recordRequestBody(model, prompt)),
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      payload = await res.json().catch(() => null);
    } catch (err) {
      payload = null;
      status = -1;
      console.error(`request failed: ${(err as Error).name}`);
    }
    const ms = Math.round(performance.now() - started);
    const usage = (payload?.usage ?? {}) as Record<string, unknown>;
    const details = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
    const choice = Array.isArray(payload?.choices) ? payload!.choices[0] as Record<string, unknown> : null;
    const text = (choice?.message as Record<string, unknown> | undefined)?.content;
    const brief = normaliseRecordBrief(typeof text === 'string' ? parseBrief(text) : null);
    const cost = n(usage.cost);
    spent += cost ?? 0;
    const err = payload?.error as Record<string, unknown> | undefined;
    out.push({
      model,
      served: typeof payload?.model === 'string' ? payload.model as string : '',
      ok: status === 200 && Boolean(brief),
      prompt: n(usage.prompt_tokens),
      completion: n(usage.completion_tokens),
      reasoning: n(details.reasoning_tokens),
      cost,
      ms,
      headline: brief?.headline ?? '',
      points: brief?.points ?? [],
      // A provider error's own message can name the model or parameter; it never carries the key.
      note: status === 200
        ? (brief ? '' : 'malformed JSON')
        : `HTTP ${status}${err?.message ? `: ${String(err.message).slice(0, 160)}` : ''}`,
    });
  }
  results.push(out);
}

// ---- report ---------------------------------------------------------------------------------

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const lines: string[] = [];
lines.push(
  `Run at ${new Date().toISOString()}; ${records.length} records x ${MODELS.length} models; total spend $${
    spent.toFixed(6)
  }.`,
  '',
);

for (const out of results) {
  const model = out[0].model;
  lines.push(`### ${model}`, '');
  lines.push('| # | Desk / module | Prompt | Completion | Reasoning | Cost (USD) | Latency (ms) | OK |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---|');
  out.forEach((r, i) => {
    const rec = records[i];
    lines.push(
      `| ${i + 1} | ${rec.tier} / ${cell(rec.feature)} | ${r.prompt ?? '—'} | ${r.completion ?? '—'} | ${
        r.reasoning ?? '—'
      } | ${r.cost?.toFixed(7) ?? '—'} | ${r.ms} | ${r.ok ? 'yes' : `no (${cell(r.note)})`} |`,
    );
  });
  const ok = out.filter((r) => r.ok);
  const cost = sum(out.map((r) => r.cost));
  const lat = out.map((r) => r.ms).sort((a, b) => a - b);
  const mean = cost / out.length;
  lines.push(
    `| | **Total** | ${sum(out.map((r) => r.prompt))} | ${sum(out.map((r) => r.completion))} | ${
      sum(out.map((r) => r.reasoning))
    } | ${cost.toFixed(7)} | median ${lat[Math.floor(lat.length / 2)]}, max ${
      lat[lat.length - 1]
    } | ${ok.length}/${out.length} |`,
    '',
    `Served as: ${[...new Set(out.map((r) => r.served).filter(Boolean))].join(', ') || '—'}. Mean cost per brief $${
      mean.toFixed(7)
    }; ` +
      `projected $${(mean * 1000).toFixed(4)} per 1,000 briefs and $${(mean * PANELLED_RECORDS).toFixed(2)} for ${
        PANELLED_RECORDS.toLocaleString('en-IN')
      } panelled records (one brief each).`,
    '',
  );
}

lines.push('### The briefs, side by side', '');
records.forEach((rec, i) => {
  lines.push(`#### ${i + 1}. ${rec.tier} / ${rec.feature} (${rec.file} row ${rec.index})`, '');
  const fields = buildRecordPrompt({ tier: rec.tier, feature: rec.feature, row: rec.row }).prompt.split('\n').slice(3);
  lines.push(
    '<details><summary>Fields given to the model</summary>',
    '',
    '```',
    ...fields,
    '```',
    '',
    '</details>',
    '',
  );
  for (const out of results) {
    const r = out[i];
    lines.push(`**${r.model}**${r.ok ? '' : ` (failed: ${cell(r.note)})`}`, '');
    if (r.ok) {
      lines.push(`> **${cell(r.headline)}**`, '>');
      for (const p of r.points) lines.push(`> - ${cell(p)}`);
      lines.push('');
    }
  }
});

console.log(lines.join('\n'));
