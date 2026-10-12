import { PRIVACY_POLICY } from './legalPolicies.js';

const KEY = 'niyantranPrivacy';
const EVENT = 'niy-privacy';

export const DEFAULT_PRIVACY = PRIVACY_POLICY;

function sid() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function merge(saved) {
  const base = DEFAULT_PRIVACY;
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
    sections,
  };
}

export function parsePolicyBody(body) {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const blocks = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n').trim();
    if (text) blocks.push({ type: 'p', text });
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: 'ul', items: list });
    list = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^###\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', text: line.replace(/^###\s+/, '').trim() });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'note', text: line.replace(/^>\s?/, '').trim() });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, '').trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

export function loadPrivacy() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {
    /* defaults */
  }
  return merge({});
}

export function savePrivacy(next) {
  const value = merge(next);
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
  return value;
}

export function resetPrivacy() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
  return loadPrivacy();
}

export function subscribePrivacy(fn) {
  const on = () => fn(loadPrivacy());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}

export function newPrivacySection(index) {
  return {
    id: sid(),
    num: String(index + 1),
    title: 'New section',
    body: '',
  };
}
