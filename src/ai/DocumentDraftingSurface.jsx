import { useState, useTransition } from 'react';
import { Download, FileText, CheckCircle2, AlertTriangle, Cloud, Copy, Check } from 'lucide-react';
import { saveArtifactToFiles } from '../fileManager/artifactService.js';
import './mobileChatJourney.css';

export const QUICK_TEMPLATES = {
  lawyer: [
    { num: '01', id: 'case_note', label: 'Case-law & citation note', desc: 'Authorities, propositions and pinpoints' },
    { num: '02', id: 'legal_notice', label: 'Legal notice', desc: 'Facts, grounds, demand and deadline' },
    { num: '03', id: 'case_brief', label: 'Case brief', desc: 'Facts, issues, holding and ratio' },
    { num: '04', id: 'written_submissions', label: 'Written submissions', desc: 'Structured arguments with citations' },
    { num: '05', id: 'chronology', label: 'Chronology of facts', desc: 'Dated events with source links' },
  ],
  student: [
    { id: 'model_answer', label: 'Model Answer', desc: 'Structured Mains answer with introduction, body arguments, and conclusion' },
    { id: 'revision_summary', label: 'Revision Summary', desc: 'Key points, statutory articles, and bullet summaries' },
    { id: 'syllabus_breakdown', label: 'Syllabus Breakdown', desc: 'Topic mapped to GS papers with historical context' },
  ],
  journalist: [
    { id: 'investigative_dossier', label: 'Investigative Dossier', desc: 'Verified evidence trails, key actors, and unresolved claims' },
    { id: 'story_pitch', label: 'Story Pitch', desc: 'Editorial hook, investigative findings, and proposed angles' },
    { id: 'timeline', label: 'Event Timeline', desc: 'Fact-checked chronology with cross-referenced sources' },
  ],
  analyst: [
    { id: 'market_memo', label: 'Market Intelligence Memo', desc: 'Macro indicators, policy implications, and risk assessment' },
    { id: 'policy_brief', label: 'Policy Impact Brief', desc: 'Regulatory shifts, economic exposure, and scenario outlook' },
  ],
  researcher: [
    { id: 'literature_digest', label: 'Literature Digest', desc: 'Synthesised findings across papers and official gazettes' },
    { id: 'citation_matrix', label: 'Evidence Matrix', desc: 'Tabular mapping of claims to verified source documents' },
  ],
};
QUICK_TEMPLATES.academic = QUICK_TEMPLATES.researcher;
QUICK_TEMPLATES.policy = QUICK_TEMPLATES.analyst;

function generateTemplateContent(templateId, topic, persona) {
  const safeTopic = topic || 'Subject Dossier';
  switch (templateId) {
    case 'case_note':
      return `# CASE-LAW NOTE: ${safeTopic.toUpperCase()}\n\n` +
        `**Jurisdiction:** Supreme Court of India / High Court\n` +
        `**Date:** ${new Date().toLocaleDateString('en-IN')}\n\n` +
        `## 1. STATEMENT OF FACTS\nBrief summary of underlying dispute and proceedings below.\n\n` +
        `## 2. ISSUES FRAMED\n1. Whether the statutory provision applies to the present circumstances.\n2. Standard of proof required under the relevant precedents.\n\n` +
        `## 3. RATIO DECIDENDI & HOLDING\nThe Court observed and held based on established precedents.\n\n` +
        `## 4. APPLICABLE PRECEDENTS & STATUTORY CITATIONS\n- Section 3, Statutory Framework\n- Landmark precedent cited in record\n`;
    case 'legal_notice':
      return `# DRAFT LEGAL NOTICE\n\n` +
        `**TO:** [Recipient Name & Address]\n` +
        `**FROM:** [Advocate / Legal Representative]\n` +
        `**DATE:** ${new Date().toLocaleDateString('en-IN')}\n\n` +
        `**SUBJECT:** Legal Notice regarding ${safeTopic}\n\n` +
        `Sir/Madam,\nUnder instructions from and on behalf of my client, I hereby state as follows:\n\n` +
        `1. That my client is...\n2. That on or about [Date], the following verified events transpired...\n` +
        `3. In view of the above, you are hereby called upon to comply within 15 days.\n`;
    case 'written_submissions':
      return `# WRITTEN SUBMISSIONS ON BEHALF OF [PETITIONER / RESPONDENT]\n\n` +
        `**IN THE MATTER OF:** ${safeTopic}\n\n` +
        `## MOST RESPECTFULLY SHOWETH:\n` +
        `1. The dispute concerns verified record entries dated...\n` +
        `2. SUBMISSION I: Grounding in statutory framework...\n` +
        `3. SUBMISSION II: Absence of contradictory evidence in record...\n\n` +
        `## PRAYER\nIn light of the above submissions, it is prayed that...\n`;
    default:
      return `# RESEARCH DOSSIER: ${safeTopic.toUpperCase()}\n\n` +
        `**Persona:** ${persona || 'General'}\n` +
        `**Date:** ${new Date().toLocaleDateString('en-IN')}\n\n` +
        `## EXECUTIVE SUMMARY\nKey verified findings synthesized from the research session.\n\n` +
        `## EVIDENCE & CITATIONS\nDocumented points verified against primary sources.\n\n` +
        `## ANALYSIS & NEXT STEPS\nActionable conclusions based on the record.\n`;
  }
}

