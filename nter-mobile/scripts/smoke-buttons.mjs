#!/usr/bin/env node
// Every button, on every screen and sheet the app can reach, pressed once in a real browser on the
// bundled sample (no network). The crawler starts signed out on the welcome page and signed in on
// Home, presses each distinct button on the screen in front of it, and follows every button that
// leads somewhere new (up to MAX_DEPTH presses deep). It logs, per press, where the app went and
// anything that went wrong: page errors, console errors and warnings, failed requests, calls that
// would leave the phone, dialogs and downloads. The full log goes to test-results/buttons/.
//
//   npm run test:buttons            (BUTTONS_MAX_DEPTH=5, BUTTONS_MAX_STATES=120 to change the reach)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.VITE_DATA_MODE = 'sample';
const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${root}/test-results/buttons`;
mkdirSync(OUT, { recursive: true });
const MAX_DEPTH = Number(process.env.BUTTONS_MAX_DEPTH || 5);
const MAX_STATES = Number(process.env.BUTTONS_MAX_STATES || 120);
const PER_KIND = 2; // buttons of one kind in one list (rows, stories, chips): press the first two
const BASE = 'http://localhost:5196/';

// Console lines that are the browser's or the dev tools', not the app's.
const NOISE = [/React DevTools/, /\[vite\]/, /GroupMarkerNotSet|software WebGL|swiftshader|GL Driver Message|GPU stall/i, /Download the React DevTools/];

const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();

const log = []; // every press
const issues = []; // problems, each with the press that caused it
let current = { path: 'boot', button: '' };
const issue = (kind, detail) => issues.push({ kind, detail, at: current.path, button: current.button });
const opened = [];

page.on('pageerror', (e) => issue('page error', e.message));
page.on('console', (m) => {
  if (!['error', 'warning'].includes(m.type())) return;
  const t = m.text();
  if (NOISE.some((re) => re.test(t))) return;
  issue(`console ${m.type()}`, t.slice(0, 400));
});
page.on('requestfailed', (r) => { if (r.url().startsWith(BASE) && !/aborted/i.test(r.failure()?.errorText || '')) issue('request failed', `${r.url()} ${r.failure()?.errorText}`); });
page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) issue('http error', `${r.status()} ${r.url()}`); });
page.on('dialog', async (d) => { log.push({ path: current.path, button: current.button, dialog: `${d.type()}: ${d.message()}` }); await d.dismiss().catch(() => {}); });
page.on('filechooser', (fc) => { log.push({ path: current.path, button: current.button, filechooser: true }); fc.setFiles([]).catch(() => {}); });
// A file arrives a moment after its button: logged against the press in progress when it lands.
page.on('download', (d) => log.push({ path: current.path, button: current.button, download: d.suggestedFilename() }));
context.on('page', async (p) => { opened.push(p.url()); await p.close().catch(() => {}); });
await context.route(/^https?:\/\/(?!localhost)/, (route) => {
  // A link opened in a new page (an external site) is logged as opened, not as an app call.
  let fromApp = false;
  try { fromApp = route.request().frame().page() === page; } catch { fromApp = false; }
  if (fromApp) issue('network call in sample mode', route.request().url());
  return route.abort();
});

const ACTIVE = '.tabstack:not(.off) .layer:not(.under), .app > .view, .sheethost, .sheet, [role=dialog]';

/** Where the app is: the kind of screen in front (not its record or module), its section, and any open sheet. */
const signature = () => page.evaluate(() => {
  const sheet = document.querySelector('.sheethost [role=dialog]');
  const sheetName = sheet ? (sheet.getAttribute('aria-label') || sheet.querySelector('.sh-hd .t b, .sh-hd b')?.textContent || 'sheet').trim().slice(0, 30) : '';
  const top = [...document.querySelectorAll('.tabstack:not(.off) .layer:not(.under)')].pop();
  const app = document.querySelector('.app > .view');
  const appKind = () => (app.querySelector('.welcome') ? 'welcome'
    : (app.querySelector('.hdr .t')?.textContent || app.querySelector('form button[type=submit]')?.textContent || app.querySelector('h1, h2')?.textContent || 'screen').trim().slice(0, 30));
  const kind = top?.dataset.view || (app ? appKind() : '?');
  const tab = document.querySelector('.tabstack:not(.off) .tabbar button.on span')?.textContent || '';
  const seg = top?.querySelector('.segc button.on')?.textContent || '';
  const card = top?.querySelector('.rp') ? 'card' : top?.querySelector('nter-record-loader') ? 'animation' : '';
  return [tab, kind, seg, card, sheetName && `sheet:${sheetName}`].filter(Boolean).join(' › ');
});

/** The distinct buttons on the screen in front, each with a stable way to find it again. */
const buttons = () => page.evaluate((ACTIVE) => {
  // Layers are display: contents, so only the buttons themselves are checked for size.
  const roots = [...document.querySelectorAll(ACTIVE)];
  const sheetOpen = document.querySelector('.sheethost');
  const scope = sheetOpen ? [sheetOpen] : roots;
  const seen = new Map();
  const out = [];
  for (const r of scope) {
    for (const b of r.querySelectorAll('button, a[href], [role=tab], [role=button], summary')) {
      if (b.closest('.layer.under, .tabstack.off')) continue;
      const rect = b.getBoundingClientRect();
      if (!rect.width || !rect.height || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      const label = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const kind = `${b.tagName}.${(b.className && typeof b.className === 'string' ? b.className : '').split(' ').filter(Boolean).slice(0, 2).join('.')}`;
      const n = seen.get(kind) || 0;
      seen.set(kind, n + 1);
      const listy = b.parentElement && [...b.parentElement.children].filter((c) => c.tagName === b.tagName && c.className === b.className).length > 3;
      if (listy && n >= 2) continue;
      out.push({ label: label || kind, kind });
    }
  }
  // Each (label, kind) once.
  const uniq = new Map();
  for (const b of out) if (!uniq.has(`${b.kind}|${b.label}`)) uniq.set(`${b.kind}|${b.label}`, b);
  return [...uniq.values()];
}, ACTIVE);

async function press(b) {
  const sheetOpen = await page.locator('.sheethost').count();
  const loc = page.locator(`${sheetOpen ? '.sheethost' : `:is(${ACTIVE})`} :is(button, a[href], [role=tab], [role=button], summary)`);
  const all = await loc.all();
  for (const el of all) {
    const info = await el.evaluate((n) => ({
      label: (n.getAttribute('aria-label') || n.textContent || n.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      kind: `${n.tagName}.${(n.className && typeof n.className === 'string' ? n.className : '').split(' ').filter(Boolean).slice(0, 2).join('.')}`,
      hidden: Boolean(n.closest('.layer.under, .tabstack.off')) || !n.getBoundingClientRect().width,
    })).catch(() => null);
    if (!info || info.hidden) continue;
    if ((info.label || info.kind) === b.label && info.kind === b.kind) {
      // An <a> to another site is not followed: it would leave the app.
      const href = await el.getAttribute('href').catch(() => null);
      if (href && /^https?:/i.test(href) && !href.startsWith(BASE)) { log.push({ path: current.path, button: b.label, link: href }); return 'link'; }
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      try {
        await el.click({ timeout: 3000 });
      } catch (e) {
        // Moving targets (the labels orbiting the welcome globe) never hold still for the
        // actionability check; a finger can still tap them.
        if (!/Timeout/.test(e.message)) throw e;
        await el.click({ timeout: 3000, force: true });
      }
      return 'pressed';
    }
  }
  return 'gone';
}

/** A desk card plays the NTER animation (2.5 s) before its card and buttons exist: wait for it. */
async function settle() {
  const top = '.tabstack:not(.off) .layer:not(.under)';
  if (await page.locator(`${top} nter-record-loader`).count()) {
    await page.locator(`${top} .rp`).waitFor({ timeout: 10000 }).catch(() => issue('desk card did not open after the animation', page.url()));
    await page.waitForTimeout(200);
  }
}

let snapshot = {};
async function reset(signedIn) {
  // The page is on the app's origin: set its storage, then load the app once.
  if (!page.url().startsWith(BASE)) await page.goto(BASE);
  await page.evaluate(({ snap, signedIn }) => { localStorage.clear(); if (signedIn) for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v); }, { snap: snapshot, signedIn });
  await page.goto(BASE);
  await page.waitForSelector(signedIn ? '.tabstack:not(.off) .feed-hd' : 'text=Open the terminal', { timeout: 15000 });
  await page.waitForTimeout(150);
}

async function replay(start, path) {
  await reset(start === 'home');
  for (const b of path) {
    const r = await press(b);
    if (r !== 'pressed') throw new Error(`could not replay "${b.label}"`);
    await page.waitForTimeout(400);
    await settle();
  }
}

// Sign in once (simulated) and keep the device's storage, so every replay starts signed in.
await page.goto(BASE);
await page.getByRole('button', { name: 'Sign in' }).first().click();
await page.fill('input[type=email]', 'reader@example.com');
await page.fill('input[type=password]', 'secret123');
await page.locator('form button[type=submit]').click();
await page.getByRole('button', { name: /Continue as/ }).click();
await page.waitForSelector('.tabstack:not(.off) .feed-hd');
snapshot = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

const queue = [{ start: 'welcome', path: [] }, { start: 'home', path: [] }];
const states = new Map(); // signature → path that reached it
const pressedAt = new Set(); // signature|button
let presses = 0;

while (queue.length && states.size < MAX_STATES) {
  const { start, path } = queue.shift();
  try { await replay(start, path); } catch (e) { issue('replay', `${start} → ${path.map((b) => b.label).join(' → ')}: ${e.message}`); continue; }
  const sig = await signature();
  if (states.has(sig) && path.length) continue;
  states.set(sig, `${start} → ${path.map((b) => b.label).join(' → ')}`);
  await page.screenshot({ path: `${OUT}/${String(states.size).padStart(3, '0')}.png` }).catch(() => {});
  const list = await buttons();
  for (const b of list) {
    const key = `${sig}|${b.kind}|${b.label}`;
    if (pressedAt.has(key)) continue;
    pressedAt.add(key);
    // Each press starts from this screen as it was reached.
    if (presses && (await signature()) !== sig) {
      try { await replay(start, path); } catch (e) { issue('replay', e.message); break; }
    }
    current = { path: states.get(sig), button: b.label };
    const before = issues.length;
    let result;
    try {
      result = await press(b);
      if (result === 'gone') { await replay(start, path); result = await press(b); }
    } catch (e) { result = 'not pressable'; issue('press failed', `${b.label}: ${e.message.split('\n')[0]}`); }
    if (result === 'gone') issue('button not found again', b.label);
    presses += 1;
    await page.waitForTimeout(500);
    await settle();
    if (process.env.BUTTONS_VERBOSE) console.log(`${sig}  ▸  ${b.label}  →  ${result}`);
    if (presses % 25 === 0) console.log(`… ${presses} presses, ${states.size} screens, ${issues.length} issues`);
    const after = await signature().catch(() => '?');
    log.push({ from: sig, button: b.label, kind: b.kind, result, to: after, issues: issues.length - before });
    if (result === 'pressed' && after !== sig && !states.has(after) && path.length + 1 < MAX_DEPTH) queue.push({ start, path: [...path, b] });
  }
}

await browser.close();
await server.close();

writeFileSync(`${OUT}/report.json`, JSON.stringify({ states: Object.fromEntries(states), presses: log, opened, issues }, null, 2));
const lines = [
  `Screens and sheets reached: ${states.size}`,
  `Buttons pressed: ${presses}`,
  `Links to other sites (not followed): ${log.filter((l) => l.link).length}; pages opened: ${opened.length}`,
  `Downloads: ${log.filter((l) => l.download).length}; dialogs: ${log.filter((l) => l.dialog).length}`,
  `Issues: ${issues.length}`,
  ...issues.map((i) => `  - [${i.kind}] ${i.detail}\n      after "${i.button}" on ${i.at}`),
  '',
  'Screens:',
  ...[...states.entries()].map(([s, p]) => `  ${s}\n      via ${p}`),
];
writeFileSync(`${OUT}/report.txt`, `${lines.join('\n')}\n`);
console.log(lines.slice(0, 6 + issues.length).join('\n'));
console.log(`\nFull log: test-results/buttons/report.txt`);
process.exit(issues.length ? 1 : 0);
