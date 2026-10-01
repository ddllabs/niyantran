import { useCallback, useEffect, useRef, useState } from 'react';
import { createAdminIngestApi, deskPairs, planUpload, uploadPlan } from '../lib/corpusUpload.js';

/**
 * The admin panel's Documents tab (R8, docs/specs/2026-10-01-rag-v2-admin-upload.md; plan B4).
 * An admin picks PDFs; each is read and planned (pages, parts, estimated OCR cost), described
 * (title, desk, source, note) and uploaded through admin-ingest, then followed in the jobs table.
 *
 * AdminApp loads this module lazily, so corpusUpload.js, its desk catalog and the PDF libraries
 * stay out of the main bundle. Pure helpers and presentational pieces are named exports so they
 * can be tested without a DOM (src/admin/documentsPage.test.jsx).
 */

const JOBS_PAGE = 20;
const POLL_MS = 10_000;
const TITLE_MAX = 300;
const ERROR_SHOWN_CHARS = 60;
const UPLOAD_KEY_PREFIX = 'upload:';
const ACTIVE = new Set(['queued', 'running']);
const ENDED = new Set(['failed', 'cancelled']);
const PILL = { queued: 'archive', running: 'local', succeeded: 'live', failed: 'inactive', cancelled: 'inactive' };
const PART_STATE_LABEL = { queued: 'queued', uploading: 'uploading', verifying: 'verifying', stored: 'stored' };

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Decimal megabytes, as the upload limits are stated: two places under 10 MB, one above. */
export function formatMB(bytes) {
  const mb = (Number(bytes) || 0) / 1_000_000;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

/** US dollars to four places (a page of OCR costs $0.004). */
export function formatUsd(value) {
  return `$${(Number(value) || 0).toFixed(4)}`;
}

/** "in 30 s", "3 min ago", "3 h ago", "just now"; "—" when there is no time. */
export function relativeTime(iso, now = Date.now()) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '—';
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < 5_000) return 'just now';
  let amount;
  if (abs < 60_000) amount = `${Math.round(abs / 1000)} s`;
  else if (abs < 3_600_000) amount = `${Math.round(abs / 60_000)} min`;
  else if (abs < 48 * 3_600_000) amount = `${Math.round(abs / 3_600_000)} h`;
  else amount = `${Math.round(abs / 86_400_000)} d`;
  return diff > 0 ? `in ${amount}` : `${amount} ago`;
}

