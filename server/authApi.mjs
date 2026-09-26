/**
 * Server-Side Authentication & Switchable Email Delivery API Controller
 * 
 * Secure backend handler running inside Vite dev server / Node server.
 * Supports switchable delivery providers via AUTH_EMAIL_PROVIDER:
 *   - SUPABASE_NATIVE: native Supabase Auth email dispatch
 *   - RESEND_API: server-side Supabase Admin generateLink() + Resend API
 * 
 * Endpoints:
 *   GET  /api/auth/provider
 *   POST /api/auth/signup
 *   POST /api/auth/resend-verification
 *   POST /api/auth/forgot-password
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './loadEnv.mjs';
import {
  AUTH_EMAIL_PROVIDERS,
  getActiveEmailProvider,
  validateEmailProviderStartup,
  getEmailProviderStrategy,
  getSupabaseAnonClient,
} from './authEmailProvider.mjs';

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) break;
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    return null;
  }
}

function getAppBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5173';
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// In-memory rate limiting map (email -> timestamp)
const rateLimits = new Map();

function isRateLimited(email, cooldownSeconds = 60) {
  const normalized = String(email || '').trim().toLowerCase();
  const last = rateLimits.get(normalized);
  if (!last) return false;
  const diff = (Date.now() - last) / 1000;
  return diff < cooldownSeconds;
}

function recordRateLimit(email) {
  const normalized = String(email || '').trim().toLowerCase();
  rateLimits.set(normalized, Date.now());
}

export async function handleAuthApi(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);

  if (!url.pathname.startsWith('/api/auth/')) {
    next();
    return;
  }

  loadEnv(true);

  // GET /api/auth/provider — Provider diagnostics & status check
  if (url.pathname === '/api/auth/provider' && req.method === 'GET') {
    try {
      const activeProvider = getActiveEmailProvider();
      return json(res, { ok: true, provider: activeProvider });
    } catch (err) {
      return json(res, { ok: false, error: err.message }, 500);
    }
  }

  // POST /api/auth/signup
  if (url.pathname === '/api/auth/signup' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, { ok: false, error: 'Invalid JSON request body' }, 400);

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();

    if (!email || !email.includes('@')) {
      return json(res, { ok: false, error: 'A valid email address is required' }, 400);
    }
    if (!password || password.length < 8) {
      return json(res, { ok: false, error: 'Password must be at least 8 characters long' }, 400);
    }

    const appBase = getAppBaseUrl(req);
    const redirectUrl = `${appBase}/#login?verified=true`;

    try {
      const strategy = getEmailProviderStrategy();
      const result = await strategy.signup({
        email,
        password,
        firstName,
        lastName,
        redirectUrl,
      });

      if (!result.ok) {
        return json(res, { ok: false, error: result.error }, result.status || 400);
      }

      recordRateLimit(email);

      return json(res, {
        ok: true,
        user: result.user,
        messageId: result.messageId,
        provider: result.provider,
      }, 201);
    } catch (err) {
      console.error('[AuthApi] Signup error:', err);
      return json(res, { ok: false, error: err.message || 'Internal server error during registration' }, 500);
    }
  }

  // POST /api/auth/resend-verification
  if (url.pathname === '/api/auth/resend-verification' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, { ok: false, error: 'Invalid JSON request body' }, 400);

    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return json(res, { ok: false, error: 'A valid email address is required' }, 400);
    }

    if (isRateLimited(email, 60)) {
      return json(res, { ok: false, error: 'Please wait 60 seconds before requesting another email.' }, 429);
    }

    const appBase = getAppBaseUrl(req);
    const redirectUrl = `${appBase}/#login?verified=true`;

    try {
      const strategy = getEmailProviderStrategy();
      const result = await strategy.resendVerification({ email, redirectUrl });

      if (!result.ok) {
        return json(res, { ok: false, error: result.error }, result.status || 400);
      }

      recordRateLimit(email);

      return json(res, {
        ok: true,
        message: result.message,
        messageId: result.messageId,
        provider: result.provider,
      }, 200);
    } catch (err) {
      console.error('[AuthApi] Resend verification error:', err);
      return json(res, { ok: false, error: err.message || 'Failed to resend verification email' }, 500);
    }
  }

  // POST /api/auth/forgot-password (Anti-enumeration guaranteed)
  if (url.pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, { ok: false, error: 'Invalid JSON request body' }, 400);

    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return json(res, { ok: false, error: 'A valid email address is required' }, 400);
    }

    const genericSuccess = {
      ok: true,
      message: 'If an account exists for this email address, a password reset link has been sent.',
      provider: getActiveEmailProvider(),
    };

    if (isRateLimited(email, 30)) {
      // Avoid leaking rate limit states for arbitrary emails
      return json(res, genericSuccess, 200);
    }

    const appBase = getAppBaseUrl(req);
    const redirectUrl = `${appBase}/#reset-password`;

    try {
      const strategy = getEmailProviderStrategy();
      const result = await strategy.forgotPassword({ email, redirectUrl });

      recordRateLimit(email);

      return json(res, {
        ok: true,
        message: result?.message || genericSuccess.message,
        provider: result?.provider,
      }, 200);
    } catch (err) {
      console.error('[AuthApi] Forgot password error:', err);
      return json(res, genericSuccess, 200);
    }
  }

  // POST /api/auth/reset-password
  if (url.pathname === '/api/auth/reset-password' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, { ok: false, error: 'Invalid JSON request body' }, 400);
    const password = String(body.password || '');
    if (!password || password.length < 8) {
      return json(res, { ok: false, error: 'Password must be at least 8 characters long' }, 400);
    }
    const header = req.headers.authorization;
    const bearerToken = typeof header === 'string' && /^Bearer ([^\s,]+)$/i.exec(header)?.[1];
    const token = String(body.token || body.accessToken || bearerToken || '').trim();
    if (!token) {
      return json(res, { ok: false, error: 'Valid recovery session token is required' }, 401);
    }
    try {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
      const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.updateUser({ password });
      if (error) return json(res, { ok: false, error: error.message }, 400);
      return json(res, { ok: true, message: 'Password updated successfully', user: data.user }, 200);
    } catch (err) {
      return json(res, { ok: false, error: err.message || 'Password update failed' }, 500);
    }
  }

  // POST /api/auth/login
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, { ok: false, error: 'Invalid JSON request body' }, 400);
    const email = String(body.email || body.user || '').trim().toLowerCase();
    const password = String(body.password || body.pass || '');
    if (!email || !password) {
      return json(res, { ok: false, error: 'Email and password are required' }, 400);
    }
    try {
      const anon = getSupabaseAnonClient();
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error) {
        return json(res, { ok: false, error: error.message }, 401);
      }
      return json(res, { ok: true, user: data.user, session: data.session }, 200);
    } catch (err) {
      return json(res, { ok: false, error: err.message || 'Login failed' }, 500);
    }
  }

  // GET /api/auth/me
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const header = req.headers.authorization;
    const match = typeof header === 'string' && /^Bearer ([^\s,]+)$/i.exec(header);
    if (!match) {
      return json(res, { ok: false, error: 'Authentication required' }, 401);
    }
    try {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
      const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${match[1]}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser(match[1]);
      if (error || !data?.user) {
        return json(res, { ok: false, error: 'Invalid or expired session' }, 401);
      }
      return json(res, { ok: true, user: data.user }, 200);
    } catch (err) {
      return json(res, { ok: false, error: err.message || 'Verification failed' }, 500);
    }
  }

  // POST /api/auth/logout
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    return json(res, { ok: true, message: 'Logged out successfully' }, 200);
  }

  return json(res, { ok: false, error: 'Auth route not found' }, 404);
}

export function authApiPlugin() {
  return {
    name: 'niyantran-auth-api',
    configureServer(server) {
      try {
        validateEmailProviderStartup();
      } catch (err) {
        console.warn('[AuthApiPlugin] Startup warning:', err.message);
      }
      server.middlewares.use((req, res, next) => {
        const p = handleAuthApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      try {
        validateEmailProviderStartup();
      } catch (err) {
        console.warn('[AuthApiPlugin] Preview warning:', err.message);
      }
      server.middlewares.use((req, res, next) => {
        const p = handleAuthApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
