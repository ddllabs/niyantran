#!/usr/bin/env node
// End-to-end smoke test of the whole app on the bundled sample (no network): every tab, the
// desk → module → desk card path (NTER animation, then the website's card), Quick Exit → Make → Studio → PDF and Word export, Ask AI with a
// cited answer, history, Me, plans and the dark theme. Fails on any page error.
//
//   npm run test:smoke        (SMOKE_SHOTS=folder to keep screenshots)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.VITE_DATA_MODE = 'sample';
const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SMOKE_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const problems = [];

const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
await context.route(/^https?:\/\/(?!localhost)/, (route) => { problems.push(`network call in sample mode: ${route.request().url()}`); return route.abort(); });
const vis = (sel) => page.locator(`.tabstack:not(.off) .layer:not(.under) ${sel}`);
const tab = (name) => vis('.tabbar button').filter({ hasText: new RegExp(`^${name}$`) }).click();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const step = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); } catch (e) { problems.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
};

try {
  await page.goto('http://localhost:5198/');
  await step('welcome page with figures', async () => { await page.getByText('THE RECORD, AT A GLANCE').waitFor(); await shot('01-welcome'); });
  await step('sign in (simulated in sample mode)', async () => {
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.fill('input[type=email]', 'reader@example.com');
    await page.fill('input[type=password]', 'secret123');
    await page.locator('form button[type=submit]').click();
    await page.getByRole('button', { name: /Continue as/ }).click();
    await vis('.feed-hd').waitFor();
  });
  await step('home: feed, desks, markets, watchlist', async () => {
    await vis('.leadst').waitFor();
    await vis('.deskcar .dcard').first().waitFor();
    await vis('.mkt div').first().waitFor();
    await vis('.watch button').first().waitFor();
    await shot('02-home');
  });
  await step('story page', async () => {
    await vis('.leadst').click();
    await vis('.stbody .dek').waitFor();
    await vis('.sthero button[aria-label="Back"]').click();
  });
  await step('search finds modules and records', async () => {
    await vis('button[aria-label="Search"]').first().click();
    await vis('input[type=search]').fill('tribunal');
    await vis('.rrow').first().waitFor();
    await vis('.hdr button').filter({ hasText: 'Cancel' }).click();
  });
  await step('library → desk → sector → module', async () => {
    await tab('Library');
    await vis('.dtile').first().click();
    await vis('.scard').first().click();
    await vis('.mod').first().click();
    await vis('.rrow').first().waitFor();
    await shot('03-module');
  });
  await step('desk card: NTER animation, then the website card with its AI brief', async () => {
    await vis('.rrow .ib').first().click();
    await vis('.rrow button').first().click();
    await vis('nter-record-loader').waitFor();
    await shot('04a-animation');
    await vis('.rp .rp-eyebrow').filter({ hasText: '01 · At a glance' }).waitFor({ timeout: 8000 });
    await vis('.rp-brief .rd-ai-brief').first().waitFor({ timeout: 8000 });
    await vis('.rp-tiles .rp-tile').first().waitFor();
    await shot('04-record');
  });
  await step('record PDF download', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), vis('.actbar button[aria-label="Download as PDF"]').click()]);
    const file = `${root}/node_modules/.smoke-record.pdf`;
    await dl.saveAs(file);
    if (statSync(file).size < 1000) throw new Error('PDF too small');
  });
  await step('Quick Exit → Make → Studio', async () => {
    await vis('.actbar .pbtn.dark').click();
    await page.locator('.qcard').first().click();
    await vis('.makebar .go').click();
    await vis('.exitbar .p').waitFor({ timeout: 10000 });
    await shot('05-made');
    await vis('.exitbar .p').click();
    await vis('.paper').waitFor();
    await shot('06-studio');
  });
  await step('Studio exports PDF and Word', async () => {
    for (const label of ['PDF', 'Word']) {
      const [dl] = await Promise.all([page.waitForEvent('download'), vis('.signbar button').filter({ hasText: label }).click()]);
      const file = `${root}/node_modules/.smoke-${label}`;
      await dl.saveAs(file);
      if (statSync(file).size < 1000) throw new Error(`${label} too small`);
    }
  });
  await step('Ask AI answers with a citation', async () => {
    await vis('.segc button').filter({ hasText: 'AI chat' }).click();
    await vis('.composer textarea').fill('What does this record say?');
    await vis('.composer .send').click();
    await vis('.ans button.cite').first().waitFor({ timeout: 10000 });
    await vis('.ans button.cite').first().click();
    await page.locator('.sheethost .docpage').waitFor();
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await shot('07-answer');
  });
  await step('model and focus sheets', async () => {
    await vis('.composer .model').click();
    await page.locator('.sheethost .opt').first().waitFor();
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await vis('.toolrow .setchip').first().click();
    await page.locator('.sheethost .opt').first().waitFor();
    await page.locator('.sheethost .sh-foot .pbtn').click();
  });
  await step('history drawer lists the conversation', async () => {
    await vis('.askhd .ib').click();
    await page.locator('.sheethost .thread').first().waitFor();
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
  });
  await step('Me, plans and dark theme', async () => {
    await tab('Me');
    await vis('.plan').waitFor();
    await vis('.plan .foot button').click();
    await page.locator('.sheethost .plancard').first().waitFor();
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await vis('.segs button').filter({ hasText: 'Dark' }).click();
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('theme did not switch');
    await shot('08-me-dark');
  });
  await step('sign out returns to the welcome page', async () => {
    await vis('.row-btn').filter({ hasText: 'Sign out' }).click();
    await page.getByText('Open the terminal').first().waitFor();
  });
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
}
console.log('\nSample-mode smoke test passed.');