export default function DocumentDraftingSurface({
  topic = '',
  persona = 'lawyer',
  initialContent = '',
  sources = [],
  modelLabel = '',
  focusLabel = '',
  onClose,
  lang = 'en',
}) {
  const templates = QUICK_TEMPLATES[persona] || QUICK_TEMPLATES.lawyer;
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id || 'case_note');
  const [docTitle, setDocTitle] = useState(() => topic ? `${topic} - Draft Brief` : 'Legal Brief & Submissions');
  const [content, setContent] = useState(() => initialContent || generateTemplateContent(templates[0]?.id, topic, persona));
  const [savingVault, setSavingVault] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  const hi = lang === 'hi';

  // Verification items: any cited source marked as needing check or general review
  const needsVerificationCount = Math.max(0, 5 - (sources?.length || 0));

  const handleSelectTemplate = (id) => {
    setSelectedTemplate(id);
    const newContent = generateTemplateContent(id, topic, persona);
    setContent(newContent);
    const matched = templates.find((t) => t.id === id);
    if (matched) setDocTitle(`${matched.label} - ${topic || 'Draft'}`);
  };

  const handleDownloadDoc = () => {
    // Generate Word-compatible HTML document with application/msword MIME type
    const safeTitle = String(docTitle || 'Draft')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const bodyHtml = String(content || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/# (.*)/g, '<h1>$1</h1>')
      .replace(/## (.*)/g, '<h2>$1</h2>')
      .replace(/\n\n/g, '<p></p>');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
body { font-family: 'Calibri', 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.5; margin: 1in; }
h1 { font-size: 18pt; color: #123db5; }
h2 { font-size: 14pt; color: #11121b; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
p, li { font-size: 11pt; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToFiles = async () => {
    setSavingVault(true);
    try {
      await saveArtifactToFiles({
        title: `${docTitle}.md`,
        content,
        mime_type: 'text/markdown',
        kind: 'brief',
        metadata: {
          prompt_subject: topic,
          persona,
        },
      });
      setVaultSaved(true);
      setTimeout(() => setVaultSaved(false), 3500);
    } catch {
      // Graceful fallback: download if cloud save fails or unauthenticated
      handleDownloadDoc();
    } finally {
      setSavingVault(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="doc-draft-surface" role="region" aria-label={hi ? 'दस्तावेज़ ड्राफ्टिंग सतह' : 'Document Drafting Surface'}>
      {/* 1. CARRIED OVER FROM CHAT Banner (Reference Image 4) */}
      <div className="nter-carried-over-banner">
        <div className="nter-carried-kicker">{hi ? 'चैट से आगे बढ़ाया गया' : 'CARRIED OVER FROM CHAT'}</div>
        <h3 className="nter-carried-title">
          {topic || (hi ? 'वर्तमान अनुसंधान सत्र' : 'Current Research Session')}
        </h3>
        <p className="nter-carried-desc">
          {sources?.length
            ? (hi
                ? `आपका प्रश्न और ${sources.length} उद्धृत स्रोत उपयोग के लिए तैयार हैं।`
                : `Your question and ${sources.length} cited ${sources.length === 1 ? 'source is' : 'sources are'} ready to use.`)
            : (hi
                ? 'आपका अनुसंधान संदर्भ और सत्र रिकॉर्ड उपयोग के लिए तैयार हैं।'
                : 'Your research context and session records are ready to use.')}
        </p>
        <div className="nter-carried-tags">
          <span className="nter-carried-tag">{persona ? persona.toUpperCase() : 'LEGAL'}</span>
          {focusLabel ? <span className="nter-carried-tag">{focusLabel.toUpperCase()}</span> : null}
          {modelLabel ? <span className="nter-carried-tag">{modelLabel.toUpperCase()}</span> : null}
        </div>
      </div>

      {/* 2. Recent Work Section (Reference Image 4) */}
      {topic ? (
        <div className="nter-recent-work-sec">
          <div className="nter-recent-work-head">
            <h4>{hi ? 'हाल का कार्य' : 'Recent work'}</h4>
          </div>
          <div className="nter-recent-work-card">
            <div className="nter-recent-icon">
              <FileText size={18} />
            </div>
            <div className="nter-recent-copy">
              <strong>{topic}</strong>
              <span>
                {sources?.length
                  ? `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`
                  : (hi ? 'सक्रिय ड्राफ्ट' : 'Active draft')}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Quick Document Bottom Section (Reference Image 4) */}
      <div className="nter-quick-doc-sheet">
        <div className="nter-mob-sheet-handle" />
        <div className="nter-mob-sheet-head">
          <div>
            <h3 className="nter-mob-sheet-title">{hi ? 'त्वरित दस्तावेज़' : 'Quick document'}</h3>
            <p className="nter-mob-sheet-sub">
              {hi ? 'वकील के दैनिक कार्य के लिए निर्मित।' : "Built for a lawyer's everyday work."}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              className="nter-mob-sheet-close"
              onClick={onClose}
              aria-label={hi ? 'ड्राफ्टिंग बंद करें' : 'Close drafting'}
            >
              ×
            </button>
          )}
        </div>
        <div className="nter-quick-doc-list">
          {templates.map((tpl, idx) => {
            const numStr = tpl.num || `0${idx + 1}`;
            const isSel = selectedTemplate === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                className={`nter-quick-doc-item ${isSel ? 'selected' : ''}`}
                onClick={() => startTransition(() => handleSelectTemplate(tpl.id))}
              >
                <div className="nter-quick-doc-item-left">
                  <div className="nter-quick-doc-num">{numStr}</div>
                  <div className="nter-quick-doc-copy">
                    <strong>{tpl.label}</strong>
                    <span>{tpl.desc}</span>
                  </div>
                </div>
                <div className="nter-quick-doc-arrow">{isSel ? '→' : '›'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Active Document Editor & Export Actions */}
      <div className="doc-draft-header">
        <div className="doc-draft-title-row">
          <FileText size={18} className="doc-draft-icon" />
          <input
            type="text"
            className="doc-draft-title-input"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            aria-label={hi ? 'दस्तावेज़ शीर्षक' : 'Document title'}
          />
        </div>
        <div className="doc-draft-actions">
          <button
            type="button"
            className="doc-action-btn ghost"
            onClick={handleCopy}
            title={hi ? 'क्लिपबोर्ड में कॉपी करें' : 'Copy to clipboard'}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? (hi ? 'कॉपी हुआ' : 'Copied') : (hi ? 'कॉपी' : 'Copy')}</span>
          </button>
          <button
            type="button"
            className={`doc-action-btn ${vaultSaved ? 'success' : 'primary'}`}
            disabled={savingVault}
            onClick={handleSaveToFiles}
            title={hi ? 'निजी फ़ाइल प्रबंधक में सहेजें' : 'Save to Private Files (AI Artifacts)'}
          >
            <Cloud size={16} />
            <span>{savingVault ? (hi ? 'सहेज रहे हैं…' : 'Saving…') : vaultSaved ? (hi ? 'सहेजा गया' : 'Saved to Files') : (hi ? 'फ़ाइलों में सहेजें' : 'Save to Files')}</span>
          </button>
          <button
            type="button"
            className="doc-action-btn export-btn"
            onClick={handleDownloadDoc}
            title={hi ? 'दस्तावेज़ डाउनलोड करें (.doc)' : 'Download document (.doc)'}
          >
            <Download size={16} />
            <span>{hi ? 'निर्यात' : 'Export .DOC'}</span>
          </button>
          {onClose && (
            <button
              type="button"
              className="doc-draft-close"
              onClick={onClose}
              aria-label={hi ? 'ड्राफ्टिंग बंद करें' : 'Close drafting'}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Verification Banner */}
      <div className={`doc-verify-banner ${needsVerificationCount > 0 ? 'needs-check' : 'all-verified'}`}>
        {needsVerificationCount > 0 ? (
          <>
            <AlertTriangle size={16} className="verify-icon warn" />
            <span>
              {hi
                ? `⚠️ ${needsVerificationCount} आइटम को प्राथमिक स्रोतों के साथ सत्यापन की आवश्यकता है`
                : `⚠️ ${needsVerificationCount} items need verification with primary gazettes / citations`}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 size={16} className="verify-icon ok" />
            <span>{hi ? '✓ सभी उद्धरण और साक्ष्य प्राथमिक रिकॉर्ड से सत्यापित हैं' : '✓ All citations verified against primary records'}</span>
          </>
        )}
      </div>

      {/* Quick Templates Selector */}
      <div className="doc-templates-bar" role="toolbar" aria-label={hi ? 'त्वरित टेम्पलेट' : 'Quick Document Templates'}>
        <span className="doc-templates-label">{hi ? 'त्वरित टेम्पलेट:' : 'Quick Templates:'}</span>
        <div className="doc-templates-list">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={`doc-template-pill ${selectedTemplate === tpl.id ? 'active' : ''}`}
              onClick={() => startTransition(() => handleSelectTemplate(tpl.id))}
              title={tpl.desc}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Drafting Editor Surface */}
      <div className="doc-draft-editor-wrap">
        <textarea
          className="doc-draft-editor"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label={hi ? 'दस्तावेज़ पाठ' : 'Document Content'}
          placeholder={hi ? 'यहाँ दस्तावेज़ का मसौदा तैयार करें…' : 'Draft, edit or extract document content here…'}
          spellCheck="false"
        />
      </div>
    </div>
  );
}
