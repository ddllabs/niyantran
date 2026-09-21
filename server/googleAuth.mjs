/**
 * Google Sign-In — verify ID tokens and resolve / create NTER accounts.
 *
 *   POST /api/auth/google
 *     { credential }                         — GIS ID token (login: existing only)
 *     { credential, mode: 'signup' }         — create explorer seat if new
 *     { credential, linkPassword }           — link Google to existing password account
 *
 * Login never auto-registers. Signup is the only create path.
 * Defaults for new accounts (approved): plan=explorer, persona=analyst.
 * Never overwrite plan/persona on returning users.
 * Same email with password but no google_sub → needs_link (no silent merge).
 */
import { OAuth2Client } from 'google-auth-library';
import { loadEnv } from './loadEnv.mjs';
import { getDb, queryAll, run, saveDb } from './db.mjs';

loadEnv();

const CLIENT_ID = () =>
  String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function publicUser(u) {
  if (!u) return null;
  const { password: _pw, ...rest } = u;
  return rest;
}

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password || '',
    plan: r.plan || 'explorer',
    type: r.type || 'analyst',
    active: Number(r.active) !== 0,
    personaId: r.persona_id || r.type || 'analyst',
    planStatus: r.plan_status || (r.plan === 'explorer' ? 'free' : 'active'),
    trialEndsAt: r.trial_ends_at || null,
    billingYearly: Number(r.billing_yearly) === 1,
    googleSub: r.google_sub || null,
    authProvider: r.google_sub ? 'google' : 'password',
    createdAt: r.created_at,
    updatedAt: r.updated_at || null,
  };
}

