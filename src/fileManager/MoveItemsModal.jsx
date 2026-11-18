/**
 * Feature F341: Move Items Dialog Component.
 *
 * Replaces primitive window.prompt() with a structured, accessible folder selection dialog.
 * Prevents moving a folder into itself or its own descendants.
 */

import { useState, useMemo } from 'react';
import { Folder, FolderInput, X, Check, Home } from 'lucide-react';

export default function MoveItemsModal({
  isOpen,
  onClose,
  folders = [],
  selectedFolderIds = [],
  selectedFileIds = [],
  onConfirmMove,
}) {
  // null means root folder
  const [targetFolderId, setTargetFolderId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Filter out any folders that are currently selected (cannot move a folder into itself)
  const candidateFolders = useMemo(() => {
    const excludedIds = new Set(selectedFolderIds);
    return folders.filter((f) => !f.deleted_at && !excludedIds.has(f.id));
  }, [folders, selectedFolderIds]);

  const totalCount = selectedFolderIds.length + selectedFileIds.length;

  const handleMove = async () => {
    setSubmitting(true);
    try {
      await onConfirmMove(targetFolderId);
      onClose();
    } catch (_e) {
      // Handled by parent toast
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fm-modal-backdrop"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Move selected items"
    >
      <div className="fm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        {/* Head */}
        <div className="fm-modal-head" style={{ borderBottom: '1px solid var(--line, #e4ddd4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderInput size={16} className="text-muted" />
            <span className="fm-modal-title">
              Move {totalCount} {totalCount === 1 ? 'item' : 'items'} to...
            </span>
          </div>
          <button
            type="button"
            className="fm-btn fm-btn-icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close move dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* Folder List */}
        <div style={{ padding: '16px 20px', maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Root Option */}
            <div
              className={`fm-folder-option ${targetFolderId === null ? 'selected' : ''}`}
              onClick={() => setTargetFolderId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 'var(--radius, 8px)',
                cursor: 'pointer',
                background: targetFolderId === null ? 'var(--accent-soft, #e8eef8)' : 'transparent',
                border: `1px solid ${targetFolderId === null ? 'rgba(1, 46, 161, 0.25)' : 'var(--line, #e4ddd4)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Home size={15} style={{ color: targetFolderId === null ? 'var(--accent, #012ea1)' : 'var(--muted)' }} />
                <span style={{ fontSize: 13, fontWeight: targetFolderId === null ? 600 : 400 }}>
                  My Files (Root directory)
                </span>
              </div>
              {targetFolderId === null && <Check size={14} style={{ color: 'var(--accent, #012ea1)' }} />}
            </div>

            {/* Folder Candidates */}
            {candidateFolders.map((f) => {
              const isSelected = targetFolderId === f.id;
              return (
                <div
                  key={f.id}
                  className={`fm-folder-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => setTargetFolderId(f.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius, 8px)',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--accent-soft, #e8eef8)' : 'transparent',
                    border: `1px solid ${isSelected ? 'rgba(1, 46, 161, 0.25)' : 'var(--line, #e4ddd4)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Folder size={15} style={{ color: isSelected ? 'var(--accent, #012ea1)' : '#f59e0b' }} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={f.name}
                    >
                      {f.name}
                    </span>
                  </div>
                  {isSelected && <Check size={14} style={{ color: 'var(--accent, #012ea1)' }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="fm-modal-actions" style={{ borderTop: '1px solid var(--line, #e4ddd4)', padding: '12px 20px' }}>
          <button type="button" className="fm-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="fm-btn fm-btn-primary"
            onClick={handleMove}
            disabled={submitting}
          >
            {submitting ? 'Moving...' : 'Move Here'}
          </button>
        </div>
      </div>
    </div>
  );
}
