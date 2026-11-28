/**
 * Feature F341: Dedicated Upload Progress Queue Manager (Phase 3).
 *
 * Provides a floating, persistent queue manager panel docked in the bottom-right:
 * - Independent state for every file: queued, uploading (0-100%), processing, completed, failed.
 * - Cancel in-flight upload (aborts XMLHttpRequest).
 * - Retry button for failed uploads.
 * - Auto-rename indicators for resolved duplicate filenames.
 * - Dismiss individual entries or clear all completed.
 * - Minimize / expand toggle with animated state transitions.
 */

import { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Image as ImageIcon,
  CheckCheck,
} from 'lucide-react';
import { formatBytes } from './fileManagerService.js';

function getQueueFileIcon(name = '', mimeType = '') {
  const m = (mimeType || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (m === 'application/pdf' || ext === 'pdf') {
    return <FileText size={16} style={{ color: '#dc2626' }} />;
  }
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) {
    return <ImageIcon size={16} style={{ color: '#0284c7' }} />;
  }
  if (
    m.includes('spreadsheet') ||
    m.includes('csv') ||
    m.includes('excel') ||
    ['csv', 'xlsx', 'xls', 'tsv'].includes(ext)
  ) {
    return <FileSpreadsheet size={16} style={{ color: '#16a34a' }} />;
  }
  if (
    m.includes('json') ||
    m.includes('javascript') ||
    m.includes('typescript') ||
    m.includes('markdown') ||
    ['js', 'ts', 'jsx', 'tsx', 'json', 'md', 'html', 'css', 'py', 'sql'].includes(ext)
  ) {
    return <FileCode size={16} style={{ color: '#7c3aed' }} />;
  }
  if (m.includes('zip') || m.includes('tar') || m.includes('gzip') || ['zip', 'tar', 'gz', 'rar'].includes(ext)) {
    return <FileArchive size={16} style={{ color: '#ea580c' }} />;
  }
  return <FileText size={16} style={{ color: 'var(--muted)' }} />;
}

/**
 * @param {{
 *   queue: Array<{
 *     id: string,
 *     file?: File,
 *     name: string,
 *     originalName?: string,
 *     size: number,
 *     status: 'queued' | 'uploading' | 'processing' | 'completed' | 'failed',
 *     percent: number,
 *     error?: string | null,
 *     folderName?: string
 *   }>,
 *   onCancel: (id: string) => void,
 *   onRetry: (id: string) => void,
 *   onDismiss: (id: string) => void,
 *   onClearCompleted: () => void,
 *   onClose?: () => void
 * }} props
 */
