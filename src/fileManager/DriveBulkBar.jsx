/**
 * Feature F341: Capability 6 — Floating Multi-Selection Action Bar.
 *
 * Renders batch operations for selected items:
 * - Active view: Batch "Index for AI", "Move to...", "Download", and "Move to Trash".
 * - Trash view: Batch "Restore" and "Delete Permanently".
 */

import {
  Sparkles,
  FolderInput,
  Download,
  Trash2,
  RotateCcw,
  X,
  Loader2,
} from 'lucide-react';
import { formatBytes } from './fileManagerService.js';

/**
 * @param {{
 *   selectedCount: number,
 *   totalSizeBytes?: number,
 *   view?: 'all' | 'trash' | 'artifacts',
 *   hasPdfFiles?: boolean,
 *   busy?: boolean,
 *   onIndex: () => void,
 *   onMove: () => void,
 *   onDownload: () => void,
 *   onTrash: () => void,
 *   onRestore?: () => void,
 *   onPermanentDelete?: () => void,
 *   onClear: () => void
 * }} props
 */
export default function DriveBulkBar({
  selectedCount,
  totalSizeBytes = 0,
  view = 'all',
  hasPdfFiles = false,
  busy = false,
  onIndex,
  onMove,
  onDownload,
  onTrash,
  onRestore,
  onPermanentDelete,
  onClear,
}) {
  if (selectedCount <= 0) return null;

  const isTrashView = view === 'trash';

  return (
    <div className="fm-bulk-bar" role="toolbar" aria-label="Bulk actions toolbar">
      <span className="fm-bulk-count">
        {selectedCount} selected
        {totalSizeBytes > 0 && (
          <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
            · {formatBytes(totalSizeBytes)}
          </span>
        )}
      </span>

      {isTrashView ? (
        <>
          <button
            type="button"
            className="fm-btn fm-btn-primary"
            onClick={onRestore}
            disabled={busy}
            title="Restore selected items"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            <span>Restore</span>
          </button>

          <button
            type="button"
            className="fm-btn fm-btn-danger"
            onClick={onPermanentDelete}
            disabled={busy}
            title="Permanently erase selected items"
          >
            <Trash2 size={14} />
            <span>Delete Permanently</span>
          </button>
        </>
      ) : (
        <>
          {hasPdfFiles && (
            <button
              type="button"
              className="fm-btn fm-btn-primary"
              onClick={onIndex}
              disabled={busy}
              title="Index all selected PDF documents for AI retrieval"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span>Index for AI</span>
            </button>
          )}

          <button
            type="button"
            className="fm-btn"
            onClick={onMove}
            disabled={busy}
            title="Move selected items to another folder"
          >
            <FolderInput size={14} />
            <span>Move</span>
          </button>

          <button
            type="button"
            className="fm-btn"
            onClick={onDownload}
            disabled={busy}
            title="Download selected files"
          >
            <Download size={14} />
            <span>Download</span>
          </button>

          <button
            type="button"
            className="fm-btn fm-btn-danger"
            onClick={onTrash}
            disabled={busy}
            title="Move selected items to Trash"
          >
            <Trash2 size={14} />
            <span>Move to Trash</span>
          </button>
        </>
      )}

      <button
        type="button"
        className="fm-btn"
        style={{ padding: '6px 8px' }}
        onClick={onClear}
        title="Deselect all items"
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}
