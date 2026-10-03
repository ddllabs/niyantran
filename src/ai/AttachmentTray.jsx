import { FileText, Layers, X } from 'lucide-react';
import { isModuleAttachment } from '../lib/aiDrop.js';
import { coverageOf } from '../lib/corpusCoverage.js';

export default function AttachmentTray({ attachments, indexedKeys, locked, onRemove, lang }) {
  const hi = lang === 'hi';
  if (!attachments.length) return null;
  const file = a => {
    const module = isModuleAttachment(a);
    const cover = coverageOf(a, indexedKeys);
    return <li key={a.id} className={module ? 'module' : undefined}>
      {module ? <Layers size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
      <span title={a.title}>{a.title}</span>
      {a.kind === 'document' ? <em className="ai-v2-file-cover document" title={hi ? 'केवल संलग्न या चयन फोकस में खोज इस दस्तावेज़ तक सीमित है' : 'Under Attached or Selection focus, searches are limited to attached documents'}>{hi ? 'दस्तावेज़' : 'Document'}</em> : null}
      {module ? <em className="ai-v2-file-cover module" title={hi ? 'मॉड्यूल की नमूना पंक्तियाँ, पूरा दस्तावेज़ नहीं' : 'A sample of module rows, not the full document text'}>{hi ? 'मॉड्यूल' : 'Module'}</em> : null}
      {cover ? <em className={`ai-v2-file-cover${cover === 'full' ? ' full' : ''}`} title={cover === 'full' ? (hi ? 'पूरा पाठ अनुक्रमित है' : 'Full text is indexed and can be quoted') : (hi ? 'केवल तालिका पंक्ति उपलब्ध है' : 'Only the desk row is available; no indexed text')}>
        {cover === 'full' ? (hi ? 'पूर्ण पाठ' : 'Full text') : (hi ? 'केवल रिकॉर्ड' : 'Record only')}
      </em> : null}
      <button type="button" aria-label={`${hi ? 'हटाएँ' : 'Remove'} ${a.title}`} disabled={locked} onClick={() => onRemove(a.id)}><X size={14} aria-hidden="true" /></button>
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