export function titleFromFileName(name) {
  const bare = String(name ?? '').replace(/\.pdf$/i, '').trim();
  return bare || String(name ?? '');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ─── The form ────────────────────────────────────────────────────────────────

/** Catalog pairs grouped by tier, keeping the catalog's order. */
export function deskGroups(pairs) {
  const groups = new Map();
  for (const { tier, feature } of pairs) {
    if (!groups.has(tier)) groups.set(tier, { tier, features: [] });
    groups.get(tier).features.push(feature);
  }
  return [...groups.values()];
}

const pairValue = (tier, feature) => `${tier}|${feature}`;
function parsePairValue(value) {
  const at = String(value ?? '').indexOf('|');
  return at < 1 ? null : { tier: value.slice(0, at), feature: value.slice(at + 1) };
}

/** The "split every N" field as planUpload takes it: null when blank, else the number. */
function splitOf(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : Number(text);
}

function isHttpUrl(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{title: string, desk: string, file_url: string, note: string, splitEvery: string}} draft
 * @param {{tier: string, feature: string}[]} pairs
 * @returns {{valid: boolean, errors: Record<string, string>}}
 */
export function validateDraft(draft, pairs) {
  const errors = {};
  const title = String(draft.title ?? '').trim();
  if (!title) errors.title = 'A title is required.';
  else if (title.length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`;
  const desk = parsePairValue(draft.desk);
  if (!desk || !pairs.some((p) => p.tier === desk.tier && p.feature === desk.feature)) errors.desk = 'Choose a desk.';
  const url = String(draft.file_url ?? '').trim();
  if (url && !isHttpUrl(url)) errors.file_url = 'Use an http(s) address, or leave it blank.';
  const split = String(draft.splitEvery ?? '').trim();
  if (split && !(/^\d+$/.test(split) && Number(split) >= 1)) errors.splitEvery = 'A whole number of pages, 1 or more.';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** uploadPlan's `meta` from the form. */
export function metaFromDraft(draft, plan) {
  const desk = parsePairValue(draft.desk) ?? { tier: '', feature: '' };
  const text = (value) => String(value ?? '').trim() || null;
  return {
    title: String(draft.title ?? '').trim(),
    desk_tier: desk.tier,
    desk_feature: desk.feature,
    file_url: text(draft.file_url),
    note: text(draft.note),
    file_name: plan.file_name,
  };
}

// ─── Uploading ───────────────────────────────────────────────────────────────

/**
 * The duplicate gate: shows the prompt through `setPrompt` and settles when the admin chooses.
 * Accepting resolves (uploadPlan then sends the bytes); cancelling rejects with code `cancelled`,
 * which stops this file before any byte is sent.
 */
export function askDuplicates(documents, setPrompt) {
  return new Promise((resolve, reject) => {
    setPrompt({
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

/** One line for the admin about how a file ended: `{tone: 'ok'|'warn'|'err', text}`. */
export function describeResult(outcome, fileName) {
  if (outcome instanceof Error) {
    if (outcome.code === 'cancelled') return { tone: 'warn', text: `${fileName}: cancelled; nothing was uploaded.` };
    return { tone: 'err', text: `${fileName}: ${outcome.message}` };
  }
  if (outcome?.existing) {
    const { title, job_status: status, document_id: id } = outcome.existing;
    if (title) return { tone: 'warn', text: `${fileName}: already uploaded as “${title}”${status ? ` (${status})` : ''}.` };
    return { tone: 'warn', text: `${fileName}: already uploaded (document ${id}).` };
  }
  return { tone: 'ok', text: `${fileName}: registered; processing will start shortly.` };
}

/** Runs uploadPlan for one confirmed file and describes the outcome; never throws. */
export async function uploadFile({ plan, draft, upload = uploadPlan, api, onProgress, setPrompt }) {
  try {
    const result = await upload(plan, metaFromDraft(draft, plan), {
      api,
      onProgress,
      onDuplicates: (documents) => askDuplicates(documents, setPrompt),
    });
    return describeResult(result, plan.file_name);
  } catch (error) {
    return describeResult(error, plan.file_name);
  }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

/** Refresh while any job is queued or running. */
export function shouldPoll(jobs) {
  return jobs.some((job) => ACTIVE.has(job.status));
}

/**
 * Which actions a job row offers. Discard mirrors ingest_discard's conditions as far as the jobs
 * list can tell: an `upload:` document, this job failed or cancelled, the document not live (a
 * row's `indexed`, when present), and no other loaded job of the same document queued, running or
 * succeeded. The server still decides; a refusal shows in the banner.
 */
export function jobActions(job, jobs = []) {
  const ended = ENDED.has(job.status);
  const otherHolds = jobs.some((other) => other.document_id === job.document_id && other.job_id !== job.job_id
    && (ACTIVE.has(other.status) || other.status === 'succeeded'));
  return {
    retry: ended,
    cancel: ACTIVE.has(job.status),
    discard: ended && String(job.source_key ?? '').startsWith(UPLOAD_KEY_PREFIX) && job.indexed !== true && !otherHolds,
  };
}

/** A refreshed first page merged into the loaded rows: fresh rows win, newest first. */
export function mergeJobs(current, fresh) {
  const byId = new Map(current.map((job) => [job.job_id, job]));
  for (const job of fresh) byId.set(job.job_id, job);
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function nextAttemptLabel(job, now) {
  if (job.status !== 'queued' || !job.next_attempt_at) return '—';
  return Date.parse(job.next_attempt_at) > now ? relativeTime(job.next_attempt_at, now) : '—';
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

export function UploadForm({ draft, pairs, planCurrent, busy = false, onChange, onConfirm, onSkip, onReplan }) {
  const { valid, errors } = validateDraft(draft, pairs);
  const field = (name) => (e) => onChange(name, e.target.value);
  return (
    <div className="adm-form">
      <label className="adm-field span2">
        <span>Title</span>
        <input value={draft.title} maxLength={TITLE_MAX} required disabled={busy} aria-invalid={Boolean(errors.title)} onChange={field('title')} />
      </label>
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
      <label className="adm-field">
        <span>Source URL (optional)</span>
        <input type="url" value={draft.file_url} placeholder="https://…" disabled={busy} aria-invalid={Boolean(errors.file_url)} onChange={field('file_url')} />
        {errors.file_url ? <small className="adm-msg err">{errors.file_url}</small> : null}
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

export function JobsTable({ jobs, now, busyId, confirmId, onRetry, onCancel, onAskDiscard, onDiscard, onKeep }) {
  if (!jobs.length) return <p className="adm-hint">No ingest jobs yet.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Pages</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Next attempt</th>
            <th>Error</th>
            <th>Cost</th>
            <th>Requested by</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const allowed = jobActions(job, jobs);
            const busy = busyId === job.job_id;
            const desk = [job.desk_tier, job.desk_feature].filter(Boolean).join(' · ');
            const error = job.error_code || job.last_error ? [job.error_code, job.last_error].filter(Boolean).join(': ') : '';
            return (
              <tr key={job.job_id} data-job={job.job_id}>
                <td>
                  <span className="feat">{job.title || job.document_id}</span>
                  {desk ? <div className="note">{desk}</div> : null}
                </td>
                <td>{`${job.ocr_pages} / ${job.pages_total}`}</td>
                <td>{job.stage}</td>
                <td><span className={`adm-pill ${PILL[job.status] ?? 'archive'}`}>{job.status}</span></td>
                <td>{job.attempts}</td>
                <td>{nextAttemptLabel(job, now)}</td>
                <td className="note" title={error || undefined}>{error ? truncate(error, ERROR_SHOWN_CHARS) : '—'}</td>
                <td>{formatUsd((Number(job.ocr_cost_usd) || 0) + (Number(job.embed_cost_usd) || 0))}</td>
                <td>{job.requested_by_email || '—'}</td>
                <td className="when" title={job.created_at}>{relativeTime(job.created_at, now)}</td>
                <td>
                  {confirmId === job.job_id ? (
                    <div className="adm-actions" style={{ marginTop: 0 }}>
                      <span className="note">Discard this upload?</span>
                      <button className="adm-btn tiny danger" type="button" disabled={busy} onClick={() => onDiscard(job)}>Confirm discard</button>
                      <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onKeep()}>Keep</button>
                    </div>
                  ) : (
                    <div className="adm-actions" style={{ marginTop: 0 }}>
                      {allowed.retry ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onRetry(job)}>Retry</button> : null}
                      {allowed.cancel ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onCancel(job)}>Cancel</button> : null}
                      {allowed.discard ? <button className="adm-btn tiny ghost" type="button" disabled={busy} onClick={() => onAskDiscard(job)}>Discard</button> : null}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

let nextEntryId = 1;
const emptyDraft = (file) => ({ title: titleFromFileName(file.name), desk: '', file_url: '', note: '', splitEvery: '' });

/**
 * @param {{api?: ReturnType<typeof createAdminIngestApi>}} props  `api` is for tests; the tab
 *   uses the default admin-ingest client.
 */
export default function DocumentsPage({ api: injectedApi } = {}) {
  const [api] = useState(() => injectedApi ?? createAdminIngestApi());
  const [pairs] = useState(() => deskPairs());
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [results, setResults] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [banner, setBanner] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const planToken = useRef(0);
  const loadedMore = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ─── Jobs ───
  const refresh = useCallback(async () => {
    try {
      const res = await api.jobs({ limit: JOBS_PAGE });
      if (!mounted.current) return;
      const fresh = Array.isArray(res?.jobs) ? res.jobs : [];
      if (loadedMore.current) {
        setJobs((cur) => mergeJobs(cur, fresh));
      } else {
        setJobs(fresh);
        setCursor(res?.next_before ?? null);
      }
    } catch (error) {
      if (mounted.current) setBanner(error.message || String(error));
    } finally {
      if (mounted.current) {
        setNow(Date.now());
        setJobsLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = shouldPoll(jobs);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [active, refresh]);

  async function loadMore() {
    if (!cursor) return;
    setJobsLoading(true);
    try {
      const res = await api.jobs({ limit: JOBS_PAGE, before: cursor });
      if (!mounted.current) return;
      loadedMore.current = true;
      setJobs((cur) => mergeJobs(cur, Array.isArray(res?.jobs) ? res.jobs : []));
      setCursor(res?.next_before ?? null);
    } catch (error) {
      if (mounted.current) setBanner(error.message || String(error));
    } finally {
      if (mounted.current) setJobsLoading(false);
    }
  }

  async function act(kind, job) {
    setBusyId(job.job_id);
    setBanner('');
    try {
      if (kind === 'retry') await api.retry(job.job_id);
      else if (kind === 'cancel') await api.cancel(job.job_id);
      else {
        await api.discard(job.document_id);
        // The discard cascades to the document's jobs; drop them here as well as on the server.
        if (mounted.current) setJobs((cur) => cur.filter((row) => row.document_id !== job.document_id));
      }
      if (mounted.current) setConfirmId(null);
      await refresh();
    } catch (error) {
      if (mounted.current) setBanner(error.message || String(error));
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  // ─── The upload queue, one file at a time ───
  const patchCurrent = useCallback((id, patch) => {
    setCurrent((cur) => (cur && cur.id === id ? { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } : cur));
  }, []);

  const planEntry = useCallback(async (entry, split) => {
    const token = ++planToken.current;
    patchCurrent(entry.id, { status: 'reading', error: '' });
    try {
      const bytes = entry.bytes ?? new Uint8Array(await entry.file.arrayBuffer());
      const plan = await planUpload({ name: entry.file.name, bytes }, { splitEvery: split });
      if (!mounted.current || token !== planToken.current) return;
      patchCurrent(entry.id, { bytes, plan, plannedSplit: split, status: 'ready' });
    } catch (error) {
      if (!mounted.current || token !== planToken.current) return;
      patchCurrent(entry.id, { status: 'error', error: error.message || String(error) });
    }
  }, [patchCurrent]);

  useEffect(() => {
    if (current || !queue.length) return;
    const [file, ...rest] = queue;
    const entry = { id: nextEntryId++, file, bytes: null, plan: null, plannedSplit: null, status: 'reading', error: '', draft: emptyDraft(file), progress: {} };
    setQueue(rest);
    setCurrent(entry);
    void planEntry(entry, null);
  }, [current, queue, planEntry]);

  function onPick(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) setQueue((q) => [...q, ...files]);
  }

  function finish(result) {
    setResults((list) => [{ id: nextEntryId++, ...result }, ...list].slice(0, 10));
    setCurrent(null);
  }

  function onChangeDraft(name, value) {
    if (!current) return;
    patchCurrent(current.id, (cur) => ({ draft: { ...cur.draft, [name]: value } }));
  }

  function onReplan() {
    if (!current || !current.bytes || current.status === 'uploading') return;
    const { valid, errors } = validateDraft(current.draft, pairs);
    if (!valid && errors.splitEvery) return;
    const split = splitOf(current.draft.splitEvery);
    if (split === current.plannedSplit && current.status === 'ready') return;
    void planEntry(current, split);
  }

  async function onConfirm() {
    if (!current?.plan || current.status !== 'ready') return;
    if (!validateDraft(current.draft, pairs).valid || splitOf(current.draft.splitEvery) !== current.plannedSplit) return;
    const { id, plan, draft } = current;
    patchCurrent(id, { status: 'uploading', progress: {} });
    const result = await uploadFile({
      plan,
      draft,
      api,
      setPrompt,
      onProgress: ({ part_index, state }) => {
        if (mounted.current) patchCurrent(id, (cur) => ({ progress: { ...cur.progress, [part_index]: state } }));
      },
    });
    if (!mounted.current) return;
    if (result.tone === 'err') {
      // Stored parts are found again by `prepare`, so pressing Upload again resumes.
      setResults((list) => [{ id: nextEntryId++, ...result }, ...list].slice(0, 10));
      patchCurrent(id, { status: 'ready' });
      return;
    }
    finish(result);
    if (result.tone === 'ok') void refresh();
  }

  function onSkip() {
    if (!current || current.status === 'uploading') return;
    planToken.current += 1;
    finish({ tone: 'warn', text: `${current.file.name}: skipped.` });
  }

  const planCurrent = Boolean(current?.plan) && current.status === 'ready'
    && splitOf(current.draft.splitEvery) === current.plannedSplit;
  const uploading = current?.status === 'uploading';

  return (
    <>
      <h1 className="adm-h1">Documents</h1>
      <p className="adm-lede">
        Upload PDFs to the research corpus. Each file is checked, split if it is too large for OCR, stored, and then
        read, chunked and embedded by the ingest worker. Follow every job below; retry, cancel, or discard an upload that
        never went live.
      </p>

      <div className="adm-card">
        <h2>Upload</h2>
        <div className="adm-form">
          <label className="adm-field span2">
            <span>PDF files</span>
            <input type="file" multiple accept="application/pdf,.pdf" onChange={onPick} />
          </label>
        </div>
        {queue.length ? <p className="adm-hint">{`${plural(queue.length, 'more file')} waiting.`}</p> : null}

        {current ? (
          <div style={{ marginTop: 14 }}>
            {current.status === 'reading' ? <p className="adm-hint">{`Reading ${current.file.name}…`}</p> : null}
            {current.error ? <p className="adm-msg err" role="alert">{`${current.file.name}: ${current.error}`}</p> : null}
            {current.plan ? (
              <>
                <PlanSummary plan={current.plan} fileBytes={current.file.size} />
                <UploadForm
                  draft={current.draft}
                  pairs={pairs}
                  planCurrent={planCurrent}
                  busy={uploading}
                  onChange={onChangeDraft}
                  onReplan={onReplan}
                  onConfirm={onConfirm}
                  onSkip={onSkip}
                />
                {uploading && Object.keys(current.progress).length ? <PartProgress parts={current.plan.parts} progress={current.progress} /> : null}
              </>
            ) : current.status === 'error' ? (
              <div className="adm-actions">
                <button className="adm-btn ghost" type="button" onClick={onSkip}>Skip</button>
              </div>
            ) : null}
            {prompt ? <DuplicateWarning documents={prompt.documents} onAccept={prompt.accept} onCancel={prompt.cancel} /> : null}
          </div>
        ) : null}

        {results.map((r) => (
          <p key={r.id} className={r.tone === 'err' ? 'adm-msg err' : 'adm-msg'} role={r.tone === 'err' ? 'alert' : undefined}>{r.text}</p>
        ))}
      </div>

      <div className="adm-card">
        <h2>Ingest jobs</h2>
        {banner ? <p className="adm-msg err" role="alert">{banner}</p> : null}
        {jobsLoading && !jobs.length ? <p className="adm-hint">Loading jobs…</p> : (
          <JobsTable
            jobs={jobs}
            now={now}
            busyId={busyId}
            confirmId={confirmId}
            onRetry={(job) => act('retry', job)}
            onCancel={(job) => act('cancel', job)}
            onAskDiscard={(job) => setConfirmId(job.job_id)}
            onDiscard={(job) => act('discard', job)}
            onKeep={() => setConfirmId(null)}
          />
        )}
        <div className="adm-actions">
          <button className="adm-btn tiny ghost" type="button" disabled={jobsLoading} onClick={() => { void refresh(); }}>Refresh</button>
          {cursor ? <button className="adm-btn tiny ghost" type="button" disabled={jobsLoading} onClick={loadMore}>Load more</button> : null}
        </div>
      </div>
    </>
  );
}
