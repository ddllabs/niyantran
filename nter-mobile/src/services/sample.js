// The sample service: a read-only snapshot of nter.pro bundled with the app, for building,
// testing and demos without a network. It never contacts NTER. Sign-in is simulated on the
// device, and AI answers are canned and labelled as such, so nothing here can be mistaken for
// the live product.
import { getJSON, setJSON } from '../lib/storage.js';
import { DESKS, ALL_MODULES } from '../data/desks.js';
import { rowTitle, pickColumns, rowFields, SITE_FIGURES } from './shape.js';
import LATEST from '../sample/home-latest.json';
import MARKETS from '../sample/home-markets.json';
import MODELS from '../sample/ai-models.json';

export const mode = 'sample';

const moduleFiles = import.meta.glob('../sample/modules-*.json', { import: 'default' });
const extraFiles = import.meta.glob(['../sample/feed-store.json', '../sample/record-briefs.json'], { import: 'default' });
const cache = new Map();
const DESK_OF = new Map(ALL_MODULES.map((m) => [`${m.tier}::${m.feature}`, m.desk]));
async function deskModules(deskId) {
  if (cache.has(deskId)) return cache.get(deskId);
  const load = moduleFiles[`../sample/modules-${deskId}.json`];
  const data = load ? await load() : {};
  const store = extraFiles['../sample/feed-store.json'] ? await extraFiles['../sample/feed-store.json']() : {};
  const merged = { ...data };
  for (const [k, v] of Object.entries(store || {})) {
    if (DESK_OF.get(k) === deskId && (!merged[k] || !(merged[k].rows || []).length)) merged[k] = { ...v, desk: deskId };
  }
  cache.set(deskId, merged);
  return merged;
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// ---------- auth (simulated on this device) ----------
const listeners = new Set();
const SESSION_KEY = 'nter.sample.session';
const PROFILE_KEY = 'nter.sample.profile';
const emit = (s) => listeners.forEach((cb) => cb(s));

export const getSession = () => getJSON(SESSION_KEY, null);
export function onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

async function start(email, profile) {
  const session = { access_token: 'sample', user: { id: 'sample-user', email } };
  await setJSON(SESSION_KEY, session);
  const had = await getJSON(PROFILE_KEY, null);
  await setJSON(PROFILE_KEY, { user_id: 'sample-user', email, status: 'active', persona: null, ...had, ...profile });
  emit(session);
  return session;
}

export async function signIn({ email, password }) {
  if (!/^\S+@\S+\.\S+$/.test(String(email))) throw new Error('Enter a valid email address.');
  if (String(password).length < 6) throw new Error('Email or password is incorrect.');
  return start(email.trim(), {});
}
export async function signUp({ email, password, firstName, lastName, persona }) {
  if (String(password).length < 6) throw new Error('Password should be at least 6 characters.');
  const session = await start(email.trim(), { first_name: firstName, last_name: lastName, name: `${firstName || ''} ${lastName || ''}`.trim(), persona: persona?.db || null });
  return { session, needsConfirmation: false };
}
export const resendConfirmation = async () => {};
export const forgotPassword = async () => {};
export const signInWithGoogle = async () => start('reader@example.com', { first_name: 'Sample', last_name: 'Reader', name: 'Sample Reader' });
export const completeOAuth = async () => null;
export async function signOut() { await setJSON(SESSION_KEY, null); emit(null); }

export async function getProfile() { return getJSON(PROFILE_KEY, null); }
export async function setPersona(db) { const p = (await getProfile()) || {}; await setJSON(PROFILE_KEY, { ...p, persona: db }); }

export async function getEntitlement() { return { plan: 'free', status: 'active', lapsed: false, source: 'sample' }; }
export async function getCredits() {
  const start = new Date(); start.setDate(1);
  const end = new Date(start); end.setDate(start.getDate() + 30);
  return { balance: 10000, held: 0, plan: 'free', cycle: { allowance: 10000, starts_at: start.toISOString(), ends_at: end.toISOString() }, used_this_cycle: 0, recent: [] };
}
export async function getModels() { return MODELS.map((m) => ({ ...m, credits: m.credits ?? null })); }

// ---------- news and markets ----------
export async function homeLatest() { return { rows: LATEST.rows, asOf: LATEST.as_of || LATEST.updated || null, fallback: false, sample: true }; }
export async function homeMarkets() { return { rows: MARKETS.rows, asOf: MARKETS.as_of || null, fallback: false, sample: true }; }

export async function siteFigures() { return SITE_FIGURES; }

// ---------- desks ----------
export async function moduleFeed({ module, page = 1, pageSize = 50, q = '' }) {
  const data = await deskModules(module.desk);
  const entry = data[`${module.tier}::${module.feature}`] || null;
  let rows = (entry?.rows || []).filter((r) => r && r.status !== 'source_status');
  const s = String(q || '').trim().toLowerCase();
  if (s) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(s));
  const from = (page - 1) * pageSize;
  return {
    rows: rows.slice(from, from + pageSize),
    columns: pickColumns(rows, entry?.columns),
    total: s ? rows.length : Math.max(rows.length, Number(entry?.total) || 0),
    shown: rows.length,
    paged: false, page, pageSize,
    source: entry?.source || null, coverage: entry?.coverage || null, asOf: null,
    sample: true,
  };
}

