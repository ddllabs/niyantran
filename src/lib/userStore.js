import { DEFAULT_USER_TYPE, userTypeOf } from './userTypes.js';

const KEY = 'niyantranUsers';
const EVENT = 'niy-users';
const SESSION_KEY = 'niyantranUser';

export { USER_TYPES, userTypeOf, desksForType, tabsForType, canOpenDesk, DEFAULT_USER_TYPE } from './userTypes.js';

export const SEED_USER = {
  id: 'seed-analyst',
  name: 'Lead Analyst',
  email: 'analyst@niyantran',
  password: '12345678#',
  plan: 'enterprise',
  planStatus: 'active',
  personaId: 'analyst',
  type: 'analyst',
  active: true,
  createdAt: '2026-01-15T00:00:00.000Z',
};

export const SEED_STUDENT = {
  id: 'seed-student',
  name: 'Student Desk',
  email: 'student@niyantran',
  password: '12345678#',
  plan: 'explorer',
  planStatus: 'free',
  personaId: 'student',
  type: 'student',
  active: true,
  createdAt: '2026-01-15T00:00:00.000Z',
};

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* empty */
  }
  return null;
}

function normalize(user) {
  if (!user || typeof user !== 'object') return null;
  const type = userTypeOf(user.type || user.personaId).id;
  const personaId = user.personaId || user.persona_id || type;
  const plan = String(user.plan || 'explorer').toLowerCase();
  return {
    ...user,
    email: String(user.email || '')
      .trim()
      .toLowerCase(),
    type,
    personaId,
    plan: plan === 'professional' ? 'pro' : plan,
    planStatus: user.planStatus || user.plan_status || (plan === 'explorer' ? 'free' : 'active'),
    trialEndsAt: user.trialEndsAt || user.trial_ends_at || null,
    billingYearly: Boolean(user.billingYearly ?? user.billing_yearly),
    googleSub: user.googleSub || user.google_sub || null,
    authProvider: user.authProvider || (user.googleSub || user.google_sub ? 'google' : 'password'),
    active: user.active !== false,
  };
}

function withSeeds(list) {
  let out = Array.isArray(list) ? list.map(normalize).filter(Boolean) : [];
  if (!out.some((u) => u.email === SEED_USER.email)) out = [SEED_USER, ...out];
  if (!out.some((u) => u.email === SEED_STUDENT.email)) out = [...out, SEED_STUDENT];
  return out.map(normalize).filter(Boolean);
}

function mergeByEmail(a, b) {
  const map = new Map();
  for (const u of [...(a || []), ...(b || [])]) {
    const n = normalize(u);
    if (!n?.email) continue;
    const prev = map.get(n.email);
    if (!prev) {
      map.set(n.email, n);
      continue;
    }
    const newer = String(n.createdAt || '') >= String(prev.createdAt || '') ? n : prev;
    map.set(n.email, { ...prev, ...newer, email: n.email });
  }
  // Demo seats always keep known passwords so a stale localStorage can't lock you out.
  const seeds = [SEED_USER, SEED_STUDENT];
  for (const s of seeds) {
    const cur = map.get(s.email);
    if (!cur) {
      map.set(s.email, normalize(s));
      continue;
    }
    map.set(s.email, {
      ...cur,
      id: s.id,
      email: s.email,
      password: s.password,
      type: cur.type || s.type,
      active: cur.active !== false,
    });
  }
  return withSeeds([...map.values()]);
}

export function loadUsers() {
  const saved = readRaw();
  const list = withSeeds(saved && saved.length ? saved : [SEED_USER, SEED_STUDENT]);
  // Keep demo passwords stable even if localStorage was polluted.
  return list.map((u) => {
    if (u.email === SEED_USER.email) return { ...u, password: SEED_USER.password, id: SEED_USER.id };
    if (u.email === SEED_STUDENT.email) return { ...u, password: SEED_STUDENT.password, id: SEED_STUDENT.id };
    return u;
  });
}

async function pushUsersToServer(users) {
  try {
    await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users }),
    });
  } catch {
    /* offline / no plugin */
  }
}

/** Pull server seats into localStorage (fixes localhost vs 127.0.0.1 split). */
export async function hydrateUsersFromServer() {
  const local = loadUsers();
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return local;
    const body = await res.json().catch(() => ({}));
    const remote = Array.isArray(body?.users) ? body.users : [];
    if (!remote.length) {
      await pushUsersToServer(local);
      return local;
    }
    const merged = mergeByEmail(remote, local);
    localStorage.setItem(KEY, JSON.stringify(merged));
    window.dispatchEvent(new Event(EVENT));
    // Persist union so the other origin sees issued seats too
    await pushUsersToServer(merged);
    return merged;
  } catch {
    return local;
  }
}

export function saveUsers(users) {
  const list = withSeeds(users.map(normalize).filter(Boolean));
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
  pushUsersToServer(list);
  return list;
}

export function subscribeUsers(fn) {
  const on = () => fn(loadUsers());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}

export function toPublicUser(user, typeOverride) {
  const u = normalize(user);
  if (!u) return null;
  const { password: _pw, ...rest } = u;
  return {
    ...rest,
    type: userTypeOf(typeOverride || u.type).id,
  };
}

