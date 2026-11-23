// The Quick Exit catalogue: six personas × five buckets of documents, from the Quick Exit Shutter
// design (94 documents). Fill labels say how much of each document the record fills today.
import { QE_DATA } from './quickExitData.js';

export { QE_DATA };
export const BLADE_HUES = ['#012ea1', '#2b2b9f', '#4f1d90', '#8e1a5c', '#c81322'];
export const fillKind = (f) => { const k = String(f || '').split(/[ ,;(]/)[0]; return (k === 'Full' || k === 'Most') ? 'full' : k === 'Half' ? 'half' : 'skel'; };
export const FILL_TEXT = { full: 'Fills from record', half: 'Half from record', skel: 'Skeleton until text' };
export const FORMAT_LABEL = { PDF: 'PDF', DOCX: 'Word', XLSX: 'Excel', PPTX: 'PowerPoint · one slide', COPY: 'Copy · text / email', ICS: 'Calendar · .ics', CSV: 'CSV', BIB: 'BibTeX / RIS', WA: 'WhatsApp post' };
export const qePersona = (qeIndex) => QE_DATA[qeIndex] || QE_DATA[0];
export const qeDoc = (id) => { for (const p of QE_DATA) { const d = p.docs.find((x) => x.id === id); if (d) return { doc: d, persona: p }; } return null; };
