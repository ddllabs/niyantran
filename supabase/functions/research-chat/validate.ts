// Request validation for research-chat (streaming spec §A). Everything the
// browser sends is untrusted: the selection and the attachments are rendered
// into the prompt, and the document keys are resolved against the corpus, so
// they are shape-checked and bounded here before any of that happens.

export const FOCUS_VALUES = ['attached', 'selection', 'desk', 'broad'] as const;
export const REASONING_VALUES = ['off', 'low', 'medium', 'high'] as const;
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

export interface Attachment {
  kind: 'row' | 'record' | 'file';
  title: string;
  text: string;
  tier?: string;
  feature?: string;
  row_key?: string;
  document_key?: string;
}

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
      for (const raw of b.attachments.slice(0, LIMITS.attachments)) {
        if (!raw || typeof raw !== 'object') continue;
        const a = raw as Record<string, unknown>;
        const kind = a.kind === 'row' || a.kind === 'record' || a.kind === 'file' ? a.kind : null;
        const title = str(a.title, LIMITS.title);
        const text = str(a.text, LIMITS.attachmentText);
        if (!kind || !title || !text) continue;
        const item: Attachment = { kind, title, text };
        const tier = str(a.tier, LIMITS.key);
        const feature = str(a.feature, LIMITS.title);
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
    },
  };
}

/** The document keys a turn may scope its first search to: the selection and the row attachments. */
export function documentKeysOf(r: ResearchRequest): string[] {
  const keys = new Set<string>();
  if (r.selection?.document_key) keys.add(r.selection.document_key);
  for (const a of r.attachments) if (a.document_key) keys.add(a.document_key);
  return [...keys];
}
