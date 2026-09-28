const KEY = 'niyantranAiModels.v4';
const EVENT = 'niy-ai-models';


/**
 * Models shown in AI research.
 * All models are routed through the single universal OpenRouter gateway.
 * tier: free = Gemini model IDs; paid = others. A label only; nothing gates on it.
 */
export const AI_PROVIDERS = [
  {
    id: 'gemini-lite',
    label: 'Gemini - Lite',
    model: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    tier: 'free',
    enabled: true,
    hint: 'Default — fast briefing and desk questions (OpenRouter · Google Gemini 3.5 Flash Lite)',
  },
  {
    id: 'gemini-flash',
    label: 'Gemini - Flash',
    model: 'google/gemini-3.8-flash',
    provider: 'openrouter',
    tier: 'free',
    enabled: true,
    hint: 'Heavier synthesis / visual research (OpenRouter · Google Gemini 3.8 Flash)',
  },
  {
    id: 'gpt-astra',
    label: 'GPT - Astra',
    model: 'openai/gpt-6-astra',
    provider: 'openrouter',
    tier: 'paid',
    enabled: true,
    hint: 'OpenRouter · OpenAI GPT-6 Astra',
  },
];

const DEFAULT_PROVIDER = AI_PROVIDERS.find((p) => p.enabled) || AI_PROVIDERS[0];

/** Live list for the picker / send path. */
export function liveAiProviders() {
  return AI_PROVIDERS.map((p) => ({ ...p }));
}

/**
 * Research role map — OpenRouter gateway across all models. Static fallback
 * (labels and the legacy picker) mirroring the live ai_roles rows; the server
 * resolves the model a request finally uses against the live registry.
 */
export const AI_ROLES = [
  {
    id: 'DEFAULT_ANALYST',
    label: 'Default analyst',
    hint: 'Everyday briefing, tables, and multi-desk questions.',
    model: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    key: '',
  },
  {
    id: 'EXPERT_ESCALATION',
    label: 'Expert escalation',
    hint: 'Harder synthesis when the lite pass is not enough.',
    model: 'openai/gpt-6-astra',
    provider: 'openrouter',
    key: '',
  },
  {
    id: 'PDF_PARSER',
    label: 'PDF parser',
    hint: 'Read PDFs, scans, and attached documents.',
    model: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    key: '',
  },
  {
    id: 'VISUAL_RESEARCH',
    label: 'Visual research',
    hint: 'Charts, maps, images, and screenshot-backed questions.',
    model: 'google/gemini-3.8-flash',
    provider: 'openrouter',
    key: '',
  },
];

function providerOf(model, fallback) {
  return 'openrouter';
}


export function getAiProvider(id) {
  return liveAiProviders().find((p) => p.id === id) || liveAiProviders().find((p) => p.enabled) || DEFAULT_PROVIDER;
}

export function activeAiProvider() {
  return liveAiProviders().find((p) => p.enabled) || DEFAULT_PROVIDER;
}

/** Compact pill label: `Gemini - Lite` / `GPT - Astra`. */
export function shortModelLabel(role) {
  const hit = AI_PROVIDERS.find((p) => p.model === role?.model || p.id === role?.id);
  if (hit) return hit.label;
  const provider = String(role?.provider || providerOf(role?.model, '')).toLowerCase();
  if (provider === 'openrouter' || /astra|gpt-6/i.test(role?.model || '')) return 'GPT - Astra';
  const brand = 'Gemini';
  const m = String(role?.model || '').toLowerCase();
  let tag = '';
  if (m.includes('pro')) tag = 'Pro';
  else if (m.includes('lite')) tag = 'Lite';
  else if (m.includes('flash')) tag = 'Flash';
  else {
    const parts = m.split(/[-_/]/).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    tag = last ? last.charAt(0).toUpperCase() + last.slice(1) : '';
  }
  return tag ? `${brand} - ${tag}` : brand;
}

function clean(saved) {
  const byId = new Map((Array.isArray(saved) ? saved : []).map((r) => [r.id, r]));
  return AI_ROLES.map((base) => {
    const extra = byId.get(base.id) || {};
    const model = String(extra.model || base.model).trim() || base.model;
    const provider = extra.provider || providerOf(model, base.provider);
    return {
      ...base,
      label: String(extra.label || base.label),
      hint: String(extra.hint || base.hint),
      model,
      provider,
      key: '',
    };
  });
}

export function loadAiModels() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
  } catch {
    /* defaults */
  }
  return clean([]);
}

export function saveAiModels(roles) {
  const value = clean(roles);
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
  return value;
}

export function resetAiModels() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
  return loadAiModels();
}

export function getAiRole(id) {
  return loadAiModels().find((r) => r.id === id) || loadAiModels()[0];
}

export function pickAiRole(attachments = [], preferredId) {
  const roles = loadAiModels();
  if (preferredId && preferredId !== 'AUTO') {
    return roles.find((r) => r.id === preferredId) || roles[0];
  }
  const kinds = (attachments || [])
    .flatMap((a) => [
      a.kind,
      a.mime,
      a.url,
      ...((a.files || []).map((f) => f.kind || f.url || f.mime || '')),
      ...(a.urls || []),
    ])
    .map((x) => String(x || '').toLowerCase());
  if (kinds.some((k) => k.includes('pdf') || k.endsWith('.pdf'))) {
    return roles.find((r) => r.id === 'PDF_PARSER') || roles[0];
  }
  if (kinds.some((k) => /image|png|jpe?g|webp|gif|chart|map/.test(k))) {
    return roles.find((r) => r.id === 'VISUAL_RESEARCH') || roles[0];
  }
  return roles.find((r) => r.id === 'DEFAULT_ANALYST') || roles[0];
}

export function subscribeAiModels(fn) {
  const on = () => fn(loadAiModels());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}