async function ensureGoogleColumn(database) {
  const cols = queryAll(database, `PRAGMA table_info(users)`).map((r) => r.name);
  if (!cols.includes('google_sub')) {
    database.run(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
    saveDb();
  }
}

async function findByGoogleSub(database, sub) {
  const rows = queryAll(database, `SELECT * FROM users WHERE google_sub = ? LIMIT 1`, [sub]);
  return rowToUser(rows[0]);
}

async function findByEmail(database, email) {
  const rows = queryAll(database, `SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1`, [email]);
  return rowToUser(rows[0]);
}

function insertUser(database, u) {
  const now = new Date().toISOString();
  run(
    database,
    `INSERT INTO users (id, name, email, password, plan, type, active, persona_id, plan_status, trial_ends_at, billing_yearly, created_at, updated_at, google_sub)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      u.id,
      u.name,
      u.email,
      u.password || '',
      u.plan || 'explorer',
      u.type || 'analyst',
      u.active === false ? 0 : 1,
      u.personaId || u.type || 'analyst',
      u.planStatus || 'free',
      u.trialEndsAt || null,
      u.billingYearly ? 1 : 0,
      u.createdAt || now,
      now,
      u.googleSub || null,
    ],
  );
  saveDb();
}

function updateGoogleLink(database, id, googleSub, name) {
  const now = new Date().toISOString();
  if (name) {
    run(database, `UPDATE users SET google_sub = ?, name = ?, updated_at = ? WHERE id = ?`, [
      googleSub,
      name,
      now,
      id,
    ]);
  } else {
    run(database, `UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?`, [googleSub, now, id]);
  }
  saveDb();
}

async function verifyGoogleCredential(credential) {
  const audience = CLIENT_ID();
  if (!audience) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the server.');
  }
  if (!credential || typeof credential !== 'string') {
    throw new Error('Missing Google credential.');
  }
  const client = new OAuth2Client(audience);
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('Google token missing subject.');
  if (payload.aud !== audience) throw new Error('Google token audience mismatch.');
  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw new Error('Google token issuer mismatch.');
  }
  if (!payload.email) throw new Error('Google account did not return an email.');
  if (payload.email_verified === false) throw new Error('Google email is not verified.');
  return {
    sub: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || payload.given_name || payload.email.split('@')[0] || 'User').trim(),
    picture: payload.picture || null,
  };
}

function sanitizeAuthError(err) {
  const msg = err?.message || String(err || 'Google sign-in failed');
  if (/sql-wasm|sql\.js|ENOENT|WASM/i.test(msg)) {
    return 'Sign-in is temporarily unavailable. Please try again in a moment, or create an account first.';
  }
  return msg;
}

/**
 * Resolve Google identity to a NTER user.
 * @param {{ credential?: string, linkPassword?: string, mode?: 'signin'|'signup' }} opts
 * @returns {{ ok: true, user, created: boolean } | { ok: false, code: string, email?: string, error: string }}
 */
export async function resolveGoogleLogin({ credential, linkPassword, mode } = {}) {
  const identity = await verifyGoogleCredential(credential);
  const allowCreate = String(mode || 'signin').toLowerCase() === 'signup';
  const database = await getDb();
  await ensureGoogleColumn(database);

  // Returning Google user (stable sub)
  const bySub = await findByGoogleSub(database, identity.sub);
  if (bySub) {
    if (!bySub.active) return { ok: false, code: 'SUSPENDED', error: 'This account is suspended.' };
    // Preserve plan/persona; refresh display name lightly if empty
    if ((!bySub.name || bySub.name === bySub.email.split('@')[0]) && identity.name) {
      updateGoogleLink(database, bySub.id, identity.sub, identity.name);
      bySub.name = identity.name;
    }
    return { ok: true, user: publicUser({ ...bySub, googleSub: identity.sub, authProvider: 'google' }), created: false };
  }

  const byEmail = await findByEmail(database, identity.email);
  if (byEmail) {
    // Already linked under different sub — should not happen if unique; treat as conflict
    if (byEmail.googleSub && byEmail.googleSub !== identity.sub) {
      return {
        ok: false,
        code: 'EMAIL_CONFLICT',
        email: identity.email,
        error: 'This email is already linked to a different Google account.',
      };
    }
    if (byEmail.googleSub === identity.sub) {
      return { ok: true, user: publicUser({ ...byEmail, authProvider: 'google' }), created: false };
    }
    // Password account without Google link — require proof
    if (!linkPassword) {
      return {
        ok: false,
        code: 'NEEDS_LINK',
        email: identity.email,
        error: 'An account with this email already exists. Enter your password to link Google Sign-In.',
      };
    }
    if (String(byEmail.password || '') !== String(linkPassword)) {
      return { ok: false, code: 'BAD_PASSWORD', email: identity.email, error: 'Password does not match this account.' };
    }
    if (!byEmail.active) return { ok: false, code: 'SUSPENDED', error: 'This account is suspended.' };
    updateGoogleLink(database, byEmail.id, identity.sub, identity.name || byEmail.name);
    return {
      ok: true,
      user: publicUser({ ...byEmail, googleSub: identity.sub, name: identity.name || byEmail.name, authProvider: 'google' }),
      created: false,
      linked: true,
    };
  }

  // No existing seat — login must register first; signup may create.
  if (!allowCreate) {
    return {
      ok: false,
      code: 'NO_ACCOUNT',
      email: identity.email,
      error: 'No account found for this Google email. Please register first.',
    };
  }

  const now = new Date().toISOString();
  const created = {
    id: `g-${identity.sub}`,
    name: identity.name,
    email: identity.email,
    password: '', // Google-only seat
    plan: 'explorer',
    planStatus: 'free',
    type: 'analyst',
    personaId: 'analyst',
    active: true,
    trialEndsAt: null,
    billingYearly: false,
    googleSub: identity.sub,
    authProvider: 'google',
    createdAt: now,
  };
  // Idempotent under concurrent first-login: unique email / id
  try {
    insertUser(database, created);
  } catch (err) {
    const again = (await findByGoogleSub(database, identity.sub)) || (await findByEmail(database, identity.email));
    if (again) {
      if (!again.googleSub) updateGoogleLink(database, again.id, identity.sub, identity.name);
      return { ok: true, user: publicUser({ ...again, googleSub: identity.sub, authProvider: 'google' }), created: false };
    }
    throw err;
  }
  return { ok: true, user: publicUser(created), created: true };
}

export async function handleGoogleAuthApi(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/auth/google')) {
    next();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/google') {
    return json(res, {
      ok: true,
      configured: Boolean(CLIENT_ID()),
      clientIdSuffix: CLIENT_ID() ? CLIENT_ID().slice(-24) : null,
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/api/auth/google') {
    return json(res, { ok: false, error: 'POST /api/auth/google only' }, 405);
  }

  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) break;
    }
    const payload = JSON.parse(raw || '{}');
    const out = await resolveGoogleLogin(payload);
    if (!out.ok) {
      const status =
        out.code === 'BAD_PASSWORD' || out.code === 'NEEDS_LINK'
          ? 401
          : out.code === 'NO_ACCOUNT'
            ? 404
            : 400;
      return json(res, out, status);
    }
    return json(res, { ok: true, user: out.user, created: out.created, linked: Boolean(out.linked) });
  } catch (err) {
    const msg = sanitizeAuthError(err);
    const raw = err?.message || String(err);
    const status = /audience|issuer|expired|token|credential|Missing|verified/i.test(raw) ? 401 : 500;
    return json(res, { ok: false, code: 'VERIFY_FAILED', error: msg }, status);
  }
}

export function googleAuthApiPlugin() {
  return {
    name: 'niyantran-google-auth-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleGoogleAuthApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleGoogleAuthApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
