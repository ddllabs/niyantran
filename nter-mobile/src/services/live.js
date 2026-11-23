// The live service: the same backend nter.pro runs on. Sign-in, profile, plan, credits,
// conversations and the watchlist go through Supabase with the member's own session (row-level
// security decides what they can read and change); desks and the news feed come from
// www.nter.pro's public /api routes; answers come from the research-chat edge function.
// Nothing here uses a server secret.
import { supabase, accessToken } from '../lib/supabaseClient.js';
import { apiGet, HttpError } from '../lib/http.js';
import { functionsUrl, SUPABASE_KEY, STREAM_CHAT, API_BASE } from '../lib/config.js';
import { readSseFrames } from '../lib/sse.js';
import { isNative } from '../lib/platform.js';
import { PAGED_FEATURES, DESKS } from '../data/desks.js';
import { pickColumns, rowTitle, mergeFigures, SITE_FIGURES } from './shape.js';
import * as sample from './sample.js';

const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
const fail = (error, fallback) => { if (error) throw new Error(error.message || fallback); };

// ---------- auth ----------
export const mode = 'live';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session || null));
  return () => data?.subscription?.unsubscribe?.();
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid login/i.test(error.message) ? 'Email or password is incorrect.' : error.message);
  return data.session;
}

export async function signUp({ email, password, firstName, lastName, persona }) {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { name, first_name: firstName || '', last_name: lastName || '', personaId: persona?.id || null, plan: 'free' } },
  });
  if (error) throw new Error(error.message);
  // With email confirmation on, there is a user but no session until the link is opened.
  return { session: data.session || null, needsConfirmation: !data.session };
}

export async function resendConfirmation(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
  fail(error, 'Could not resend the email.');
}

export async function forgotPassword(email) {
  // The reset form lives on the website; the link opens there on any device.
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${API_BASE}/#reset-password` });
  fail(error, 'Could not send the reset email.');
}

export const OAUTH_REDIRECT = 'pro.nter.app://auth/callback';

export async function signInWithGoogle() {
  const redirectTo = isNative() ? OAUTH_REDIRECT : window.location.origin;
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: isNative() } });
  fail(error, 'Google sign-in is unavailable.');
  if (isNative() && data?.url) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: data.url, presentationStyle: 'popover' });
  }
}

// Called by the app when the OS hands it pro.nter.app://auth/callback?code=…
export async function completeOAuth(url) {
  const code = new URL(url).searchParams.get('code');
  if (!code) return null;
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  fail(error, 'Sign-in could not be completed.');
  try { (await import('@capacitor/browser')).Browser.close(); } catch { /* already closed */ }
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut({ scope: 'local' });
}

// ---------- profile, plan, credits, models ----------
export async function getProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');
  fail(error, 'Could not load your profile.');
  return one(data);
}

export async function setPersona(db) {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) throw new Error('Sign in first.');
  const { error } = await supabase.from('user_profiles').update({ persona: db }).eq('user_id', uid);
  fail(error, 'Could not save your role.');
}

export async function getEntitlement() {
  const { data, error } = await supabase.rpc('my_entitlement_manual');
  fail(error, 'Could not load your plan.');
  return one(data);
}

export async function getCredits() {
  const { data, error } = await supabase.rpc('my_credits_cycle_v3');
  fail(error, 'Could not load your credits.');
  return one(data);
}

export async function getModels() {
  const [models, estimates] = await Promise.all([
    supabase.from('ai_models').select('model_id,label,vendor,tier,efforts,params,is_default,sort_order,min_plan').eq('enabled', true).order('sort_order'),
    supabase.rpc('model_credit_estimates'),
  ]);
  fail(models.error, 'Could not load the AI models.');
  const cost = new Map((estimates.data || []).map((e) => [e.model_id, e.credits]));
  return (models.data || []).map((m) => ({ ...m, credits: cost.get(m.model_id) ?? null }));
}

