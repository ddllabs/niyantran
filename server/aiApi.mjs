/**
 * Same-origin AI proxy.
 *   POST /api/ai/chat   { roleId, model, provider, messages, files }
 *   POST /api/ai/desk-brief  { feature, tier, row, hash, force }  — organise one selected entry
 *   GET  /api/ai/desk-brief?feature=&tier=&hash=  cached entry brief only
 *   GET  /api/ai/fetch?url=  text or base64 for pdf/image (CORS bypass)
 *   GET  /api/ai/source-extract?url=  fetch + extract readable text (PDF/HTML/CSV/XLSX)
 * Chat is forwarded to the research-chat Edge Function, which holds the only
 * provider key (ADR 0008); nothing here calls a model provider directly.
 * Request-body `key` is ignored — never accept client-supplied credentials (D6).
 */
import { createClient } from '@supabase/supabase-js';
import { assertAiAllowedInTesting } from './appFlags.mjs';
import { loadEnv } from './loadEnv.mjs';
import { entryFingerprint, getCachedDeskBrief, runDeskBrief } from './deskBrief.mjs';
import { briefFromExtract, extractBuffer, extractSource } from './sourceExtract.mjs';
import { isExtractableSourceUrl, isHubListingUrl } from '../src/lib/sourceUrls.js';
import { dbPersona } from '../src/lib/personaMap.js';

loadEnv();
const CHAT_MS = 90_000;
const MAX_TEXT = 180_000;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function loadFile(file) {
  if (file?.text && !file?.base64) return { ...file, text: String(file.text).slice(0, MAX_TEXT) };
  if (file?.base64 && !file?.url) {
    try {
      const buf = Buffer.from(String(file.base64), 'base64');
      const got = await extractBuffer(buf, {
        kind: file.kind || '',
        mime: file.mime || '',
        name: file.name || '',
      });
      return {
        ...file,
        kind: got.kind || file.kind,
        mime: got.mime || file.mime,
        text: got.text ? String(got.text).slice(0, MAX_TEXT) : file.text,
        base64: got.base64 || file.base64,
        error: got.error || undefined,
      };
    } catch (err) {
      return { ...file, error: err.message || String(err) };
    }
  }
  const url = file?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    if (file?.text) return { ...file, text: String(file.text).slice(0, MAX_TEXT) };
    return file;
  }
  if (isHubListingUrl(url) || !isExtractableSourceUrl(url)) {
    return {
      ...file,
      url,
      error: 'Registry hub / non-document URL — not fetched. Use terminal row columns as the record.',
    };
  }
  try {
    const got = await extractSource(url);
    return {
      ...file,
      url: got.url || url,
      kind: file.kind || got.kind,
      mime: got.mime || file.mime,
      text: got.text ? String(got.text).slice(0, MAX_TEXT) : file.text,
      base64: got.base64 || file.base64,
      error: got.error || undefined,
    };
  } catch (err) {
    return { ...file, url, error: err.message || String(err) };
  }
}

