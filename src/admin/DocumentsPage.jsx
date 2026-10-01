import { useCallback, useEffect, useRef, useState } from 'react';
import { createAdminIngestApi, deskPairs, planUpload } from '../lib/corpusUpload.js';
import { plural } from './documents/format.js';
import { JobsTable, mergeJobs, shouldPoll } from './documents/jobs.jsx';
import { BILL_DESK, linkExistingRequest, pairValue, recordsDesk, runAction, draftFor } from './documents/model.js';
import { DeskPicker, RecordsSection } from './documents/records.jsx';
import { UnlinkedSection } from './documents/unlinked.jsx';
import {
  DuplicateWarning, KeyHolderWarning, PartProgress, PlanSummary, ResultLine, UploadForm, UploadTarget, hintsOf, splitOf, uploadFile, validateDraft,
} from './documents/upload.jsx';

/**
 * The admin panel's Documents tab: records-first corpus management (R8, Amendment A of
 * docs/specs/2026-10-01-rag-v2-admin-upload.md; plans B4 and C4).
 *
 * - Records: pick a desk; a keyed desk lists one row per record key with its status, documents
 *   and actions (attach, replace, unlink, re-link, delete), each destructive one confirmed in the
 *   page. Desks without keys offer standalone uploads only (F40).
 * - Documents without a record: Link, Delete and Swap.
 * - Upload: one panel in three modes (attach, replace, standalone), with the D6 source-URL rule
 *   and the D3 and key-holder warnings.
 * - Ingest jobs: as before, with a Record column.
 *
 * AdminApp loads this module lazily, so corpusUpload.js, its desk catalog and the PDF libraries
 * stay out of the main bundle. The pieces live in ./documents/; the ones the earlier tests use are
 * re-exported here.
 */

export { formatMB, formatUsd, relativeTime, titleFromFileName } from './documents/format.js';
export { JobsTable, jobActions, mergeJobs, shouldPoll } from './documents/jobs.jsx';
export {
  DuplicateWarning, PartProgress, PlanSummary, UploadForm, askDuplicates, deskGroups, describeResult, metaFromDraft, uploadFile, validateDraft,
} from './documents/upload.jsx';

const JOBS_PAGE = 20;
const POLL_MS = 10_000;
const RESULTS_KEPT = 10;
const BILL_VALUE = pairValue(BILL_DESK.tier, BILL_DESK.feature);
const STANDALONE = Object.freeze({ mode: 'standalone' });

let nextEntryId = 1;

/**
 * @param {{api?: ReturnType<typeof createAdminIngestApi>}} props  `api` is for tests; the tab
 *   uses the default admin-ingest client.
 */
