/**
 * Feature F341: Capabilities 8, 9 & 10 — Job Monitoring Drawer.
 *
 * Monitors asynchronous background indexing jobs live via Supabase Realtime with
 * a 3-second polling fallback. Allows inspection of OCR/Embedding steps, retrying
 * failed tasks, and safely cancelling queued operations.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Ban,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import {
  listIndexJobs,
  retryIndexJob,
  cancelIndexJob,
  formatBytes,
  formatRelativeDate,
} from './fileManagerService.js';

const STEP_LABELS = {
  ocr: 'Mistral OCR extraction',
  compose: 'Document normalization',
  chunk: 'Semantic chunking',
  embed: 'OpenRouter embeddings',
  commit: 'Vector database commit',
};

/**
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onJobUpdated?: () => void
 * }} props
 */
export default function DriveJobsDrawer({ isOpen, onClose, onJobUpdated }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'active' | 'succeeded' | 'failed'
  const [busyJobId, setBusyJobId] = useState(null);

  const fetchJobs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await listIndexJobs();
      setJobs(data || []);
    } catch (err) {
      console.error('Failed to load indexing jobs:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // Fetch on drawer open and subscribe to Supabase Realtime channel with 3s polling fallback
  useEffect(() => {
    if (!isOpen) return;

    fetchJobs();

    // 1. Supabase Realtime subscription
    const channel = supabase
      .channel('user-file-jobs-drawer')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_file_jobs' },
        () => {
          fetchJobs(true);
          onJobUpdated?.();
        }
      )
      .subscribe();

    // 2. Polling fallback every 3 seconds for active jobs
    const interval = setInterval(() => {
      fetchJobs(true);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [isOpen, fetchJobs, onJobUpdated]);

  const handleRetry = async (jobId, fileId) => {
    setBusyJobId(jobId);
    try {
      await retryIndexJob(jobId, fileId);
      await fetchJobs(true);
      onJobUpdated?.();
    } catch (err) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setBusyJobId(null);
    }
  };

  const handleCancel = async (jobId, fileId) => {
    setBusyJobId(jobId);
    try {
      await cancelIndexJob(jobId, fileId);
      await fetchJobs(true);
      onJobUpdated?.();
    } catch (err) {
      alert(`Cancellation failed: ${err.message}`);
    } finally {
      setBusyJobId(null);
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (activeTab === 'active') return j.status === 'queued' || j.status === 'running';
      if (activeTab === 'succeeded') return j.status === 'completed' || j.status === 'indexed';
      if (activeTab === 'failed') return j.status === 'failed';
      return true;
    });
  }, [jobs, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fm-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="AI Indexing Queue">
      <div className="fm-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fm-drawer-header">
          <div className="fm-drawer-title">
            <Loader2 size={16} className={jobs.some((j) => j.status === 'running') ? 'animate-spin' : ''} />
            <span>AI Indexing Queue</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="fm-btn"
              style={{ padding: '4px 8px' }}
              onClick={() => fetchJobs(false)}
              disabled={loading}
              title="Refresh queue"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="fm-btn"
              style={{ padding: '4px 8px' }}
              onClick={onClose}
              title="Close drawer"
              aria-label="Close indexing drawer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="fm-drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`fm-drawer-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All ({jobs.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'active'}
            className={`fm-drawer-tab ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            Active ({jobs.filter((j) => j.status === 'queued' || j.status === 'running').length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'succeeded'}
            className={`fm-drawer-tab ${activeTab === 'succeeded' ? 'active' : ''}`}
            onClick={() => setActiveTab('succeeded')}
          >
            Succeeded ({jobs.filter((j) => j.status === 'completed' || j.status === 'indexed').length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'failed'}
            className={`fm-drawer-tab ${activeTab === 'failed' ? 'active' : ''}`}
            onClick={() => setActiveTab('failed')}
          >
            Failed ({jobs.filter((j) => j.status === 'failed').length})
          </button>
        </div>

        {/* Jobs List */}
        <div className="fm-drawer-body">
          {filteredJobs.length === 0 ? (
            <div className="fm-empty-state" style={{ padding: '40px 0' }}>
              <Clock size={36} className="fm-empty-icon" />
              <div className="fm-empty-title">No jobs found</div>
              <div className="fm-empty-desc">
                {activeTab === 'active'
                  ? 'No active indexing jobs in progress.'
                  : 'Files queued for AI indexing will appear here.'}
              </div>
            </div>
          ) : (
            filteredJobs.map((job) => {
              const fileName = job.user_files?.name || `File ${job.file_id?.slice(0, 8)}`;
              const fileSize = job.user_files?.size_bytes;
              const isBusy = busyJobId === job.id;

              return (
                <div key={job.id} className="fm-job-card">
                  <div className="fm-job-card-header">
                    <div>
                      <div className="fm-job-name">{fileName}</div>
                      <div className="fm-job-meta">
                        {fileSize && <span>{formatBytes(fileSize)}</span>}
                        {job.created_at && <span>· {formatRelativeDate(job.created_at)}</span>}
                        {job.attempt_count > 0 && <span>· Attempt {job.attempt_count}/3</span>}
                      </div>
                    </div>

                    {/* Status Badge */}
                    {job.status === 'queued' && (
                      <span className="fm-pill fm-pill-queued">
                        <Clock size={11} /> Queued
                      </span>
                    )}
                    {job.status === 'running' && (
                      <span className="fm-pill fm-pill-running">
                        <Loader2 size={11} className="animate-spin" /> Ingesting
                      </span>
                    )}
                    {(job.status === 'completed' || job.status === 'indexed') && (
                      <span className="fm-pill fm-pill-indexed">
                        <CheckCircle2 size={11} /> Indexed
                      </span>
                    )}
                    {job.status === 'failed' && (
                      <span className="fm-pill fm-pill-failed">
                        <AlertCircle size={11} /> Failed
                      </span>
                    )}
                    {job.status === 'cancelled' && (
                      <span className="fm-pill fm-pill-unsupported">
                        <Ban size={11} /> Cancelled
                      </span>
                    )}
                  </div>

                  {/* Active Step Progress */}
                  {job.status === 'running' && (
                    <div style={{ fontSize: 11, color: 'var(--accent)' }}>
                      <strong>Current Stage:</strong> {STEP_LABELS[job.step] || job.step}
                    </div>
                  )}

                  {/* Error Message */}
                  {job.status === 'failed' && job.error_message && (
                    <div className="fm-job-error">
                      <strong>Error:</strong> {job.error_message}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                    {job.status === 'failed' && (
                      <button
                        type="button"
                        className="fm-btn fm-btn-primary"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleRetry(job.id, job.file_id)}
                        disabled={isBusy}
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                        <span>Retry</span>
                      </button>
                    )}

                    {(job.status === 'queued' || job.status === 'running') && (
                      <button
                        type="button"
                        className="fm-btn"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleCancel(job.id, job.file_id)}
                        disabled={isBusy}
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
