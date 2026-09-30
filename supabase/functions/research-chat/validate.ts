// Request validation for research-chat (streaming spec §A). Everything the
// browser sends is untrusted: the selection and the attachments are rendered
// into the prompt, and the document keys are resolved against the corpus, so
// they are shape-checked and bounded here before any of that happens.
import { PERSONA_MAP } from '../_shared/personaMap.ts';

export const FOCUS_VALUES = ['attached', 'selection', 'desk', 'broad'] as const;
// OpenRouter's full ladder, cheapest first. It stopped at `high`, so `max` and
// `xhigh` were rejected here even for models that accept them. `off` is this
// codebase's sentinel for "send no reasoning block"; OpenRouter's `none` rung
// is folded onto it by refresh-model-pricing, so it is not a value on the wire.
// Which of these a given model accepts is still decided per model against
// ai_models.efforts in the handler - this list only bounds the vocabulary.
export const REASONING_VALUES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
/** What an omitted `reasoning` field means. 'off' is still honoured when asked for by name. */
export const DEFAULT_REASONING = 'low' as const;

export const LIMITS = {
  message: 4_000,
  turnKey: 64,
  attachments: 12,
  attachmentText: 40_000,
  rowColumns: 64,
  columnNameChars: 200,
  cellChars: 500,
  title: 200,
  key: 200,
} as const;

export type Focus = (typeof FOCUS_VALUES)[number];
export type Reasoning = (typeof REASONING_VALUES)[number];

export interface Selection {
  tier: string;
  feature: string;
  row: Record<string, string>;
  document_key?: string;
}

/** Material the reader attached, rendered into the prompt as untrusted context. */
export interface TextAttachment {
  kind: 'row' | 'record' | 'file';
  title: string;
  text: string;
  tier?: string;
  feature?: string;
  row_key?: string;
  document_key?: string;
}

/**
 * "Ask about this document": a pointer to an indexed document, never its
 * content. It has no `text` - the corpus is searched for it, not inlined - and
 * its id scopes every document search of the turn.
 */
export interface DocumentAttachment {
  kind: 'document';
  title: string;
  document_id: string;
  tier?: string;
  feature?: string;
}

export type Attachment = TextAttachment | DocumentAttachment;

export interface ResearchRequest {
  conversation_id?: string;
  message: string;
  turn_key: string;
  model?: string;
  reasoning?: Reasoning;
  focus: Focus;
  selection?: Selection;
  attachments: Attachment[];
  desk_context?: { tier: string; feature?: string };
  /** Admin persona probe: an app_persona value. research-chat honours it only for a platform admin. */
  persona_probe?: string;
}

export type FieldErrors = Record<string, string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function slimRow(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  let n = 0;
  // Drop oversized names intact: truncation could overwrite a genuine header.
  // Walk own columns without materializing an entry pair for every input column.
  for (const k in v) {
    if (!Object.hasOwn(v, k) || k.length > LIMITS.columnNameChars) continue;
    const value = (v as Record<string, unknown>)[k];
    if (value == null || value === '' || typeof value === 'object') continue;
    out[k] = String(value).slice(0, LIMITS.cellChars);
    if (++n >= LIMITS.rowColumns) break;
  }
  return Object.keys(out).length ? out : null;
}

