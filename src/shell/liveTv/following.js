// B6: "My list": the channels a user follows, kept in this browser only (no account, no server). One versioned
// key. Reading never throws and never trusts what it finds; ids of channels that no longer exist are dropped
// where the list is shown, not here.
export const FOLLOW_KEY = 'nter.livetv.following.v1';
export const FOLLOW_MAX = 60;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const clean = (ids) => {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === 'string' && ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= FOLLOW_MAX) break;
  }
  return out;
};

/** The browser's storage, or undefined when it is not there or not allowed. */
export function browserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; } catch { return undefined; }
}

export function readFollowing(storage) {
  try {
    const raw = storage?.getItem(FOLLOW_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) && data.v === 1 ? clean(data.ids) : [];
  } catch { return []; }
}

export function writeFollowing(storage, ids) {
  try { storage?.setItem(FOLLOW_KEY, JSON.stringify({ v: 1, ids: clean(ids) })); } catch { /* the list stays for this visit only */ }
}

/** A new list with the id added at the end, or removed if it was there. Following stops at the cap. */
export function toggleFollowing(ids, id) {
  if (typeof id !== 'string' || !id) return [...ids];
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= FOLLOW_MAX ? [...ids] : [...ids, id];
}

export const FOLLOW_FULL = `My list is full (${FOLLOW_MAX}). Unfollow one first.`;
