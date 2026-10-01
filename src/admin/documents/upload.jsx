import { UploadError, uploadPlan } from '../../lib/corpusUpload.js';
import { formatMB, formatUsd, plural } from './format.js';
import {
  LEGACY_WARNING,
  keyHolderDecision,
  pairValue,
  parsePairValue,
  recordActions,
  recordTitle,
  sourceUrlError,
  uploadMeta,
} from './model.js';

// The Documents tab's upload panel (R8, plan B4; Amendment A, plan C4). One panel, three modes:
// - attach: a PDF for one record; the desk is the record's, `document_key` is its key;
// - replace: a new PDF for a record whose ingestion-v2 document it will swap out (D5);
// - standalone: a PDF for any catalog desk, without a record.

const TITLE_MAX = 300;
const PART_STATE_LABEL = { queued: 'queued', uploading: 'uploading', verifying: 'verifying', stored: 'stored' };
const STANDALONE = Object.freeze({ mode: 'standalone' });

const keyedMode = (target) => target?.mode === 'attach' || target?.mode === 'replace';
const recordName = (record) => {
  const title = recordTitle(record);
  return title && title !== record.document_key ? `${record.document_key} (${title})` : record.document_key;
};

/** The record's provenance URL, the D6 hint the form refuses as a value. */
export function hintsOf(target) {
  const hint = target?.record?.source_hint;
  return hint ? [hint] : [];
}

/** Catalog pairs grouped by tier, keeping the catalog's order. */
export function deskGroups(pairs) {
  const groups = new Map();
  for (const { tier, feature } of pairs) {
    if (!groups.has(tier)) groups.set(tier, { tier, features: [] });
    groups.get(tier).features.push(feature);
  }
  return [...groups.values()];
}

/** The "split every N" field as planUpload takes it: null when blank, else the number. */
export function splitOf(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : Number(text);
}

/**
 * @param {{title: string, desk: string, file_url: string, no_public_source?: boolean, note: string, splitEvery: string}} draft
 * @param {{tier: string, feature: string}[]} pairs
 * @param {string[]} [hints]  the desk's hub URLs (D6)
 * @returns {{valid: boolean, errors: Record<string, string>}}
 */
