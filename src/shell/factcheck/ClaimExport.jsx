// B1: "Copy" on a claim card and "Export" for a whole session. Both work on text the view already holds and make
// no request. Confirmations go to the view's ONE shared status node (announce.jsx) through `say`; nothing here
// carries a live region of its own. Styles: factCheck.css (fc-card-actions).
import { copyToClipboard, downloadTextFile } from './transcriptTools.js';

export const CLAIM_EXPORT_TEXT = {
  copied: 'Claim copied.',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  exported: 'Session exported.',
  exportFailed: 'Could not make the file. Copy the claims one at a time instead.',
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
