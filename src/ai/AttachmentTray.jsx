import { FileText, Layers, X } from 'lucide-react';
import { isModuleAttachment } from '../lib/aiDrop.js';
import { recordAvailability } from '../lib/corpusCoverage.js';
import { fileMessage } from '../lib/fileText.js';

export default function AttachmentTray({ attachments, indexedKeys, locked, onRemove, lang }) {
  const hi = lang === 'hi';
  if (!attachments.length) return null;
  const file = a => {
    const module = isModuleAttachment(a);
    const subject = /parliamentary question/i.test(a.feature || '') && typeof a.preview?.subject === 'string' ? a.preview.subject.trim() : '';
    const title = subject || a.title;
    const availability = recordAvailability(a, indexedKeys);
    const cover = availability.text;
    const showRecord = availability.record && cover !== 'full' && cover !== 'partial';
    const coverageLabels = {
      error: ['Text lookup failed', 'Full-text coverage could not be checked. This does not establish absence or readiness.'],
      full: [hi ? 'पूर्ण पाठ' : 'Full text', 'All linked text is indexed and accessible'],
      row: [hi ? 'केवल रिकॉर्ड' : 'Record only', 'No indexed text resolves through this record key'],
      unmapped: ['Text mapping unavailable', 'No verified accessible document link; OCR may already exist'],
      unavailable: ['Text coverage unavailable', 'The record or its document link is not accessible'],
      partial: ['Partial text', 'Some linked documents are not ready or accessible'],
      registered: ['Not indexed', 'Linked document registered; indexing is incomplete'],
      incomplete: ['Index incomplete', 'Linked text has missing embeddings'],
      held: ['Mapping held', 'Linked source identity changed and needs review'],
    };
    const coverLabel = coverageLabels[cover];
    // F178: why a file was not sent, and what was cut, in text a touch reader can read (not only a tooltip).
    const notSent = a.kind === 'file' && a.error ? fileMessage(a.error, lang) : '';
    const note = a.note ? fileMessage(a.note, lang) : '';
    const name = <span title={title}>{title}</span>;
    const messageId = `ai-file-msg-${a.id}`;
    return <li key={a.id} className={module ? 'module' : undefined}>
      {module ? <Layers size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
      {notSent || note
        ? <div className="ai-v2-file-main">
          {name}
          <small id={messageId} role="note" className={notSent ? 'ai-v2-file-msg not-sent' : 'ai-v2-file-msg'}>{notSent}{notSent && note ? ' ' : ''}{note}</small>
        </div>
        : name}
      {a.kind === 'file' && a.error ? <em className="ai-v2-file-cover not-sent">{hi ? 'नहीं भेजा' : 'Not sent'}</em> : null}
      {a.kind === 'document' ? <em className="ai-v2-file-cover document" title={hi ? 'केवल संलग्न या चयन फोकस में खोज इस दस्तावेज़ तक सीमित है' : 'Under Attached or Selection focus, searches are limited to attached documents'}>{hi ? 'दस्तावेज़' : 'Document'}</em> : null}
      {module ? <em className="ai-v2-file-cover module" title={hi ? 'मॉड्यूल की नमूना पंक्तियाँ, पूरा दस्तावेज़ नहीं' : 'A sample of module rows, not the full document text'}>{hi ? 'मॉड्यूल' : 'Module'}</em> : null}
      {showRecord ? <em className="ai-v2-file-cover" title={availability.record === 'snapshot' ? 'The stored record identity could not be verified; only the supplied record snapshot is available.' : availability.record === 'stored' ? `Verified record metadata is available independently of full-text coverage. ${coverageLabels[cover]?.[1] || ''}` : 'Record identity has not been verified; supplied fields are a snapshot only.'}>{availability.record === 'snapshot' ? 'Record snapshot' : availability.record === 'stored' ? hi ? 'केवल रिकॉर्ड' : 'Record only' : 'Record unverified'}</em> : null}
      {availability.record === 'unknown' && cover !== 'error' ? <em className="ai-v2-file-cover" title="Full-text coverage has not been verified; a pending or failed lookup does not establish absence.">Text coverage unverified</em> : null}
      {coverLabel && cover !== 'unmapped' && (!showRecord || cover !== 'row') ? <em className={`ai-v2-file-cover${cover === 'full' ? ' full' : ''}`} title={coverLabel[1]}>{coverLabel[0]}</em> : null}
      <button type="button" aria-label={`${hi ? 'हटाएँ' : 'Remove'} ${title}`} aria-describedby={notSent || note ? messageId : undefined} disabled={locked} onClick={() => onRemove(a.id)}><X size={14} aria-hidden="true" /></button>
    </li>;
  };
  return <section className="ai-attachment-tray" aria-label={hi ? 'संलग्न सामग्री' : 'Attached context'}>
    <ul className="ai-v2-files">{attachments.slice(0, 1).map(file)}</ul>
    {attachments.length > 1 ? <details>
      <summary>{hi ? 'और संलग्नक' : 'More attachments'} · {attachments.length - 1}</summary>
      <ul className="ai-v2-files">{attachments.slice(1).map(file)}</ul>
    </details> : null}
  </section>;
}
