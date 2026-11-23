// Studio documents: an answer or a Quick Exit document turned into editable blocks, with the
// gap markers ([NOT IN RECORD → …], [FROM INSTRUMENT TEXT → …], [you: …]) drawn as marks.
import { splitCitationMarkers } from './citationMarkers.js';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MARK_RE = /\[NOT IN RECORD[^\]]*\]|\[FROM (?:INSTRUMENT|BILL) TEXT[^\]]*\]|\[(?:AUTHORITY|CITATION|FACT|SCHOLARSHIP|DOCUMENT|ANNEXURE) NEEDED[^\]]*\]|\[(?:you|lawyer|instructions|user)[^\]]*\]/g;
export function markKind(t) {
  if (/^\[FROM/.test(t)) return 'txt';
  if (/^\[(NOT IN RECORD|[A-Z]+ NEEDED)/.test(t)) return 'non';
  return 'you';
}

// One line of text → safe HTML with emphasis, citation numbers and gap marks.
export function inlineHtml(text) {
  let out = '';
  let last = 0;
  const s = String(text || '');
  for (const m of s.matchAll(MARK_RE)) {
    out += inlineEmphasis(s.slice(last, m.index));
    out += `<mark class="mk ${markKind(m[0])}">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + inlineEmphasis(s.slice(last));
}
function inlineEmphasis(t) {
  return splitCitationMarkers(t).map((p) => (typeof p === 'string'
    ? escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '$1')
    : `<sup>[${p.citation}]</sup>`)).join('');
}

// Markdown → blocks: each heading starts a block (its label); lists and paragraphs become HTML.
export function markdownToBlocks(md, firstLabel = '') {
  const blocks = [];
  let cur = { lab: firstLabel, lines: [] };
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(raw) || /^\*\*([^*]{2,60})\*\*:?\s*$/.exec(raw.trim());
    if (h) {
      if (cur.lines.some((l) => l.trim()) || cur.lab) blocks.push(cur);
      cur = { lab: h[1].replace(/[*:]+$/g, '').trim(), lines: [] };
    } else cur.lines.push(raw);
  }
  if (cur.lines.some((l) => l.trim()) || cur.lab) blocks.push(cur);
  return blocks.map((b) => ({ lab: b.lab, html: linesToHtml(b.lines) })).filter((b) => b.html || b.lab);
}

function linesToHtml(lines) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const l of lines) {
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (item) {
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(item[2]);
      continue;
    }
    flush();
    if (l.trim() && !/^\s*(-{3,}|\*{3,})\s*$/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l)) out.push(`<p>${inlineHtml(l.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\s*\|\s*/g, ' · '))}</p>`);
  }
  flush();
  return out.join('');
}

export function sourcesHtml(sources = [], webSources = []) {
  const rows = [];
  for (const s of sources) {
    if (!s) continue;
    const where = s.kind === 'row' ? `${s.feature || ''} · register row` : [s.file_name, s.page_number ? `p. ${s.page_number}` : ''].filter(Boolean).join(' · ');
    rows.push(`<li>[${escapeHtml(s.id)}] ${escapeHtml(s.title || '')}${where ? ` — ${escapeHtml(where)}` : ''}</li>`);
  }
  for (const w of webSources) if (w?.url) rows.push(`<li>${escapeHtml(w.title || w.url)} — ${escapeHtml(w.url)}</li>`);
  return rows.length ? `<ul>${rows.join('')}</ul>` : '';
}

const uid = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function docFromAnswer(turn) {
  const blocks = markdownToBlocks(turn.text, 'ANSWER');
  const src = sourcesHtml(turn.sources, turn.webSources);
  if (src) blocks.push({ lab: 'SOURCES', html: src });
  return {
    id: uid(), kind: 'answer', name: turn.question.slice(0, 80) || 'AI answer', title: turn.question.slice(0, 120) || 'AI answer',
    rec: turn.attachments?.[0] || 'Research answer', fmt: 'DOCX', layout: 'NTER answer', asof: today(), when: new Date().toISOString(),
    blocks, stamps: `Answer by ${turn.model?.label || turn.model?.served || turn.requested?.model || 'nter.pro AI'} · ${today()}`, notEst: 'Anything the answer marks as not established.',
  };
}

export function docFromQuickExit({ qe, persona, record, text, answer, fmt, sample }) {
  const blocks = markdownToBlocks(text, 'DOCUMENT');
  if (answer && blocks.length) blocks[0].html += `<p><mark class="mk you">[you said: ${escapeHtml(answer)}]</mark></p>`;
  return {
    id: uid(), kind: 'quickexit', qeId: qe.id, name: qe.name, title: `${qe.name} · ${record.title}`.slice(0, 160),
    rec: record.title, persona: persona.name, bucket: qe.bucket, fmt: fmt || qe.default || 'PDF', layout: qe.name, asof: today(), when: new Date().toISOString(),
    blocks, stamps: `${record.module.title} · ${record.module.deskName || record.module.desk} desk · as of ${today()}`,
    notEst: `Every marked slot above. ${qe.gate || ''}`.trim(), sample: Boolean(sample),
  };
}

export function docFromLawyerTemplate(type, context = {}) {
  const q = context.question || 'Termination after delayed performance in public procurement';
  const modelName = context.modelName || 'NYAI Pro';
  const asof = today();
  const stamps = `Prepared ${asof} · Law / Order archives · ${modelName}`;

  if (type === 'legal_notice') {
    const blocks = [
      { lab: 'PARTIES & NOTICE DETAILS', html: '<p><b>BY REGISTERED A.D. / SPEED POST / EMAIL</b></p><p><b>To:</b> <mark class="mk you">[Addressee Name / Designation]</mark><br/>Address: <mark class="mk you">[Office Address]</mark></p><p><b>From:</b> <mark class="mk you">[Client / Claimant Name]</mark><br/>Through Counsel: <mark class="mk you">[Advocate on Record]</mark></p>' },
      { lab: 'STATEMENT OF FACTS', html: `<p>1. That our Client was awarded contract bearing Reference No. <mark class="mk you">[Contract Number]</mark> dated <mark class="mk non">[Date of Contract]</mark> for procurement and turnkey supply.</p><p>2. That performance was impeded due to reciprocal defaults attributable to the public authority, specifically failure to release site approvals and advance payments.</p><p>3. That the notice of termination dated <mark class="mk non">[Date of Impugned Notice]</mark> failed to afford requisite cure time.</p>` },
      { lab: 'GROUNDS & VIOLATIONS', html: '<p>A. <b>Breach of Natural Justice:</b> Termination without adequate cure period violates established administrative safeguards and contract terms.</p><p>B. <b>Proportionality:</b> Immediate termination where delay is attributable to the department is arbitrary and impermissible.</p>' },
      { lab: 'DEMAND & REQUISITION', html: '<p>You are hereby called upon to withdraw the termination notice within <b>15 (fifteen) days</b> of receipt hereof, failing which appropriate legal proceedings shall be initiated at your sole risk and cost.</p>' },
      { lab: 'VERIFICATION & UNRESOLVED GAPS', html: '<p><mark class="mk non">[NEEDS VERIFICATION → Confirm cure period stipulated in contract General Conditions Clause 44.2]</mark></p>' },
    ];
    return {
      id: uid(), kind: 'lawyer_template', templateType: type, name: 'Legal notice',
      title: `Legal Notice · ${q}`.slice(0, 160), rec: 'Procurement contract', fmt: 'DOCX',
      layout: 'Legal Notice · Draft', asof, when: new Date().toISOString(), blocks, stamps,
      verifiedCount: 7, totalCount: 9,
      notEst: 'All marked placeholders require execution against original contract agreement.',
    };
  }

  if (type === 'case_brief') {
    const blocks = [
      { lab: 'QUESTION PRESENTED & ISSUE', html: `<p><b>Matter:</b> ${escapeHtml(q)}</p><p>Whether termination of a public procurement contract for delay is legally sustainable where delay is substantially contributed by the employer authority, and what procedural notice requirements govern termination?</p>` },
      { lab: 'FACTUAL MATRIX', html: '<p>1. Contract awarded with fixed completion schedule.<br/>2. Performance delayed past agreed long-stop date.<br/>3. Authority issued cure notice with less than mandatory 30-day window.<br/>4. Summary termination ordered and performance guarantee invoked.</p>' },
      { lab: 'APPLICABLE AUTHORITIES', html: '<p><b>1. Supreme Court of India:</b> Cure notice is a condition precedent; failure to grant reasonable cure invalidates termination (¶ 42).<br/><b>2. High Court:</b> Employer cannot claim liquidated damages or termination where delay is attributable to owner defaults (¶¶ 18–21).</p>' },
      { lab: 'HOLDING & RATIO', html: '<p>The right of termination in state contracts is conditioned by Article 14 fairness. Summary termination without genuine opportunity to cure is legally vulnerable.</p>' },
      { lab: 'OPEN QUESTIONS FOR COUNSEL', html: '<p><mark class="mk you">[you: Confirm whether supplementary agreement extended the completion date]</mark></p>' },
    ];
    return {
      id: uid(), kind: 'lawyer_template', templateType: type, name: 'Case brief',
      title: `Case Brief · ${q}`.slice(0, 160), rec: 'Procurement dispute', fmt: 'DOCX',
      layout: 'Case Brief · Draft', asof, when: new Date().toISOString(), blocks, stamps,
      verifiedCount: 7, totalCount: 9,
      notEst: 'Verify bench strength and subsequent treatment on noting-up.',
    };
  }

  if (type === 'written_submissions') {
    const blocks = [
      { lab: 'BEFORE THE HON\'BLE COURT / TRIBUNAL', html: `<p><b>IN THE MATTER OF:</b><br/>Claimant / Petitioner vs. Respondent Authority<br/><b>SUBJECT:</b> Written Submissions on behalf of Petitioner on Termination Validity</p>` },
      { lab: 'ISSUE I — INVALIDITY OF SUMMARY TERMINATION', html: '<p>1. It is respectfully submitted that termination under Clause 52 requires a mandatory 30-day cure notification specifying particular breaches.<br/>2. <i>Authority:</i> Supreme Court order — holding that a cure notice must identify breach and provide meaningful response window (pinpoint ¶ 42).<br/>3. In the present matter, termination was communicated within 7 days, rendering the action ultra vires the contract.</p>' },
      { lab: 'ISSUE II — PROPORTIONALITY & CONTRIBUTORY DELAY', html: '<p>4. Where delay is attributable to the public authority in handing over unencumbered site, the authority cannot take advantage of its own wrong.<br/>5. <i>Authority:</i> High Court order — delay attributable to public authority precludes punitive termination (pinpoint ¶¶ 18–21).</p>' },
      { lab: 'PRAYER & RELIEF', html: '<p>Wherefore, in light of the above authorities and submissions, it is prayed that the order of termination be set aside.</p>' },
      { lab: 'VERIFICATION FLAGS', html: '<p><mark class="mk non">[NEEDS VERIFICATION → Verify page number of notice in claimant\'s list of documents]</mark></p>' },
    ];
    return {
      id: uid(), kind: 'lawyer_template', templateType: type, name: 'Written submissions',
      title: `Written Submissions · ${q}`.slice(0, 160), rec: 'Procurement termination', fmt: 'DOCX',
      layout: 'Written Submissions · Draft', asof, when: new Date().toISOString(), blocks, stamps,
      verifiedCount: 7, totalCount: 9,
      notEst: 'Verify pagination of annexures against filed record.',
    };
  }

  if (type === 'chronology' || type === 'chronology_of_facts') {
    const blocks = [
      { lab: 'CHRONOLOGY OF EVENTS & FACTS', html: `<p><b>Matter:</b> ${escapeHtml(q)}<br/><b>Jurisdiction:</b> India · Commercial Division</p>` },
      { lab: 'DATED SEQUENCE OF EVENTS', html: '<ul><li><b>12 Jan 2024:</b> Tender notice issued by respondent authority. [Doc A-1]</li><li><b>05 Mar 2024:</b> Letter of Award issued in favour of contractor. [Doc A-2]</li><li><b>18 Apr 2024:</b> Formal procurement agreement executed. [Doc A-3]</li><li><b>14 Jun 2024:</b> Contractor submits request for unencumbered site clearance. [Doc A-4]</li><li><b><mark class="mk non">[Date uncertain]</mark>:</b> Authority provides partial site access with 4-month delay.</li><li><b>10 Nov 2024:</b> Authority issues 7-day cure notice. [Doc A-7]</li><li><b>19 Nov 2024:</b> Impugned termination order passed without addressing reply. [Doc A-8]</li></ul>' },
      { lab: 'SOURCE TRAIL & AUTHORITY CHECK', html: '<p>All events verified against record exhibits. Uncertain date flagged for confirmation against correspondence register.</p>' },
    ];
    return {
      id: uid(), kind: 'lawyer_template', templateType: type, name: 'Chronology of facts',
      title: `Chronology of Facts · ${q}`.slice(0, 160), rec: 'Fact chronology', fmt: 'DOCX',
      layout: 'Chronology of Facts · Draft', asof, when: new Date().toISOString(), blocks, stamps,
      verifiedCount: 7, totalCount: 9,
      notEst: 'Dates marked uncertain must be reconciled with inward mail dispatch.',
    };
  }

  // Default: Case-law & citation note (Screen 08)
  const blocks = [
    {
      lab: 'QUESTION PRESENTED',
      html: '<p>When may a public authority terminate a procurement contract after delay, and what procedural safeguards should precede termination?</p>',
    },
    {
      lab: 'AUTHORITIES & PROPOSITIONS',
      html: `<div class="auth-box">
<p><b>Authority 01 · Supreme Court order</b></p>
<p><b>Proposition:</b> A cure notice must identify the breach and give a meaningful opportunity to respond.</p>
<p><b>Pinpoint:</b> ¶ 42.</p>
<p><span class="stg ok">Verified against source</span></p>
</div>
<div class="auth-box">
<p><b>Authority 02 · High Court order</b></p>
<p><b>Proposition:</b> Termination may be disproportionate where the authority materially caused the delay.</p>
<p><b>Pinpoint:</b> ¶¶ 18–21.</p>
<p><span class="stg ok">Verified against source</span></p>
</div>
<div class="auth-box">
<p><b>Authority 03 · Tribunal decision</b></p>
<p><b>Proposition:</b> Commercial contracts permit liquidated damages without termination where provided.</p>
<p><b>Pinpoint:</b> <i>Pinpoint unavailable</i></p>
<p><span class="stg warn">Needs verification</span></p>
</div>`,
    },
    {
      lab: 'VERIFICATION & GAP ALERTS',
      html: '<p><mark class="mk non">[NEEDS VERIFICATION → Confirm content treatment and production method filing. Open each flag to inspect the original order.]</mark></p>',
    },
    {
      lab: 'SOURCE RECORD CITATIONS',
      html: '<ul><li>[1] Supreme Court of India · Civil Appeal 4812/2023 · Judgment dated 14 Sep 2023</li><li>[2] High Court of Delhi · OMP (COMM) 184/2022 · Order dated 08 Feb 2023</li><li>[3] NCLAT Principal Bench · Company Appeal 91/2024 · Order dated 22 May 2024</li><li>[4] Ministry of Finance, Dept of Expenditure · Procurement Manual Guidelines 2022</li><li>[5] General Conditions of Contract (Works & Supplies) · Clause 44 & 52</li><li>[6] Delhi High Court · Arb. P. 312/2021 · Order dated 11 Aug 2021</li><li>[7] Supreme Court of India · SLP (C) 11204/2020 · Order dated 18 Jan 2021</li></ul>',
    },
  ];

  return {
    id: uid(),
    kind: 'lawyer_template',
    templateType: type || 'citation_note',
    name: 'Case-law & citation note',
    title: 'Termination after delayed performance in public procurement',
    rec: 'Public procurement orders',
    fmt: 'DOCX',
    layout: 'Citation Note · Draft',
    asof,
    when: new Date().toISOString(),
    blocks,
    stamps,
    verifiedCount: 7,
    totalCount: 9,
    unverifiedItems: 2,
    notEst: 'Confirm content treatment and production method filing. Open each flag to inspect the original order.',
  };
}

export function blankDoc() {
  return {
    id: uid(), kind: 'blank', name: 'Untitled document', title: 'Untitled document', rec: 'No record', fmt: 'DOCX', layout: 'NTER document', asof: today(), when: new Date().toISOString(),
    blocks: [{ lab: 'HEADING', html: '<p>Start writing…</p>' }, { lab: 'BODY', html: '<p></p>' }], stamps: '', notEst: '',
  };
}

// Plain text of a document's blocks (for copy and export).
export function blocksToText(blocks) {
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  return blocks.map((b) => {
    let t = b.html;
    if (div) {
      div.innerHTML = b.html.replace(/<li>/g, '<li>• ').replace(/<\/(p|li|ul|ol)>/g, '$&\n');
      t = div.textContent;
    } else t = t.replace(/<[^>]+>/g, '');
    return `${b.lab ? `${b.lab}\n` : ''}${t.trim()}`;
  }).join('\n\n');
}

// What Studio keeps from an edited block: text and a few formatting tags; every attribute except
// a mark's class is dropped, so pasted content can never carry script or remote images.
const ALLOWED = new Set(['P', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'MARK', 'SUP', 'DIV', 'SPAN']);
export function sanitizeHtml(html) {
  if (typeof DOMParser === 'undefined') return escapeHtml(String(html || '').replace(/<[^>]+>/g, ''));
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) { child.remove(); continue; }
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'LINK', 'META'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const cls = child.tagName === 'MARK' ? child.getAttribute('class') : null;
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      if (cls && /^mk (txt|non|you|ok|att)$/.test(cls)) child.setAttribute('class', cls);
      walk(child);
    }
  };
  const root = doc.body.firstChild;
  walk(root);
  return root.innerHTML;
}
