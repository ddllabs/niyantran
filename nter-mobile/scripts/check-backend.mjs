#!/usr/bin/env node
// Checks the nter.pro backend the way the app uses it, and prints PASS / FAIL for each call.
//
//   npm run check:backend                              public feeds only (no sign-in)
//   NTER_EMAIL=you@example.com npm run check:backend   also your account (asks for the password)
//   ... npm run check:backend -- --ask                 also one short AI answer (uses ~ a few hundred credits)
//
// Everything is read-only except what signing in itself records, and --ask, which is one normal
// question (it is saved to your conversations, like any question on nter.pro).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
const API = (process.env.VITE_API_BASE || 'https://www.nter.pro').replace(/\/$/, '');
const ASK = process.argv.includes('--ask');

const results = [];
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t;
    results.push({ name, ok: true });
    console.log(`${green('PASS')}  ${name.padEnd(44)} ${String(detail ?? '').slice(0, 90)} ${dim(`${ms} ms`)}`);
    return true;
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`${red('FAIL')}  ${name.padEnd(44)} ${String(e?.message || e).slice(0, 120)} ${dim(`${Date.now() - t} ms`)}`);
    return false;
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

async function getJson(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  const body = await res.json().catch(() => null);
  must(res.ok, `HTTP ${res.status}`);
  return body;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const desks = JSON.parse(readFileSync(new URL('../src/sample/desks.json', import.meta.url), 'utf8'));

console.log(`\nnter.pro backend check · ${new Date().toLocaleString('en-IN')}\nAPI ${API} · Supabase ${SUPABASE_URL}\n`);
console.log(dim('Public feeds (no sign-in)'));

let billRow = null;
await check('nter.news feed  /api/home/latest', async () => {
  const b = await getJson('/api/home/latest', { limit: 24 });
  const rows = (b?.rows || []).filter((r) => r.title);
  must(rows.length > 0, 'no stories');
  return `${rows.length} stories · newest ${rows[0].pub || rows[0].published_at || '?'}`;
});
await check('markets  /api/home/markets', async () => {
  const b = await getJson('/api/home/markets');
  must(b?.rows?.length > 0, 'no quotes');
  return `${b.rows.length} quotes · ${b.rows.slice(0, 3).map((r) => `${r.name} ${r.last}`).join(' · ')}`;
});
await check('landing figures  /api/site-figures', async () => {
  const b = await getJson('/api/site-figures');
  must(Number.isInteger(b?.bills), 'no bill count');
  return `${b.bills} bills · ${b.ministries ?? '?'} ministries`;
});
await check('paged module  Bill Passage Probability Index', async () => {
  const b = await getJson('/api/feature-feed', { tier: 'national', feature: 'Bill Passage Probability Index', page: 1 });
  must(b?.paged && b.rows?.length, 'no paged rows');
  billRow = b.rows.find((r) => r.status !== 'source_status') || null;
  return `${b.total} records · page 1 has ${b.rows.length}`;
});
for (const d of desks) {
  const m = d.groups[0]?.modules[0];
  if (!m) continue;
  await check(`${d.name} desk  ${m.title}`.slice(0, 44), async () => {
    const b = await getJson('/api/feature-feed', { tier: m.tier, feature: m.feature });
    const rows = (b?.rows || []).filter((r) => r.status !== 'source_status');
    must(b?.ok !== false, b?.error || 'not ok');
    must(rows.length > 0, 'no rows (the app would show its saved copy)');
    return `${rows.length} rows${b.source?.adapter ? ` · ${b.source.adapter}` : ''}`;
  });
}

const email = process.env.NTER_EMAIL;
if (email) {
  console.log(dim(`\nYour account (${email})`));
  const password = process.env.NTER_PASSWORD || await askHidden('nter.pro password (not shown, not saved): ');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let token = null;
  const signedIn = await check('sign in', async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    must(!error, error?.message);
    token = data.session.access_token;
    return `user ${data.user.id.slice(0, 8)}…`;
  });
  if (signedIn) {
    await check('profile  rpc get_my_profile', async () => {
      const { data, error } = await sb.rpc('get_my_profile');
      must(!error, error?.message);
      const p = Array.isArray(data) ? data[0] : data;
      must(p, 'no profile');
      must(!p.status || p.status === 'active', `status ${p.status}`);
      return `persona ${p.persona || '(not set)'} · status ${p.status || 'active'}`;
    });
    await check('plan  rpc my_entitlement_manual', async () => {
      const { data, error } = await sb.rpc('my_entitlement_manual');
      must(!error, error?.message);
      const e = Array.isArray(data) ? data[0] : data;
      return `plan ${e?.plan || 'free'} · ${e?.status || '-'}${e?.lapsed ? ' · lapsed' : ''}`;
    });
    await check('credits  rpc my_credits_cycle_v3', async () => {
      const { data, error } = await sb.rpc('my_credits_cycle_v3');
      must(!error, error?.message);
      const c = Array.isArray(data) ? data[0] : data;
      return `balance ${c?.balance} · held ${c?.held} · allowance ${c?.cycle?.allowance ?? '-'}`;
    });
    await check('models  ai_models + estimates', async () => {
      const [m, e] = await Promise.all([sb.from('ai_models').select('model_id,label,min_plan,is_default').eq('enabled', true), sb.rpc('model_credit_estimates')]);
      must(!m.error, m.error?.message);
      must(m.data.length > 0, 'no models');
      return `${m.data.length} models · default ${m.data.find((x) => x.is_default)?.label || '?'} · ${e.data?.length ?? 0} estimates`;
    });
    await check('conversations  (your own)', async () => {
      const { data, error } = await sb.from('conversations').select('id,title,last_message_at').order('last_message_at', { ascending: false, nullsFirst: false }).limit(5);
      must(!error, error?.message);
      return `${data.length} shown · latest “${(data[0]?.title || '-').slice(0, 40)}”`;
    });
    await check('watchlist  user_preferences', async () => {
      const { data, error } = await sb.from('user_preferences').select('watchlist').maybeSingle();
      must(!error, error?.message);
      return `${Array.isArray(data?.watchlist) ? data.watchlist.length : 0} modules (none saved yet = website default)`;
    });
    await check('record search  rpc search_desk_rows', async () => {
      const { data, error } = await sb.rpc('search_desk_rows', { p_tier: 'national', p_feature: null, p_query: 'tribunal', p_filters: {}, p_limit: 3 });
      must(!error, error?.message);
      return `${data?.length ?? 0} matches for “tribunal”`;
    });
    if (billRow) {
      await check('AI brief  desk-brief (read only)', async () => {
        const row = Object.fromEntries(Object.entries(billRow).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [k, String(v).slice(0, 2000)]));
        const res = await fetch(`${SUPABASE_URL}/functions/v1/desk-brief`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
          body: JSON.stringify({ scope: 'record', tier: 'national', feature: 'Bill Passage Probability Index', row, mode: 'read' }),
          signal: AbortSignal.timeout(25000),
        });
        const b = await res.json().catch(() => null);
        must(res.ok, `HTTP ${res.status} ${b?.error || ''}`);
        return `state ${b?.state} (ready or missing are both fine)`;
      });
    }
    if (ASK) {
      await check('AI answer  research-chat (uses credits)', async () => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/research-chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream', apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: 'Backend check from the nter.pro app: reply with one short sentence naming any one desk.', turn_key: `check-${Date.now()}`, reasoning: 'low', focus: 'broad' }),
          signal: AbortSignal.timeout(120000),
        });
        must(res.ok, `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
        const text = await res.text();
        const frames = text.split('\n\n').map((b) => b.replace(/^data: ?/gm, '')).filter((p) => p && p !== '[DONE]').map((p) => { try { return JSON.parse(p); } catch { return null; } }).filter(Boolean);
        const answer = frames.filter((f) => typeof f.chunk === 'string').map((f) => f.chunk).join('');
        const err = frames.find((f) => typeof f.error === 'string');
        const credits = frames.find((f) => 'credits' in f && Object.keys(f).length === 1)?.credits;
        must(!err, err?.error);
        must(frames.some((f) => f.done), 'no done frame');
        return `${answer.trim().slice(0, 50)}… · ${credits ?? '?'} credits`;
      });
    }
    await sb.auth.signOut({ scope: 'local' });
  }
} else {
  console.log(dim('\nSet NTER_EMAIL=you@example.com to also check sign-in, credits, conversations and briefs.'));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? red(`${failed} of ${results.length} checks failed`) : green(`All ${results.length} checks passed`)}\n`);
process.exit(failed ? 1 : 0);
