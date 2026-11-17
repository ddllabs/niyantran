import { ApiError, sessionNotFound, sqlError } from './apiError.ts';
import { log } from '../_shared/logging.ts';
import { attribution, clip, clipEnd, isPlaceholderClaimant, mapStatus, normaliseClaim } from './claimText.ts';
import { type Ledger, ledgerFromInput, mergeLedger } from './ledger.ts';
import { chatJson } from './modelCall.ts';
import { EXTRACTION_MODEL } from './models.ts';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, extractUser } from './prompts.ts';
import { mergeLines, normaliseWords } from './pieceText.ts';
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

const MAX_RANGE_PIECES = 12;

/** `piece_from` and `piece_to` together (integers, at most 12 pieces), or neither. */
function pieceRange(turn: Obj): { from: number; to: number } | null {
  const { piece_from: from, piece_to: to } = turn;
  if (from === undefined && to === undefined) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw badRequest('piece_from and piece_to must both be integers.');
  }
  const a = from as number;
  const b = to as number;
  if (a < 0 || b < a || b - a >= MAX_RANGE_PIECES || b > 999_999_999) throw badRequest('piece range is not valid.');
  return { from: a, to: b };
}

interface StoredPiece {
  text: string;
  start: number | null;
  end: number | null;
  no: number | null;
}

function storedPieces(data: unknown): StoredPiece[] | null {
  const list = isObject(data) && data.ok === true && Array.isArray(data.pieces) ? data.pieces : null;
  if (!list) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return list.slice(0, MAX_RANGE_PIECES).flatMap((p) =>
    isObject(p) && typeof p.text === 'string'
      ? [{ text: p.text, start: num(p.pos_start_s), end: num(p.pos_end_s), no: num(p.piece_no) }]
      : []
  );
}

/** Whether each piece overlaps the one before it in time, as the browser decides: the next number, starting early. */
function withOverlaps(pieces: StoredPiece[]): { text: string; overlaps: boolean }[] {
  return pieces.map((p, i) => {
    const prev = pieces[i - 1];
    return {
      text: p.text,
      overlaps: !!prev && p.no !== null && prev.no !== null && p.no === prev.no + 1 && p.start !== null &&
        prev.end !== null && p.start < prev.end,
    };
  });
}

/**
 * What the model sees of a range turn, all from server-held pieces: the turn text (the range's pieces, the
 * first de-duplicated against the stored piece just before it, as the browser shows it), the position of
 * the range's first piece, and up to 12 pieces before the range as context. Nothing here comes from the browser.
 */
async function rangeText(
  ctx: Ctx,
  sessionId: string,
  r: { from: number; to: number },
): Promise<{ text: string; position: number | null; context: string }> {
  const { data, error } = await ctx.deps.rpc('factcheck_turn_pieces', {
    p_user: ctx.userId,
    p_session: sessionId,
    p_from: r.from,
    p_to: r.to,
  });
  if (error) throw sqlError(error);
  if (isObject(data) && data.ok === false) {
    if (data.reason === 'not_found') throw sessionNotFound();
    if (data.reason === 'bad_range') throw badRequest('piece range is not valid.');
  }
  const inRange = storedPieces(data);
  if (!inRange) throw new Error('unexpected factcheck_turn_pieces answer');

  // Context: the pieces just before the range (clamped at piece 1). A refusal or an empty answer is no context.
  let before: StoredPiece[] = [];
  if (r.from > 1) {
    try {
      const ctxAnswer = await ctx.deps.rpc('factcheck_turn_pieces', {
        p_user: ctx.userId,
        p_session: sessionId,
        p_from: Math.max(1, r.from - MAX_RANGE_PIECES),
        p_to: r.from - 1,
      });
      if (!ctxAnswer.error) before = storedPieces(ctxAnswer.data) ?? [];
    } catch { /* no context */ }
  }
  const lines = mergeLines(withOverlaps([...before, ...inRange]));
  return {
    text: lines.filter((l) => l.index >= before.length).map((l) => l.text).join(' '),
    position: inRange[0]?.start ?? null,
    context: lines.filter((l) => l.index < before.length).map((l) => l.text).join(' '),
  };
}