export async function searchRecords(query) {
  const s = String(query || '').trim().toLowerCase();
  if (s.length < 3) return [];
  const out = [];
  for (const d of DESKS) {
    const data = await deskModules(d.id);
    for (const entry of Object.values(data)) {
      for (const row of entry.rows || []) {
        if (out.length >= 40) return out;
        if (JSON.stringify(row).toLowerCase().includes(s)) out.push({ desk: d.id, tier: entry.tier, feature: entry.feature, rowKey: null, row, title: rowTitle(row, entry.feature) });
      }
    }
  }
  return out;
}

// ---------- record brief ----------
// The snapshot holds 40 real briefs from nter.pro. One is shown only when it is plainly about the
// record on screen; otherwise the preview says how the live app writes one.
export async function recordBrief({ module, row, generate = false }) {
  const saved = extraFiles['../sample/record-briefs.json'] ? await extraFiles['../sample/record-briefs.json']() : [];
  const title = rowTitle(row, '').toLowerCase();
  // A saved brief belongs to this record when its headline names the record as a whole phrase
  // ("NIFTY 50" is not "NIFTY 500").
  const named = new RegExp(`(^|[^a-z0-9])${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
  const hit = title.length > 3 && Array.isArray(saved)
    ? saved.find((b) => b.feature === module.feature && named.test(String(b.headline || '').toLowerCase()))
    : null;
  if (hit) {
    const p = hit.points || {};
    return Array.isArray(p)
      ? { ok: true, state: 'ready', format: 1, headline: hit.headline, points: p, model: null, writtenAt: hit.written_at, sample: true }
      : { ok: true, state: 'ready', format: 2, brief: hit.headline, why: p.why || '', watch: p.watch || '', tags: p.tags || [], model: null, writtenAt: hit.written_at, sample: true };
  }
  if (!generate) return { ok: true, state: 'missing', sample: true };
  await wait(400);
  const fields = rowFields(row, 8).slice(0, 4);
  return {
    ok: true, state: 'ready', format: 2, sample: true, model: 'sample', writtenAt: new Date().toISOString(),
    brief: `Sample mode: the live app asks nter.pro's AI to write this brief. The record's own fields are ${fields.map((f) => `${f.label.toLowerCase()} “${f.value}”`).join(', ')}.`,
    why: 'Sample mode: no AI was asked; the live app writes this from the record once and keeps it for every reader.', watch: '', tags: [module.title],
  };
}

// ---------- research chat (canned, clearly labelled) ----------
const CONV_KEY = 'nter.sample.conversations';

function isLegalSampleQuery(msg = '') {
  const s = String(msg).toLowerCase();
  return s.includes('procurement') || s.includes('authorities') || s.includes('termination') || s.includes('cure period') || s.includes('legal notice') || s.includes('case-law');
}

function cannedAnswer(body) {
  const msg = String(body.message || '').toLowerCase();
  const atts = body.attachments || [];
  const privateFiles = atts.filter((a) => a.kind === 'private_file' || a.type === 'user_file');

  if (msg.includes('insufficient') || msg.includes('penalty increase') || msg.includes('unilateral') || msg.includes('without arbitration')) {
    return `### Insufficient Evidence in Attached Records\n\nNo clause in your attached private document authorizes unilateral penalty increases without prior notice and bilateral dispute resolution.\n\n* **Dispute Resolution Mandate:** Clause 3.1 provides that any dispute shall be resolved strictly under the Arbitration and Conciliation Act, 1996 [1].\n* **Cure Period Requirement:** Clause 14.2 requires a mandatory 30-day cure period before penalties or liquidated damages can be evaluated [1].\n\nTo verify further, attach supplementary contract amendments or addenda.`;
  }

  if (isLegalSampleQuery(body.message)) {
    return `### The strongest authorities turn on notice, contractual cure periods and proportionality.\n\nI found three lines of authority in your Order archives. Two support termination after a failed cure notice; one limits termination where delay was substantially caused by the authority.\n\n* **Cure notice mandate:** Notice is a condition precedent before invoking termination provisions under Standard EPC/Procurement clauses [1].\n* **Allocation of delay:** Where delay is substantially attributable to reciprocal owner defaults (e.g. delayed drawings or approvals), summary termination is vulnerable to challenge [2].\n* **Proportionality and liquidated damages:** Contractual mechanisms provide for graded compensation prior to punitive contract determination [3].`;
  }

  const hasDocx = privateFiles.some((f) => (f.name || f.title || '').toLowerCase().includes('.docx') || (f.name || f.title || '').toLowerCase().includes('opinion'));
  const hasXlsx = privateFiles.some((f) => (f.name || f.title || '').toLowerCase().includes('.xlsx') || (f.name || f.title || '').toLowerCase().includes('report') || (f.name || f.title || '').toLowerCase().includes('financial'));

  if (hasDocx && hasXlsx) {
    return `### Multi-Format Synthesized Research (DOCX + XLSX)\n\nCross-referencing your legal memorandum and financial statements yields a coherent assessment of operational delay exposure [1, 2]:\n\n* **Legal Risk Assessment (DOCX §4):** Contractor performance delay is legally defensible under Section 54 of the Indian Contract Act due to employer's 45-day corridor handover delay [1].\n* **Financial Capital Buffer (XLSX 'Income Statement'):** The enterprise retains ₹215 Cr positive operating cash flow and a healthy 2.00x current ratio to sustain potential dispute proceedings [2].\n\nGrounding verified across Word memorandum and Excel spreadsheet models.`;
  }

  if (hasDocx || msg.includes('docx') || msg.includes('opinion') || msg.includes('reciprocal default')) {
    return `### Analysis Grounded in Legal Opinion (.docx)\n\nBased on your indexed legal memorandum **Legal_Opinion_Procurement_Delay.docx**, I retrieved key conclusions on reciprocal owner default and summary injunction risks [1]:\n\n* **Section 4 — Reciprocal Defaults (Indian Contract Act §54):** Where owner delayed corridor access and 765kV GIS bay drawings, the employer cannot invoke default termination for consequential delay [1].\n* **Section 5 — Injunction Against Bank Guarantees:** Special equities exist under settled High Court precedent restraining summary invocation of performance bank guarantees where owner breach is documented [1].\n\nDirectly verified against Section 4 & 5 of your uploaded Word document.`;
  }

  if (hasXlsx || msg.includes('financial') || msg.includes('operating profit') || msg.includes('xlsx') || msg.includes('spreadsheet')) {
    return `### Financial Analysis Grounded in Spreadsheet (.xlsx)\n\nBased on **Annual_Financial_Report_2025.xlsx**, key audited performance metrics for FY2025 are [1]:\n\n* **Income Statement:** FY2025 Revenue reached ₹1,420 Cr (+14.2% YoY) with Operating Profit of ₹261 Cr (18.4% margin) [1].\n* **Solvency & Capital:** Net PAT stood at ₹148 Cr. Debt-to-Equity is 0.42x, comfortably below the 0.60x covenant ceiling [1].\n* **Current Liquidity:** Current Ratio is 2.00x vs 1.50x benchmark [1].\n\nDirectly verified against Worksheets 'Income Statement' (Rows 3–7) and 'Financial Ratios' (Rows 2–5).`;
  }

  if (privateFiles.length) {
    const titles = privateFiles.map((f) => `“${f.title || f.name}”`).join(' and ');
    return `### Analysis grounded in your attached file${privateFiles.length > 1 ? 's' : ''}\n\nBased on your indexed private document ${titles}, I retrieved key provisions regarding obligations, payment milestones, and dispute resolution [1]:\n\n* **Clause 1.2 — Delivery & Timeline:** Phased execution over 18 calendar months across designated state corridors.\n* **Clause 2.2 & 2.3 — Financial Safeguards:** 70% milestone payouts against verified factory test certificates; 10% retention held through defects liability period.\n* **Dispute Mechanism:** Arbitration seated in New Delhi under the Arbitration and Conciliation Act, 1996.\n\nAll statements above are directly verified against your private library file.`;
  }
  if (atts.length) {
    const parts = atts.slice(0, 3).map((a, i) => {
      const lines = String(a.text || '').split('\n').filter((l) => l.includes(':')).slice(0, 6);
      return `**${a.title}** [${i + 1}]\n${lines.map((l) => `- ${l.trim()}`).join('\n')}`;
    });
    return `This is a **sample-mode** answer. The preview is not connected to nter.pro’s AI, so it restates what you attached instead of researching it.\n\n${parts.join('\n\n')}\n\nIn the live app the same question is answered by the model you picked, with citations to the desk records and documents it used.`;
  }
  return `This is a **sample-mode** answer. The preview is not connected to nter.pro’s AI.\n\nIn the live app, “${body.message.slice(0, 160)}” is researched across all eight desks — legislation, courts, markets, climate and more — and the answer cites every record it relies on.\n\nTry attaching a record from the Library to see how citations look.`;
}

