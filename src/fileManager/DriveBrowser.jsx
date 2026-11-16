/**
 * Feature F341: Drive Browser Component (Redesigned per Reference Architecture).
 *
 * Implements:
 * - Reference table structure with 8 normative columns:
 *   [Selection, Name, Documents, Indexing, Size, Owner, Shared With, Connected, Actions]
 * - Dual status pills for upload (`upload_status`) and AI indexing (`index_status`):
 *   "Not searchable", "Queued", "Processing", "Searchable", "Failed"
 * - Multi-selection (Shift-click range, Select All, and individual checkboxes)
 * - Recognizable file-type icons (PDF, Spreadsheet, Code, Image, Document, Archive, Generic)
 * - Row context actions ("✦ Ask AI", "Index for AI", "Preview", "Download", "Rename", "Trash")
 * - Responsive horizontal scrolling and layout
 * - Loading skeletons, empty states (Empty folder, Search, Filters, Organisation, Trash, Artifacts)
 */

import { useState } from 'react';
import {
  Folder,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Image as ImageIcon,
  Sparkles,
  Eye,
  Download,
  Trash2,
  RotateCcw,
  MoreVertical,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pencil,
  ArrowUpDown,
  Search,
  Building2,
  Filter,
} from 'lucide-react';
import {
  formatBytes,
  formatRelativeDate,
} from './fileManagerService.js';
import { isPdfMimeType } from '../types/fileManager.ts';

/**
 * Returns recognizable icon for file MIME type and extension.
 */
function getFileIcon(mimeType = '', name = '', size = 18) {
  const m = (mimeType || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (m === 'application/pdf' || ext === 'pdf') {
    return <FileText size={size} style={{ color: '#dc2626' }} />;
  }
  if (
    m.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)
  ) {
    return <ImageIcon size={size} style={{ color: '#0284c7' }} />;
  }
  if (
    m.includes('spreadsheet') ||
    m.includes('csv') ||
    m.includes('excel') ||
    ['csv', 'xlsx', 'xls', 'tsv'].includes(ext)
  ) {
    return <FileSpreadsheet size={size} style={{ color: '#16a34a' }} />;
  }
  if (
    m.includes('json') ||
    m.includes('javascript') ||
    m.includes('typescript') ||
    m.includes('markdown') ||
    ['js', 'ts', 'jsx', 'tsx', 'json', 'md', 'html', 'css', 'py', 'sql', 'yaml', 'yml'].includes(ext)
  ) {
    return <FileCode size={size} style={{ color: '#7c3aed' }} />;
  }
  if (
    m.includes('word') ||
    m.includes('document') ||
    ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)
  ) {
    return <FileText size={size} style={{ color: '#1e40af' }} />;
  }
  if (
    m.includes('zip') ||
    m.includes('tar') ||
    m.includes('gzip') ||
    ['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)
  ) {
    return <FileArchive size={size} style={{ color: '#ea580c' }} />;
  }
  return <FileText size={size} style={{ color: 'var(--muted)' }} />;
}

