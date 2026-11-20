// B1: "Copy" on a claim card and "Export" for a whole session. Both work on text the view already holds and make
// no request. Confirmations go to the view's ONE shared status node (announce.jsx) through `say`; nothing here
// carries a live region of its own. Styles: factCheck.css (fc-card-actions).
import { useState } from 'react';
import { copyToClipboard, downloadTextFile } from './transcriptTools.js';

export const CLAIM_EXPORT_TEXT = {
  copied: 'Claim copied.',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  exported: 'Session exported.',
  exportFailed: 'Could not make the file. Copy the claims one at a time instead.',
  pdfDone: 'PDF downloaded',
  pdfFailed: 'Could not make the PDF. Try again.',
};

/** `text` is a function so the block is built only when pressed. `dataKey` is the data attribute prefix (fc or pst). */
export function CopyClaimButton({ text, label = 'Copy this claim', dataKey = 'fc', say = () => {} }) {
  const attr = { [`data-${dataKey}`]: 'copy-claim' };
  return (
    <button
      type="button" className="ltv-action-btn fc-btn" aria-label={label} {...attr}
      onClick={async () => {
        let ok = false;
        try { ok = await copyToClipboard(text()); } catch { ok = false; }
        say(ok ? CLAIM_EXPORT_TEXT.copied : CLAIM_EXPORT_TEXT.copyFailed);
      }}
    >
      Copy
    </button>
  );
}

/** `build` returns { name, text } when pressed. */
export function ExportButton({ build, dataKey = 'fc', label = 'Export', say = () => {} }) {
  const attr = { [`data-${dataKey}`]: 'export' };
  return (
    <button
      type="button" className="ltv-action-btn fc-btn" {...attr}
      onClick={() => {
        let ok = false;
        try { const { name, text } = build(); ok = downloadTextFile(name, text); } catch { ok = false; }
        say(ok ? CLAIM_EXPORT_TEXT.exported : CLAIM_EXPORT_TEXT.exportFailed);
      }}
    >
      {label}
    </button>
  );
}

/**
 * Saves the PDF made in the browser. The builder (pdf-lib, a canvas) is loaded only when this is pressed, so it stays
 * out of the main bundle. `build()` returns the claimPdf.js input: { title, link, date, minutes, items, note, timeZone }.
 */
export async function savePdf(args, env = {
  document: typeof document !== 'undefined' ? document : undefined,
  URL: typeof URL !== 'undefined' ? URL : undefined,
  Blob: typeof Blob !== 'undefined' ? Blob : undefined,
}) {
  const { sessionPdfBytes, pdfFileName } = await import('./claimPdf.js');
  const bytes = await sessionPdfBytes(args);
  const { document: doc, URL: url, Blob: BlobCtor } = env;
  if (!doc || !url || !BlobCtor) throw new Error('no browser to save with');
  const href = url.createObjectURL(new BlobCtor([bytes], { type: 'application/pdf' }));
  try {
    const a = doc.createElement('a');
    a.href = href;
    a.download = pdfFileName({ title: args.title, date: args.date, timeZone: args.timeZone });
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove?.();
  } finally {
    setTimeout(() => { try { url.revokeObjectURL(href); } catch { /* nothing to free */ } }, 1000);
  }
}

/** "Download PDF" beside Export. Disabled and aria-busy while the file is being made; failures are said, never thrown. */
export function PdfButton({ build, dataKey = 'fc', disabled = false, say = () => {}, label = 'Download PDF', save = savePdf }) {
  const [busy, setBusy] = useState(false);
  const attr = { [`data-${dataKey}`]: 'pdf' };
  return (
    <button
      type="button" className="ltv-action-btn fc-btn" {...attr}
      disabled={disabled || busy} aria-busy={busy ? 'true' : undefined}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        let ok = false;
        try { await save(build()); ok = true; } catch { ok = false; }
        setBusy(false);
        say(ok ? CLAIM_EXPORT_TEXT.pdfDone : CLAIM_EXPORT_TEXT.pdfFailed);
      }}
    >
      {busy ? 'Making PDF…' : label}
    </button>
  );
}
