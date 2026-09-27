// Desk entry brief Supabase Edge Function
// Reads OPENROUTER_API_KEY from Deno.env (Supabase Secrets) only.
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts';

const SYSTEM = `You are the Niyantran Terminal record analyst.
The analyst selected ONE row in a desk tab. Organise and explain THAT entry's fields only.
Do not summarise the whole desk, feed volume, or other rows.
Chart numbers are computed on the server from this row — you write narrative and may rename chart titles.

Hard rules:
- Never buy / sell / hold / accumulate / avoid language. No price targets or predicted moves.
- Never use the word "correlation". Prefer connections, linkages, pathways, what this touches.
- Evidence first: base every claim on the attached row fields. If a field is missing, say so.
- Confidence only as labelled bands: strong / moderate / weak / speculative.
- Market cap is market data — do not use it as materiality.
- Do not invent chart series. Do not talk about "25 stories" or desk-wide totals.
- Prefer summary bullets shaped as "Label: detail" (Facility:, Status:, Source:, etc.).
- Return ONLY valid JSON matching the schema. No markdown fences.`;

function buildPrompt(entry: Record<string, unknown>, feature: string, tier: string): string {
  const title = String(entry.bill_name || entry.policy_name || entry.title || entry.name || entry.conflict_name || entry.subject || 'Selected Entry');
  return `DESK FEATURE: ${feature} (${tier || 'desk'})
ENTRY TITLE: ${title}

ROW FIELDS (authoritative):
${JSON.stringify(entry, null, 2)}

Produce a structured JSON brief with:
{
  "headline": "One sentence capturing the material development and institutional significance",
  "summary": ["3-5 crisp bullets shaped as 'Label: detail'"],
  "findings": ["2-3 key analytical takeaways directly backed by the fields"],
  "kpis": [{"label": "Metric name", "value": "Metric value"}],
  "confidence": "strong" | "moderate" | "weak"
}`;
}

export async function handleDeskBrief(req: Request): Promise<Response> {
  const p = preflight(req);
  if (p) return p;

  if (req.method !== 'POST') {
    return errorResponse(new HttpError(405, 'POST only'), corsHeaders(req));
  }

  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const feature = String(body.feature || '').trim();
    const tier = String(body.tier || '').trim();
    const row = body.row && typeof body.row === 'object' ? body.row : null;

    if (!feature || !row) {
      throw new HttpError(400, 'feature and valid row required');
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')?.trim();
    if (!apiKey) {
      throw new HttpError(503, 'AI research service is temporarily unavailable.');
    }

    const model = Deno.env.get('OPENROUTER_DESK_MODEL')?.trim() || 'google/gemini-2.0-flash-001';
    const prompt = buildPrompt(row, feature, tier);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://niyantran.local',
        'X-Title': 'Niyantran Terminal Desk Brief',
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new HttpError(503, 'AI research service is temporarily unavailable.');
    }

    const completion = await res.json();
    const content = completion?.choices?.[0]?.message?.content || '{}';
    let brief = {};
    try {
      brief = JSON.parse(content);
    } catch {
      throw new HttpError(502, 'Malformed AI brief response');
    }

    return jsonResponse(
      {
        ok: true,
        ...brief,
        hash: body.hash || '',
        model: completion?.model || model,
        generatedAt: new Date().toISOString(),
      },
      200,
      corsHeaders(req),
    );
  } catch (err) {
    return errorResponse(err, corsHeaders(req));
  }
}

Deno.serve(handleDeskBrief);
