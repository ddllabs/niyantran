#!/usr/bin/env node
import { createServer } from 'vite';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'qa', 'screenshots', 'step-1');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log('===============================================================');
console.log('🚀 NTER PHASE 2 / STEP 1: MOBILE SHELL VERIFICATION & SCREENSHOT HARNESS');
console.log('===============================================================\n');

// 1. Start Programmatic Vite Dev Server
const port = 5174;
console.log(`[1/4] Starting local Vite dev server on port ${port}...`);
const viteServer = await createServer({
  root,
  server: { port, host: '127.0.0.1' },
  configFile: path.resolve(root, 'vite.config.js'),
});
await viteServer.listen();
console.log(`  ✓ Vite server running at http://127.0.0.1:${port}\n`);

// 2. Launch Chrome Headless
console.log('[2/4] Launching Headless Chrome via CDP...');
const debugPort = 9224;
const userDataDir = 'C:\\Users\\Afreen\\AppData\\Local\\Temp\\chrome_qa_recovery';

const chromeProcess = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  'about:blank',
], { stdio: 'ignore' });

async function waitPort(retries = 35) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Chrome debugging port not available');
}

const version = await waitPort();
console.log(`  ✓ Chrome connected: ${version['User-Agent']}\n`);

const pagesRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
const pages = await pagesRes.json();
const targetPage = pages.find(p => p.type === 'page');

const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
let id = 1;
const pending = new Map();

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error)));
    else resolve(data.result);
  }
};

await new Promise(r => ws.onopen = r);

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const curId = id++;
    pending.set(curId, { resolve, reject });
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
}

await send('Page.enable');
await send('DOM.enable');
await send('Runtime.enable');

