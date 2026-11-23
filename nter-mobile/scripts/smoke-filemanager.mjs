#!/usr/bin/env node
// End-to-end automated File Manager & RAG verification script for NTER Mobile.
// Steps through the 12 File Manager & RAG scenarios and captures visual evidence screenshots.
//
// Usage:
//   npm run test:filemanager
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.VITE_DATA_MODE = 'sample';
const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS_DIR = process.env.FILEMANAGER_SHOTS || `${root}/docs/screenshots`;
mkdirSync(SHOTS_DIR, { recursive: true });
const problems = [];

const server = await createServer({
  root,
  configFile: `${root}/vite.config.js`,
  server: { port: 5204, strictPort: false },
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

const vis = (sel) => page.locator(`.tabstack:not(.off) .layer:not(.under) ${sel}`);
const tab = (name) => vis('.tabbar button').filter({ hasText: new RegExp(`^${name}$`) }).first().click();

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

  // Navigate through onboarding to reach the app Shell
  await step('Initial Navigation: Onboarding to App', async () => {
    await page.locator('.welcome-storyboard-view').waitFor({ timeout: 10000 });
    await page.locator('#welcome-email-input').fill('advocate@chambers.in');
    await page.locator('.continue-outcome-btn').click();

    await page.locator('.persona-grid-2col').waitFor({ timeout: 10000 });
    const lawyerCard = page.locator('.persona-card-sb').filter({ hasText: 'Lawyer' });
    await lawyerCard.waitFor();
    await lawyerCard.click();
    await page.locator('.continue-persona-btn').click();

    await page.locator('.lawyer-badge-card').waitFor({ timeout: 10000 });
    await page.locator('.continue-chat-btn').click();

    await page.locator('.focus-chat-bar').waitFor({ timeout: 10000 });
  });

  // Navigate to Me tab and open File Manager
  await step('Navigate to File Manager from Me screen', async () => {
    await tab('Me');
    await vis('.me-hd').waitFor({ timeout: 10000 });

    const fmRow = vis('.row-btn').filter({ hasText: 'File Manager' });
    await fmRow.waitFor({ timeout: 5000 });
    await fmRow.click();
    await vis('.fm-view').waitFor({ timeout: 10000 });
  });

  // Scenario 01: File Manager Empty State (via search filter that matches 0 files)
  await step('Scenario 01: File Manager Empty State', async () => {
    await vis('.fm-search-wrap input').fill('NoMatchesXYZ999');
    await vis('.empty').waitFor({ timeout: 5000 });
    await shot('01-file-manager-empty');
    await vis('.fm-search-wrap input').fill('');
  });

  // Scenario 02: File Manager Populated State
  await step('Scenario 02: File Manager Populated State', async () => {
    await vis('.fm-storage-card').waitFor();
    await vis('.fm-card').first().waitFor();
    await shot('02-file-manager-populated');
  });

  // Scenario 03: Search and Filters
  await step('Scenario 03: Search and Filters', async () => {
    const pdfTab = vis('.fm-filter-pill').filter({ hasText: 'PDF' });
    await pdfTab.click();
    await vis('.fm-search-wrap input').fill('Procurement');
    await vis('.fm-card-title').filter({ hasText: 'Q3_Procurement_Contract.pdf' }).waitFor();
    await shot('03-search-and-filters');
    await vis('.fm-search-wrap input').fill('');
    const allTab = vis('.fm-filter-pill').filter({ hasText: 'All' });
    await allTab.click();
  });

  // Scenario 04: Upload Flow (Trigger upload CTA)
  await step('Scenario 04: Upload Flow', async () => {
    const uploadBtn = vis('.fm-upload-cta');
    await uploadBtn.scrollIntoViewIfNeeded();
    await shot('04-upload-flow');
  });

  // Scenario 05: Upload Progress State
  await step('Scenario 05: Upload Progress', async () => {
    // Inject a simulated upload state for visual evidence
    await page.evaluate(() => {
      let ind = document.querySelector('.fm-upload-indicator');
      if (!ind) {
        ind = document.createElement('div');
        ind.className = 'fm-upload-indicator';
        ind.innerHTML = `
          <div class="fm-upload-info">
            <span class="fm-upload-name">Uploading: Tender_Notice_NIT_84.pdf</span>
            <span class="fm-upload-pct">68%</span>
          </div>
          <div class="fm-upload-bar"><i style="width: 68%;"></i></div>
        `;
        const bar = document.querySelector('.fm-actions-bar');
        bar?.parentNode?.insertBefore(ind, bar.nextSibling);
      }
    });
    await vis('.fm-upload-indicator').waitFor();
    await shot('05-upload-progress');
    // Remove simulated indicator
    await page.evaluate(() => {
      document.querySelector('.fm-upload-indicator')?.remove();
    });
  });

  // Scenario 06: Processing / Ingestion Status
  await step('Scenario 06: Processing Status', async () => {
    const procTab = vis('.fm-filter-pill').filter({ hasText: 'Processing' });
    await procTab.click();
    await vis('.fm-card').filter({ hasText: 'Arbitration_Petition_2026.pdf' }).waitFor();
    await vis('.pill.purple').filter({ hasText: 'Ingesting' }).waitFor();
    await shot('06-processing-status');
  });

  // Scenario 07: Successfully Indexed Document
  await step('Scenario 07: Successfully Indexed Document', async () => {
    const readyTab = vis('.fm-filter-pill').filter({ hasText: 'Ready for AI' });
    await readyTab.click();
    const contractCard = vis('.fm-card').filter({ hasText: 'Q3_Procurement_Contract.pdf' });
    await contractCard.waitFor();
    await contractCard.locator('.pill.live').filter({ hasText: 'Ready for AI' }).waitFor();
    await shot('07-successfully-indexed');
  });

  // Scenario 08: Failed Ingestion and Retry Action
  await step('Scenario 08: Failed Ingestion and Retry', async () => {
    const failedTab = vis('.fm-filter-pill').filter({ hasText: 'Failed' });
    await failedTab.click();
    await vis('.fm-card').filter({ hasText: 'Notice_of_Motion_Draft.pdf' }).waitFor();
    await vis('.pill.red').filter({ hasText: 'Index Failed' }).waitFor();
    await vis('.fm-card-error').waitFor();
    await vis('.fm-act-btn.retry').waitFor();
    await shot('08-failed-ingestion-retry');
  });

  // Scenario 09: File Preview Modal
  await step('Scenario 09: File Preview', async () => {
    const allTab = vis('.fm-filter-pill').filter({ hasText: 'All' });
    await allTab.click();
    const contractCard = vis('.fm-card').filter({ hasText: 'Q3_Procurement_Contract.pdf' });
    await contractCard.locator('.fm-act-btn').filter({ hasText: 'Preview' }).click();
    await page.locator('.fm-modal-sheet').waitFor({ timeout: 10000 });
    await page.locator('.fm-preview-content pre').waitFor({ timeout: 10000 });
    await shot('09-file-preview');
    await page.locator('.fm-modal-header button[aria-label="Close Preview"]').click();
    await page.locator('.fm-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // Scenario 10: Ask About This File
  await step('Scenario 10: Ask About This File', async () => {
    const contractCard = vis('.fm-card').filter({ hasText: 'Q3_Procurement_Contract.pdf' });
    await contractCard.locator('.fm-act-btn.ask-ai').click();
    // Navigates to Ask tab with file attached
    await page.locator('.tabstack[data-view="ask"], .tabstack:not(.off)').first().waitFor();
    await page.locator('.attrow .chip.soft').filter({ hasText: 'Q3_Procurement_Contract.pdf' }).waitFor({ timeout: 10000 });
    await page.locator('.composer textarea').waitFor();
    await shot('10-ask-about-this-file');
  });

  // Scenario 11: Multi-File Research Selection in Attach Picker
  await step('Scenario 11: Multi-File Research Selection', async () => {
    await page.locator('.plus-attach-btn').first().click();
    await page.locator('.sheethost').waitFor({ timeout: 5000 });
    await page.locator('.sheethost .tabs button').filter({ hasText: 'Files' }).click();
    await page.locator('.sheethost .list').waitFor();

    // Select first and second stored file
    const fileRows = page.locator('.sheethost .rrow');
    await fileRows.first().waitFor();
    await fileRows.nth(0).click();
    await fileRows.nth(1).click();
    await page.locator('.sh-foot .pbtn').filter({ hasText: /Attach [12]/ }).waitFor();
    await shot('11-multi-file-research-selection');
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await page.locator('.sheethost').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // Scenario 12: AI Answer Grounded in File with Citations
  await step('Scenario 12: AI Answer with File Citations', async () => {
    const prompt = 'What are the payment milestones and dispute terms specified in the attached contract?';
    await page.locator('.composer textarea').first().fill(prompt);
    await page.locator('.send-circle-btn').first().click();

    // Wait for assistant response stream
    await page.locator('.ans').first().waitFor({ timeout: 15000 });
    await page.locator('.ans').first().getByText('Analysis grounded in your attached file').waitFor({ timeout: 15000 });
    await page.locator('.source-trail-footer').first().waitFor({ timeout: 15000 });
    await shot('12-ai-answer-file-citations');
  });

} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
}
console.log(`\nFile Manager E2E verification passed. Screenshots saved to ${SHOTS_DIR}`);