export default function DocumentsPage({ api: injectedApi } = {}) {
  const [api] = useState(() => injectedApi ?? createAdminIngestApi());
  const [pairs] = useState(() => deskPairs());
  const [deskValue, setDeskValue] = useState(BILL_VALUE);
  const [reloadToken, setReloadToken] = useState(0);
  const [target, setTarget] = useState(STANDALONE);
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
  const uploadCard = useRef(null);

  const desk = recordsDesk(deskValue);
  const reloadLists = useCallback(() => setReloadToken((t) => t + 1), []);

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
  }, [refresh, reloadToken]);

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
      if (kind === 'discard' && mounted.current) reloadLists();
    } catch (error) {
      if (mounted.current) setBanner(error.message || String(error));
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  // ─── The upload panel's mode ───
  const uploading = current?.status === 'uploading';

  /** Switches the panel's mode; a file waiting in the form takes the new mode's title and desk. */
  function chooseTarget(next) {
    if (uploading) return;
    setTarget(next);
    setCurrent((cur) => {
      if (!cur) return cur;
      const fresh = draftFor(next, cur.file);
      return { ...cur, draft: { ...cur.draft, title: fresh.title, desk: fresh.desk || cur.draft.desk } };
    });
    uploadCard.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const standaloneTarget = () => ({ mode: 'standalone', desk: deskValue });

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
    const entry = { id: nextEntryId++, file, bytes: null, plan: null, plannedSplit: null, status: 'reading', error: '', draft: draftFor(target, file), progress: {} };
    setQueue(rest);
    setCurrent(entry);
    void planEntry(entry, null);
  }, [current, queue, planEntry, target]);

  function onPick(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    // An attach or a replacement is one PDF for one record.
    setQueue((q) => (target.mode === 'standalone' ? [...q, ...files] : [...q, files[0]]));
  }

  function addResult(result) {
    setResults((list) => [{ id: nextEntryId++, ...result }, ...list].slice(0, RESULTS_KEPT));
  }

  function finish(result) {
    addResult(result);
    setCurrent(null);
  }

  function onChangeDraft(name, value) {
    if (!current) return;
    patchCurrent(current.id, (cur) => ({ draft: { ...cur.draft, [name]: value } }));
  }

  function onReplan() {
    if (!current || !current.bytes || current.status === 'uploading') return;
    const { valid, errors } = validateDraft(current.draft, pairs, hintsOf(target));
    if (!valid && errors.splitEvery) return;
    const split = splitOf(current.draft.splitEvery);
    if (split === current.plannedSplit && current.status === 'ready') return;
    void planEntry(current, split);
  }

  async function onConfirm() {
    if (!current?.plan || current.status !== 'ready') return;
    if (!validateDraft(current.draft, pairs, hintsOf(target)).valid || splitOf(current.draft.splitEvery) !== current.plannedSplit) return;
    const { id, plan, draft } = current;
    const mode = target;
    patchCurrent(id, { status: 'uploading', progress: {} });
    const result = await uploadFile({
      plan,
      draft,
      target: mode,
      api,
      setPrompt,
      onProgress: ({ part_index, state }) => {
        if (mounted.current) patchCurrent(id, (cur) => ({ progress: { ...cur.progress, [part_index]: state } }));
      },
    });
    if (!mounted.current) return;
    if (result.tone === 'err') {
      // Stored parts are found again by `prepare`, so pressing Upload again resumes. A key_held
      // refusal keeps the file too, so "Replace instead" uploads it as the replacement.
      addResult(result);
      patchCurrent(id, { status: 'ready' });
      return;
    }
    finish(result);
    if (result.tone === 'ok') {
      if (mode.mode !== 'standalone') setTarget(standaloneTarget());
      void refresh();
      reloadLists();
    }
  }

  function onSkip() {
    if (!current || current.status === 'uploading') return;
    planToken.current += 1;
    finish({ tone: 'warn', text: `${current.file.name}: skipped.` });
  }

  async function onOffer(offer) {
    if (offer.kind === 'replace') {
      chooseTarget({ mode: 'replace', record: offer.record, holder: offer.holder });
      return;
    }
    const res = await runAction(api, 'link', linkExistingRequest(offer));
    if (!mounted.current) return;
    if (res.ok === false) addResult({ tone: 'err', text: res.text });
    else addResult({ tone: 'ok', text: `Linked the existing document to ${offer.record.document_key}.` });
    if (res.ok !== false || res.stale) reloadLists();
  }

  const planCurrent = Boolean(current?.plan) && current.status === 'ready'
    && splitOf(current.draft.splitEvery) === current.plannedSplit;

  return (
    <>
      <h1 className="adm-h1">Documents</h1>
      <p className="adm-lede">
        Manage the research corpus by record. Attach a PDF to a bill, replace, unlink, re-link or delete an upload, and
        follow every ingest job. Legacy text is read-only here.
      </p>

      <div className="adm-card">
        <h2>Records</h2>
        <div className="adm-form">
          <DeskPicker value={deskValue} pairs={pairs} onChange={setDeskValue} />
        </div>
        {desk?.keyed ? (
          <RecordsSection
            key={`${desk.tier}|${desk.feature}`}
            api={api}
            desk={desk}
            reloadToken={reloadToken}
            uploading={uploading}
            onChanged={reloadLists}
            onAttach={(record) => chooseTarget({ mode: 'attach', record })}
            onReplace={(record, doc) => chooseTarget({ mode: 'replace', record, holder: doc })}
          />
        ) : (
          <div className="adm-hint">
            <p style={{ margin: 0 }}>This desk has no record keys yet, so its documents cannot be linked to records. Standalone uploads only.</p>
            <div className="adm-actions">
              <button className="adm-btn tiny ghost" type="button" disabled={uploading} onClick={() => chooseTarget(standaloneTarget())}>Upload to this desk</button>
            </div>
          </div>
        )}
      </div>

      {desk ? (
        <div className="adm-card">
          <h2>Documents without a record</h2>
          <UnlinkedSection key={`${desk.tier}|${desk.feature}`} api={api} desk={desk} reloadToken={reloadToken} onChanged={reloadLists} />
        </div>
      ) : null}

      <div className="adm-card" ref={uploadCard}>
        <h2>Upload</h2>
        <UploadTarget target={target} onStandalone={() => chooseTarget(standaloneTarget())} />
        <div className="adm-form">
          <label className="adm-field span2">
            <span>{target.mode === 'standalone' ? 'PDF files' : 'PDF file'}</span>
            <input type="file" multiple={target.mode === 'standalone'} accept="application/pdf,.pdf" onChange={onPick} />
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
                  target={target}
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
            {prompt?.kind === 'legacy' ? <KeyHolderWarning holder={prompt.holder} onAccept={prompt.accept} onCancel={prompt.cancel} /> : null}
            {prompt && prompt.kind !== 'legacy' ? <DuplicateWarning documents={prompt.documents} onAccept={prompt.accept} onCancel={prompt.cancel} /> : null}
          </div>
        ) : null}

        {results.map((r) => <ResultLine key={r.id} result={r} onOffer={(offer) => { void onOffer(offer); }} />)}
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
