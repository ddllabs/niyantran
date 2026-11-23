// Small key-value store. On a phone it uses Capacitor Preferences (survives WebView storage
// clean-ups on iOS); in a browser it falls back to localStorage. Every call is guarded, so a
// blocked or missing store never breaks the app.
import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform.js';

const mem = new Map();

export const kv = {
  async get(key) {
    try {
      if (isNative()) return (await Preferences.get({ key })).value ?? null;
      return window.localStorage.getItem(key);
    } catch { return mem.get(key) ?? null; }
  },
  async set(key, value) {
    try {
      if (isNative()) await Preferences.set({ key, value });
      else window.localStorage.setItem(key, value);
    } catch { mem.set(key, value); }
  },
  async remove(key) {
    try {
      if (isNative()) await Preferences.remove({ key });
      else window.localStorage.removeItem(key);
    } catch { mem.delete(key); }
  },
};

export async function getJSON(key, fallback = null) {
  const raw = await kv.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
export const setJSON = (key, value) => kv.set(key, JSON.stringify(value));
