import { useRef, useState } from 'react';

const PREFIX = 'niy-workspace-v1:';
const MAX_VIEWS = 160;
const memory = new Map();

/** Client-only UI state. Never stores feed rows or synchronizes to the server. */
export function workspaceScopeKey(identity, view) {
  return identity ? `${PREFIX}${encodeURIComponent(identity)}:${encodeURIComponent(view)}` : '';
}
export function readWorkspace(scope, slot, fallback) {
  if (!scope) return fallback;
  if (!memory.has(scope)) {
    try { memory.set(scope, JSON.parse(sessionStorage.getItem(scope) || '{}')); }
    catch { memory.set(scope, {}); }
  }
  const value = memory.get(scope);
  return value && Object.hasOwn(value, slot) ? value[slot] : fallback;
}
export function writeWorkspace(scope, slot, value) {
  if (!scope) return;
  readWorkspace(scope, slot, null);
  const state = { ...memory.get(scope), [slot]: value };
  // UI controls only; corrupt/oversized session state cannot grow without bound.
  let json;
  try { json = JSON.stringify(state); } catch { return; }
  if (json.length > 24000) return;
  memory.delete(scope); memory.set(scope, state);
  try { sessionStorage.setItem(scope, json); } catch { /* memory works when storage is blocked */ }
  while (memory.size > MAX_VIEWS) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
    try { sessionStorage.removeItem(oldest); } catch { /* optional persistence */ }
  }
}
export function clearWorkspace() {
  for (const scope of memory.keys()) { try { sessionStorage.removeItem(scope); } catch { /* optional storage */ } }
  memory.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { /* optional persistence */ }
}
/** DeskView is keyed by canonical module; each setter captures its original scope. */
export function useWorkspaceState(slot, initial, scope = '') {
  const [value, setValue] = useState(() => readWorkspace(scope, slot, typeof initial === 'function' ? initial() : initial));
  const setter = useRef(null);
  if (!setter.current) setter.current = next => {
    if (typeof next !== 'function') { writeWorkspace(scope, slot, next); setValue(next); return; }
    setValue(previous => {
      const result = next(previous);
      writeWorkspace(scope, slot, result);
      return result;
    });
  };
  return [value, setter.current];
}
