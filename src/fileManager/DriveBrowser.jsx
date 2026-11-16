/**
 * Feature F341: Drive Browser Component (Phase 4).
 *
 * Implements:
 * - List and Grid view presentations with responsive layouts and full feature parity.
 * - Shift-click range multi-selection, select all, and individual item selection.
 * - Recognizable file-type icons (PDF, Image, Document, Spreadsheet, Code, Archive, Generic).
 * - Orthogonal status pills for upload (`upload_status`) and AI indexing (`index_status`).
 * - Detailed tooltips for AI indexing states and failure retries.
 * - Trash banner: "Trashed files continue consuming quota and will be permanently deleted after 30 days."
 * - Item context actions: "✦ Ask AI", "Index for AI", "Preview", "Download", "Rename", "Trash".
 * - Distinct empty states for empty folders, search results, trash, and AI artifacts.
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

/**
 * @param {{
 *   folders: any[],
 *   files: any[],
 *   selectedFolderIds: string[],
 *   selectedFileIds: string[],
 *   viewMode?: 'grid' | 'list',
 *   view?: 'all' | 'trash' | 'artifacts',
 *   searchQuery?: string,
 *   sort?: { field: string, direction: 'asc' | 'desc' },
 *   onSortChange?: (field: string) => void,
 *   onSelectFolder: (id: string, isShift: boolean, isCtrl: boolean) => void,
 *   onSelectFile: (id: string, isShift: boolean, isCtrl: boolean) => void,
 *   onSelectAll: (checked: boolean) => void,
 *   onOpenFolder: (folder: any) => void,
 *   onPreviewFile: (file: any) => void,
 *   onDownloadFile: (file: any) => void,
 *   onIndexFile: (file: any) => void,
 *   onChatWithFile: (file: any) => void,
 *   onRenameItem: (item: any, kind: 'file' | 'folder') => void,
 *   onTrashItem: (item: any, kind: 'file' | 'folder') => void,
 *   onRestoreItem?: (item: any, kind: 'file' | 'folder') => void,
 *   onPermanentDeleteItem?: (item: any, kind: 'file' | 'folder') => void,
 *   onUploadClick?: () => void
 * }} props
 */
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

  // Toggle row action menu
  const toggleMenu = (e, id) => {
    e.stopPropagation();
    setActiveMenuId((prev) => (prev === id ? null : id));
  };

  // Close menus when clicking anywhere
  const handleContainerClick = () => {
    if (activeMenuId) setActiveMenuId(null);
  };

  // Render Dual Status Pills for a File
  const renderStatusPills = (file) => {
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
        <span className="fm-pill fm-pill-unsupported" title="Stored securely. AI indexing in v1 is supported for PDF documents.">
          Stored Only
        </span>
      );
    }

    switch (file.index_status) {
      case 'indexed':
        return (
          <span className="fm-pill fm-pill-indexed" title="Vector embedded and searchable in Niyantran AI">
            <CheckCircle2 size={11} /> Indexed
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
            <Loader2 size={11} className="animate-spin" /> Indexing
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
            <AlertCircle size={11} /> Retry Index
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
            <Sparkles size={11} /> Index for AI
          </button>
        );
    }
  };

  // Render Empty State
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
            : 'Drag and drop files here to upload, or use the Upload button in the toolbar.'}
        </div>
        {onUploadClick && (
          <button type="button" className="fm-btn fm-btn-primary" onClick={onUploadClick}>
            Upload Files
          </button>
        )}
      </div>
    );
  }

  // ─── Table / List View ─────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <div className="fm-table-wrap" onClick={handleContainerClick}>
        {/* Trash Retention Warning Banner (Phase 4 Requirement) */}
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
                style={{ cursor: 'pointer' }}
                title="Sort by Name"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>Name</span>
                  {sort.field === 'name' && <ArrowUpDown size={12} />}
                </div>
              </th>
              <th style={{ width: 140 }}>Status</th>
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
              <th
                onClick={() => onSortChange?.('updated_at')}
                style={{ width: 130, cursor: 'pointer' }}
                title="Sort by Date"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>Modified</span>
                  {sort.field === 'updated_at' && <ArrowUpDown size={12} />}
                </div>
              </th>
              <th style={{ width: 110, textAlign: 'right' }}>Actions</th>
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
                      onChange={(e) => onSelectFolder(folder.id, false, true)}
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
                  <td>
                    <span className="fm-pill fm-pill-coverage">Folder</span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>—</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {formatRelativeDate(folder.updated_at || folder.created_at)}
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        type="button"
                        className="fm-btn"
                        style={{ padding: '4px 6px', border: 0 }}
                        onClick={(e) => toggleMenu(e, `folder-${folder.id}`)}
                        aria-label={`Actions for folder ${folder.name}`}
                      >
                        <MoreVertical size={14} />
                      </button>

                      {isMenuOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            background: 'var(--panel)',
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                            zIndex: 30,
                            minWidth: 140,
                            padding: '4px 0',
                          }}
                        >
                          {!isTrash ? (
                            <>
                              <button
                                type="button"
                                className="fm-nav-btn"
                                style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                                style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                                style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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
                                style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onRestoreItem?.(folder, 'folder');
                                }}
                              >
                                <RotateCcw size={13} /> Restore
                              </button>
                              <button
                                type="button"
                                className="fm-nav-btn"
                                style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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
                      onChange={(e) => onSelectFile(file.id, false, true)}
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
                  <td>{renderStatusPills(file)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {formatBytes(file.size_bytes)}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {formatRelativeDate(file.updated_at || file.created_at)}
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      {!isTrash && (
                        <>
                          <button
                            type="button"
                            className="fm-btn"
                            style={{ padding: '4px 6px', border: 0 }}
                            onClick={() => onPreviewFile(file)}
                            title="Preview file"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="fm-btn"
                            style={{ padding: '4px 6px', border: 0 }}
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
                          className="fm-btn"
                          style={{ padding: '4px 6px', border: 0 }}
                          onClick={(e) => toggleMenu(e, `file-${file.id}`)}
                          aria-label={`More actions for file ${file.name}`}
                        >
                          <MoreVertical size={14} />
                        </button>

                        {isMenuOpen && (
                          <div
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: '100%',
                              background: 'var(--panel)',
                              border: '1px solid var(--line)',
                              borderRadius: 6,
                              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                              zIndex: 30,
                              minWidth: 150,
                              padding: '4px 0',
                            }}
                          >
                            {!isTrash ? (
                              <>
                                <button
                                  type="button"
                                  className="fm-nav-btn"
                                  style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onChatWithFile(file);
                                  }}
                                >
                                  <Sparkles size={13} /> ✦ Ask AI
                                </button>
                                {isPdfMimeType(file.mime_type) && file.index_status !== 'indexed' && (
                                  <button
                                    type="button"
                                    className="fm-nav-btn"
                                    style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                                  style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                                  style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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
                                  style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    onRestoreItem?.(file, 'file');
                                  }}
                                >
                                  <RotateCcw size={13} /> Restore
                                </button>
                                <button
                                  type="button"
                                  className="fm-nav-btn"
                                  style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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

  // ─── Grid View (Phase 4 Full Feature Parity) ───────────────────────────────
  return (
    <div className="fm-grid-wrap" onClick={handleContainerClick}>
      {/* Trash Retention Warning Banner (Phase 4 Requirement) */}
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
              {/* Card Header: Checkbox + Context Menu */}
              <div className="fm-grid-card-head" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => onSelectFolder(folder.id, false, true)}
                  aria-label={`Select folder ${folder.name}`}
                />
                <button
                  type="button"
                  className="fm-btn"
                  style={{ padding: '2px 4px', border: 0 }}
                  onClick={(e) => toggleMenu(e, `grid-folder-${folder.id}`)}
                  aria-label={`Actions for folder ${folder.name}`}
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div className="fm-grid-menu">
                    {!isTrash ? (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                          onClick={() => {
                            setActiveMenuId(null);
                            onRestoreItem?.(folder, 'folder');
                          }}
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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

              <div className="fm-card-icon-area">
                <Folder size={40} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="fm-card-name" title={folder.name}>
                {folder.name}
              </div>
              <div className="fm-card-meta">
                <span>Folder</span>
                <span>{formatRelativeDate(folder.updated_at || folder.created_at)}</span>
              </div>
            </div>
          );
        })}

        {/* File Cards */}
        {files.map((file) => {
          const isSelected = selectedFileIds.includes(file.id);
          const isMenuOpen = activeMenuId === `grid-file-${file.id}`;

          return (
            <div
              key={`file-grid-${file.id}`}
              className={`fm-grid-card ${isSelected ? 'selected' : ''}`}
              onClick={(e) => onSelectFile(file.id, e.shiftKey, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => onPreviewFile(file)}
            >
              {/* Card Header: Checkbox + Context Menu */}
              <div className="fm-grid-card-head" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => onSelectFile(file.id, false, true)}
                  aria-label={`Select file ${file.name}`}
                />
                <button
                  type="button"
                  className="fm-btn"
                  style={{ padding: '2px 4px', border: 0 }}
                  onClick={(e) => toggleMenu(e, `grid-file-${file.id}`)}
                  aria-label={`Actions for file ${file.name}`}
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div className="fm-grid-menu">
                    {!isTrash ? (
                      <>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                          onClick={() => {
                            setActiveMenuId(null);
                            onChatWithFile(file);
                          }}
                        >
                          <Sparkles size={13} /> ✦ Ask AI
                        </button>
                        {isPdfMimeType(file.mime_type) && file.index_status !== 'indexed' && (
                          <button
                            type="button"
                            className="fm-nav-btn"
                            style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12 }}
                          onClick={() => {
                            setActiveMenuId(null);
                            onRestoreItem?.(file, 'file');
                          }}
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button
                          type="button"
                          className="fm-nav-btn"
                          style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: '#dc2626' }}
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

              <div className="fm-card-icon-area">
                {getFileIcon(file.mime_type, file.name, 36)}
              </div>
              <div className="fm-card-name" title={file.name}>
                {file.name}
              </div>
              <div>{renderStatusPills(file)}</div>
              <div className="fm-card-meta">
                <span>{formatBytes(file.size_bytes)}</span>
                <span>{formatRelativeDate(file.updated_at || file.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