export function validateDraft(draft, pairs, hints = []) {
  const errors = {};
  const title = String(draft.title ?? '').trim();
  if (!title) errors.title = 'A title is required.';
  else if (title.length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`;
  const desk = parsePairValue(draft.desk);
  if (!desk || !pairs.some((p) => p.tier === desk.tier && p.feature === desk.feature)) errors.desk = 'Choose a desk.';
  const url = sourceUrlError(draft, hints);
  if (url) errors.file_url = url;
  const split = String(draft.splitEvery ?? '').trim();
  if (split && !(/^\d+$/.test(split) && Number(split) >= 1)) errors.splitEvery = 'A whole number of pages, 1 or more.';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** uploadPlan's `meta` from the form, for the panel's mode (standalone by default). */
export function metaFromDraft(draft, plan, target = STANDALONE) {
  return uploadMeta(draft, plan, target);
}

/**
 * The duplicate gate: shows the prompt through `setPrompt` and settles when the admin chooses.
 * Accepting resolves (uploadPlan then sends the bytes); cancelling rejects with code `cancelled`,
 * which stops this file before any byte is sent.
 */
export function askDuplicates(documents, setPrompt) {
  return new Promise((resolve, reject) => {
    setPrompt({
      kind: 'duplicates',
      documents,
      accept() {
        setPrompt(null);
        resolve();
      },
      cancel() {
        setPrompt(null);
        reject(Object.assign(new Error('Cancelled; nothing was uploaded.'), { code: 'cancelled' }));
      },
    });
  });
}

/**
 * The key-holder gate (uploadPlan's `onKeyHolder`), before any byte is sent. Over legacy text it
 * waits for the admin to accept a second document (D3); over an ingestion-v2 document it stops
 * with `key_held` and the holder, so the panel can offer Replace (D2).
 */
export function askKeyHolder(holder, mode, setPrompt) {
  const decision = keyHolderDecision(holder, mode);
  if (decision === 'proceed') return Promise.resolve();
  if (decision === 'offer_replace') {
    return Promise.reject(new UploadError(
      'key_held',
      `“${holder.title || holder.document_id}” already holds this record; nothing was uploaded. Replace it instead, or unlink it first.`,
      { holder },
    ));
  }
  return new Promise((resolve, reject) => {
    setPrompt({
      kind: 'legacy',
      holder,
      accept() {
        setPrompt(null);
        resolve();
      },
      cancel() {
        setPrompt(null);
        reject(Object.assign(new Error('Cancelled; nothing was uploaded.'), { code: 'cancelled' }));
      },
    });
  });
}

/**
 * One line for the admin about how a file ended: `{tone: 'ok'|'warn'|'err', text, offer?}`. In
 * attach mode a `key_held` refusal offers Replace, and a file already uploaded offers to link it.
 */
export function describeResult(outcome, fileName, target = STANDALONE) {
  if (outcome instanceof Error) {
    if (outcome.code === 'cancelled') return { tone: 'warn', text: `${fileName}: cancelled; nothing was uploaded.` };
    const result = { tone: 'err', text: `${fileName}: ${outcome.message}` };
    if (outcome.code === 'key_held' && target.mode === 'attach') {
      const holder = outcome.holder ?? recordActions(target.record).holder;
      if (holder) result.offer = { kind: 'replace', record: target.record, holder };
    }
    return result;
  }
  if (outcome?.existing) {
    const { title, job_status: status, document_id: id } = outcome.existing;
    const result = title
      ? { tone: 'warn', text: `${fileName}: already uploaded as “${title}”${status ? ` (${status})` : ''}.` }
      : { tone: 'warn', text: `${fileName}: already uploaded (document ${id}).` };
    if (target.mode === 'attach' && id) result.offer = { kind: 'link', record: target.record, document_id: id };
    return result;
  }
  return { tone: 'ok', text: `${fileName}: registered; processing will start shortly.` };
}

/** Runs uploadPlan for one confirmed file and describes the outcome; never throws. */
export async function uploadFile({ plan, draft, target = STANDALONE, upload = uploadPlan, api, onProgress, setPrompt }) {
  try {
    const result = await upload(plan, metaFromDraft(draft, plan, target), {
      api,
      onProgress,
      onDuplicates: (documents) => askDuplicates(documents, setPrompt),
      onKeyHolder: (holder) => askKeyHolder(holder, target.mode, setPrompt),
    });
    return describeResult(result, plan.file_name, target);
  } catch (error) {
    return describeResult(error, plan.file_name, target);
  }
}

// ─── Presentational pieces ───────────────────────────────────────────────────

export function PlanSummary({ plan, fileBytes }) {
  const facts = [
    plural(plan.page_count, 'page'),
    plural(plan.parts.length, 'part'),
    formatMB(fileBytes),
    `estimated ${formatUsd(plan.estimated_usd)}`,
  ].join(' · ');
  return (
    <div className="adm-hint" style={{ marginTop: 0 }}>
      <b>{plan.file_name}</b>
      <div>{facts}</div>
      <div>OCR only; embedding adds under 1 %.</div>
      {plan.encrypted ? <span className="adm-pill archive">Encrypted</span> : null}
    </div>
  );
}

export function PartProgress({ parts, progress }) {
  return (
    <ol className="adm-parts">
      {parts.map((part) => {
        const state = progress[part.part_index] ?? 'waiting';
        const range = `Part ${part.part_index + 1} · pages ${part.page_offset + 1}–${part.page_offset + part.page_count}`;
        return (
          <li key={part.part_index} data-state={state}>
            <span>{range}</span>
            <b>{PART_STATE_LABEL[state] ?? 'waiting'}</b>
          </li>
        );
      })}
    </ol>
  );
}

/** What the panel will do with the next file, and a way back to a standalone upload. */
export function UploadTarget({ target, onStandalone }) {
  if (!keyedMode(target)) return <p className="adm-hint" style={{ marginTop: 0 }}>Standalone upload: the document is not linked to a record.</p>;
  const { record } = target;
  const back = <button className="adm-btn tiny ghost" type="button" onClick={() => onStandalone()}>Upload without a record instead</button>;
  if (target.mode === 'replace') {
    const old = target.holder.title || target.holder.document_id;
    return (
      <div className="adm-hint adm-target" style={{ marginTop: 0 }}>
        <b>{`Replace “${old}” on ${recordName(record)}`}</b>
        <div>The new PDF registers without a record; when it is live, swap it in from Documents without a record.</div>
        {back}
      </div>
    );
  }
  return (
    <div className="adm-hint adm-target" style={{ marginTop: 0 }}>
      <b>{`Attach a PDF to ${recordName(record)}`}</b>
      {recordActions(record).legacyWarning ? <div className="adm-msg err">{LEGACY_WARNING}</div> : null}
      {back}
    </div>
  );
}

export function UploadForm({ draft, pairs, planCurrent, busy = false, target = STANDALONE, onChange, onConfirm, onSkip, onReplan }) {
  const hints = hintsOf(target);
  const { valid, errors } = validateDraft(draft, pairs, hints);
  const field = (name) => (e) => onChange(name, e.target.value);
  const keyed = keyedMode(target);
  const deskPair = parsePairValue(draft.desk);
  const urlTyped = String(draft.file_url ?? '').trim() !== '';
  return (
    <div className="adm-form">
      <label className="adm-field span2">
        <span>Title</span>
        <input value={draft.title} maxLength={TITLE_MAX} required disabled={busy} aria-invalid={Boolean(errors.title)} onChange={field('title')} />
      </label>
      {keyed ? (
        <div className="adm-field span2">
          <span>Desk and record</span>
          <output className="adm-fixed">{`${deskPair ? `${deskPair.tier} · ${deskPair.feature}` : ''} · ${target.record.document_key}`}</output>
        </div>
      ) : (
        <label className="adm-field span2">
          <span>Desk</span>
          <select value={draft.desk} required disabled={busy} aria-invalid={Boolean(errors.desk)} onChange={field('desk')}>
            <option value="" disabled>Choose a desk</option>
            {deskGroups(pairs).map((group) => (
              <optgroup key={group.tier} label={group.tier}>
                {group.features.map((feature) => (
                  <option key={feature} value={pairValue(group.tier, feature)}>{feature}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <label className="adm-field">
        <span>Source URL</span>
        <input
          type="url"
          value={draft.file_url}
          placeholder="https://… the document’s own address"
          required={!draft.no_public_source}
          disabled={busy || Boolean(draft.no_public_source)}
          aria-invalid={urlTyped && Boolean(errors.file_url)}
          onChange={field('file_url')}
        />
        {hints.length ? <small className="adm-hint" style={{ marginTop: 0 }}>{`The desk’s source page is ${hints[0]} — paste the document’s own link.`}</small> : null}
        {urlTyped && errors.file_url ? <small className="adm-msg err">{errors.file_url}</small> : null}
      </label>
      <label className="adm-field adm-check">
        <input type="checkbox" checked={Boolean(draft.no_public_source)} disabled={busy} onChange={(e) => onChange('no_public_source', e.target.checked)} />
        <span>No public source</span>
      </label>
      <label className="adm-field">
        <span>Split every N pages (advanced)</span>
        <input
          type="number"
          min="1"
          step="1"
          value={draft.splitEvery}
          placeholder="Only if needed"
          disabled={busy}
          aria-invalid={Boolean(errors.splitEvery)}
          onChange={field('splitEvery')}
          onBlur={() => onReplan?.()}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        {errors.splitEvery ? <small className="adm-msg err">{errors.splitEvery}</small> : null}
      </label>
      <label className="adm-field span2">
        <span>Note (optional)</span>
        <textarea value={draft.note} disabled={busy} onChange={field('note')} />
      </label>
      <div className="adm-actions">
        <button className="adm-btn" type="button" disabled={busy || !valid || !planCurrent} onClick={() => onConfirm?.()}>Upload and ingest</button>
        <button className="adm-btn ghost" type="button" disabled={busy} onClick={() => onSkip?.()}>Skip</button>
      </div>
    </div>
  );
}

function duplicateText(documents) {
  const names = documents.map((doc) => `“${doc.title || doc.document_id}” (${doc.source_key})`).join(', ');
  return `This file is already in the corpus as ${names}; uploading adds a second copy.`;
}

export function DuplicateWarning({ documents, onAccept, onCancel }) {
  return (
    <div className="adm-hint" role="alert">
      <p className="adm-msg err" style={{ margin: 0 }}>{duplicateText(documents)}</p>
      <div className="adm-actions">
        <button className="adm-btn" type="button" onClick={() => onAccept?.()}>Upload a second copy</button>
        <button className="adm-btn ghost" type="button" onClick={() => onCancel?.()}>Cancel this file</button>
      </div>
    </div>
  );
}

/** D3: the record already has legacy text; attaching adds a second document. */
export function KeyHolderWarning({ holder, onAccept, onCancel }) {
  return (
    <div className="adm-hint" role="alert">
      <p className="adm-msg err" style={{ margin: 0 }}>{`“${holder.title || holder.document_id}” is legacy text for this record. ${LEGACY_WARNING}`}</p>
      <div className="adm-actions">
        <button className="adm-btn" type="button" onClick={() => onAccept?.()}>Attach as a second document</button>
        <button className="adm-btn ghost" type="button" onClick={() => onCancel?.()}>Cancel this file</button>
      </div>
    </div>
  );
}

const OFFER_LABEL = { replace: 'Replace instead', link: 'Link the existing document' };

/** One upload outcome, with its offer (Replace, or Link the existing document) as a button. */
export function ResultLine({ result, onOffer }) {
  const err = result.tone === 'err';
  return (
    <p className={err ? 'adm-msg err' : 'adm-msg'} role={err ? 'alert' : undefined}>
      {result.text}
      {result.offer ? (
        <>
          {' '}
          <button className="adm-btn tiny ghost" type="button" onClick={() => onOffer(result.offer)}>{OFFER_LABEL[result.offer.kind]}</button>
        </>
      ) : null}
    </p>
  );
}