export async function sendTurn(body, { onFrame, signal } = {}) {
  const convs = await getJSON(CONV_KEY, []);
  let conv = convs.find((c) => c.id === body.conversation_id);
  if (!conv) {
    conv = { id: `sample-${Date.now().toString(36)}`, title: body.message.slice(0, 60), created_at: new Date().toISOString(), messages: [] };
    convs.unshift(conv);
  }
  onFrame?.({ conversation: { id: conv.id } });
  await wait(250, signal);
  onFrame?.({ reasoning: 'Reading the question and what is attached' });
  onFrame?.({ tool: { name: 'search_desk_rows', phase: 'start', step: 1, label: 'Searching desk records' } });
  await wait(400, signal);
  onFrame?.({ tool: { name: 'search_desk_rows', phase: 'end', step: 1, label: 'Searching desk records', count: (body.attachments || []).length } });
  
  const isLegal = isLegalSampleQuery(body.message);
  if (isLegal) {
    onFrame?.({ model: { served: 'NYAI Pro', label: 'NYAI Pro' } });
    onFrame?.({ evidence: { recordsSearched: 23, searchedRecords: 23, sourcesOpened: 9, citationsFound: 7 } });
    onFrame?.({
      authorities: [
        {
          id: 'auth-1',
          name: 'Authority 01 · Supreme Court order',
          court: 'Supreme Court of India',
          proposition: 'Notice and opportunity to cure · pinpoint ¶ 42',
          pinpoint: '¶ 42',
          verified: true,
        },
        {
          id: 'auth-2',
          name: 'Authority 02 · High Court order',
          court: 'High Court of Delhi',
          proposition: 'Delay attributable to the public authority · pinpoint ¶¶ 18–21',
          pinpoint: '¶¶ 18–21',
          verified: true,
        },
        {
          id: 'auth-3',
          name: 'Authority 03 · Tribunal decision',
          court: 'NCLAT Principal Bench',
          proposition: 'Commercial contracts permit liquidated damages without termination where provided.',
          pinpoint: null,
          verified: false,
        },
      ],
    });
  } else {
    onFrame?.({ model: { served: 'sample', label: 'Sample mode' } });
  }

  const answer = cannedAnswer(body);
  for (const piece of answer.match(/[\s\S]{1,48}/g) || []) {
    onFrame?.({ chunk: piece });
    await wait(18, signal);
  }
  const privateFiles = (body.attachments || []).filter((a) => a.kind === 'private_file' || a.type === 'user_file');
  const sources = isLegal ? [
    { id: 1, kind: 'row', tier: 'law', feature: 'Order archives', row_key: 'ord-1', title: 'Supreme Court of India · Civil Appeal 4812/2023 · Judgment dated 14 Sep 2023', page_number: '42' },
    { id: 2, kind: 'row', tier: 'law', feature: 'Order archives', row_key: 'ord-2', title: 'High Court of Delhi · OMP (COMM) 184/2022 · Order dated 08 Feb 2023', page_number: '18-21' },
    { id: 3, kind: 'row', tier: 'law', feature: 'Judiciary', row_key: 'ord-3', title: 'NCLAT Principal Bench · Company Appeal 91/2024 · Order dated 22 May 2024' },
    { id: 4, kind: 'file', tier: 'law', feature: 'Guidelines', row_key: 'ord-4', title: 'Ministry of Finance, Dept of Expenditure · Procurement Manual Guidelines 2022' },
    { id: 5, kind: 'file', tier: 'law', feature: 'Contract', row_key: 'ord-5', title: 'General Conditions of Contract (Works & Supplies) · Clause 44 & 52' },
    { id: 6, kind: 'row', tier: 'law', feature: 'High Court', row_key: 'ord-6', title: 'Delhi High Court · Arb. P. 312/2021 · Order dated 11 Aug 2021' },
    { id: 7, kind: 'row', tier: 'law', feature: 'Supreme Court', row_key: 'ord-7', title: 'Supreme Court of India · SLP (C) 11204/2020 · Order dated 18 Jan 2021' },
  ] : privateFiles.length ? privateFiles.map((a, i) => {
    const name = a.title || a.name || 'Personal File';
    const low = name.toLowerCase();
    let title = `${name} · Clause 2.2 Payment Terms`;
    let pageNum = 'p. 14';
    let prov = 'PDF Document · Cryptographic Hash Verified';

    if (low.endsWith('.docx') || low.includes('opinion')) {
      title = `${name} · Section 4 "Reciprocal Defaults"`;
      pageNum = 'Sec 4, ¶¶ 12–16';
      prov = 'Word Document · Heading Hierarchy Verified';
    } else if (low.endsWith('.xlsx') || low.endsWith('.csv') || low.includes('financial') || low.includes('report')) {
      title = `${name} · Worksheet 'Income Statement' · Rows 3–7`;
      pageNum = 'Sheet 1, R3:R7';
      prov = 'Spreadsheet · Tabular Cell Range Verified';
    } else if (low.endsWith('.pptx') || low.includes('deck')) {
      title = `${name} · Slide 2 · Infrastructure Delivery Pipeline`;
      pageNum = 'Slide 2';
      prov = 'Presentation · Slide Deck Outline Verified';
    }

    return {
      id: 101 + i,
      kind: 'private_file',
      tier: 'private',
      feature: 'User Files',
      file_id: a.file_id || `user-file-${i + 1}`,
      title,
      page_number: pageNum,
      provenance: prov,
    };
  }) : (body.attachments || []).slice(0, 3).map((a, i) => ({
    id: i + 1, kind: 'row', tier: a.tier || 'national', feature: a.feature || 'Attachment', row_key: `sample-${i + 1}`, title: a.title,
    row_snapshot: Object.fromEntries(String(a.text || '').split('\n').filter((l) => l.includes(':')).slice(0, 12).map((l) => { const j = l.indexOf(':'); return [l.slice(0, j).trim(), l.slice(j + 1).trim()]; })),
    snapshot_at: null,
  }));
  onFrame?.({ sources });
  onFrame?.({ followUpQuestions: ['What changed most recently?', 'Which sources back this up?', 'Draft a one-page note on this'] });
  onFrame?.({ timing: { total_ms: 900 }, usage: null });
  const id = `m-${Date.now().toString(36)}`;
  conv.messages.push({ id: `${id}-q`, role: 'user', content: body.message, created_at: new Date().toISOString() },
    { id, role: 'assistant', content: answer, sources, follow_ups: [], status: 'complete', model_served: 'sample', created_at: new Date().toISOString() });
  conv.last_message_at = new Date().toISOString();
  await setJSON(CONV_KEY, convs.slice(0, 40));
  onFrame?.({ done: { message_id: id } });
}

