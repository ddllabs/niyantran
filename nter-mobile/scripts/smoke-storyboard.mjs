#!/usr/bin/env node
// End-to-end automated Storyboard verification script for NTER Mobile.
// Steps through the 8 client screens and captures visual evidence screenshots.
//
// Usage:
//   npm run test:storyboard
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.VITE_DATA_MODE = 'sample';
const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS_DIR = process.env.STORYBOARD_SHOTS || `${root}/docs/screenshots`;
mkdirSync(SHOTS_DIR, { recursive: true });
const problems = [];

const server = await createServer({
  root,
  configFile: `${root}/vite.config.js`,
  server: { port: 5199, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const port = server.httpServer.address().port;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
});
const page = await context.newPage();

page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
await context.route(/^https?:\/\/(?!localhost)/, (route) => {
  problems.push(`network call in sample mode: ${route.request().url()}`);
  return route.abort();
});

const shot = async (name) => {
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` });
};

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    const msg = e.message.split('\n')[0];
    problems.push(`${name}: ${msg}`);
    console.log(`FAIL  ${name}: ${msg}`);
  }
};

try {
  await page.goto(`http://localhost:${port}/`);

  // Screen 01: Welcome / Sign-in
  await step('Screen 01: Welcome / Sign-in', async () => {
    await page.locator('.welcome-storyboard-view').waitFor({ timeout: 10000 });
    await page.locator('#welcome-email-input').fill('advocate@chambers.in');
    await shot('01-welcome-signin');
    await page.locator('.continue-outcome-btn').click();
  });

  // Screen 02: Persona Selection
  await step('Screen 02: Persona Selection', async () => {
    await page.locator('.persona-grid-2col').waitFor({ timeout: 10000 });
    const lawyerCard = page.locator('.persona-card-sb').filter({ hasText: 'Lawyer' });
    await lawyerCard.waitFor();
    await lawyerCard.click();
    await page.locator('.continue-persona-btn').filter({ hasText: 'Continue as Lawyer' }).waitFor();
    await shot('02-persona-selection');
    await page.locator('.continue-persona-btn').click();
  });

  // Screen 03: Lawyer Profile
  await step('Screen 03: Lawyer Profile', async () => {
    await page.locator('.lawyer-badge-card').waitFor({ timeout: 10000 });
    await page.locator('#primary-practice-select').selectOption('Civil & commercial');
    await page.locator('.continue-chat-btn').waitFor();
    await shot('03-lawyer-profile');
    await page.locator('.continue-chat-btn').click();
  });

  // Screen 04: Chat Legal Focus
  await step('Screen 04: Chat Legal Focus', async () => {
    await page.locator('.focus-chat-bar').waitFor({ timeout: 10000 });
    await page.locator('.focus-dropdown-chip').filter({ hasText: 'Law' }).waitFor();
    await page.locator('.focus-dropdown-chip').filter({ hasText: 'Order archives' }).waitFor();
    await page.locator('.chat-empty-storyboard').waitFor();
    await shot('04-chat-focus');
  });

  // Screen 05: Model Selection
  await step('Screen 05: Model Selection', async () => {
    await page.locator('.model-pill-btn').click();
    await page.locator('.model-picker-body').waitFor({ timeout: 10000 });
    await page.locator('.model-card-sb').filter({ hasText: 'NYAI Pro' }).waitFor();
    await page.locator('.model-card-sb').filter({ hasText: 'NYAI Lite' }).waitFor();
    await shot('05-model-selection');
  });

  // Screen 06: Evidence Research
  await step('Screen 06: Evidence Research', async () => {
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await page.locator('.sheethost').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

    const query = 'Find authorities on termination of a public procurement contract after delayed performance. Search the feed and prepare a cited note.';
    await page.locator('.composer textarea').fill(query);
    await page.locator('.send-circle-btn').click();

    await page.locator('.evidence-progress-bar').waitFor({ timeout: 15000 });
    await page.locator('.evidence-progress-bar').getByText('23 records searched').waitFor();
    await page.locator('.authorities-list').waitFor({ timeout: 15000 });
    await page.locator('.authority-card-sb').filter({ hasText: 'Authority 01 · Supreme Court order' }).waitFor();
    await page.locator('.authority-card-sb').filter({ hasText: 'pinpoint ¶ 42' }).waitFor();
    await page.locator('.source-trail-footer').waitFor({ timeout: 15000 });
    await shot('06-evidence-research');
  });

  // Screen 07: Switch to Work
  await step('Screen 07: Switch to Work', async () => {
    await page.locator('.chat-work-pill button').filter({ hasText: 'Work' }).click();
    await page.locator('.carried-over-card').waitFor({ timeout: 10000 });
    await page.getByText('CARRIED OVER FROM CHAT').waitFor();
    await page.locator('.quick-doc-open-btn').click();
    await page.locator('.qd-list').waitFor({ timeout: 10000 });
    await shot('07-switch-to-work');
  });

  // Screen 08: Citation Note
  await step('Screen 08: Citation Note', async () => {
    await page.locator('.qd-card').filter({ hasText: 'Case-law & citation note' }).click();
    await page.locator('.citation-note-banner').waitFor({ timeout: 10000 });
    await page.getByText('Citation note ready').waitFor();
    await page.getByText(/7 of 9.*verified/).waitFor();
    await page.locator('.verif-warning-box').getByText('2 items need verification').waitFor();
    await page.locator('.export-docx-btn').waitFor();
    await shot('08-citation-note-docx');
  });
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
}
console.log(`\nStoryboard E2E test passed. Screenshots saved to ${SHOTS_DIR}`);