export async function runAiFetch(target) {
  if (!/^https?:\/\//i.test(target)) throw new Error('HTTPS url required');
  const file = await loadFile({ url: target });
  return {
    file: {
      url: file.url,
      kind: file.kind,
      mime: file.mime,
      hasBinary: Boolean(file.base64),
      text: file.text,
      bytes: file.text?.length || file.base64?.length || 0,
    },
  };
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';

// Roles research-chat knows, and the legacy picker aliases that stand for them.
const RESEARCH_ROLE_IDS = new Set(['DEFAULT_ANALYST', 'EXPERT_ESCALATION', 'PDF_PARSER', 'VISUAL_RESEARCH']);
const LEGACY_MODEL_ROLES = {
  'gemini-lite': 'DEFAULT_ANALYST',
  'gemini-flash': 'VISUAL_RESEARCH',
  'gpt-astra': 'EXPERT_ESCALATION',
};
const REGISTRY_MS = 5_000;

// Request-scoped client bound to the caller's bearer, so the registry read runs
// under RLS as that user (ai_models and ai_roles are readable by authenticated).
// Same project and publishable key as the research-chat forward below.
function registryClientForToken(token) {
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
  return createClient(SUPABASE_URL, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Map a requested model to a live, enabled model ID, or undefined so that
 * research-chat uses its own default. An enabled ID passes through; a role ID
 * or legacy alias becomes that role's model when it is enabled. A failed
 * registry read also yields undefined: it never fails the request.
 */
async function resolveResearchModel(requested, token) {
  const id = String(requested || '').trim();
  if (!id || !token) return undefined;
  // Bounded and without retries: a slow or failing registry must not delay the turn.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_MS);
  try {
    const client = registryClientForToken(token);
    const [models, roles] = await Promise.all([
      client.from('ai_models').select('model_id').eq('enabled', true).retry(false).abortSignal(controller.signal),
      client.from('ai_roles').select('role_id,model_id').retry(false).abortSignal(controller.signal),
    ]);
    if (models.error || roles.error) return undefined;
    const enabled = new Set((models.data || []).map((m) => m.model_id));
    if (enabled.has(id)) return id;
    const roleId = LEGACY_MODEL_ROLES[id] || (RESEARCH_ROLE_IDS.has(id) ? id : null);
    const roleModel = roleId ? (roles.data || []).find((r) => r.role_id === roleId)?.model_id : null;
    return roleModel && enabled.has(roleModel) ? roleModel : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function proxyResearchChat(payload, authHeader) {
  const userMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUser = userMessages.filter((m) => m && m.role === 'user').pop();
  const prompt = lastUser?.content || payload.message || '';
  if (!prompt.trim()) {
    throw new Error('Message missing.');
  }

  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  const model = await resolveResearchModel(payload.model, token);

  const rawAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const attachments = rawAttachments
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const kind = a.kind === 'row' || a.kind === 'record' || a.kind === 'file' ? a.kind : 'file';
      const title = String(a.title || a.name || 'Attachment').trim().slice(0, 200);
      const text = String(a.text || a.content || a.preview?.record_text || (a.preview ? JSON.stringify(a.preview) : '') || '').trim().slice(0, 40000);
      if (!title || !text) return null;
      const item = { kind, title, text };
      if (a.tier) item.tier = String(a.tier).slice(0, 200);
      if (a.feature) item.feature = String(a.feature).slice(0, 200);
      if (a.row_key || a.rowKey) item.row_key = String(a.row_key || a.rowKey).slice(0, 200);
      if (a.document_key || a.documentKey) item.document_key = String(a.document_key || a.documentKey).slice(0, 200);
      return item;
    })
    .filter(Boolean)
    .slice(0, 12);

  const rawDesk = payload.deskContext || payload.desk_context;
  const desk_context = rawDesk && (rawDesk.tier || rawDesk.tab)
    ? {
        tier: String(rawDesk.tier || rawDesk.tab).trim().slice(0, 200),
        ...(rawDesk.feature ? { feature: String(rawDesk.feature).trim().slice(0, 200) } : {}),
      }
    : undefined;

  let selection = undefined;
  if (payload.selection && typeof payload.selection === 'object' && !Array.isArray(payload.selection)) {
    const s = payload.selection;
    if (s.tier && s.feature && s.row && typeof s.row === 'object') {
      selection = {
        tier: String(s.tier).trim().slice(0, 200),
        feature: String(s.feature).trim().slice(0, 200),
        row: s.row,
        ...(s.document_key ? { document_key: String(s.document_key).trim().slice(0, 200) } : {}),
      };
    }
  }

  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/research-chat`;
  const body = {
    message: prompt.slice(0, 4000),
    turn_key: String(payload.turn_key || payload.turnKey || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`).slice(0, 64),
    focus: ['attached', 'selection', 'desk', 'broad'].includes(String(payload.focus))
      ? String(payload.focus)
      : 'attached',
    attachments,
    ...(model ? { model } : {}),
    ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
    ...(selection ? { selection } : {}),
    ...(desk_context ? { desk_context } : {}),
    ...(payload.conversationId ? { conversation_id: payload.conversationId } : {}),
    // Admin persona probe: research-chat honours it only for a platform admin.
    // Draft prompt text is never forwarded; the shipped prompt is tested.
    ...(payload.probe === true && dbPersona(payload.userType) ? { persona_probe: dbPersona(payload.userType) } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_MS);
  try {
    const anonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'apikey': anonKey,
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error || errBody?.message || `research-chat HTTP ${res.status}`;
      throw new Error(msg);
    }

    let text = '';
    let servedModel = model || 'openrouter';
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const raw = trimmed.slice(5).trim();
          if (raw === '[DONE]') break;
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.chunk === 'string') text += parsed.chunk;
            if (parsed.model?.served) servedModel = parsed.model.served;
          } catch {}
        }
      }
    }

    if (!text.trim()) {
      throw new Error('Empty response from AI research service');
    }

    return { text: text.trim(), model: servedModel, provider: 'openrouter' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiChat(payload = {}, authHeader = null) {
  loadEnv();
  const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) {
    throw new Error('AI research service requires authentication.');
  }

  const model = String(payload.model || '').trim();
  const rawProvider = String(payload.provider || '').toLowerCase();
  if (rawProvider === 'deepseek') {
    throw new Error('DeepSeek is no longer available. All AI requests are routed through OpenRouter.');
  }
  await assertAiAllowedInTesting({ provider: rawProvider || (model.includes('gemini') ? 'gemini' : 'openrouter'), model });

  return await proxyResearchChat(payload, authHeader);
}

