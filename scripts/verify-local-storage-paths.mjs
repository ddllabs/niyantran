#!/usr/bin/env node
// F17: run the two database paths no unit test reaches against a real local
// Supabase stack (docs/plans/open-work.md):
//   1. the preferences merge-upsert through PostgREST (PUT /api/user-prefs);
//   2. the intro-video upload through a signed Storage URL
//      (POST upload-url, upload, POST finalize, public read, DELETE).
// It drives the real route handlers with the caller's own bearer.
//
// Local only. It refuses any SUPABASE_URL that is not 127.0.0.1 or localhost,
// and pins every Supabase variable before the handlers load, so nothing can
// fall back to the values in .env.local. Start a stack whose database has the
// auth_schema.sql bootstrap and every migration (see the F17 entry in
// docs/plans/open-work.md), then:
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
//   SUPABASE_SECRET_KEY=sb_secret_… node scripts/verify-local-storage-paths.mjs
//
// It creates one throwaway user and deletes it (and the uploaded object) at the end.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const secret = process.env.SUPABASE_SECRET_KEY || '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('Refusing: SUPABASE_URL must point at a local stack (127.0.0.1 or localhost).');
  process.exit(2);
}
if (!publishable || !secret) {
  console.error('SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (the local stack\'s) are required.');
  process.exit(2);
}
// No fallback to .env.local: loadEnv() only fills variables that are unset.
Object.assign(process.env, {
  VITE_SUPABASE_URL: url,
  SUPABASE_ANON_KEY: publishable,
  VITE_SUPABASE_ANON_KEY: publishable,
});

const { handleUserPrefsApi } = await import('../server/userPrefsApi.mjs');
const { handleMarketingMediaApi } = await import('../server/marketingMediaApi.mjs');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

async function call(handler, method, path, token, body) {
  const req = { method, url: path, headers: { host: 'localhost', authorization: `Bearer ${token}` }, body };
  let text = '';
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(chunk) { text = chunk || ''; } };
  await handler(req, res, () => { res.statusCode = 404; });
  return { status: res.statusCode, body: text ? JSON.parse(text) : null };
}

const email = `f17-${crypto.randomUUID().slice(0, 8)}@example.test`;
const password = crypto.randomBytes(18).toString('base64url');
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw new Error(`createUser failed: ${created.error.message}`);
const userId = created.data.user.id;

try {
  const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`sign-in failed: ${signed.error.message}`);
  const token = signed.data.session.access_token;

  // 1. Preferences: two partial PUTs must merge, not overwrite.
  const a = await call(handleUserPrefsApi, 'PUT', '/api/user-prefs', token, { watchlist: ['f17-a'] });
  check(a.status === 200 && a.body?.ok, `PUT watchlist → ${a.status}`);
  const b = await call(handleUserPrefsApi, 'PUT', '/api/user-prefs', token, { tours: { home: true } });
  check(b.status === 200 && b.body?.ok, `PUT tours only → ${b.status}`);
  const got = await call(handleUserPrefsApi, 'GET', '/api/user-prefs', token);
  check(JSON.stringify(got.body?.prefs?.watchlist) === '["f17-a"]', 'watchlist survived the tours-only PUT (merge-upsert)');
  check(JSON.stringify(got.body?.prefs?.tours) === '{"home":true}', 'tours stored');
  const owner = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const row = await owner.from('user_preferences').select('watchlist, tours').eq('user_id', userId).single();
  check(!row.error && row.data.watchlist?.[0] === 'f17-a' && row.data.tours?.home === true, 'the stored row holds both fields (read as the owner)');
  // Least privilege: service_role holds no grant on this table.
  const privileged = await admin.from('user_preferences').select('user_id').eq('user_id', userId);
  check(Boolean(privileged.error), 'service_role cannot read preferences');

  // 2. Intro video: the route needs an internal admin, set here as trusted server access.
  const promoted = await admin.from('user_profiles').update({ role: 'admin' }).eq('user_id', userId);
  if (promoted.error) throw new Error(`promote failed: ${promoted.error.message}`);
  const video = Buffer.from(`F17 local upload ${Date.now()}`);
  const signedUrl = await call(handleMarketingMediaApi, 'POST', '/api/marketing/intro-video/upload-url', token,
    { contentType: 'video/mp4', bytes: video.length });
  check(signedUrl.status === 200 && signedUrl.body?.token, `POST upload-url → ${signedUrl.status}`);
  // The browser's step: upload straight to Storage with the signed token.
  const up = await anon.storage.from(signedUrl.body.bucket)
    .uploadToSignedUrl(signedUrl.body.path, signedUrl.body.token, video, { contentType: 'video/mp4' });
  check(!up.error, `upload to the signed URL${up.error ? `: ${up.error.message}` : ''}`);
  const fin = await call(handleMarketingMediaApi, 'POST', '/api/marketing/intro-video/finalize', token, { path: signedUrl.body.path });
  check(fin.status === 200 && fin.body?.bytes === video.length, `POST finalize → ${fin.status}, ${fin.body?.bytes} bytes`);
  const pub = await fetch(fin.body?.videoUrl || 'http://127.0.0.1:1/');
  const served = Buffer.from(await pub.arrayBuffer());
  check(pub.ok && served.equals(video), 'the public URL serves the uploaded bytes');
  const del = await call(handleMarketingMediaApi, 'DELETE', '/api/marketing/intro-video', token);
  check(del.status === 200, `DELETE → ${del.status}`);
  const gone = await admin.storage.from(signedUrl.body.bucket).info(signedUrl.body.path);
  check(Boolean(gone.error), 'the object is removed');
} finally {
  await admin.auth.admin.deleteUser(userId);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
