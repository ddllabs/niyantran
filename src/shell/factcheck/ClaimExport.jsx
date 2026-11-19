// B1: "Copy" on a claim card and "Export" for a whole session. Both work on text the view already holds and
// make no request. A short message (role="status", a polite live region) says what happened and clears itself,
// so a screen reader hears it once. Styles: factCheck.css (fc-card-actions, fc-tsearch-note).
import { useEffect, useRef, useState } from 'react';
import { copyToClipboard, downloadTextFile } from './transcriptTools.js';

export const CLAIM_EXPORT_TEXT = {
  copied: 'Claim copied.',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  exported: 'Session exported.',
  exportFailed: 'Could not make the file. Copy the claims one at a time instead.',
};
const NOTE_MS = 4000;

function useFlashNote() {
  const [note, setNote] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (message) => {
    clearTimeout(timer.current);
    setNote(message);
    timer.current = setTimeout(() => setNote(''), NOTE_MS);
  };
  return [note, say];
}

/** `text` is a function so the block is built only when pressed. `dataKey` is the data attribute prefix (fc or pst). */
export function CopyClaimButton({ text, label = 'Copy this claim', dataKey = 'fc' }) {
  const [note, say] = useFlashNote();
  const attr = { [`data-${dataKey}`]: 'copy-claim' };
  return (
    <span className="fc-copy">
      <button
        type="button" className="ltv-action-btn fc-btn" aria-label={label} {...attr}
        onClick={async () => say((await copyToClipboard(text())) ? CLAIM_EXPORT_TEXT.copied : CLAIM_EXPORT_TEXT.copyFailed)}
      >
        Copy
      </button>
      <span className="fc-tsearch-note" role="status">{note}</span>
    </span>
  );
}

/** `build` returns { name, text } when pressed. */
export function ExportButton({ build, dataKey = 'fc', label = 'Export' }) {
  const [note, say] = useFlashNote();
  const attr = { [`data-${dataKey}`]: 'export' };
  return (
    <span className="fc-copy">
      <button
        type="button" className="ltv-action-btn fc-btn" {...attr}
        onClick={() => { const { name, text } = build(); say(downloadTextFile(name, text) ? CLAIM_EXPORT_TEXT.exported : CLAIM_EXPORT_TEXT.exportFailed); }}
      >
        {label}
      </button>
      <span className="fc-tsearch-note" role="status">{note}</span>
    </span>
  );
}
