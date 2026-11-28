/**
 * File Manager Picker Modal for AI Research Attachment (Phase 4).
 *
 * Allows users to browse their personal folders, search documents,
 * view AI indexing status (Searchable vs Unindexed), select files,
 * and attach them directly to the active AI conversation.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Sparkles,
  Search,
  X,
  Check,
  ChevronRight,
  ArrowLeft,
  Loader2,
  HardDrive,
} from 'lucide-react';
import { listFilesAndFolders, formatBytes } from '../fileManager/fileManagerService.js';
import { isPdfMimeType } from '../types/fileManager.ts';

export default function FileManagerPickerModal({ isOpen, onClose, onSelectFiles }) {
  const [currentFolder, setCurrentFolder] = useState(null);
  const [folderHistory, setFolderHistory] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMap, setSelectedMap] = useState({});

  // Reset or fetch on open
  useEffect(() => {
    if (!isOpen) {
      setSelectedMap({});
      setSearchQuery('');
      setCurrentFolder(null);
      setFolderHistory([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const folderId = currentFolder?.id || null;
    listFilesAndFolders({
      folder_id: folderId,
      sort: { field: 'name', direction: 'asc' },
    })
      .then((res) => {
        if (!isMounted) return;
        setFolders(res?.folders || []);
        setFiles(res?.files || []);
      })
      .catch((err) => {
        console.error('Failed to load files for picker:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentFolder]);

  // Navigate deeper into a folder
  const handleOpenFolder = (folder) => {
    setFolderHistory((prev) => [...prev, currentFolder]);
    setCurrentFolder(folder);
  };

  // Navigate back to previous folder
  const handleBack = () => {
    if (folderHistory.length === 0) return;
    const prev = folderHistory[folderHistory.length - 1];
    setFolderHistory((old) => old.slice(0, -1));
    setCurrentFolder(prev);
  };

  // Toggle selection
  const handleToggleSelect = (file) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[file.id]) {
        delete next[file.id];
      } else {
        next[file.id] = file;
      }
      return next;
    });
  };

  const selectedCount = Object.keys(selectedMap).length;

  const handleConfirm = () => {
    const chosenFiles = Object.values(selectedMap);
    if (chosenFiles.length > 0) {
      onSelectFiles(chosenFiles);
    }
    onClose();
  };

  // Filtered display
  const displayFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const displayFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders;
    const q = searchQuery.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fm-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose files from File Manager"
    >
      <div
        className="fm-modal-box"
        style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="fm-modal-head" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HardDrive size={18} style={{ color: 'var(--accent, #012ea1)' }} />
            <span className="fm-modal-title">Select from File Manager</span>
          </div>
          <button
            type="button"
            className="fm-btn"
            style={{ padding: '4px 8px' }}
            onClick={onClose}
            aria-label="Close picker"
          >
            <X size={15} />
          </button>
        </div>

        {/* Toolbar & Search */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--line, #e4ddd4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--bg, #f8f5f0)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
            {currentFolder ? (
              <button
                type="button"
                className="fm-btn"
                style={{ padding: '3px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={handleBack}
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>
            ) : null}
            <span style={{ fontWeight: 600, color: 'var(--text, #3d3a36)', whiteSpace: 'nowrap' }}>
              {currentFolder ? currentFolder.name : 'My Files'}
            </span>
          </div>

          <div style={{ position: 'relative', width: 220 }}>
            <Search
              size={13}
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted, #6d675f)' }}
            />
            <input
              type="search"
              className="fm-global-search-input"
              style={{ width: '100%', paddingLeft: 26, fontSize: 12, height: 30 }}
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* File & Folder List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {loading ? (
            <div className="fm-empty-state" style={{ minHeight: 220 }}>
              <Loader2 size={28} className="animate-spin text-muted" />
              <div className="fm-empty-title" style={{ fontSize: 14 }}>Loading your files...</div>
            </div>
          ) : displayFolders.length === 0 && displayFiles.length === 0 ? (
            <div className="fm-empty-state" style={{ minHeight: 220 }}>
              <Folder size={36} className="fm-empty-icon" />
              <div className="fm-empty-title" style={{ fontSize: 14 }}>No files in this folder</div>
              <div className="fm-empty-desc" style={{ fontSize: 12 }}>Upload documents in File Manager to attach them to research.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Folders */}
              {displayFolders.map((fldr) => (
                <div
                  key={fldr.id}
                  onClick={() => handleOpenFolder(fldr)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: '1px solid transparent',
                    background: 'var(--panel, #ffffff)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--line, #e4ddd4)';
                    e.currentTarget.style.background = 'var(--bg, #f8f5f0)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.background = 'var(--panel, #ffffff)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Folder size={18} style={{ color: 'var(--accent, #012ea1)' }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #3d3a36)' }}>{fldr.name}</span>
                  </div>
                  <ChevronRight size={15} style={{ color: 'var(--muted, #6d675f)' }} />
                </div>
              ))}

              {/* Files */}
              {displayFiles.map((file) => {
                const isSelected = Boolean(selectedMap[file.id]);
                const isPdf = isPdfMimeType(file.mime_type);
                const isIndexed = file.index_status === 'indexed';

                return (
                  <div
                    key={file.id}
                    onClick={() => handleToggleSelect(file)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: isSelected ? '1px solid var(--accent, #012ea1)' : '1px solid var(--line, #e4ddd4)',
                      background: isSelected ? 'var(--accent-soft, #e8eef8)' : 'var(--panel, #ffffff)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: isSelected ? '1px solid var(--accent, #012ea1)' : '1px solid var(--muted, #6d675f)',
                          background: isSelected ? 'var(--accent, #012ea1)' : '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isSelected && <Check size={12} style={{ color: '#ffffff', strokeWidth: 3 }} />}
                      </div>

                      {isPdf ? (
                        <FileText size={16} style={{ color: '#b91c1c', flexShrink: 0 }} />
                      ) : file.mime_type.includes('spreadsheet') || file.name.endsWith('.csv') ? (
                        <FileSpreadsheet size={16} style={{ color: '#047857', flexShrink: 0 }} />
                      ) : file.mime_type.includes('code') || file.name.endsWith('.js') || file.name.endsWith('.py') ? (
                        <FileCode size={16} style={{ color: '#4338ca', flexShrink: 0 }} />
                      ) : file.mime_type.startsWith('image/') ? (
                        <ImageIcon size={16} style={{ color: '#0284c7', flexShrink: 0 }} />
                      ) : (
                        <FileText size={16} style={{ color: 'var(--muted, #6d675f)', flexShrink: 0 }} />
                      )}

                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isSelected ? 600 : 500,
                          color: 'var(--text, #3d3a36)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={file.name}
                      >
                        {file.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted, #6d675f)' }}>
                        {formatBytes(file.size_bytes)}
                      </span>

                      {/* Index Status Badge */}
                      {isPdf ? (
                        isIndexed ? (
                          <span className="fm-pill fm-pill-indexed" style={{ fontSize: 10, padding: '2px 8px' }}>
                            <Sparkles size={10} /> Searchable
                          </span>
                        ) : (
                          <span className="fm-pill fm-pill-not-indexed" style={{ fontSize: 10, padding: '2px 8px' }}>
                            Not searchable
                          </span>
                        )
                      ) : (
                        <span className="fm-pill fm-pill-unsupported" style={{ fontSize: 10, padding: '2px 8px' }}>
                          File
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line, #e4ddd4)',
            background: 'var(--bg, #f8f5f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--muted, #6d675f)' }}>
            {selectedCount === 0
              ? 'Select files to attach as context'
              : `${selectedCount} file${selectedCount > 1 ? 's' : ''} selected`}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="fm-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="fm-btn fm-btn-primary"
              disabled={selectedCount === 0}
              onClick={handleConfirm}
            >
              Attach to Research ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
