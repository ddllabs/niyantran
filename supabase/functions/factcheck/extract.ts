import { ApiError, sessionNotFound } from './apiError.ts';
import { log } from '../_shared/logging.ts';
import { attribution, clip, clipEnd, isPlaceholderClaimant, mapStatus, normaliseClaim } from './claimText.ts';
import { ledgerFromInput, mergeLedger } from './ledger.ts';
import { chatJson } from './modelCall.ts';
import { EXTRACTION_MODEL } from './models.ts';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, extractUser } from './prompts.ts';
import { touch } from './touch.ts';
import type { ClaimInsert, ClaimKind, ClaimRow, ClaimStatus, Ctx } from './types.ts';
import { badRequest, isObject, isoTime, type Obj, position, UUID, uuid } from './validate.ts';

/**
 * Most claims saved from one turn. A turn is about 20 s (up to a few merged ones); the densest bulletin
 * measured gave 6.7 checkable claims a minute (spec G2b), so 12 is several times the real rate. Each
 * claim becomes one paid check, so this also bounds what one request (or one injected transcript) can
 * make the user pay for.
 */
export const MAX_CLAIMS_PER_TURN = 8;
const SAVED_LIMIT = 300;
const HELD_LIMIT = 10;
const MAX_TOKENS = 2000;
// Input sizes are clipped, not rejected: a long turn costs money and adds nothing the end of it lacks.
const TURN_CHARS = 1500;
const RECENT_ITEMS = 3;
const RECENT_CHARS = 3000;
const SEED_CHARS = 200;
const KINDS = new Set<string>(['claim', 'opinion', 'prediction', 'question']);

interface ModelClaim {
  quote: string;
  claim_en: string;
  claimant: string | null;
  reported_by: string | null;
  kind: ClaimKind;
  checkable: boolean;
  needs_context: boolean;
  resolves_id: string | null;
}

const optionalName = (v: unknown): string | null => (typeof v === 'string' ? clip(v, 200) || null : null);