export const cancelTurn = async () => {};
export async function listConversations() {
  const convs = await getJSON(CONV_KEY, []);
  return convs.map(({ messages: _m, ...c }) => c);
}
export async function getMessages(id) { return (await getJSON(CONV_KEY, [])).find((c) => c.id === id)?.messages || []; }
export async function renameConversation(id, title) {
  const convs = await getJSON(CONV_KEY, []);
  await setJSON(CONV_KEY, convs.map((c) => (c.id === id ? { ...c, title: String(title).slice(0, 80) } : c)));
}
export async function deleteConversation(id) { await setJSON(CONV_KEY, (await getJSON(CONV_KEY, [])).filter((c) => c.id !== id)); }

// ---------- watchlist ----------
export const getWatchlist = () => getJSON('nter.sample.watchlist', null);
export const saveWatchlist = (list) => setJSON('nter.sample.watchlist', list.slice(0, 24));

export const pricingUrl = () => 'https://www.nter.pro/#pricing';

// ---------- file manager (sample mode) ----------
export const SAMPLE_STORAGE_QUOTA_BYTES = 524_288_000; // 500 MB for Free tier

const INITIAL_SAMPLE_FILES = [
  {
    id: 'sample-file-1',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Q3_Procurement_Contract.pdf',
    storage_path: 'sample-user/sample-file-1/Q3_Procurement_Contract.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2_450_000,
    sha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    upload_status: 'uploaded',
    index_status: 'indexed',
    index_error: null,
    page_count: 24,
    extract_hash: 'h1a2s3h4',
    deleted_at: null,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    preview_text: `SAMPLE PROCUREMENT AGREEMENT

BETWEEN: National Infrastructure Development Corporation (NIDC)
AND: Apex EPC Global Consortium Limited

Effective Date: 15 August 2026
Contract Reference: NIDC/PROC/2026/088-C
Contract Value: INR 482.50 Crores

1. SCOPE OF PROCUREMENT & WORK SPECIFICATION
1.1 The Contractor agrees to supply, install, and commission 765kV ultra-high voltage electrical substation hardware across 4 designated state corridors.
1.2 Delivery schedule: Phased over 18 calendar months from the signing date.

2. PAYMENT TERMS & PERFORMANCE GUARANTEES
2.1 Mobilization Advance: 10% against unconditional Bank Guarantee.
2.2 Milestone Payments: 70% pro-rata against verified factory test certificates and dispatch documentation.
2.3 Retention: 10% held until final commercial operation date plus 12 months defects liability.

3. DISPUTE RESOLUTION
Any dispute arising out of or in connection with this Contract shall be resolved under the Arbitration and Conciliation Act, 1996, with seat of arbitration in New Delhi.`,
  },
  {
    id: 'sample-file-2',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Arbitration_Petition_2026.pdf',
    storage_path: 'sample-user/sample-file-2/Arbitration_Petition_2026.pdf',
    mime_type: 'application/pdf',
    size_bytes: 5_120_000,
    sha256: 'b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef01',
    upload_status: 'uploaded',
    index_status: 'indexing_extracting',
    index_error: null,
    page_count: 48,
    extract_hash: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 60000).toISOString(),
    preview_text: `IN THE HIGH COURT OF JUDICATURE AT BOMBAY
COMMERCIAL DIVISION
ARBITRATION PETITION NO. 418 OF 2026

IN THE MATTER OF:
Consortium Alpha Private Limited ... Petitioner
VERSUS
Union of India, Ministry of Power & Anr. ... Respondents

PETITION UNDER SECTION 9 OF THE ARBITRATION AND CONCILIATION ACT, 1996 FOR INTERIM MEASURES
1. The Petitioner respectfully submits that disputes have arisen under the Master Concession Agreement dated 12 January 2023.
2. The Respondents have unlawfully threatened invocation of Performance Bank Guarantees totaling INR 64 Crores.
3. The Petitioner prays for an ad-interim injunction restraining encashment pending constitution of the Arbitral Tribunal.`,
  },
  {
    id: 'sample-file-3',
    user_id: 'sample-user',
    folder_id: null,
    name: 'NCLT_Company_Petition_Sec7.pdf',
    storage_path: 'sample-user/sample-file-3/NCLT_Company_Petition_Sec7.pdf',
    mime_type: 'application/pdf',
    size_bytes: 8_700_000,
    sha256: 'c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef012',
    upload_status: 'uploaded',
    index_status: 'indexed',
    index_error: null,
    page_count: 72,
    extract_hash: 'h7x8y9z0',
    deleted_at: null,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    preview_text: `BEFORE THE NATIONAL COMPANY LAW TRIBUNAL
PRINCIPAL BENCH, NEW DELHI
COMPANY PETITION (IB) NO. 882/ND/2026

IN THE MATTER OF:
State Bank Consortium ... Financial Creditor
VERSUS
Horizon Infrastructure Projects Limited ... Corporate Debtor

APPLICATION UNDER SECTION 7 OF THE INSOLVENCY AND BANKRUPTCY CODE, 2016
Total Default Amount Claimed: INR 218,45,00,000/-
Date of Default: 14 October 2025
Proposed Interim Resolution Professional: Mr. Rajeshwar Rao (IBBI/IPA-002/IP-N00142/2018-2019/10384)`,
  },
  {
    id: 'sample-file-4',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Notice_of_Motion_Draft.pdf',
    storage_path: 'sample-user/sample-file-4/Notice_of_Motion_Draft.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1_250_000,
    sha256: 'd4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0123',
    upload_status: 'uploaded',
    index_status: 'indexing_failed',
    index_error: 'OCR extraction timed out on scanned page 14.',
    page_count: 18,
    extract_hash: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    preview_text: `IN THE HIGH COURT OF DELHI AT NEW DELHI
INTERLOCUTORY APPLICATION NO. 11024/2026
IN COMMERCIAL SUIT NO. 392/2026

IN THE MATTER OF:
Apex Digital Innovations Private Limited ... Plaintiff
VERSUS
Zenith Fintech Solutions LLP ... Defendant

NOTICE OF MOTION UNDER ORDER XXXIX RULES 1 & 2 CPC
FOR TEMPORARY RESTRAINING ORDER IN TRADE SECRET MISAPPROPRIATION`,
  },
  {
    id: 'sample-file-5',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Annual_Financial_Report_2025.xlsx',
    storage_path: 'sample-user/sample-file-5/Annual_Financial_Report_2025.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size_bytes: 3_400_000,
    sha256: 'e5f67890123456789abcdef0123456789abcdef0123456789abcdef01234',
    upload_status: 'uploaded',
    index_status: 'indexed',
    index_error: null,
    page_count: null,
    worksheet_count: 4,
    extract_hash: 'x7l8s9p0',
    deleted_at: null,
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    preview_text: `## Worksheet: Income Statement

| Line Item | FY2024 | FY2025 | YoY Change | Margin |
| --- | --- | --- | --- | --- |
| Revenue | 1,243 Cr | 1,420 Cr | +14.2% | 100.0% |
| Cost of Goods Sold | 740 Cr | 832 Cr | +12.4% | 58.6% |
| Operating Profit | 228 Cr | 261 Cr | +14.5% | 18.4% |
| Net Profit (PAT) | 129 Cr | 148 Cr | +14.7% | 10.4% |

## Worksheet: Balance Sheet

| Classification | Assets | Liabilities | Net Equity |
| --- | --- | --- | --- |
| Current (Short-Term) | 840 Cr | 420 Cr | 420 Cr |
| Non-Current (Long-Term) | 1,250 Cr | 580 Cr | 670 Cr |
| Total Consolidated | 2,090 Cr | 1,000 Cr | 1,090 Cr |

## Worksheet: Cash Flows

| Activity | FY2024 | FY2025 | Trend |
| --- | --- | --- | --- |
| Operating Cash Flow | 184 Cr | 215 Cr | Positive |
| Investing Cash Flow | -95 Cr | -110 Cr | Outflow |
| Financing Cash Flow | -45 Cr | -55 Cr | Dividends |

## Worksheet: Financial Ratios

| Metric | Benchmark | FY2025 Value | Status |
| --- | --- | --- | --- |
| Debt to Equity | < 0.60x | 0.42x | Healthy |
| Current Ratio | > 1.50x | 2.00x | Strong |
| Return on Equity | > 12.0% | 13.6% | Outperforming |`,
  },
  {
    id: 'sample-file-6',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Board_Strategy_Deck.pptx',
    storage_path: 'sample-user/sample-file-6/Board_Strategy_Deck.pptx',
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    size_bytes: 5_200_000,
    sha256: 'f67890123456789abcdef0123456789abcdef0123456789abcdef0123456',
    upload_status: 'uploaded',
    index_status: 'ready_for_ai',
    index_error: null,
    page_count: null,
    slide_count: 12,
    extract_hash: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    preview_text: `## Slide 1: Strategic Growth Plan FY2026-27

- Executive Summary & Corporate Vision
  - Expanding operations across 4 key regional zones
  - Accelerating high-margin infrastructure mandates
  - Maintaining debt-to-equity ratio below 0.50x

> **Speaker Notes:** Opening slide presented to the board of directors.

## Slide 2: Infrastructure Delivery Pipeline

- Target substation hardware deployment across 765kV corridors
  - Phase 1: Northern corridor commissioning by Q2
  - Phase 2: Western grid synchronization by Q4
- Total capital outlay capped at INR 482.50 Crores`,
  },
  {
    id: 'sample-file-7',
    user_id: 'sample-user',
    folder_id: null,
    name: 'Legal_Opinion_Procurement_Delay.docx',
    storage_path: 'sample-user/sample-file-7/Legal_Opinion_Procurement_Delay.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size_bytes: 1_840_000,
    sha256: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
    upload_status: 'uploaded',
    index_status: 'indexed',
    index_error: null,
    page_count: null,
    section_count: 5,
    word_count: 3420,
    extract_hash: 'h8w9d1x2',
    deleted_at: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    preview_text: `# LEGAL OPINION ON TERMINATION & RECIPROCAL DEFAULT

## 1. Executive Summary
This memorandum evaluates the legal risks associated with termination of the Transmission Substation EPC Agreement dated 15 August 2026.

## 2. Factual Matrix & Timeline
The Contractor was granted site access to Corridor Alpha on 01 October 2026, 45 days after contract execution. Drawings for 765kV GIS bays were released in batches between November and January.

## 3. Contractual Provisions on Notice & Cure
Clause 14.2 requires issuance of a 30-day cure notice detailing specific breaches prior to invocation of Clause 14.3 (Termination for Contractor Default).

## 4. Assessment of Reciprocal Defaults
Under Section 54 of the Indian Contract Act, 1872, where reciprocal promises form the consideration, the promisor cannot claim performance if their own prior default prevented the other party.

## 5. Risk of Summary Injunction
High Court precedent indicates that where reciprocal owner delays exist, invocation of unconditional bank guarantees may be restrained under the special equities exception.`,
  },
];