export function authenticateUser(loginId, password) {
  const needle = String(loginId || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!needle) return { ok: false, reason: 'Unknown user ID.' };

  const users = loadUsers();
  const byEmail = users.filter((u) => String(u.email || '').toLowerCase() === needle);
  const byId = users.filter((u) => String(u.id || '').toLowerCase() === needle);
  const byLocal = users.filter((u) => {
    const em = String(u.email || '').toLowerCase();
    const at = em.indexOf('@');
    return at > 0 && em.slice(0, at) === needle;
  });
  const byName = users.filter((u) => String(u.name || '').trim().toLowerCase() === needle);

  let hit = byEmail[0] || byId[0] || (byLocal.length === 1 ? byLocal[0] : null);
  if (!hit && byName.length === 1) hit = byName[0];

  if (!hit) {
    return {
      ok: false,
      reason: 'Unknown user ID. Open Admin → Users and use that exact User ID, or try student@niyantran / 12345678#',
    };
  }
  if (!hit.active) return { ok: false, reason: 'This account is suspended.' };
  if (String(hit.password) !== pass) return { ok: false, reason: 'Invalid user ID or password.' };
  return { ok: true, user: hit };
}

export function createUser({ name, email, password, plan, type, personaId, planStatus, trialEndsAt, billingYearly }) {
  const users = loadUsers();
  const cleanEmail = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!cleanEmail || !password) return { ok: false, reason: 'User ID and password are required.' };
  if (cleanEmail.length < 2) return { ok: false, reason: 'User ID is too short.' };
  if (String(password).length < 6) return { ok: false, reason: 'Password must be at least 6 characters.' };
  if (users.some((u) => String(u.email).toLowerCase() === cleanEmail)) {
    return { ok: false, reason: 'That user ID already exists.' };
  }
  const role = userTypeOf(personaId || type).id;
  const planId = String(plan || 'explorer').toLowerCase();
  const next = normalize({
    id: `u-${Date.now()}`,
    name: String(name || '').trim() || cleanEmail.split('@')[0],
    email: cleanEmail,
    password: String(password),
    plan: planId,
    planStatus: planStatus || (planId === 'explorer' ? 'free' : 'active'),
    trialEndsAt: trialEndsAt || null,
    billingYearly: Boolean(billingYearly),
    type: role,
    personaId: role,
    active: true,
    createdAt: new Date().toISOString(),
  });
  saveUsers([next, ...users]);
  return { ok: true, user: next };
}

/**
 * Upsert a server-verified Google user into the local seat list.
 * Preserves existing plan/persona when the account already exists.
 */
export function upsertGoogleUser(remote) {
  const n = normalize(remote);
  if (!n?.email) return { ok: false, reason: 'Invalid Google user.' };
  const users = loadUsers();
  const idx = users.findIndex(
    (u) =>
      (n.googleSub && u.googleSub === n.googleSub) ||
      String(u.email).toLowerCase() === n.email,
  );
  if (idx >= 0) {
    const prev = users[idx];
    const merged = normalize({
      ...prev,
      ...n,
      // Never downgrade existing plan / persona from a Google return trip
      plan: prev.plan || n.plan,
      planStatus: prev.planStatus || n.planStatus,
      type: prev.type || n.type,
      personaId: prev.personaId || n.personaId,
      password: prev.password || '',
      googleSub: n.googleSub || prev.googleSub,
      authProvider: 'google',
      id: prev.id || n.id,
      email: prev.email || n.email,
    });
    const next = [...users];
    next[idx] = merged;
    saveUsers(next);
    return { ok: true, user: merged };
  }
  const created = normalize({
    ...n,
    plan: n.plan || 'explorer',
    planStatus: n.planStatus || 'free',
    type: n.type || 'analyst',
    personaId: n.personaId || 'analyst',
    password: '',
    authProvider: 'google',
    active: true,
    createdAt: n.createdAt || new Date().toISOString(),
  });
  saveUsers([created, ...users]);
  return { ok: true, user: created };
}

export function updateUser(id, patch) {
  const users = loadUsers().map((u) => {
    if (u.id !== id) return u;
    const next = { ...u, ...patch, id: u.id, email: u.email };
    if (patch.type != null || patch.personaId != null) {
      const role = userTypeOf(patch.personaId || patch.type || u.type).id;
      next.type = role;
      next.personaId = role;
    }
    return next;
  });
  saveUsers(users);
}

export function removeUser(id) {
  if (id === SEED_USER.id || id === SEED_STUDENT.id) {
    return { ok: false, reason: 'Seed accounts cannot be removed.' };
  }
  saveUsers(loadUsers().filter((u) => u.id !== id));
  return { ok: true };
}

export function setSessionUser(user) {
  const pub = toPublicUser(user);
  sessionStorage.setItem('niyantranAuthed', '1');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(pub));
  return pub;
}

export function sessionUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.email) return toPublicUser(parsed);
      if (typeof parsed === 'string') {
        const hit = loadUsers().find((u) => String(u.email).toLowerCase() === parsed.toLowerCase());
        return hit ? toPublicUser(hit) : toPublicUser({ ...SEED_USER, email: parsed });
      }
    }
  } catch {
    /* empty */
  }
  const email = sessionStorage.getItem(SESSION_KEY);
  if (email && !email.startsWith('{')) {
    const hit = loadUsers().find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    return hit ? toPublicUser(hit) : toPublicUser({ ...SEED_USER, email });
  }
  return toPublicUser(SEED_USER);
}

export function clearSessionUser() {
  sessionStorage.removeItem('niyantranAuthed');
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('niyantranLand');
}