export function validateRequest(body: unknown): { request: ResearchRequest } | { fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

  const message = str(b.message, LIMITS.message);
  if (!message) fieldErrors.message = `message is required (1..${LIMITS.message} characters)`;

  const turnKey = str(b.turn_key, LIMITS.turnKey);
  if (typeof b.turn_key === 'string' && b.turn_key.trim().length > LIMITS.turnKey) fieldErrors.turn_key = `turn_key exceeds ${LIMITS.turnKey} characters`;
  if (!turnKey) fieldErrors.turn_key = `turn_key is required (1..${LIMITS.turnKey} characters)`;

  let conversationId: string | undefined;
  if (b.conversation_id !== undefined && b.conversation_id !== null) {
    if (typeof b.conversation_id !== 'string' || !UUID_RE.test(b.conversation_id)) fieldErrors.conversation_id = 'conversation_id must be a uuid';
    else conversationId = b.conversation_id;
  }

  const focus = typeof b.focus === 'string' && (FOCUS_VALUES as readonly string[]).includes(b.focus) ? (b.focus as Focus) : null;
  if (!focus) fieldErrors.focus = `focus must be one of ${FOCUS_VALUES.join(', ')}`;

  let reasoning: Reasoning | undefined;
  if (b.reasoning !== undefined && b.reasoning !== null) {
    if (typeof b.reasoning !== 'string' || !(REASONING_VALUES as readonly string[]).includes(b.reasoning)) {
      fieldErrors.reasoning = `reasoning must be one of ${REASONING_VALUES.join(', ')}`;
    } else reasoning = b.reasoning as Reasoning;
  }

  let model: string | undefined;
  if (b.model !== undefined && b.model !== null) {
    const m = str(b.model, LIMITS.key);
    if (!m) fieldErrors.model = 'model must be a non-empty string';
    else model = m;
  }

  let selection: Selection | undefined;
  if (b.selection !== undefined && b.selection !== null) {
    const s = b.selection as Record<string, unknown>;
    const tier = str(s.tier, LIMITS.key);
    const feature = str(s.feature, LIMITS.title);
    const row = slimRow(s.row);
    if (!tier || !feature || !row) fieldErrors.selection = 'selection needs tier, feature and a non-empty row';
    else {
      selection = { tier, feature, row };
      const key = str(s.document_key, LIMITS.key);
      if (key) selection.document_key = key;
    }
  }

  const attachments: Attachment[] = [];
  if (b.attachments !== undefined && b.attachments !== null) {
    if (!Array.isArray(b.attachments)) fieldErrors.attachments = 'attachments must be an array';
    else {
      for (const [index, raw] of b.attachments.slice(0, LIMITS.attachments).entries()) {
        if (!raw || typeof raw !== 'object') continue;
        const a = raw as Record<string, unknown>;
        const title = str(a.title, LIMITS.title);
        const tier = str(a.tier, LIMITS.key);
        const feature = str(a.feature, LIMITS.title);
        if (a.kind === 'document') {
          // A bad id is a client bug, and dropping the chip would silently turn
          // "search this document" into "search everything", so it is refused.
          if (typeof a.document_id !== 'string' || !UUID_RE.test(a.document_id)) {
            fieldErrors.attachments = `attachment ${index}: document_id must be a uuid`;
            continue;
          }
          if (!title) continue;
          const item: DocumentAttachment = { kind: 'document', title, document_id: a.document_id.toLowerCase() };
          if (tier) item.tier = tier;
          if (feature) item.feature = feature;
          attachments.push(item);
          continue;
        }
        const kind = a.kind === 'row' || a.kind === 'record' || a.kind === 'file' ? a.kind : null;
        const text = str(a.text, LIMITS.attachmentText);
        if (!kind || !title || !text) continue;
        const item: TextAttachment = { kind, title, text };
        const rowKey = str(a.row_key, LIMITS.key);
        const docKey = str(a.document_key, LIMITS.key);
        if (tier) item.tier = tier;
        if (feature) item.feature = feature;
        if (rowKey) item.row_key = rowKey;
        if (docKey) item.document_key = docKey;
        attachments.push(item);
      }
    }
  }

  let deskContext: { tier: string; feature?: string } | undefined;
  if (b.desk_context !== undefined && b.desk_context !== null) {
    const d = b.desk_context as Record<string, unknown>;
    const tier = str(d.tier, LIMITS.key);
    if (!tier) fieldErrors.desk_context = 'desk_context needs a tier';
    else {
      deskContext = { tier };
      const feature = str(d.feature, LIMITS.title);
      if (feature) deskContext.feature = feature;
    }
  }

  let personaProbe: string | undefined;
  if (b.persona_probe !== undefined && b.persona_probe !== null) {
    if (typeof b.persona_probe !== 'string' || !PERSONA_MAP.some((p) => p.db === b.persona_probe)) {
      fieldErrors.persona_probe = `persona_probe must be one of ${PERSONA_MAP.map((p) => p.db).join(', ')}`;
    } else personaProbe = b.persona_probe;
  }

  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return {
    request: {
      ...(conversationId ? { conversation_id: conversationId } : {}),
      message: message!,
      turn_key: turnKey!,
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
      focus: focus!,
      ...(selection ? { selection } : {}),
      attachments,
      ...(deskContext ? { desk_context: deskContext } : {}),
      ...(personaProbe ? { persona_probe: personaProbe } : {}),
    },
  };
}

/** The document keys a turn scopes every document search to: the selection and the row attachments. */
export function documentKeysOf(r: ResearchRequest): string[] {
  const keys = new Set<string>();
  if (r.selection?.document_key) keys.add(r.selection.document_key);
  for (const a of r.attachments) if (a.kind !== 'document' && a.document_key) keys.add(a.document_key);
  return [...keys];
}

/** The indexed documents a turn's document chips name: distinct, at most one per attachment slot. */
export function documentIdsOf(r: ResearchRequest): string[] {
  const ids = new Set<string>();
  for (const a of r.attachments) if (a.kind === 'document') ids.add(a.document_id);
  return [...ids].slice(0, LIMITS.attachments);
}