export default function UploadQueuePanel({
  queue = [],
  onCancel,
  onRetry,
  onDismiss,
  onClearCompleted,
  onClose,
}) {
  const [isMinimized, setIsMinimized] = useState(false);

  if (!queue || queue.length === 0) return null;

  const totalCount = queue.length;
  const inFlightCount = queue.filter(
    (item) => item.status === 'uploading' || item.status === 'processing'
  ).length;
  const queuedCount = queue.filter((item) => item.status === 'queued').length;
  const completedCount = queue.filter((item) => item.status === 'completed').length;
  const failedCount = queue.filter((item) => item.status === 'failed').length;

  const isAllDone = inFlightCount === 0 && queuedCount === 0;

  // Header Title
  let title = 'Uploading files...';
  if (inFlightCount > 0 || queuedCount > 0) {
    title = `Uploading ${completedCount + 1} of ${totalCount}...`;
  } else if (failedCount > 0 && completedCount === 0) {
    title = `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`;
  } else if (failedCount > 0) {
    title = `${completedCount} completed, ${failedCount} failed`;
  } else {
    title = `${completedCount} upload${completedCount > 1 ? 's' : ''} complete`;
  }

  return (
    <div
      className={`fm-upload-queue-panel ${isMinimized ? 'minimized' : ''}`}
      role="region"
      aria-label="Upload progress queue"
    >
      {/* Panel Header */}
      <div className="fm-queue-header">
        <div className="fm-queue-header-left">
          {inFlightCount > 0 ? (
            <Loader2 size={16} className="animate-spin text-accent" />
          ) : failedCount > 0 ? (
            <AlertCircle size={16} style={{ color: '#dc2626' }} />
          ) : (
            <CheckCircle2 size={16} style={{ color: '#059669' }} />
          )}
          <span className="fm-queue-title">{title}</span>
        </div>

        <div className="fm-queue-header-actions">
          {completedCount > 0 && !isMinimized && (
            <button
              type="button"
              className="fm-queue-btn-icon"
              onClick={onClearCompleted}
              title="Clear completed uploads"
              aria-label="Clear completed uploads"
            >
              <CheckCheck size={14} />
            </button>
          )}

          <button
            type="button"
            className="fm-queue-btn-icon"
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? 'Expand upload queue' : 'Minimize upload queue'}
            aria-label={isMinimized ? 'Expand upload queue' : 'Minimize upload queue'}
          >
            {isMinimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {isAllDone && (
            <button
              type="button"
              className="fm-queue-btn-icon"
              onClick={onClose || onClearCompleted}
              title="Close queue"
              aria-label="Close upload queue"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Panel Body (List of items) */}
      {!isMinimized && (
        <div className="fm-queue-list">
          {queue.map((item) => {
            const wasRenamed = item.originalName && item.originalName !== item.name;

            return (
              <div key={item.id} className={`fm-queue-item ${item.status}`}>
                <div className="fm-queue-item-icon">
                  {getQueueFileIcon(item.name, item.file?.type)}
                </div>

                <div className="fm-queue-item-content">
                  <div className="fm-queue-item-title-row">
                    <span className="fm-queue-item-name" title={item.name}>
                      {item.name}
                    </span>
                    {wasRenamed && (
                      <span className="fm-queue-pill-renamed" title={`Auto-renamed from "${item.originalName}" to prevent overwrite`}>
                        Renamed
                      </span>
                    )}
                    <span className="fm-queue-item-size">
                      {formatBytes(item.size)}
                    </span>
                  </div>

                  {/* Status Indicator & Progress Bar */}
                  {item.status === 'uploading' && (
                    <div className="fm-queue-progress-wrap">
                      <div className="fm-queue-progress-bar">
                        <div
                          className="fm-queue-progress-fill"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                      <span className="fm-queue-percent">{item.percent}%</span>
                    </div>
                  )}

                  {item.status === 'processing' && (
                    <div className="fm-queue-status-text processing">
                      <Loader2 size={11} className="animate-spin" />
                      <span>Finalizing & verifying integrity...</span>
                    </div>
                  )}

                  {item.status === 'queued' && (
                    <div className="fm-queue-status-text queued">
                      <Clock size={11} />
                      <span>Waiting in queue...</span>
                    </div>
                  )}

                  {item.status === 'completed' && (
                    <div className="fm-queue-status-text completed">
                      <CheckCircle2 size={11} />
                      <span>Upload completed</span>
                    </div>
                  )}

                  {item.status === 'failed' && (
                    <div className="fm-queue-status-text failed" title={item.error || 'Upload failed'}>
                      <AlertCircle size={11} />
                      <span>{item.error || 'Upload failed'}</span>
                    </div>
                  )}
                </div>

                {/* Contextual Action per Item */}
                <div className="fm-queue-item-actions">
                  {(item.status === 'uploading' || item.status === 'queued') && (
                    <button
                      type="button"
                      className="fm-queue-btn-action text-danger"
                      onClick={() => onCancel(item.id)}
                      title="Cancel this upload"
                      aria-label={`Cancel upload for ${item.name}`}
                    >
                      <X size={13} />
                    </button>
                  )}

                  {item.status === 'failed' && (
                    <>
                      <button
                        type="button"
                        className="fm-queue-btn-action"
                        onClick={() => onRetry(item.id)}
                        title="Retry upload"
                        aria-label={`Retry upload for ${item.name}`}
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        type="button"
                        className="fm-queue-btn-action"
                        onClick={() => onDismiss(item.id)}
                        title="Dismiss"
                        aria-label={`Dismiss ${item.name}`}
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}

                  {item.status === 'completed' && (
                    <button
                      type="button"
                      className="fm-queue-btn-action"
                      onClick={() => onDismiss(item.id)}
                      title="Dismiss"
                      aria-label={`Dismiss ${item.name}`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
