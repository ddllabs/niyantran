import { pickAiRole, activeAiProvider, liveAiProviders } from './aiModelsStore.js';
import { sessionUser, userTypeOf } from './userStore.js';

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
  const providers = liveAiProviders();
  const live = activeAiProvider();
  const picked =
    providers.find((p) => p.enabled && p.model === modelOverride) ||
    providers.find((p) => p.enabled && p.id === providerOverride) ||
    providers.find((p) => p.enabled && p.provider === providerOverride) ||
    live;
  const model = (modelOverride && String(modelOverride).trim()) || picked.model || role.model || live.model;
  let provider = String(
    (['gemini', 'openrouter', 'openai', 'gpt'].includes(String(providerOverride || '').toLowerCase())
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