/** One claim from the model, cleaned and capped; null when it is unusable. The model's other fields are dropped. */
function parseModelClaim(raw: unknown): ModelClaim | null {
  if (!isObject(raw)) return null;
  if (typeof raw.quote !== 'string' || typeof raw.claim_en !== 'string') return null;
  if (typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return null;
  if (typeof raw.checkable !== 'boolean' || typeof raw.needs_context !== 'boolean') return null;
  let claimant = optionalName(raw.claimant);
  const reported_by = optionalName(raw.reported_by);
  const quote = clip(raw.quote, 300);
  // The prompt is the main control; this catches "A said that X" the model wrote anyway. When the strip
  // removes a named subject and the model gave no real claimant, that subject is the claimant.
  const stripped = attribution(clip(raw.claim_en, 1000), claimant, reported_by);
  if (stripped.subject && isPlaceholderClaimant(claimant)) claimant = clip(stripped.subject, 200) || claimant;
  const claim_en = clip(stripped.text, 500);
  if (!quote || !normaliseClaim(claim_en)) return null;
  return {
    quote,
    claim_en,
    claimant,
    reported_by,
    kind: raw.kind as ClaimKind,
    checkable: raw.checkable,
    needs_context: raw.needs_context,
    resolves_id: typeof raw.resolves_id === 'string' && UUID.test(raw.resolves_id)
      ? raw.resolves_id.toLowerCase()
      : null,
  };
}

type Plan = { held: ClaimRow; claim: ModelClaim; status: ClaimStatus } | { insert: ClaimInsert } | {
  existing: ClaimRow;
};

export async function extractAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const sessionId = uuid(body.session_id, 'session_id');
  if (!isObject(body.turn)) throw badRequest('turn must be an object.');
  if (typeof body.turn.text !== 'string' || !body.turn.text.trim()) throw badRequest('turn.text must be text.');
  // A turn over the limit keeps its END: the claim being made when the turn closed is the newest speech.
  const turnText = clipEnd(body.turn.text, TURN_CHARS);
  const spokenAt = isoTime(body.turn.spoken_at, 'turn.spoken_at');
  const positionS = position(body.turn.position_s, 'turn.position_s');
  if (!Array.isArray(body.recent) || body.recent.some((t) => typeof t !== 'string')) {
    throw badRequest('recent must be a list of texts.');
  }
  // At most 3 turns and 3,000 characters in all, keeping the most recent text.
  const recent: string[] = [];
  let room = RECENT_CHARS;
  for (const t of (body.recent as string[]).slice(-RECENT_ITEMS).reverse()) {
    if (room <= 0) break;
    const kept = clipEnd(t, room);
    if (kept) recent.unshift(kept);
    room -= Array.from(kept).length;
  }
  const ledger = ledgerFromInput(body.ledger);
  if (!ledger) throw badRequest('ledger is not valid or is over 4 kB.');
  const seed = body.seed === undefined || body.seed === null ? {} : body.seed;
  if (!isObject(seed)) throw badRequest('seed must be an object.');
  const channel = typeof seed.channel === 'string' ? clip(seed.channel, SEED_CHARS) : '';
  const title = typeof seed.title === 'string' ? clip(seed.title, SEED_CHARS) : '';
  if (!ctx.deps.apiKey) throw new ApiError(503, 'Fact-check is not configured yet.', { reason: 'unavailable' });

  await touch(ctx, sessionId, 'extract');
  const store = ctx.deps.store;
  const session = await store.session(ctx.userId, sessionId);
  if (!session) throw sessionNotFound();
  const saved = await store.claims(ctx.userId, sessionId, SAVED_LIMIT);
  const held = saved.filter((r) => r.status === 'needs_context').slice(0, HELD_LIMIT);

  const { content } = await chatJson(ctx, {
    purpose: 'claim_extraction',
    model: EXTRACTION_MODEL,
    sessionId,
    system: EXTRACT_SYSTEM,
    user: extractUser({
      channel,
      title,
      ledger: ledger.entries,
      held: held.map((h) => ({ id: h.id, claim_en: h.claim_en })),
      recent,
      text: turnText,
    }),
    schema: { name: 'extraction', schema: EXTRACT_SCHEMA },
    maxTokens: MAX_TOKENS,
    // gemini-3.8-flash serves with both (live probe 2026-11-16).
    provider: { data_collection: 'deny', require_parameters: true },
    // The G2b setting for this model: 0 reasoning tokens, 3.2 s median and about a third less cost than the
    // default (the 2026-11-16 probe without it spent 457 of 951 tokens on reasoning and took 7.1 s).
    reasoning: { effort: 'low' },
  });
  // Unusable output saves nothing and is not an error the browser should retry: no claims this turn, the
  // ledger as it was sent. (A provider failure or timeout was thrown above as a 502.)
  if (!isObject(content) || !Array.isArray(content.claims)) return { claims: [], ledger };
  const updates = Array.isArray(content.ledger_updates) ? content.ledger_updates : [];

  // Every saved claim of the session, whatever its status, counts for de-duplication.
  // A duplicate of a claim saved from THIS SAME turn (same spoken_at) is a retry whose first response was
  // lost, so the saved claim is returned again instead of being dropped; a duplicate from any other turn is
  // dropped. If the model words a retried claim differently it is saved as a new row (a near-duplicate).
  const seen = new Map<string, ClaimRow | null>(saved.map((r) => [normaliseClaim(r.claim_en), r]));
  const returned = new Set<string>();
  const heldById = new Map(held.map((r) => [r.id, r]));
  const used = new Set<string>();
  const plan: Plan[] = [];
  for (const raw of content.claims.slice(0, MAX_CLAIMS_PER_TURN)) {
    const claim = parseModelClaim(raw);
    if (!claim) continue;
    const status = mapStatus(claim);
    const key = normaliseClaim(claim.claim_en);
    const target = claim.resolves_id ? heldById.get(claim.resolves_id) : undefined;
    if (target && !used.has(target.id)) {
      if (status === 'needs_context') continue; // still unresolved: it stays held
      if (key !== normaliseClaim(target.claim_en) && seen.has(key)) continue;
      used.add(target.id);
      seen.set(key, target);
      plan.push({ held: target, claim, status });
      continue;
    }
    const dup = seen.get(key);
    if (dup !== undefined) {
      if (dup && Date.parse(dup.spoken_at) === Date.parse(spokenAt) && !returned.has(dup.id)) {
        returned.add(dup.id);
        plan.push({ existing: dup });
      }
      continue;
    }
    seen.set(key, null);
    plan.push({
      insert: {
        // Copied from the session row, never from the request.
        session_id: session.id,
        user_id: session.user_id,
        video_id: session.video_id,
        video_kind: session.video_kind,
        position_s: positionS,
        spoken_at: spokenAt,
        quote: claim.quote,
        claim_en: claim.claim_en,
        claimant: claim.claimant,
        reported_by: claim.reported_by,
        kind: claim.kind,
        status,
      },
    });
  }

  const inserted = await store.insertClaims(plan.flatMap((p) => ('insert' in p ? [p.insert] : [])));
  let next = 0;
  const claims: Obj[] = [];
  for (const p of plan) {
    let row: ClaimRow | null;
    if ('insert' in p) row = inserted[next++] ?? null;
    else if ('existing' in p) row = p.existing;
    else {
      row = await store.updateHeld(ctx.userId, sessionId, p.held.id, {
        claim_en: p.claim.claim_en,
        claimant: p.claim.claimant ?? p.held.claimant,
        reported_by: p.claim.reported_by ?? p.held.reported_by,
        kind: p.claim.kind,
        status: p.status,
      });
    }
    if (!row) continue;
    claims.push({
      id: row.id,
      quote: row.quote,
      claim_en: row.claim_en,
      claimant: row.claimant,
      reported_by: row.reported_by,
      kind: row.kind,
      status: row.status,
    });
  }
  log('factcheck.extract', { session_id: sessionId, claims: claims.length, held: held.length });
  return { claims, ledger: mergeLedger(ledger, updates) };
}