const SAMPLE_FILES_KEY = 'nter.sample.files';

async function getSampleFiles() {
  const stored = await getJSON(SAMPLE_FILES_KEY, null);
  if (Array.isArray(stored) && stored.some((f) => (f.name || '').endsWith('.docx'))) return stored;
  await setJSON(SAMPLE_FILES_KEY, INITIAL_SAMPLE_FILES);
  return INITIAL_SAMPLE_FILES;
}

async function saveSampleFiles(files) {
  await setJSON(SAMPLE_FILES_KEY, files);
}

export async function listFiles({ filter = 'all', search = '' } = {}) {
  const all = await getSampleFiles();
  const q = String(search || '').trim().toLowerCase();
  return all.filter((f) => {
    if (filter === 'trash') {
      if (!f.deleted_at) return false;
    } else {
      if (f.deleted_at) return false;
    }

    if (q && !f.name.toLowerCase().includes(q)) return false;

    if (filter === 'pdf') {
      return (f.mime_type || '').toLowerCase() === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    }
    if (filter === 'processing') {
      return ['indexing_queued', 'indexing_extracting', 'indexing_chunking', 'processing'].includes(f.index_status) || f.upload_status === 'uploading';
    }
    if (filter === 'ready_for_ai') {
      return f.index_status === 'indexed' || f.index_status === 'ready_for_ai';
    }
    if (filter === 'failed') {
      return f.index_status === 'indexing_failed' || f.index_status === 'failed' || f.upload_status === 'upload_failed';
    }
    return true;
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function uploadFile(file, onProgress) {
  if (!file) throw new Error('No file provided for upload.');
  const MAX_SIZE = 52_428_800; // 50 MB
  if (file.size > MAX_SIZE) {
    throw new Error('This file exceeds the 50 MB upload limit.');
  }

  onProgress?.({ loaded: Math.round(file.size * 0.3), total: file.size, percent: 30 });
  await wait(80);
  onProgress?.({ loaded: Math.round(file.size * 0.75), total: file.size, percent: 75 });
  await wait(80);
  onProgress?.({ loaded: file.size, total: file.size, percent: 100 });

  const all = await getSampleFiles();
  const isPdf = (file.type || '').toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const fileId = `sample-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const newFile = {
    id: fileId,
    user_id: 'sample-user',
    folder_id: null,
    name: file.name,
    storage_path: `sample-user/${fileId}/${file.name}`,
    mime_type: file.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
    size_bytes: file.size,
    sha256: `sample-hash-${Date.now()}`,
    upload_status: 'uploaded',
    index_status: isPdf ? 'indexed' : 'unsupported',
    index_error: null,
    page_count: isPdf ? Math.max(1, Math.round(file.size / 150000)) : null,
    extract_hash: isPdf ? `ext-${Date.now()}` : null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    preview_text: `Preview for ${file.name}\nSize: ${file.size} bytes\nType: ${file.type || 'Unknown'}\nUploaded in sample mode.`,
  };

  const next = [newFile, ...all];
  await saveSampleFiles(next);
  return newFile;
}

export async function deleteFile(fileId) {
  const all = await getSampleFiles();
  const next = all.map((f) => (f.id === fileId ? { ...f, deleted_at: new Date().toISOString() } : f));
  await saveSampleFiles(next);
  return { success: true };
}

export async function retryIndexing(fileId) {
  const all = await getSampleFiles();
  const next = all.map((f) => (f.id === fileId ? { ...f, index_status: 'indexed', index_error: null, updated_at: new Date().toISOString() } : f));
  await saveSampleFiles(next);
  return { success: true };
}

export async function indexForAi(fileId) {
  return retryIndexing(fileId);
}

export async function getFilePreview(fileId) {
  const all = await getSampleFiles();
  const file = all.find((f) => f.id === fileId);
  if (!file) throw new Error('File not found.');
  return {
    file,
    url: null,
    text: file.preview_text || `Preview for ${file.name}\n(Ready for AI indexing)`,
  };
}

export const getFilePreviewUrl = getFilePreview;

export async function getStorageUsage() {
  const all = await getSampleFiles();
  const active = all.filter((f) => !f.deleted_at);
  const usedBytes = active.reduce((sum, f) => sum + (Number(f.size_bytes) || 0), 0);
  const quotaBytes = SAMPLE_STORAGE_QUOTA_BYTES;
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
    plan: 'free',
    quotaBytes,
    usedBytes,
    remainingBytes,
    percentUsed,
    formattedUsed: formatB(usedBytes),
    formattedQuota: formatB(quotaBytes),
  };
}