export default function DriveBrowser({
  folders = [],
  files = [],
  selectedFolderIds = [],
  selectedFileIds = [],
  viewMode = 'list',
  view = 'all',
  searchQuery = '',
  sort = { field: 'name', direction: 'asc' },
  quota,
  loading = false,
  currentUser = null,
  hasActiveFilters = false,
  onClearFilters,
  onSortChange,
  onSelectFolder,
  onSelectFile,
  onSelectAll,
  onOpenFolder,
  onPreviewFile,
  onDownloadFile,
  onIndexFile,
  onChatWithFile,
  onRenameItem,
  onTrashItem,
  onRestoreItem,
  onPermanentDeleteItem,
  onUploadClick,
}) {
  const [activeMenuId, setActiveMenuId] = useState(null);

  const totalItemsCount = folders.length + files.length;
  const isAllSelected =
    totalItemsCount > 0 &&
    selectedFolderIds.length === folders.length &&
    selectedFileIds.length === files.length;

  const isTrash = view === 'trash';
  const isOrganisation = view === 'organisation';

  // Toggle row action menu
  const toggleMenu = (e, id) => {
    e.stopPropagation();
    setActiveMenuId((prev) => (prev === id ? null : id));
  };

  // Close menus when clicking anywhere
  const handleContainerClick = () => {
    if (activeMenuId) setActiveMenuId(null);
  };

  // Display user identity or friendly name
  const ownerLabel = currentUser?.email
    ? currentUser.email.split('@')[0]
    : 'Me';

  // Render AI Indexing Status Pills (per Section 6 requirements)
  const renderIndexStatusPill = (file) => {
    const isPdf = isPdfMimeType(file.mime_type);

    if (file.upload_status === 'uploading') {
      return (
        <span className="fm-pill fm-pill-running">
          <Loader2 size={11} className="animate-spin" /> Uploading
        </span>
      );
    }

    if (file.upload_status === 'upload_failed') {
      return (
        <span className="fm-pill fm-pill-failed">
          <AlertCircle size={11} /> Upload Failed
        </span>
      );
    }

    if (!isPdf) {
      return (
        <span className="fm-pill fm-pill-unsupported" title="Stored securely. AI vector indexing is supported for PDF documents.">
          Not searchable
        </span>
      );
    }

    switch (file.index_status) {
      case 'indexed':
        return (
          <span className="fm-pill fm-pill-indexed" title="Vector embedded and searchable in Niyantran AI">
            <CheckCircle2 size={11} /> Searchable
          </span>
        );
      case 'indexing_queued':
        return (
          <span className="fm-pill fm-pill-queued" title="Queued for background extraction and vector chunking">
            <Clock size={11} /> Queued
          </span>
        );
      case 'indexing_extracting':
      case 'indexing_chunking':
        return (
          <span className="fm-pill fm-pill-running" title="Processing OCR and vector embeddings">
            <Loader2 size={11} className="animate-spin" /> Processing
          </span>
        );
      case 'indexing_failed':
        return (
          <button
            type="button"
            className="fm-pill fm-pill-failed"
            onClick={(e) => {
              e.stopPropagation();
              onIndexFile(file);
            }}
            title={file.index_error ? `${file.index_error} — Click to retry indexing.` : 'Indexing failed. Click to retry.'}
          >
            <AlertCircle size={11} /> Failed
          </button>
        );
      case 'not_indexed':
      default:
        return (
          <button
            type="button"
            className="fm-pill fm-pill-not-indexed"
            onClick={(e) => {
              e.stopPropagation();
              onIndexFile(file);
            }}
            title="Click to extract text and vector index for AI research"
          >
            <Sparkles size={11} /> Not searchable
          </button>
        );
    }
  };

  // ─── Loading Skeletons State ────────────────────────────────────────────────
  if (loading && totalItemsCount === 0) {
    return (
      <div className="fm-table-wrap">
        <div className="fm-loading-skeleton-container" role="status" aria-label="Loading files">
          <div className="fm-skeleton-row" />
          <div className="fm-skeleton-row" />
          <div className="fm-skeleton-row" />
          <div className="fm-skeleton-row" />
          <div className="fm-skeleton-row" />
        </div>
      </div>
    );
  }

  // ─── Empty & Specific Tab States ───────────────────────────────────────────
  if (isOrganisation) {
    return (
      <div className="fm-empty-state">
        <Building2 size={44} className="fm-empty-icon" style={{ color: 'var(--accent)' }} />
        <div className="fm-empty-title">Organisation Files</div>
        <div className="fm-empty-desc">
          Organisation drives and shared team workspaces are not enabled for this account tier.
          Files in your personal drive remain private, encrypted, and isolated to your account.
        </div>
        <div style={{ marginTop: 12 }}>
          <span className="fm-pill fm-pill-unsupported">Enterprise Tier Required</span>
        </div>
      </div>
    );
  }

  if (totalItemsCount === 0) {
    if (searchQuery) {
      return (
        <div className="fm-empty-state">
          <Search size={40} className="fm-empty-icon" />
          <div className="fm-empty-title">No files matching &ldquo;{searchQuery}&rdquo;</div>
          <div className="fm-empty-desc">Check your spelling or switch search scope to Everywhere.</div>
        </div>
      );
    }

    if (hasActiveFilters) {
      return (
        <div className="fm-empty-state">
          <Filter size={40} className="fm-empty-icon" />
          <div className="fm-empty-title">No items match the selected filters</div>
          <div className="fm-empty-desc">Try selecting a different type or index status filter.</div>
          {onClearFilters && (
            <button
              type="button"
              className="fm-btn fm-btn-secondary"
              onClick={onClearFilters}
              style={{ marginTop: 12 }}
            >
              Reset Filters
            </button>
          )}
        </div>
      );
    }

    if (isTrash) {
      return (
        <div className="fm-empty-state">
          <Trash2 size={40} className="fm-empty-icon" />
          <div className="fm-empty-title">Trash is empty</div>
          <div className="fm-empty-desc">
            Deleted files and folders are safely stored here for 30 days before permanent erasure.
          </div>
        </div>
      );
    }

    if (view === 'artifacts') {
      return (
        <div className="fm-empty-state">
          <Sparkles size={40} className="fm-empty-icon" />
          <div className="fm-empty-title">No AI artifacts saved yet</div>
          <div className="fm-empty-desc">
            Save analysis briefs, generated tables, or executive summaries directly from Niyantran AI turns.
          </div>
        </div>
      );
    }

    const hasOccupiedStorage = (quota?.used_bytes || 0) > 0;

    return (
      <div className="fm-empty-state">
        <Folder size={40} className="fm-empty-icon" />
        <div className="fm-empty-title">This folder is empty</div>
        <div className="fm-empty-desc">
          {hasOccupiedStorage
            ? 'Your storage is occupied by files or pending uploads that are not currently visible in this folder.'
            : 'Drag and drop files here to upload, or use the Upload Here button in the toolbar.'}
        </div>
        {onUploadClick && (
          <button type="button" className="fm-btn fm-btn-primary" onClick={onUploadClick}>
            Upload Files
          </button>
        )}
      </div>
    );
  }

  // ─── Table / List View (Normative 8-Column Reference Structure) ────────────
  if (viewMode === 'list') {
    return (
      <div className="fm-table-wrap" onClick={handleContainerClick}>
        {/* Trash Retention Warning Banner */}
        {isTrash && (
          <div className="fm-trash-notice-banner" role="status">
            <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0 }} />
            <span>
              Trashed files continue consuming quota and will be permanently deleted after 30 days.
            </span>
          </div>
        )}

        <table className="fm-table">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  aria-label="Select all files and folders"
                />
              </th>
              <th
                onClick={() => onSortChange?.('name')}
                style={{ cursor: 'pointer', minWidth: 220 }}
                title="Sort by Name"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>Name</span>
                  {sort.field === 'name' && <ArrowUpDown size={12} />}
                </div>
              </th>
              <th style={{ width: 110 }}>Documents</th>
              <th style={{ width: 140 }}>Indexing</th>
              <th
                onClick={() => onSortChange?.('size_bytes')}
                style={{ width: 100, cursor: 'pointer' }}
                title="Sort by Size"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>Size</span>
                  {sort.field === 'size_bytes' && <ArrowUpDown size={12} />}
                </div>
              </th>
              <th style={{ width: 100 }}>Owner</th>
              <th style={{ width: 110 }}>Shared With</th>
              <th style={{ width: 100 }}>Connected</th>
              <th style={{ width: 90, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Folder Rows */}
            {folders.map((folder) => {
              const isSelected = selectedFolderIds.includes(folder.id);
              const isMenuOpen = activeMenuId === `folder-${folder.id}`;

              return (
                <tr
                  key={`folder-${folder.id}`}
                  className={isSelected ? 'selected' : ''}
                  onClick={(e) => onSelectFolder(folder.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelectFolder(folder.id, false, true)}
                      aria-label={`Select folder ${folder.name}`}
                    />
                  </td>
                  <td>
                    <div
                      className="fm-row-name"
                      onDoubleClick={() => onOpenFolder(folder)}
                    >
                      <Folder size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <span title={folder.name}>{folder.name}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{ownerLabel}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        type="button"
                        className="fm-btn fm-btn-icon"
                        onClick={(e) => toggleMenu(e, `folder-${folder.id}`)}
                        aria-label={`Actions for folder ${folder.name}`}
                      >
                        <MoreVertical size={14} />
                      </button>

                      {isMenuOpen && (
                        <div className="fm-context-menu">
                          {!isTrash ? (
                            <>
                              <button
                                type="button"
                                className="fm-nav-btn"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onOpenFolder(folder);
                                }}
                              >
                                <Folder size={13} /> Open
                              </button>
                              <button
                                type="button"
                                className="fm-nav-btn"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onRenameItem(folder, 'folder');
                                }}
                              >
                                <Pencil size={13} /> Rename
                              </button>
                              <button
                                type="button"
                                className="fm-nav-btn text-danger"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onTrashItem(folder, 'folder');
                                }}
                              >
                                <Trash2 size={13} /> Move to Trash
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="fm-nav-btn"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onRestoreItem?.(folder, 'folder');
                                }}
                              >
                                <RotateCcw size={13} /> Restore
                              </button>
                              <button
                                type="button"
                                className="fm-nav-btn text-danger"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onPermanentDeleteItem?.(folder, 'folder');
                                }}
                              >
                                <Trash2 size={13} /> Delete Permanently
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* File Rows */}
            {files.map((file) => {
              const isSelected = selectedFileIds.includes(file.id);
              const isMenuOpen = activeMenuId === `file-${file.id}`;
              const isPdf = isPdfMimeType(file.mime_type);
              const docsCount = file.page_count
                ? `${file.page_count} ${file.page_count === 1 ? 'doc' : 'docs'}`
                : isPdf
                  ? '1 doc'
                  : '—';

              return (
                <tr
                  key={`file-${file.id}`}
                  className={isSelected ? 'selected' : ''}
                  onClick={(e) => onSelectFile(file.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelectFile(file.id, false, true)}
                      aria-label={`Select file ${file.name}`}
                    />
                  </td>
                  <td>
                    <div
                      className="fm-row-name"
                      onDoubleClick={() => onPreviewFile(file)}
                    >
                      {getFileIcon(file.mime_type, file.name)}
                      <span title={file.name}>{file.name}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{docsCount}</td>
                  <td>{renderIndexStatusPill(file)}</td>
                  <td style={{ color: 'var(--text)', fontSize: 13, whiteSpace: 'nowrap' }}>
                    {formatBytes(file.size_bytes)}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{ownerLabel}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>—</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      {!isTrash && (
                        <>
                          <button
                            type="button"
                            className="fm-btn fm-btn-icon"
                            onClick={() => onPreviewFile(file)}
                            title="Preview file"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="fm-btn fm-btn-icon"
                            onClick={() => onDownloadFile(file)}
                            title="Download file"
                          >
                            <Download size={14} />
                          </button>
                        </>
                      )}

                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <button
                          type="button"
                          className="fm-btn fm-btn-icon"
                          onClick={(e) => toggleMenu(e, `file-${file.id}`)}
                          aria-label={`More actions for file ${file.name}`}
                        >
                          <MoreVertical size={14} />
                        </button>

                        {isMenuOpen && (
                          <div className="fm-context-menu">
                            {!isTrash ? (
                              <>
                                <button
                                  type="button"
                                  className="fm-nav-btn"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onChatWithFile(file);
                                  }}
                                >
                                  <Sparkles size={13} /> ✦ Ask AI
                                </button>
                                {isPdf && file.index_status !== 'indexed' && (
                                  <button
                                    type="button"
                                    className="fm-nav-btn"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      onIndexFile(file);
                                    }}
                                  >
                                    <Sparkles size={13} /> Index for AI
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="fm-nav-btn"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onRenameItem(file, 'file');
                                  }}
                                >
                                  <Pencil size={13} /> Rename
                                </button>
                                <button
                                  type="button"
                                  className="fm-nav-btn text-danger"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onTrashItem(file, 'file');
                                  }}
                                >
                                  <Trash2 size={13} /> Move to Trash
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="fm-nav-btn"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onRestoreItem?.(file, 'file');
                                  }}
                                >
                                  <RotateCcw size={13} /> Restore
                                </button>
                                <button
                                  type="button"
                                  className="fm-nav-btn text-danger"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onPermanentDeleteItem?.(file, 'file');
                                  }}
                                >
                                  <Trash2 size={13} /> Delete Permanently
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ─── Grid View ─────────────────────────────────────────────────────────────
  return (
    <div className="fm-grid-wrap" onClick={handleContainerClick}>
      {isTrash && (
        <div className="fm-trash-notice-banner" role="status" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0 }} />
          <span>
            Trashed files continue consuming quota and will be permanently deleted after 30 days.
          </span>
        </div>
      )}

      <div className="fm-grid">
        {/* Folder Cards */}
        {folders.map((folder) => {
          const isSelected = selectedFolderIds.includes(folder.id);
          const isMenuOpen = activeMenuId === `grid-folder-${folder.id}`;

          return (
            <div
              key={`folder-grid-${folder.id}`}
              className={`fm-grid-card ${isSelected ? 'selected' : ''}`}
              onClick={(e) => onSelectFolder(folder.id, e.shiftKey, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => onOpenFolder(folder)}
            >
              <div className="fm-grid-card-head" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onSelectFolder(folder.id, false, true)}
                  aria-label={`Select folder ${folder.name}`}
                />
                <button
                  type="button"
                  className="fm-btn fm-btn-icon"
                  onClick={(e) => toggleMenu(e, `grid-folder-${folder.id}`)}
                  aria-label={`Actions for folder ${folder.name}`}
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div className="fm-context-menu">
                    {!isTrash ? (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onOpenFolder(folder);
                          }}
                        >
                          <Folder size={13} /> Open
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onRenameItem(folder, 'folder');
                          }}
                        >
                          <Pencil size={13} /> Rename
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn text-danger"
                          onClick={() => {
                            setActiveMenuId(null);
                            onTrashItem(folder, 'folder');
                          }}
                        >
                          <Trash2 size={13} /> Move to Trash
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onRestoreItem?.(folder, 'folder');
                          }}
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn text-danger"
                          onClick={() => {
                            setActiveMenuId(null);
                            onPermanentDeleteItem?.(folder, 'folder');
                          }}
                        >
                          <Trash2 size={13} /> Delete Permanently
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="fm-grid-card-body">
                <Folder size={36} style={{ color: 'var(--accent)' }} />
                <span className="fm-grid-card-title" title={folder.name}>
                  {folder.name}
                </span>
              </div>

              <div className="fm-grid-card-footer">
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Folder</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatRelativeDate(folder.updated_at || folder.created_at)}
                </span>
              </div>
            </div>
          );
        })}

        {/* File Cards */}
        {files.map((file) => {
          const isSelected = selectedFileIds.includes(file.id);
          const isMenuOpen = activeMenuId === `grid-file-${file.id}`;
          const isPdf = isPdfMimeType(file.mime_type);

          return (
            <div
              key={`file-grid-${file.id}`}
              className={`fm-grid-card ${isSelected ? 'selected' : ''}`}
              onClick={(e) => onSelectFile(file.id, e.shiftKey, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => onPreviewFile(file)}
            >
              <div className="fm-grid-card-head" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onSelectFile(file.id, false, true)}
                  aria-label={`Select file ${file.name}`}
                />
                <button
                  type="button"
                  className="fm-btn fm-btn-icon"
                  onClick={(e) => toggleMenu(e, `grid-file-${file.id}`)}
                  aria-label={`Actions for file ${file.name}`}
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div className="fm-context-menu">
                    {!isTrash ? (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onPreviewFile(file);
                          }}
                        >
                          <Eye size={13} /> Preview
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onDownloadFile(file);
                          }}
                        >
                          <Download size={13} /> Download
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onChatWithFile(file);
                          }}
                        >
                          <Sparkles size={13} /> ✦ Ask AI
                        </button>
                        {isPdf && file.index_status !== 'indexed' && (
                          <button
                            type="button"
                            className="fm-nav-btn"
                            onClick={() => {
                              setActiveMenuId(null);
                              onIndexFile(file);
                            }}
                          >
                            <Sparkles size={13} /> Index for AI
                          </button>
                        )}
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onRenameItem(file, 'file');
                          }}
                        >
                          <Pencil size={13} /> Rename
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn text-danger"
                          onClick={() => {
                            setActiveMenuId(null);
                            onTrashItem(file, 'file');
                          }}
                        >
                          <Trash2 size={13} /> Move to Trash
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          onClick={() => {
                            setActiveMenuId(null);
                            onRestoreItem?.(file, 'file');
                          }}
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn text-danger"
                          onClick={() => {
                            setActiveMenuId(null);
                            onPermanentDeleteItem?.(file, 'file');
                          }}
                        >
                          <Trash2 size={13} /> Delete Permanently
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="fm-grid-card-body">
                {getFileIcon(file.mime_type, file.name, 36)}
                <span className="fm-grid-card-title" title={file.name}>
                  {file.name}
                </span>
                <div style={{ marginTop: 6 }}>
                  {renderIndexStatusPill(file)}
                </div>
              </div>

              <div className="fm-grid-card-footer">
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatBytes(file.size_bytes)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatRelativeDate(file.updated_at || file.created_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
