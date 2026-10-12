import { TERMS_OF_SERVICE } from './legalPolicies.js';
import { parsePolicyBody } from './privacyStore.js';

const KEY = 'niyantranTerms';
const EVENT = 'niy-terms';

export { parsePolicyBody };

export const DEFAULT_TERMS = TERMS_OF_SERVICE;

function sid() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function merge(saved) {
  const base = DEFAULT_TERMS;
  const src = saved && typeof saved === 'object' ? saved : {};
  const sections = Array.isArray(src.sections) && src.sections.length
    ? src.sections.map((s, i) => ({
        id: String(s.id || sid()),
        num: String(s.num || String(i + 1)),
        title: String(s.title || `Section ${i + 1}`),
        body: String(s.body || ''),
      }))
    : base.sections.map((s) => ({ ...s }));
  return {
    lastUpdated: String(src.lastUpdated ?? base.lastUpdated),
    org: String(src.org ?? base.org),
    team: String(src.team ?? base.team),
    email: String(src.email ?? base.email),
    website: String(src.website ?? base.website),
    address: String(src.address ?? base.address),
    jurisdiction: String(src.jurisdiction ?? base.jurisdiction),
    courts: String(src.courts ?? base.courts),
    sections,
  };
}

export function loadTerms() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {
    /* defaults */
  }
  return merge({});
}

export function saveTerms(next) {
  const value = merge(next);
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
  return value;
}

export function resetTerms() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
  return loadTerms();
}

export function subscribeTerms(fn) {
  const on = () => fn(loadTerms());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}

export function newTermsSection(index) {
  return {
    id: sid(),
    num: String(index + 1),
    title: 'New section',
    body: '',
  };
}
