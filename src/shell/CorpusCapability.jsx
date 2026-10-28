import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { attachmentCoverageKey, deskRowKey, recordDocumentKey } from '../lib/deskRows.js';
import { corpusCapabilityPending, observeCoverage, publicCorpusCapability, subscribeCoverage } from '../lib/corpusCoverage.js';
import './corpusCapability.css';

const unsupportedIndicator = row => row && !String(row.indicator || '').trim() && /^not wired\b/i.test(String(row.authority || ''));

/** Always resolve the current tuple. A cached Bill/Law key or source URL proves no readiness. */
export function capabilityRecord(row, feed) {
  if (!row || row.status === 'source_status' || row.is_aggregate || row.type === 'key_number'
    || unsupportedIndicator(row) || ['simulator', 'simulated'].includes(feed?.kind) || feed?.source?.kind === 'simulator') return null;
  return { kind: 'row', document_key: recordDocumentKey(feed?.tier, feed?.feature, deskRowKey(row)) };
}

export function useCorpusCapability(attachment, active = true) {
  const key = attachmentCoverageKey(attachment) || '';
  const subscribe = useCallback(notify => subscribeCoverage(notify, [key]), [key]);
  const snapshot = useCallback(() => {
    const record = key ? { document_key: key } : null;
    return corpusCapabilityPending(record) ? 'pending' : publicCorpusCapability(record);
  }, [key]);
  useEffect(() => observeCoverage(active && key ? [key] : []) || undefined, [key, active]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Only capability labels appear in public markup, including its accessible descriptions. */
export default function CorpusCapability({ attachment, row, feed, lang = 'en' }) {
  const supplied = attachment ? unsupportedIndicator(attachment.preview) ? null : attachment : capabilityRecord(row, feed);
  const present = Boolean(supplied);
  const key = attachmentCoverageKey(supplied);
  const host = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [present, key]);
  const capability = useCorpusCapability(supplied, visible);
  if (!supplied) return null;
  const hi = lang === 'hi';
  if (capability === 'pending') {
    const checking = hi ? 'जाँच हो रही है' : 'Checking';
    return <span ref={host} className="corpus-capability pending" aria-busy="true" aria-label={checking} title={checking}>…</span>;
  }
  const full = capability === 'full';
  const label = hi ? full ? 'पूर्ण पाठ' : 'केवल रिकॉर्ड' : full ? 'Full text' : 'Record only';
  const title = hi
    ? full ? 'शोध के लिए पूरा पाठ उपलब्ध है।' : 'शोध में यहाँ दिखाए गए रिकॉर्ड के विवरण का उपयोग किया जा सकता है।'
    : full ? 'Full text is available for research.' : 'Research can use the record details shown here.';
  return <span ref={host} className={`corpus-capability${full ? ' full' : ''}`} title={title}>{label}</span>;
}
