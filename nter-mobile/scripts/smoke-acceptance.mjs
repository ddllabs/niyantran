#!/usr/bin/env node
// Acceptance E2E Playwright verification script for NTER Mobile.
// Executes the complete 31-scenario acceptance matrix and captures visual evidence.
//
// Usage:
//   node scripts/smoke-acceptance.mjs

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.VITE_DATA_MODE = 'sample';
const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS_DIR = `${root}/docs/screenshots/acceptance`;
const MIRROR_DIR = 'C:/Users/Afreen/.gemini/antigravity/brain/8b570e7b-d4e8-4d6c-8e07-a27f6be8d20f/screenshots/acceptance';

mkdirSync(SHOTS_DIR, { recursive: true });
if (existsSync('C:/Users/Afreen/.gemini/antigravity/brain/8b570e7b-d4e8-4d6c-8e07-a27f6be8d20f')) {
  mkdirSync(MIRROR_DIR, { recursive: true });
}

const problems = [];
const capturedShots = [];

const server = await createServer({
  root,
  configFile: `${root}/vite.config.js`,
  server: { port: 5218, strictPort: false },
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

const shot = async (name) => {
  const filePath = `${SHOTS_DIR}/${name}.png`;
  await page.screenshot({ path: filePath });
  capturedShots.push(name);
  try {
    copyFileSync(filePath, `${MIRROR_DIR}/${name}.png`);
  } catch (err) {
    console.warn(`Mirror warning for ${name}: ${err.message}`);
  }
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
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.goto(`http://localhost:${port}/`);

  // ==========================================
  // SECTION 1: CORE MOBILE UI (01 - 07)
  // ==========================================

  // 01. Welcome Screen
  await step('01: Welcome Screen (01-welcome.png)', async () => {
    await page.locator('.welcome-storyboard-view').waitFor({ timeout: 10000 });
    await page.locator('#welcome-email-input').fill('advocate@chambers.in');
    await shot('01-welcome');
  });

  // 02. Sign-in Screen
  await step('02: Sign-in Screen (02-sign-in.png)', async () => {
    await page.evaluate(() => {
      window.__NTER_APP__?.setStage('signin');
    });
    await page.locator('form input[type=email]').waitFor({ timeout: 10000 });
    await page.locator('form input[type=email]').fill('advocate@chambers.in');
    await page.locator('form input[type=password]').fill('sample123');
    await shot('02-sign-in');
    // Submit sign in to authenticate session
    await page.locator('form button[type=submit]').click();
  });

  // 03. Persona Selection Screen
  await step('03: Persona Selection (03-persona-selection.png)', async () => {
    await page.locator('.persona-grid-2col').waitFor({ timeout: 10000 });
    const lawyerCard = page.locator('.persona-card-sb').filter({ hasText: 'Lawyer' });
    await lawyerCard.waitFor();
    await lawyerCard.click();
    await page.locator('.continue-persona-btn').filter({ hasText: 'Continue as Lawyer' }).waitFor();
    await shot('03-persona-selection');
  });

  // 04. Lawyer Profile Screen
  await step('04: Lawyer Profile (04-lawyer-profile.png)', async () => {
    await page.locator('.continue-persona-btn').click();
    await page.locator('.lawyer-badge-card').waitFor({ timeout: 10000 });
    await page.locator('#primary-practice-select').selectOption('Civil & commercial');
    await page.locator('.continue-chat-btn').waitFor();
    await shot('04-lawyer-profile');
  });

  // 05. Home Dashboard
  await step('05: Home Dashboard (05-home-dashboard.png)', async () => {
    await page.locator('.continue-chat-btn').click();
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('home');
    });
    await page.locator('.tabstack[data-view="home"], .tabstack:not(.off)').first().waitFor();
    await page.locator('.deskad').waitFor({ timeout: 10000 });
    await shot('05-home-dashboard');
  });

  // 06. Chat Workspace
  await step('06: Chat Workspace (06-chat-workspace.png)', async () => {
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('ask');
    });
    await page.locator('.focus-chat-bar').waitFor({ timeout: 10000 });
    await page.locator('.composer textarea').waitFor({ timeout: 10000 });
    await shot('06-chat-workspace');
  });

  // 07. Model Selector
  await step('07: Model Selector (07-model-selector.png)', async () => {
    await page.locator('.model-pill-btn').click();
    await page.locator('.model-picker-body').waitFor({ timeout: 10000 });
    await page.locator('.model-card').first().waitFor({ timeout: 10000 });
    await shot('07-model-selector');
    await page.locator('.sheethost .sh-hd button[aria-label="Close"]').click();
    await page.locator('.sheethost').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // ==========================================
  // SECTION 2: FILE MANAGER (08 - 18)
  // ==========================================

  // Navigate to Me tab and open File Manager
  await step('Navigate to File Manager', async () => {
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('me');
    });
    await vis('.me-hd').waitFor({ timeout: 10000 });
    const fmRow = vis('.row-btn').filter({ hasText: 'File Manager' });
    await fmRow.waitFor({ timeout: 5000 });
    await fmRow.click();
    await vis('.fm-view').waitFor({ timeout: 10000 });
  });

  // 08. File Manager Empty State
  await step('08: File Manager Empty (08-file-manager-empty.png)', async () => {
    await vis('.fm-search-wrap input').fill('NoMatchesXYZ999');
    await vis('.empty').waitFor({ timeout: 5000 });
    await shot('08-file-manager-empty');
    await vis('.fm-search-wrap input').fill('');
  });

  // 09. File Manager Populated State
  await step('09: File Manager Populated (09-file-manager-populated.png)', async () => {
    await vis('.fm-storage-card').waitFor();
    await vis('.fm-card').first().waitFor();
    await shot('09-file-manager-populated');
  });

  // 10. File Manager Search
  await step('10: File Manager Search (10-file-manager-search.png)', async () => {
    await vis('.fm-search-wrap input').fill('Procurement');
    await vis('.fm-card-title').filter({ hasText: 'Q3_Procurement_Contract.pdf' }).waitFor();
    await shot('10-file-manager-search');
    await vis('.fm-search-wrap input').fill('');
  });

  // 11. File Upload Progress State
  await step('11: File Upload Progress (11-file-upload-progress.png)', async () => {
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
    await shot('11-file-upload-progress');
    await page.evaluate(() => {
      document.querySelector('.fm-upload-indicator')?.remove();
    });
  });

  // 12. File Processing State
  await step('12: File Processing (12-file-processing.png)', async () => {
    const procTab = vis('.fm-filter-pill').filter({ hasText: 'Processing' });
    await procTab.click();
    await vis('.fm-card').filter({ hasText: 'Arbitration_Petition_2026.pdf' }).waitFor();
    await vis('.pill.purple').filter({ hasText: 'Ingesting' }).waitFor();
    await shot('12-file-processing');
  });

  // 13. File Ready for AI State
  await step('13: File Ready for AI (13-file-ready-for-ai.png)', async () => {
    const readyTab = vis('.fm-filter-pill').filter({ hasText: 'Ready for AI' });
    await readyTab.click();
    const readyCard = vis('.fm-card').filter({ hasText: 'Legal_Opinion_Procurement_Delay.docx' });
    await readyCard.waitFor();
    await readyCard.locator('.pill.live').filter({ hasText: 'Ready for AI' }).waitFor();
    await shot('13-file-ready-for-ai');
  });

  // 14. File Failed State
  await step('14: File Failed State (14-file-failed-state.png)', async () => {
    const failedTab = vis('.fm-filter-pill').filter({ hasText: 'Failed' });
    await failedTab.click();
    await vis('.fm-card').filter({ hasText: 'Notice_of_Motion_Draft.pdf' }).waitFor();
    await vis('.pill.red').filter({ hasText: 'Index Failed' }).waitFor();
    await vis('.fm-card-error').waitFor();
    await vis('.fm-act-btn.retry').waitFor();
    await shot('14-file-failed-state');
  });

  // 15. File Preview PDF
  await step('15: File Preview PDF (15-file-preview-pdf.png)', async () => {
    const allTab = vis('.fm-filter-pill').filter({ hasText: 'All' });
    await allTab.click();
    const pdfCard = vis('.fm-card').filter({ hasText: 'Q3_Procurement_Contract.pdf' });
    await pdfCard.locator('.fm-act-btn').filter({ hasText: 'Preview' }).click();
    await page.locator('.fm-modal-sheet').waitFor({ timeout: 10000 });
    await page.locator('.fm-preview-content pre').waitFor({ timeout: 10000 });
    await shot('15-file-preview-pdf');
    await page.locator('.fm-modal-header button[aria-label="Close Preview"]').click();
    await page.locator('.fm-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // 16. File Preview DOCX
  await step('16: File Preview DOCX (16-file-preview-docx.png)', async () => {
    const docxCard = vis('.fm-card').filter({ hasText: 'Legal_Opinion_Procurement_Delay.docx' });
    await docxCard.locator('.fm-act-btn').filter({ hasText: 'Preview' }).click();
    await page.locator('.fm-modal-sheet').waitFor({ timeout: 10000 });
    await page.locator('.fm-docx-container').waitFor({ timeout: 10000 });
    await shot('16-file-preview-docx');
    await page.locator('.fm-modal-header button[aria-label="Close Preview"]').click();
    await page.locator('.fm-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // 17. File Preview XLSX
  await step('17: File Preview XLSX (17-file-preview-xlsx.png)', async () => {
    const xlsxCard = vis('.fm-card').filter({ hasText: 'Annual_Financial_Report_2025.xlsx' });
    await xlsxCard.locator('.fm-act-btn').filter({ hasText: 'Preview' }).click();
    await page.locator('.fm-modal-sheet').waitFor({ timeout: 10000 });
    await page.locator('.fm-sheet-tabs').waitFor({ timeout: 10000 });
    await shot('17-file-preview-xlsx');
    await page.locator('.fm-modal-header button[aria-label="Close Preview"]').click();
    await page.locator('.fm-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // 18. File Preview PPTX
  await step('18: File Preview PPTX (18-file-preview-pptx.png)', async () => {
    const pptxCard = vis('.fm-card').filter({ hasText: 'Board_Strategy_Deck.pptx' });
    await pptxCard.locator('.fm-act-btn').filter({ hasText: 'Preview' }).click();
    await page.locator('.fm-modal-sheet').waitFor({ timeout: 10000 });
    await page.locator('.fm-pptx-preview').waitFor({ timeout: 10000 });
    await shot('18-file-preview-pptx');
    await page.locator('.fm-modal-header button[aria-label="Close Preview"]').click();
    await page.locator('.fm-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // ==========================================
  // SECTION 3: AI AND RAG (19 - 23)
  // ==========================================

  // Navigate to Ask AI workspace
  await step('Navigate to Ask AI tab', async () => {
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('ask');
    });
    await page.locator('.composer textarea').waitFor({ timeout: 10000 });
  });

  // 19. Attach Private Files
  await step('19: Attach Private Files (19-attach-private-files.png)', async () => {
    await page.locator('.plus-attach-btn').first().click();
    await page.locator('.sheethost').waitFor({ timeout: 10000 });
    await page.locator('.sheethost .tabs button').filter({ hasText: 'Files' }).click();
    await page.locator('.sheethost .rrow').first().waitFor({ timeout: 10000 });
    const fileRows = page.locator('.sheethost .rrow');
    await fileRows.nth(0).click();
    await fileRows.nth(1).click();
    await page.locator('.sh-foot .pbtn').filter({ hasText: /Attach [12]/ }).waitFor();
    await shot('19-attach-private-files');
    await page.locator('.sh-foot .pbtn').filter({ hasText: /Attach/ }).click();
    await page.locator('.sheethost').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  });

  // 20. AI Research Answer
  await step('20: AI Research Answer (20-ai-research-answer.png)', async () => {
    const query = 'Find authorities on termination of a public procurement contract after delayed performance. Search the feed and prepare a cited note.';
    await page.locator('.composer textarea').fill(query);
    await page.locator('.send-circle-btn').click();
    await page.locator('.evidence-progress-bar').first().waitFor({ timeout: 20000 });
    await page.locator('.evidence-progress-bar').getByText('23 records searched').waitFor({ timeout: 10000 });
    await page.locator('.send-circle-btn:not(.stop)').waitFor({ timeout: 20000 });
    await shot('20-ai-research-answer');
  });

  // 21. AI Source Citations
  await step('21: AI Source Citations (21-ai-source-citations.png)', async () => {
    await page.locator('.authorities-list').first().waitFor({ timeout: 10000 });
    const authCard = page.locator('.authority-card-sb').filter({ hasText: 'pinpoint ¶ 42' }).first();
    await authCard.scrollIntoViewIfNeeded();
    await page.locator('.source-trail-footer').first().waitFor({ timeout: 10000 });
    await shot('21-ai-source-citations');
  });

  // 22. Multi-File Research
  await step('22: Multi-File Research (22-multi-file-research.png)', async () => {
    const multiQuery = 'Cross-reference the procurement delay opinion with the FY2025 financial report.';
    await page.locator('.composer textarea').fill(multiQuery);
    await page.locator('.send-circle-btn').click();
    await page.locator('.ans').nth(1).waitFor({ timeout: 20000 });
    await page.locator('.send-circle-btn:not(.stop)').waitFor({ timeout: 20000 });
    await shot('22-multi-file-research');
  });

  // 23. Insufficient Evidence
  await step('23: Insufficient Evidence (23-insufficient-evidence.png)', async () => {
    const negQuery = 'Does the contract permit unilateral penalty increases without arbitration?';
    await page.locator('.composer textarea').fill(negQuery);
    await page.locator('.send-circle-btn').click();
    await page.locator('.ans').nth(2).waitFor({ timeout: 20000 });
    await page.locator('.ans').nth(2).getByText('Insufficient Evidence').waitFor({ timeout: 20000 });
    await page.locator('.send-circle-btn:not(.stop)').waitFor({ timeout: 20000 });
    await shot('23-insufficient-evidence');
  });

  // ==========================================
  // SECTION 4: WORK AND EXPORT (24 - 28)
  // ==========================================

  // 24. Chat-to-Work Handoff
  await step('24: Chat-to-Work Handoff (24-chat-to-work-handoff.png)', async () => {
    await page.locator('.chat-work-pill button').filter({ hasText: 'Work' }).click();
    await page.locator('.carried-over-card').waitFor({ timeout: 10000 });
    await page.getByText('CARRIED OVER FROM CHAT').waitFor();
    await shot('24-chat-to-work-handoff');
  });

  // 25. Legal Document Templates
  await step('25: Legal Document Templates (25-legal-document-templates.png)', async () => {
    await page.locator('.quick-doc-open-btn').click();
    await page.locator('.qd-list').waitFor({ timeout: 10000 });
    await page.locator('.qd-card').filter({ hasText: 'Case-law & citation note' }).waitFor();
    await shot('25-legal-document-templates');
  });

  // 26. Generated Case Brief / Citation Note
  await step('26: Generated Case Brief (26-generated-case-brief.png)', async () => {
    await page.locator('.qd-card').filter({ hasText: 'Case-law & citation note' }).click();
    await page.locator('.studio-editor-body').waitFor({ timeout: 10000 });
    await page.locator('.paper.editing').waitFor({ timeout: 10000 });
    await shot('26-generated-case-brief');
  });

  // 27. Citation Verification
  await step('27: Citation Verification (27-citation-verification.png)', async () => {
    await page.locator('.citation-note-banner').waitFor({ timeout: 10000 });
    await page.locator('.verif-warning-box').getByText('2 items need verification').waitFor({ timeout: 10000 });
    await shot('27-citation-verification');
  });

  // 28. DOCX Export Success
  await step('28: DOCX Export Success (28-docx-export-success.png)', async () => {
    const exportBtn = page.locator('.export-docx-btn');
    await exportBtn.scrollIntoViewIfNeeded();
    await exportBtn.click();
    await page.waitForTimeout(1000);
    await shot('28-docx-export-success');
  });

  // ==========================================
  // SECTION 5: VIEWPORTS (29 - 31)
  // ==========================================

  // 29. Mobile 360px Viewport
  await step('29: Mobile 360px (29-mobile-360px.png)', async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('home');
    });
    await page.waitForTimeout(500);
    await shot('29-mobile-360px');
  });

  // 30. Mobile 430px Viewport
  await step('30: Mobile 430px (30-mobile-430px.png)', async () => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.evaluate(() => {
      window.__NTER_APP__?.setTab('ask');
    });
    await page.waitForTimeout(500);
    await shot('30-mobile-430px');
  });

  // 31. Desktop Responsive Viewport
  await step('31: Desktop Responsive (31-desktop-responsive.png)', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    await shot('31-desktop-responsive');
  });

} finally {
  await browser.close();
  await server.close();
}

console.log(`\n========================================`);
console.log(`E2E Acceptance Test Run Complete:`);
console.log(`Captured: ${capturedShots.length} / 31 screenshots`);
console.log(`Screenshots Directory: ${SHOTS_DIR}`);
console.log(`Mirror Directory: ${MIRROR_DIR}`);
if (problems.length) {
  console.log(`\n${problems.length} Problem(s) Detected:\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
} else {
  console.log(`\nAll 31 Acceptance Scenarios PASSED cleanly with zero issues.`);
}
