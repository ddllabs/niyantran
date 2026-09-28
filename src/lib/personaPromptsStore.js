import { USER_TYPES, userTypeOf } from './userTypes.js';
import studentPrompt from '../data/personas/student.md?raw';
import journalistPrompt from '../data/personas/journalist.md?raw';
import lawyerPrompt from '../data/personas/lawyer.md?raw';
import policyPrompt from '../data/personas/policy.md?raw';
import analystPrompt from '../data/personas/analyst.md?raw';
import academicPrompt from '../data/personas/academic.md?raw';

const KEY = 'niyantranPersonaPrompts';
const EVENT = 'niy-persona-prompts';

export const DEFAULT_PERSONA_PROMPTS = {
  student: String(studentPrompt || '').trim(),
  journalist: String(journalistPrompt || '').trim(),
  lawyer: String(lawyerPrompt || '').trim(),
  policy: String(policyPrompt || '').trim(),
  analyst: String(analystPrompt || '').trim(),
  academic: String(academicPrompt || '').trim(),
};

function emptyMap() {
  const out = {};
  for (const t of USER_TYPES) out[t.id] = '';
  return out;
}

function clean(saved) {
  const src = saved && typeof saved === 'object' ? saved : {};
  const out = emptyMap();
  for (const t of USER_TYPES) {
    const raw = src[t.id];
    out[t.id] = raw == null ? DEFAULT_PERSONA_PROMPTS[t.id] || '' : String(raw);
  }
  return out;
}

export function loadPersonaPrompts() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
  } catch {
    /* defaults */
  }
  return clean({});
}

export function savePersonaPrompts(map) {
  const value = clean(map);
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
  return value;
}

export function resetPersonaPrompts() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
  return loadPersonaPrompts();
}

export function resetPersonaPrompt(typeId) {
  const id = userTypeOf(typeId).id;
  const next = loadPersonaPrompts();
  next[id] = DEFAULT_PERSONA_PROMPTS[id] || '';
  return savePersonaPrompts(next);
}

/** Shipped markdown only — live desk / server path (A-07). */
export function shippedPersonaPromptFor(typeId) {
  const id = userTypeOf(typeId).id;
  return String(DEFAULT_PERSONA_PROMPTS[id] || '').trim();
}

/**
 * Admin drafts (localStorage). Do not use for live /api/ai/chat —
 * those resolve shipped prompts on the server unless probe=true.
 */
export function personaPromptFor(typeId) {
  const id = userTypeOf(typeId).id;
  const map = loadPersonaPrompts();
  return String(map[id] || DEFAULT_PERSONA_PROMPTS[id] || '').trim();
}

export function subscribePersonaPrompts(fn) {
  const on = () => fn(loadPersonaPrompts());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}
