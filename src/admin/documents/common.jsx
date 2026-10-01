import { useEffect, useState } from 'react';
import { confirmText, documentState } from './model.js';

// Pieces shared by the records view and the unlinked list.

export const SEARCH_MS = 300;
export const POLL_MS = 10_000;

const CONFIRM_LABEL = { unlink: 'Confirm unlink', relink: 'Confirm move', link: 'Confirm link', swap: 'Confirm swap', delete: 'Confirm delete' };
const STATE_PILL = { live: 'live', processing: 'local', failed: 'inactive', pending: 'archive' };

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The in-page confirmation for a destructive action (never window.confirm). */
export function ConfirmBar({ confirm, busy = false, onConfirm, onKeep }) {
  return (
    <div className="adm-confirm" role="group" aria-label="Confirm">
      <p className="note">{confirmText(confirm)}</p>
      <div className="adm-actions" style={{ marginTop: 4 }}>
        <button className="adm-btn tiny danger" type="button" disabled={busy} onClick={() => onConfirm(confirm)}>{CONFIRM_LABEL[confirm.kind] ?? 'Confirm'}</button>
        <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onKeep()}>Keep</button>
      </div>
    </div>
  );
}

/** A document's state pill, plus a read-only "legacy" tag for legacy text (D3). */
export function DocumentTags({ doc }) {
  const state = documentState(doc);
  return (
    <>
      {doc.legacy ? <span className="adm-pill archive" title="Legacy text is read-only here">legacy</span> : null}
      <span className={`adm-pill ${STATE_PILL[state]}`}>{state}</span>
    </>
  );
}

export function Banner({ text }) {
  return text ? <p className="adm-msg err" role="alert">{text}</p> : null;
}