export async function handleAiApi(req, res, next) {
  loadEnv();
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/ai')) {
    next();
    return;
  }

  if (url.pathname === '/api/ai/fetch') {
    if (req.method !== 'GET') return json(res, { ok: false, error: 'GET only' }, 405);
    try {
      const out = await runAiFetch(url.searchParams.get('url') || '');
      return json(res, { ok: true, ...out });
    } catch (err) {
      const msg = err.message || String(err);
      return json(res, { ok: false, error: msg }, /required/i.test(msg) ? 400 : 502);
    }
  }

  if (url.pathname === '/api/ai/source-extract') {
    if (req.method !== 'GET') return json(res, { ok: false, error: 'GET only' }, 405);
    try {
      const target = url.searchParams.get('url') || '';
      if (isHubListingUrl(target) || !isExtractableSourceUrl(target)) {
        return json(
          res,
          {
            ok: false,
            error: 'URL is a registry hub or non-document link — not extractable as source body',
            url: target,
          },
          400,
        );
      }
      const got = await extractSource(target);
      const title = url.searchParams.get('title') || '';
      const brief = briefFromExtract(got.text || '', { title, max: 1100 });
      return json(res, {
        ok: true,
        url: got.url,
        kind: got.kind,
        mime: got.mime,
        bytes: got.bytes,
        error: got.error || null,
        text: got.text || '',
        brief,
        hasBinary: Boolean(got.base64),
      });
    } catch (err) {
      const msg = err.message || String(err);
      return json(res, { ok: false, error: msg }, /required/i.test(msg) ? 400 : 502);
    }
  }

  if (url.pathname === '/api/ai/desk-brief') {
    if (req.method === 'GET') {
      const feature = url.searchParams.get('feature') || '';
      const tier = url.searchParams.get('tier') || '';
      const hash = url.searchParams.get('hash') || '';
      const scope = url.searchParams.get('scope') || 'entry';
      const hit = await getCachedDeskBrief(feature, tier, hash, scope);
      if (!hit) return json(res, { ok: false, cached: false, error: 'No cached brief for this fingerprint.' }, 404);
      return json(res, { ok: true, ...hit });
    }
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST or GET only' }, 405);

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 6 * 1024 * 1024) req.destroy();
    });
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return json(res, { ok: false, error: 'Invalid JSON' }, 400);
    }
    try {
      const row =
        payload.row && typeof payload.row === 'object'
          ? payload.row
          : Array.isArray(payload.rows)
            ? payload.rows[0]
            : null;
      const feature = String(payload.feature || '').trim();
      const tier = String(payload.tier || '').trim();
      if (!row) return json(res, { ok: false, error: 'Select a row to organise' }, 400);
      const hash = String(payload.hash || entryFingerprint(row, feature, tier));
      const out = await runDeskBrief({
        feature,
        tier,
        row,
        hash,
        force: Boolean(payload.force),
        sourceNote: payload.sourceNote || '',
        sourceExtract: payload.sourceExtract || '',
        scope: payload.scope === 'substance' ? 'substance' : 'entry',
        authorization: req.headers?.authorization,
      });
      return json(res, { ok: true, ...out });
    } catch (err) {
      const msg = err.message || String(err);
      const status = Number.isInteger(err.status) ? err.status : /missing|required|Select a row|No rows/i.test(msg) ? 400 : 502;
      return json(res, { ok: false, error: msg }, status);
    }
  }

  if (url.pathname !== '/api/ai/chat') {
    next();
    return;
  }
  if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405);

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 12 * 1024 * 1024) req.destroy();
  });
  await new Promise((resolve, reject) => {
    req.on('end', resolve);
    req.on('error', reject);
  });
  let payload = {};
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return json(res, { ok: false, error: 'Invalid JSON' }, 400);
  }

  try {
    const out = await runAiChat(payload, req.headers.authorization);
    json(res, { ok: true, ...out });
  } catch (err) {
    const msg = err.message || String(err);
    json(res, { ok: false, error: msg }, /missing|invalid json|requires authentication/i.test(msg) ? 400 : 502);
  }
}

export function aiApiPlugin() {
  return {
    name: 'niyantran-ai-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAiApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAiApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