type Plan = { held: ClaimRow; claim: ModelClaim; status: ClaimStatus } | { insert: ClaimInsert } | {
  existing: ClaimRow;
};

export async function extractAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const sessionId = uuid(body.session_id, 'session_id');
  if (!isObject(body.turn)) throw badRequest('turn must be an object.');
  // A range of stored pieces (a shareable session) replaces the text; any text sent with it is ignored.
  const range = pieceRange(body.turn);
  if (!range && (typeof body.turn.text !== 'string' || !body.turn.text.trim())) {
    throw badRequest('turn.text must be text.');
  }
  // A turn over the limit keeps its END: the claim being made when the turn closed is the newest speech.
  let turnText = range ? '' : clipEnd(body.turn.text as string, TURN_CHARS);
  const spokenAt = isoTime(body.turn.spoken_at, 'turn.spoken_at');
  let positionS = position(body.turn.position_s, 'turn.position_s');
  // A range turn is built from server-held pieces only: the browser's recent, ledger and seed are ignored
  // (not even validated), because they steer who a claim is attributed to and a shared claim must not be
  // typed by its author. Text turns use them as before.
  let recent: string[] = [];
  let ledger: Ledger = { entries: [] };
  let channel = '';
  let title = '';
  if (!range) {
    if (!Array.isArray(body.recent) || body.recent.some((t) => typeof t !== 'string')) {
      throw badRequest('recent must be a list of texts.');
    }
    // At most 3 turns and 3,000 characters in all, keeping the most recent text.
    let room = RECENT_CHARS;
    for (const t of (body.recent as string[]).slice(-RECENT_ITEMS).reverse()) {
      if (room <= 0) break;
      const kept = clipEnd(t, room);
      if (kept) recent.unshift(kept);
      room -= Array.from(kept).length;
    }
    const parsed = ledgerFromInput(body.ledger);
    if (!parsed) throw badRequest('ledger is not valid or is over 4 kB.');
    ledger = parsed;
    const seed = body.seed === undefined || body.seed === null ? {} : body.seed;
    if (!isObject(seed)) throw badRequest('seed must be an object.');
    channel = typeof seed.channel === 'string' ? clip(seed.channel, SEED_CHARS) : '';
    title = typeof seed.title === 'string' ? clip(seed.title, SEED_CHARS) : '';
  }
  if (!ctx.deps.apiKey) throw new ApiError(503, 'Fact-check is not configured yet.', { reason: 'unavailable' });

  await touch(ctx, sessionId, 'extract');
  const store = ctx.deps.store;
  const session = await store.session(ctx.userId, sessionId);
  if (!session) throw sessionNotFound();
  if (range) {
    const built = await rangeText(ctx, sessionId, range);
    positionS = built.position;
    turnText = clipEnd(built.text, TURN_CHARS);
    if (!turnText) return { claims: [], ledger };
    recent = built.context ? [clipEnd(built.context, RECENT_CHARS)] : [];
    channel = session.channel_id; // from the session row; no title
  }
  const saved = await store.claims(ctx.userId, sessionId, SAVED_LIMIT);
  // A shared claim is only ever touched from server-held pieces, and a private one only from text.
  const held = saved.filter((r) => r.status === 'needs_context' && (r.shared === true) === !!range).slice(
    0,
    HELD_LIMIT,
  );
  const turnWords = range ? normaliseWords(turnText) : '';

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
    // On a range turn a claim must quote the stored speech, so the model cannot attribute words that were not said.
    if (range) {
      const q = normaliseWords(claim.quote);
      if (!q || !` ${turnWords} `.includes(` ${q} `)) continue;
    }
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
        // Only claims extracted from server-held pieces are shared; browser text never is.
        ...(range ? { shared: true } : {}),
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
      }, !!range);
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
