import { pickAiRole, activeAiProvider, AI_PROVIDERS } from './aiModelsStore.js';
import { sessionUser, userTypeOf, verifiedLocalIdentity, localIdentityIsCurrent, subscribeLocalIdentity } from './userStore.js';
import { functionsUrl } from './supabaseClient.js';

/**
 * POST one turn to the research-chat edge function and hand back the raw
 * response so the caller can read its SSE frames. Additive: `sendAiChat`
 * below is the legacy path and is unchanged.
 */
export async function sendResearchTurn({ body, signal, identity: expectedIdentity }) {
  const controller = new AbortController();
  let identity = null;
  let version = 0;
  const unsubscribe = subscribeLocalIdentity(() => {
    version++;
    if (identity) controller.abort();
  });
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let response;
  try {
    identity = await verifiedLocalIdentity();
    const verifiedVersion = version;
    if (!identity || controller.signal.aborted || (expectedIdentity &&
        (identity.id !== expectedIdentity.id || identity.epoch !== expectedIdentity.epoch || identity.token !== expectedIdentity.token))
        || !await localIdentityIsCurrent(identity) || version !== verifiedVersion || controller.signal.aborted) {
      throw new Error('Sign in to use AI research.');
    }
    response = await fetch(functionsUrl('research-chat'), {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${identity.token}` },
      body: JSON.stringify(body),
    });
    if (!await localIdentityIsCurrent(identity) || version !== verifiedVersion || controller.signal.aborted) {
      throw new Error('Your research session changed.');
    }
    return response;
  } catch (error) {
    if (response?.body) void response.body.cancel().catch(() => {});
    throw error;
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abort);
  }
}

export async function sendAiChat({
  roleId,
  messages,
  attachments,
  files,
  signal,
  userType,
  personaPrompt: override,
  probe = false,
  model: modelOverride,
  provider: providerOverride,
  focus = 'attached',
  workMode = false,
  selection = null,
  deskContext = null,
}) {
  const role = pickAiRole(attachments, roleId);
  const live = activeAiProvider();
  const picked =
    AI_PROVIDERS.find((p) => p.enabled && p.model === modelOverride) ||
    AI_PROVIDERS.find((p) => p.enabled && p.id === providerOverride) ||
    AI_PROVIDERS.find((p) => p.enabled && p.provider === providerOverride) ||
    live;
  const model = (modelOverride && String(modelOverride).trim()) || picked.model || role.model || live.model;
  let provider = String(
    (['gemini', 'openrouter', 'deepseek', 'openai', 'gpt'].includes(String(providerOverride || '').toLowerCase())
      ? providerOverride
      : null) ||
      picked.provider ||
      role.provider ||
      live.provider ||
      'gemini',
  ).toLowerCase();
  if (provider === 'openai' || provider === 'gpt') provider = 'openrouter';

  const typeId = userTypeOf(userType || sessionUser()?.type).id;

  // A-07: live chats never send client-editable persona text. Admin probe may.
  const body = {
    roleId: role.id,
    model,
    provider,
    userType: typeId,
    focus: String(focus || 'attached'),
    workMode: Boolean(workMode),
    messages,
    attachments,
    files: files || attachments?.flatMap((a) => a.files || []) || [],
    selection: selection || undefined,
    deskContext: deskContext || undefined,
  };
  if (probe === true) {
    body.probe = true;
    body.personaPrompt = override != null ? String(override) : '';
  }

  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `AI HTTP ${res.status}`);
  }
  return {
    ...data,
    role: { ...role, provider: data.provider || provider, model: data.model || model },
  };
}