// Inject mock lawyer session into localStorage before any script runs
const sessionData = {
  id: 'usr_lawyer_step1',
  email: 'lawyer.step1@niyantran.internal',
  name: 'Advocate Raghavan',
  type: 'lawyer',
  active: true,
};

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try {
      localStorage.setItem('niy_session_user', JSON.stringify(${JSON.stringify(sessionData)}));
      localStorage.setItem('niy_user_type', 'lawyer');
      localStorage.setItem('niy_persona_id', 'lawyer');
      localStorage.setItem('niy_persona', 'lawyer');
      localStorage.setItem('niy_theme', 'light');
    } catch (e) {}
  `,
});

console.log('[3/4] Running responsive viewport and interaction tests...\n');

const testCases = [
  {
    name: 'step1-chat-375px',
    width: 375,
    height: 812,
    mode: 'chat',
    desc: 'iPhone 13 mini: MobileHeader in Chat mode',
  },
  {
    name: 'step1-work-375px',
    width: 375,
    height: 812,
    mode: 'work',
    desc: 'iPhone 13 mini: MobileHeader in Work mode with DocumentDraftingSurface',
  },
  {
    name: 'step1-drawer-open-375px',
    width: 375,
    height: 812,
    mode: 'drawer',
    desc: 'iPhone 13 mini: Hamburger drawer open over Chat',
  },
  {
    name: 'step1-chat-320px',
    width: 320,
    height: 568,
    mode: 'chat',
    desc: 'iPhone SE (320px): Minimum mobile viewport, zero overflow',
  },
  {
    name: 'step1-chat-360px',
    width: 360,
    height: 640,
    mode: 'chat',
    desc: 'Galaxy S8 (360px): Standard Android mobile viewport',
  },
  {
    name: 'step1-chat-390px',
    width: 390,
    height: 844,
    mode: 'chat',
    desc: 'iPhone 14 Pro (390px): Storyboard reference mobile viewport',
  },
  {
    name: 'step1-chat-414px',
    width: 414,
    height: 896,
    mode: 'chat',
    desc: 'iPhone XR/Plus (414px): Large mobile viewport',
  },
  {
    name: 'step1-chat-430px',
    width: 430,
    height: 932,
    mode: 'chat',
    desc: 'iPhone 15/16 Pro Max (430px): Max mobile viewport',
  },
  {
    name: 'step1-tablet-768px',
    width: 768,
    height: 1024,
    mode: 'chat',
    desc: 'iPad Mini (768px): Tablet breakpoint boundary',
  },
  {
    name: 'step1-desktop-1024px',
    width: 1024,
    height: 768,
    mode: 'desktop',
    desc: 'Small desktop/laptop (1024px): Desktop topbar active, mobile header hidden',
  },
  {
    name: 'step1-desktop-1280px',
    width: 1280,
    height: 800,
    mode: 'desktop',
    desc: 'Standard laptop (1280px): Desktop workbench layout',
  },
  {
    name: 'step1-desktop-1440px',
    width: 1440,
    height: 900,
    mode: 'desktop',
    desc: 'Full desktop workbench (1440px): Uncompromised desktop workbench',
  },
];

const results = [];

for (const tc of testCases) {
  process.stdout.write(`  📸 Capturing ${tc.name} (${tc.width}x${tc.height}) - ${tc.desc}... `);

  // Set device emulation viewport
  await send('Emulation.setDeviceMetricsOverride', {
    width: tc.width,
    height: tc.height,
    deviceScaleFactor: 2,
    mobile: tc.width < 768,
  });

  // Navigate to application
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/#/home` });
  await new Promise(r => setTimeout(r, 1200));

  // Open AI panel
  await send('Runtime.evaluate', {
    expression: `
      window.dispatchEvent(new CustomEvent('niy-ai-open'));
    `,
  });
  await new Promise(r => setTimeout(r, 500));

  if (tc.mode === 'work') {
    // Switch to Work mode
    await send('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new CustomEvent('niy-ai-mode', { detail: { mode: 'work' } }));
      `,
    });
    await new Promise(r => setTimeout(r, 600));
  } else if (tc.mode === 'drawer') {
    // Open hamburger drawer
    await send('Runtime.evaluate', {
      expression: `
        const btn = document.querySelector('[data-testid="mob-hamburger-btn"]') || document.querySelector('.nter-mob-hamburger');
        if (btn) btn.click();
      `,
    });
    await new Promise(r => setTimeout(r, 600));
  }

  // Check layout health metrics in page
  const healthCheck = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const hasHorizontalOverflow = docWidth > winWidth;
        const mobileHeader = document.querySelector('.nter-mobile-header');
        const mobileHeaderVisible = mobileHeader ? window.getComputedStyle(mobileHeader).display !== 'none' : false;
        const topbar = document.querySelector('.topbar');
        const topbarVisible = topbar ? window.getComputedStyle(topbar).display !== 'none' : false;
        const deskRail = document.querySelector('.desk-rail');
        const deskRailOpen = deskRail ? deskRail.classList.contains('open') : false;
        const draftingSurface = document.querySelector('.doc-draft-surface');
        const draftingVisible = draftingSurface ? window.getComputedStyle(draftingSurface).display !== 'none' : false;
        return {
          docWidth,
          winWidth,
          hasHorizontalOverflow,
          mobileHeaderVisible,
          topbarVisible,
          deskRailOpen,
          draftingVisible,
        };
      })()
    `,
    returnByValue: true,
  });

  const health = healthCheck.result?.value || {};

  // Capture screenshot
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(screenshotRes.data, 'base64');
  const filename = `${tc.name}.png`;
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, buffer);

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  results.push({
    test: tc.name,
    desc: tc.desc,
    width: tc.width,
    height: tc.height,
    mode: tc.mode,
    filename,
    path: filePath,
    sizeBytes: buffer.length,
    sha256: hash,
    health,
  });

  console.log(`✓ OK (${(buffer.length / 1024).toFixed(1)} KB)`);
}

// Write manifest
const manifestPath = path.join(root, 'docs', 'qa', 'step-1-visual-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));

console.log('\n[4/4] Cleaning up processes...');
ws.close();
if (chromeProcess) chromeProcess.kill();
await viteServer.close();

console.log(`\n🎉 Step 1 verification complete! Captured ${results.length} screenshots in docs/qa/screenshots/step-1/`);
