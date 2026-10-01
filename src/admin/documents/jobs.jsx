import { formatUsd, relativeTime, truncate } from './format.js';

// The Documents tab's ingest-jobs table (R8, plan B4). The Record column (Amendment A, plan C4)
// reads JobRow.document_key, the key the job's document holds; "—" when it holds none.

const UPLOAD_KEY_PREFIX = 'upload:';
const ERROR_SHOWN_CHARS = 60;
const ACTIVE = new Set(['queued', 'running']);
const ENDED = new Set(['failed', 'cancelled']);
const PILL = { queued: 'archive', running: 'local', succeeded: 'live', failed: 'inactive', cancelled: 'inactive' };

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

export function JobsTable({ jobs, now, busyId, confirmId, onRetry, onCancel, onAskDiscard, onDiscard, onKeep }) {
  if (!jobs.length) return <p className="adm-hint">No ingest jobs yet.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Record</th>
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
                <td className="note">{job.document_key || '—'}</td>
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
