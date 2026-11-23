#!/usr/bin/env node
// End-to-end smoke test of the LIVE build against a stand-in for nter.pro's backend.
//
// Every call the app makes to Supabase (auth, REST, RPC, edge functions) and to www.nter.pro/api is
// answered here with the shapes documented in docs/backend-contract.md, so the whole live code
// path — sign in, profile, models, feeds, record brief, an AI answer with citations, credits — runs
// in a real browser without touching the real backend. It also checks every request the app sends
// against research-chat's validation rules.
//
//   npm run build && node scripts/smoke-live-mock.mjs      (or: npm run test:smoke:live)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SB = 'https://vfgcppstyzjarlzyqdac.supabase.co';
const ANON = 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
const TOKEN = 'mock-member-token';
const sample = (f) => JSON.parse(readFileSync(new URL(`../src/sample/${f}`, import.meta.url), 'utf8'));
const SHOTS = process.env.SMOKE_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const problems = [];
const seen = [];
const briefModes = [];
const user = { id: '11111111-2222-3333-4444-555555555555', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const session = { access_token: TOKEN, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh', user };
const models = sample('ai-models.json');
const national = sample('modules-national.json')['national::Bill Passage Probability Index'];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const authed = (req) => (req.headers().authorization || '') === `Bearer ${TOKEN}`;

function checkResearchBody(b) {
  const bad = [];
  if (typeof b.message !== 'string' || !b.message.trim() || b.message.length > 4000) bad.push('message');
  if (typeof b.turn_key !== 'string' || !b.turn_key || b.turn_key.length > 64) bad.push('turn_key');
  if (!['attached', 'selection', 'desk', 'broad'].includes(b.focus)) bad.push('focus');
  if (b.reasoning != null && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(b.reasoning)) bad.push('reasoning');
  if (!Array.isArray(b.attachments) || b.attachments.length > 12) bad.push('attachments');
  for (const a of b.attachments || []) {
    if (!['row', 'record', 'file', 'document'].includes(a.kind) || !a.title) bad.push('attachment kind/title');
    if (a.kind !== 'document' && (!a.text || a.text.length > 40000)) bad.push('attachment text');
    for (const k of Object.keys(a)) if (!['kind', 'title', 'text', 'tier', 'feature', 'row_key', 'document_key', 'document_id'].includes(k)) bad.push(`attachment field ${k}`);
  }
  if (b.desk_context && !b.desk_context.tier) bad.push('desk_context.tier');
  if (b.conversation_id && !/^[0-9a-f-]{36}$/i.test(b.conversation_id)) bad.push('conversation_id');
  return bad;
}

const sse = (frames) => `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`;

async function installMocks(page) {
  await page.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    seen.push(`${req.method()} ${path}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' } });
    if (path === '/auth/v1/token') return json(route, session);
    if (path === '/auth/v1/user') return json(route, user);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path.startsWith('/rest/v1/')) {
      if (!authed(req) && path !== '/rest/v1/rpc/search_desk_rows') return json(route, { code: '42501', message: 'permission denied' }, 401);
      if (path === '/rest/v1/rpc/get_my_profile') return json(route, [{ user_id: user.id, email: user.email, first_name: 'Test', last_name: 'Member', persona: 'policy_analyst', status: 'active' }]);
      if (path === '/rest/v1/rpc/my_entitlement_manual') return json(route, [{ plan: 'free', status: 'active', lapsed: false }]);
      if (path === '/rest/v1/rpc/my_credits_cycle_v3') return json(route, { balance: 9400, held: 0, plan: 'free', cycle: { allowance: 10000, starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-31T00:00:00Z' }, used_this_cycle: 600, recent: [] });
      if (path === '/rest/v1/rpc/model_credit_estimates') return json(route, models.map((m) => ({ model_id: m.model_id, credits: 200, basis: 'mock' })));
      if (path === '/rest/v1/ai_models') return json(route, models);
      if (path === '/rest/v1/user_preferences') return req.method() === 'GET' ? json(route, null) : json(route, [], 201);
      if (path === '/rest/v1/conversations') return json(route, []);
      if (path === '/rest/v1/chat_cancellations') return json(route, [], 201);
      if (path === '/rest/v1/rpc/search_desk_rows') return json(route, []);
      problems.push(`unexpected REST call ${req.method()} ${path}`);
      return json(route, [], 200);
    }
    if (path === '/functions/v1/desk-brief') {
      if (!authed(req)) return json(route, { error: 'unauthorised' }, 401);
      const b = req.postDataJSON();
      if (b.scope !== 'record' || !b.tier || !b.feature || !b.row) problems.push('desk-brief body');
      briefModes.push(b.mode || 'write');
      if (b.mode === 'read') return json(route, { ok: true, state: 'missing' });
      return json(route, { ok: true, state: 'ready', format: 2, brief: 'Mock brief for the record on screen.', why: 'It matters for the test.', watch: 'Nothing.', tags: ['Test'], model: 'mock', writtenAt: new Date().toISOString() });
    }
    if (path === '/functions/v1/research-chat') {
      if (!authed(req)) return json(route, { error: 'unauthorised' }, 401);
      const b = req.postDataJSON();
      const bad = checkResearchBody(b);
      if (bad.length) problems.push(`research-chat body: ${bad.join(', ')}`);
      const first = (b.attachments || [])[0];
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
        body: sse([
          { conversation: { id: '9d0f3a1e-0000-4000-8000-000000000001' } },
          { reasoning: 'Reading the attached record' },
          { tool: { name: 'search_desk_rows', phase: 'start', step: 1 } },
          { tool: { name: 'search_desk_rows', phase: 'end', step: 1, count: 1 } },
          { model: { served: 'mock-model', label: 'Mock model' } },
          { chunk: '## Snapshot\nThe record is on the register [1].' },
          { chunk: ' It was introduced in Lok Sabha.' },
          { sources: [{ id: 1, kind: 'row', tier: 'national', feature: 'Bill Passage Probability Index', row_key: 'k1', title: first?.title || 'Record', row_snapshot: { house: 'Lok Sabha' }, snapshot_at: null }] },
          { followUpQuestions: ['What happens next?'] },
          { timing: { total_ms: 1200 }, usage: null },
          { done: { message_id: 'm-1' } },
          { credits: 187 },
        ]),
      });
    }
    problems.push(`unexpected Supabase call ${req.method()} ${path}`);
    return json(route, {}, 404);
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(`GET ${url.pathname}`);
    if (url.pathname === '/api/home/latest') {
      const live = sample('home-latest.json');
      return json(route, { ...live, rows: live.rows.map((r) => ({ ...r, img: 'https://nter.news/assets/uploads/mock.png' })) });
    }
    if (url.pathname === '/api/home/markets') return json(route, sample('home-markets.json'));
    if (url.pathname === '/api/site-figures') return json(route, { bills: 9819, documents: 3500, ministries: 56, fronts: 88 });
    if (url.pathname === '/api/feature-feed') {
      const feature = url.searchParams.get('feature');
      if (feature === 'Bill Passage Probability Index') {
        return json(route, { ok: true, tier: 'national', feature, paged: true, page: 1, pageSize: 100, total: 9819, columns: ['bill_name', 'house', 'sector', 'current_stage', 'date_introduced'], source: national.source, coverage: national.coverage, rows: national.rows });
      }
      return json(route, { ok: true, tier: url.searchParams.get('tier'), feature, rows: [] });
    }
    return json(route, { ok: false }, 404);
  });
  // The desk cards' analysis packs (website /data/…), proxied like /api.
  await page.route((u) => new URL(u).pathname.startsWith('/data/'), async (route) => {
    const url = new URL(route.request().url());
    seen.push(`GET ${url.pathname}`);
    return json(route, url.pathname.endsWith('ontology.json') ? { nodes: [], edges: [] } : {});
  });
  await page.route('https://nter.news/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex') }));
}

const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await installMocks(page);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const vis = (sel) => page.locator(`.tabstack:not(.off) .layer:not(.under) ${sel}`);
const step = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); } catch (e) { problems.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
};

try {
  await page.goto('http://localhost:5199/');
  await step('welcome page loads', async () => { await page.getByText('Open the terminal').first().waitFor({ timeout: 10000 }); await shot('01-welcome'); });
  await step('sign in with email and password', async () => {
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.fill('input[type=email]', 'tester@example.com');
    await page.fill('input[type=password]', 'not-a-real-password');
    await page.locator('form button[type=submit]').click();
    await vis('.tabbar').waitFor({ timeout: 10000 });
  });
  await step('home shows the live nter.news feed', async () => {
    await vis('.feed-hd').getByText('LIVE · LATEST').waitFor({ timeout: 10000 });
    await shot('02-home');
  });
  await step('model list loads after sign-in', async () => {
    await vis('.tabbar button').filter({ hasText: 'Ask AI' }).click();
    await vis('.composer .model .l').filter({ hasText: /Gemini|Claude|DeepSeek|GPT/ }).waitFor({ timeout: 10000 });
  });
  await step('desk → sector → module shows live rows', async () => {
    await vis('.tabbar button').filter({ hasText: 'Library' }).click();
    await vis('.dtile').first().click();
    await vis('.scard').first().click();
    await vis('.mod').first().click();
    await vis('.table-hd').getByText('9,819 RECORDS').waitFor({ timeout: 10000 });
    await shot('03-module');
  });
  await step('record opens as the desk card: NTER animation, then the brief is read and written', async () => {
    await vis('.rrow button').first().click();
    await vis('nter-record-loader').waitFor({ timeout: 5000 });
    await vis('.rp .rp-title').waitFor({ timeout: 10000 });
    await vis('.rp-brief').getByText('Mock brief for the record on screen.').waitFor({ timeout: 10000 });
    if (briefModes.join(',') !== 'read,write') throw new Error(`desk-brief calls were ${briefModes.join(',')}, expected read,write`);
    await vis('.rp-tiles .rp-tile').first().waitFor();
    await shot('04-record');
  });
  await step('Ask AI about the record returns a cited answer', async () => {
    await vis('.rp-ask').click();
    await vis('.composer textarea').fill('What stage is this bill at?');
    await vis('.composer .send').click();
    await vis('.ans .body-md').getByText('The record is on the register').waitFor({ timeout: 10000 });
    await vis('.ans button.cite').first().waitFor({ timeout: 5000 });
    await vis('.ans .meta').getByText(/187 CREDITS/).waitFor({ timeout: 5000 });
    await shot('05-answer');
  });
  await step('Me shows plan and credits', async () => {
    await vis('.tabbar button').filter({ hasText: /^Me$/ }).click();
    await vis('.plan').getByText('9,400').waitFor({ timeout: 10000 });
    await shot('06-me');
  });
} finally {
  await browser.close();
  await server.close();
}

for (const e of errors) problems.push(`page error: ${e}`);
const called = (p) => seen.some((s) => s.includes(p));
for (const p of ['/auth/v1/token', '/rest/v1/rpc/get_my_profile', '/rest/v1/ai_models', '/rest/v1/rpc/my_credits_cycle_v3', '/functions/v1/desk-brief', '/functions/v1/research-chat', '/api/home/latest', '/api/feature-feed', '/data/embedded_json/national_bill_analysis.json', '/data/ontology.json']) {
  if (!called(p)) problems.push(`never called ${p}`);
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
}
console.log(`\nLive-mode smoke test passed (${seen.length} backend calls checked).`);