// ---------- news and markets (public) ----------
export async function homeLatest({ signal } = {}) {
  try {
    const body = await apiGet('/api/home/latest', { limit: 24 }, { signal, timeoutMs: 12000 });
    const rows = Array.isArray(body?.rows) ? body.rows.filter((r) => r?.title) : [];
    if (rows.length) return { rows, asOf: body.as_of || body.updated || null, fallback: false };
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  return { ...(await sample.homeLatest()), fallback: true };
}

export async function homeMarkets({ signal } = {}) {
  try {
    const body = await apiGet('/api/home/markets', {}, { signal, timeoutMs: 12000 });
    if (Array.isArray(body?.rows) && body.rows.length) return { rows: body.rows, asOf: body.as_of || null, fallback: false };
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  return { ...(await sample.homeMarkets()), fallback: true };
}

export async function siteFigures({ signal } = {}) {
  try { return mergeFigures(await apiGet('/api/site-figures', {}, { signal, timeoutMs: 8000 })); } catch { return SITE_FIGURES; }
}

// ---------- desks ----------
export async function moduleFeed({ module, page = 1, pageSize = 50, q = '', sort, dir, signal }) {
  const paged = PAGED_FEATURES.has(module.feature);
  const params = { tier: module.tier, feature: module.feature, ...(paged ? { page, ...(pageSize !== 50 ? { pageSize } : {}), q: q.trim(), sort, dir: dir === 'desc' ? 'desc' : undefined } : {}) };
  try {
    const body = await apiGet('/api/feature-feed', params, { signal, timeoutMs: 15000 });
    const rows = (Array.isArray(body?.rows) ? body.rows : []).filter((r) => r && r.status !== 'source_status');
    if (body && body.ok !== false && rows.length) {
      return {
        rows,
        columns: pickColumns(rows, body.columns),
        total: Number(body.total ?? body.totalAll ?? rows.length) || rows.length,
        paged: Boolean(body.paged), page: body.page || page, pageSize: body.pageSize || pageSize,
        source: body.source || null, coverage: body.coverage || null, asOf: body.fetchedAt || body.asOf || null,
        fallback: false,
      };
    }
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  const archived = await sample.moduleFeed({ module, page, pageSize, q });
  return { ...archived, fallback: true };
}

// Records across every desk that match the words (the site's command search).
export async function searchRecords(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const results = await Promise.allSettled(DESKS.map(async (d) => {
    const { data, error } = await supabase.rpc('search_desk_rows', { p_tier: d.id, p_feature: null, p_query: q, p_filters: {}, p_limit: 8 }).abortSignal(signal);
    if (error) throw error;
    return (data || []).filter((r) => r.tier === d.id).map((r) => ({ desk: d.id, tier: r.tier, feature: r.feature, rowKey: r.row_key, row: r.row || {}, title: rowTitle(r.row, r.feature) }));
  }));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ---------- record brief ----------
async function postFunction(name, body, { signal } = {}) {
  const token = await accessToken();
  const res = await fetch(functionsUrl(name), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${token || SUPABASE_KEY}` },
    body: JSON.stringify(body),
    signal,
  });
  return res;
}

// The row as nter.pro sends it for a record brief (website src/lib/deskBrief.js): whole when it fits
// the function's bound, so the server hashes it exactly as for the website and both read the same
// stored brief; else the slimmed entry (40 fields, 220 characters each).
const RECORD_ROW_BYTES = 30_000;
const cell = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 220));
function slimEntry(row) {
  const o = {};
  let n = 0;
  for (const [k, v] of Object.entries(row || {})) {
    if (/^__|backup_/i.test(k)) continue;
    o[k] = cell(v);
    n += 1;
    if (n >= 40) break;
  }
  return o;
}
export function recordPayloadRow(row) {
  try {
    if (new TextEncoder().encode(JSON.stringify(row)).length <= RECORD_ROW_BYTES) return row;
  } catch { /* not serialisable as is */ }
  return slimEntry(row);
}

export async function recordBrief({ module, row, generate = false, signal }) {
  const body = { scope: 'record', tier: module.tier, feature: module.feature, row: recordPayloadRow(row), ...(generate ? {} : { mode: 'read' }) };
  const res = await postFunction('desk-brief', body, { signal });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new HttpError(res.status, data?.error || 'The brief is unavailable.', data);
  return data; // { ok, state: ready|pending|missing|unavailable, brief, why, watch, tags, model, writtenAt }
}

// ---------- research chat ----------
// Sends one turn and calls onFrame for every frame. With VITE_STREAM_CHAT=1 (the function's
// ALLOWED_ORIGINS lists the app) frames stream as written; otherwise the native HTTP layer
// returns the whole stream at the end, and the frames are replayed in order.
export async function sendTurn(body, { onFrame, signal } = {}) {
  const token = await accessToken();
  if (!token) throw new HttpError(401, 'Sign in to ask the AI.');
  const doFetch = STREAM_CHAT && isNative() && window.CapacitorWebFetch ? window.CapacitorWebFetch : fetch;
  const res = await doFetch(functionsUrl('research-chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new HttpError(res.status, detail?.error || `The AI could not start (${res.status}).`, detail);
  }
  for await (const frame of readSseFrames(res, signal)) onFrame?.(frame);
}

export async function cancelTurn(conversationId) {
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id || !conversationId) return;
  await supabase.from('chat_cancellations').upsert({ conversation_id: conversationId, user_id: data.user.id, cancel_requested_at: new Date().toISOString() }, { onConflict: 'conversation_id' });
}

export async function listConversations() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) return [];
  const { data, error } = await supabase.from('conversations').select('id,title,created_at,last_message_at,web_search')
    .eq('user_id', u.user.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(40);
  fail(error, 'Could not load your conversations.');
  return data || [];
}

export async function getMessages(conversationId) {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('chat_messages')
    .select('id, role, content, sources, web_sources, follow_ups, activity, timing, model_requested, model_served, reasoning_effort, status, error_message, execution_expires_at, turn_key, created_at')
    .eq('conversation_id', conversationId).eq('user_id', u?.user?.id).order('created_at');
  fail(error, 'Could not load this conversation.');
  return data || [];
}

export async function renameConversation(id, title) {
  const { error } = await supabase.from('conversations').update({ title: String(title).trim().slice(0, 80) }).eq('id', id);
  fail(error, 'Could not rename.');
}

export async function deleteConversation(id) {
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  fail(error, 'Could not delete.');
}

// ---------- watchlist ----------
export async function getWatchlist() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) return null;
  const { data, error } = await supabase.from('user_preferences').select('watchlist').eq('user_id', u.user.id).maybeSingle();
  fail(error, 'Could not load your watchlist.');
  return Array.isArray(data?.watchlist) ? data.watchlist : null;
}

export async function saveWatchlist(list) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) return;
  const { error } = await supabase.from('user_preferences').upsert({ user_id: u.user.id, watchlist: list.slice(0, 24) }, { onConflict: 'user_id' });
  fail(error, 'Could not save your watchlist.');
}

export const pricingUrl = () => `${API_BASE}/#pricing`;

// ---------- file manager (live Supabase mode) ----------
export const STORAGE_TIER_QUOTA_BYTES = Object.freeze({
  free: 524_288_000,
  plus: 2_147_483_648,
  pro: 5_368_709_120,
  max: 53_687_091_200,
});

export async function listFiles({ filter = 'all', search = '' } = {}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.listFiles({ filter, search });
  }

  let query = supabase.from('user_files').select('*').eq('user_id', u.user.id);

  if (filter === 'trash') {
    query = query.not('deleted_at', 'is', null);
  } else {
    query = query.is('deleted_at', null);
  }

  const s = String(search || '').trim();
  if (s) {
    query = query.ilike('name', `%${s}%`);
  }

  if (filter === 'pdf') {
    query = query.or('mime_type.eq.application/pdf,name.ilike.%.pdf');
  } else if (filter === 'ready_for_ai') {
    query = query.in('index_status', ['indexed', 'ready_for_ai']);
  } else if (filter === 'processing') {
    query = query.in('index_status', ['indexing_queued', 'indexing_extracting', 'indexing_chunking']);
  } else if (filter === 'failed') {
    query = query.in('index_status', ['indexing_failed', 'failed']);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  fail(error, 'Could not load your files.');
  return data || [];
}

export async function uploadFile(file, onProgress) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.uploadFile(file, onProgress);
  }

  const MAX_SIZE = 52_428_800; // 50 MB
  if (file.size > MAX_SIZE) {
    throw new Error('This file exceeds the 50 MB upload limit.');
  }

  onProgress?.({ loaded: 0, total: file.size, percent: 5 });

  const isPdf = (file.type || '').toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const fileId = crypto.randomUUID();
  const safeName = encodeURIComponent(file.name.replace(/[/\\?%*:|"<>]/g, '_'));
  const storagePath = `${u.user.id}/${fileId}/${safeName}`;

  let sha256Hex = '';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    sha256Hex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    sha256Hex = `hash-${fileId}`;
  }

  onProgress?.({ loaded: Math.round(file.size * 0.2), total: file.size, percent: 20 });

  const { error: storageError } = await supabase.storage
    .from('user-files')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (storageError) {
    throw new Error(`Upload to storage failed: ${storageError.message}`);
  }

  onProgress?.({ loaded: Math.round(file.size * 0.8), total: file.size, percent: 80 });

  const { data: record, error: insertError } = await supabase
    .from('user_files')
    .insert({
      id: fileId,
      user_id: u.user.id,
      folder_id: null,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
      size_bytes: file.size,
      sha256: sha256Hex,
      upload_status: 'uploaded',
      index_status: isPdf ? 'indexing_queued' : 'unsupported',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    await supabase.storage.from('user-files').remove([storagePath]).catch(() => {});
    throw new Error(`Failed to record uploaded file: ${insertError.message}`);
  }

  onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
  return record;
}

export async function deleteFile(fileId) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.deleteFile(fileId);
  }
  const { error } = await supabase
    .from('user_files')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', fileId)
    .eq('user_id', u.user.id);
  fail(error, 'Could not delete file.');
  return { success: true };
}

export async function retryIndexing(fileId) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.retryIndexing(fileId);
  }
  const { error } = await supabase
    .from('user_files')
    .update({ index_status: 'indexing_queued', index_error: null, updated_at: new Date().toISOString() })
    .eq('id', fileId)
    .eq('user_id', u.user.id);
  fail(error, 'Could not retry indexing.');
  return { success: true };
}

export async function indexForAi(fileId) {
  return retryIndexing(fileId);
}

export async function getFilePreview(fileId) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.getFilePreview(fileId);
  }

  const { data: file, error } = await supabase
    .from('user_files')
    .select('*')
    .eq('id', fileId)
    .eq('user_id', u.user.id)
    .single();
  fail(error, 'Could not find file.');

  const { data: signed, error: signErr } = await supabase.storage
    .from('user-files')
    .createSignedUrl(file.storage_path, 60);

  return {
    file,
    url: signErr ? null : signed?.signedUrl,
    text: null,
  };
}

export const getFilePreviewUrl = getFilePreview;

export async function getStorageUsage() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) {
    return sample.getStorageUsage();
  }

  let plan = 'free';
  if (u?.user?.id) {
    try {
      const { data: ent } = await supabase.rpc('my_entitlement_manual');
      if (ent?.[0]?.plan) plan = ent[0].plan;
    } catch {
      // fallback
    }
  }

  const quotaBytes = STORAGE_TIER_QUOTA_BYTES[plan] || STORAGE_TIER_QUOTA_BYTES.free;
  let usedBytes = 0;

  if (u?.user?.id) {
    const { data: files } = await supabase
      .from('user_files')
      .select('size_bytes, upload_status')
      .eq('user_id', u.user.id)
      .is('deleted_at', null);

    if (Array.isArray(files)) {
      usedBytes = files.filter((f) => f.upload_status !== 'upload_failed').reduce((sum, f) => sum + (Number(f.size_bytes) || 0), 0);
    }
  }

  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  const percentUsed = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));

  const formatB = (b) => {
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return {
    plan,
    quotaBytes,
    usedBytes,
    remainingBytes,
    percentUsed,
    formattedUsed: formatB(usedBytes),
    formattedQuota: formatB(quotaBytes),
  };
}
