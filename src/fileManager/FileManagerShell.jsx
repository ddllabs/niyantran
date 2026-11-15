/**
 * Feature F341: Personal File Manager Shell.
 *
 * Top-level workspace shell orchestrating all 13 approved v1 capabilities:
 * - Sidebar navigation (All Files, AI Artifacts, Trash) with storage capacity gauge.
 * - Header toolbar with scoped search, view mode toggle, upload, new folder, and jobs monitor.
 * - Interactive breadcrumbs, file/folder browser, floating bulk bar, and jobs drawer.
 * - In-flight upload progress indicators and drag-and-drop dropzone overlay.
 */

import { useRef, useState } from 'react';
import {
  Folder,
  Sparkles,
  Trash2,
  Plus,
  Upload,
  Search,
  List,
  LayoutGrid,
  Loader2,
  X,
} from 'lucide-react';
import './fileManager.css';
import { useFileManager } from './useFileManager.js';
import StorageUsageGauge from './StorageUsageGauge.jsx';
import DriveBreadcrumbs from './DriveBreadcrumbs.jsx';
import DriveBrowser from './DriveBrowser.jsx';
import DriveBulkBar from './DriveBulkBar.jsx';
import DriveJobsDrawer from './DriveJobsDrawer.jsx';
import PdfPreviewModal from './PdfPreviewModal.jsx';
import UploadQueuePanel from './UploadQueuePanel.jsx';

export default function FileManagerShell({ onClose } = {}) {
  const {
    view,
    currentFolder,
    pathSegments,
    viewMode,
    searchQuery,
    searchScope,
    sort,
    folders,
    files,
    quota,
    loading,
    error,
    selectedFolderIds,
    selectedFileIds,
    selectedCount,
    totalSelectedSizeBytes,
    hasSelectedPdf,
    uploadQueue,

    isJobsOpen,
    previewFile,
    isCreateFolderOpen,
    renameTarget,
    isEmptyTrashConfirmOpen,

    setView,
    setViewMode,
    setSearchQuery,
    setSearchScope,
    setSort,
    setIsJobsOpen,
    setPreviewFile,
    setIsCreateFolderOpen,
    setRenameTarget,
    setIsEmptyTrashConfirmOpen,

    refresh,
    navigateToFolder,
    handleSelectFolder,
    handleSelectFile,
    handleSelectAll,
    clearSelection,
    uploadFiles,
    cancelUpload,
    retryUpload,
    dismissUpload,
    clearCompletedUploads,
    handleCreateFolder,
    handleRename,
    handleSoftDelete,
    handleRestore,
    handlePermanentDelete,
    handleEmptyTrash,
    handleMove,
    handleIndex,
    handleBulkIndex,
    handleDownload,
    handleBulkDownload,
    handleChatWithFile,
  } = useFileManager();

  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [renameInput, setRenameInput] = useState('');

  // Drag and Drop files onto workspace
  const handleDragEnter = (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const openCreateFolderModal = () => {
    setFolderNameInput('');
    setIsCreateFolderOpen(true);
  };

  const submitCreateFolder = (e) => {
    e.preventDefault();
    if (!folderNameInput.trim()) return;
    handleCreateFolder(folderNameInput.trim());
  };

  const openRenameModal = (item, kind) => {
    setRenameTarget({ item, kind });
    setRenameInput(item.name || '');
  };

  const submitRename = (e) => {
    e.preventDefault();
    if (!renameInput.trim()) return;
    handleRename(renameInput.trim());
  };

  return (
    <div
      className="fm-shell"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="fm-dropzone-active">
          <Upload size={48} style={{ color: 'var(--accent)' }} />
          <div className="fm-dropzone-title">Drop files here to upload</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Files will be stored in {currentFolder ? `“${currentFolder.name}”` : 'All Files'}
          </div>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            uploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* ─── Navigation Sidebar ──────────────────────────────────────────────── */}
      <aside className="fm-sidebar">
        <div>
          <div className="fm-sidebar-brand">
            <Folder size={16} style={{ color: 'var(--accent)' }} />
            <span>File Manager</span>
          </div>

          <nav className="fm-sidebar-nav" aria-label="File manager navigation">
            <button
              type="button"
              className={`fm-nav-btn ${view === 'all' ? 'active' : ''}`}
              onClick={() => setView('all')}
            >
              <Folder size={15} />
              <span>All Files</span>
            </button>

            <button
              type="button"
              className={`fm-nav-btn ${view === 'artifacts' ? 'active' : ''}`}
              onClick={() => setView('artifacts')}
            >
              <Sparkles size={15} />
              <span>AI Artifacts</span>
            </button>

            <button
              type="button"
              className={`fm-nav-btn ${view === 'trash' ? 'active' : ''}`}
              onClick={() => setView('trash')}
            >
              <Trash2 size={15} />
              <span>Trash</span>
            </button>
          </nav>
        </div>

        {/* Real-time Storage Quota Gauge */}
        <div className="fm-sidebar-bottom">
          <StorageUsageGauge quota={quota} />
        </div>
      </aside>

      {/* ─── Main Content Workspace ──────────────────────────────────────────── */}
      <main className="fm-main">
        {/* Header Toolbar */}
        <header className="fm-toolbar">
          {/* Scoped Search Box */}
          <div className="fm-search-wrap">
            <Search size={14} style={{ color: 'var(--muted)' }} />
            <input
              type="search"
              className="fm-search-input"
              placeholder={
                searchScope === 'everywhere'
                  ? 'Search all files & folders...'
                  : `Search in ${currentFolder?.name || 'All Files'}...`
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search files"
            />
            <button
              type="button"
              className={`fm-scope-btn ${searchScope === 'everywhere' ? 'active' : ''}`}
              onClick={() =>
                setSearchScope((prev) => (prev === 'folder' ? 'everywhere' : 'folder'))
              }
              title="Toggle search across entire account vs current folder"
            >
              {searchScope === 'everywhere' ? 'Everywhere' : 'This Folder'}
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="fm-toolbar-actions">
            {view !== 'trash' ? (
              <>
                <button
                  type="button"
                  className="fm-btn"
                  onClick={openCreateFolderModal}
                  title="Create a new folder"
                >
                  <Plus size={14} />
                  <span>New Folder</span>
                </button>

                <button
                  type="button"
                  className="fm-btn fm-btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload files from device (up to 50 MB each)"
                >
                  <Upload size={14} />
                  <span>Upload</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="fm-btn fm-btn-danger"
                onClick={() => setIsEmptyTrashConfirmOpen(true)}
                disabled={folders.length === 0 && files.length === 0}
                title="Permanently erase all items in Trash"
              >
                <Trash2 size={14} />
                <span>Empty Trash</span>
              </button>
            )}

            {/* Jobs Drawer Button */}
            <button
              type="button"
              className="fm-btn"
              onClick={() => setIsJobsOpen(true)}
              title="View AI indexing background queue"
            >
              <Sparkles size={14} />
              <span>Jobs</span>
            </button>

            {/* Grid / List Toggle */}
            <div className="fm-view-toggle">
              <button
                type="button"
                className={`fm-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
                aria-label="Switch to list view"
              >
                <List size={14} />
              </button>
              <button
                type="button"
                className={`fm-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid view"
                aria-label="Switch to grid view"
              >
                <LayoutGrid size={14} />
              </button>
            </div>

            {onClose ? (
              <button
                type="button"
                className="fm-btn fm-btn-close"
                onClick={onClose}
                title="Close File Manager"
                aria-label="Close File Manager"
                style={{ marginLeft: 8 }}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </header>

        {/* Breadcrumb Navigation Rail */}
        <DriveBreadcrumbs
          currentFolder={currentFolder}
          pathSegments={pathSegments}
          onNavigate={navigateToFolder}
          onDropOnFolder={(_e, targetFolderId) => {
            if (selectedFileIds.length > 0 || selectedFolderIds.length > 0) {
              handleMove(targetFolderId);
            }
          }}
        />

        {/* Browser Content */}
        <div className="fm-browser-content">
          {loading && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 16,
                fontSize: 12,
                color: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Loader2 size={12} className="animate-spin" />
              <span>Updating...</span>
            </div>
          )}

          {error && (
            <div className="storage-gauge-warning" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <DriveBrowser
            folders={folders}
            files={files}
            selectedFolderIds={selectedFolderIds}
            selectedFileIds={selectedFileIds}
            viewMode={viewMode}
            view={view}
            searchQuery={searchQuery}
            sort={sort}
            onSortChange={(field) =>
              setSort((prev) => ({
                field,
                direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
              }))
            }
            onSelectFolder={handleSelectFolder}
            onSelectFile={handleSelectFile}
            onSelectAll={handleSelectAll}
            onOpenFolder={(f) => navigateToFolder(f.id)}
            onPreviewFile={(f) => setPreviewFile(f)}
            onDownloadFile={handleDownload}
            onIndexFile={handleIndex}
            onChatWithFile={handleChatWithFile}
            onRenameItem={openRenameModal}
            onTrashItem={(item, kind) => handleSoftDelete([item.id], kind)}
            onRestoreItem={(item, kind) => handleRestore([item.id], kind)}
            onPermanentDeleteItem={(item, kind) => handlePermanentDelete([item.id], kind)}
            onUploadClick={() => fileInputRef.current?.click()}
          />
        </div>

        {/* Floating Bulk Action Bar */}
        <DriveBulkBar
          selectedCount={selectedCount}
          totalSizeBytes={totalSelectedSizeBytes}
          view={view}
          hasPdfFiles={hasSelectedPdf}
          onIndex={handleBulkIndex}
          onMove={() => {
            const target = prompt('Enter target folder ID (or leave empty for root):');
            if (target !== null) {
              handleMove(target.trim() || null);
            }
          }}
          onDownload={handleBulkDownload}
          onTrash={() => {
            if (selectedFileIds.length > 0) handleSoftDelete(selectedFileIds, 'file');
            if (selectedFolderIds.length > 0) handleSoftDelete(selectedFolderIds, 'folder');
          }}
          onRestore={() => {
            if (selectedFileIds.length > 0) handleRestore(selectedFileIds, 'file');
            if (selectedFolderIds.length > 0) handleRestore(selectedFolderIds, 'folder');
          }}
          onPermanentDelete={() => {
            if (selectedFileIds.length > 0) handlePermanentDelete(selectedFileIds, 'file');
            if (selectedFolderIds.length > 0) handlePermanentDelete(selectedFolderIds, 'folder');
          }}
          onClear={clearSelection}
        />
      </main>

      {/* ─── Jobs Drawer ───────────────────────────────────────────────────────── */}
      <DriveJobsDrawer
        isOpen={isJobsOpen}
        onClose={() => setIsJobsOpen(false)}
        onJobUpdated={() => refresh(true)}
      />

      {/* ─── Preview Modal ─────────────────────────────────────────────────────── */}
      <PdfPreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownload}
        onChatWithFile={handleChatWithFile}
      />

      {/* ─── Create Folder Modal ───────────────────────────────────────────────── */}
      {isCreateFolderOpen && (
        <div
          className="fm-modal-backdrop"
          onClick={() => setIsCreateFolderOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fm-modal-box"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fm-modal-head">
              <span className="fm-modal-title">Create New Folder</span>
              <button
                type="button"
                className="fm-btn"
                style={{ padding: '2px 6px' }}
                onClick={() => setIsCreateFolderOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <form onSubmit={submitCreateFolder}>
              <div className="fm-modal-body" style={{ minHeight: 'auto', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>Folder Name</label>
                <input
                  type="text"
                  autoFocus
                  className="fm-search-input"
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    background: 'var(--bg)',
                  }}
                  placeholder="e.g. Invoices, Contracts, Briefs"
                  value={folderNameInput}
                  onChange={(e) => setFolderNameInput(e.target.value)}
                />
              </div>
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="fm-btn"
                  onClick={() => setIsCreateFolderOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fm-btn fm-btn-primary"
                  disabled={!folderNameInput.trim()}
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Rename Modal ──────────────────────────────────────────────────────── */}
      {renameTarget && (
        <div
          className="fm-modal-backdrop"
          onClick={() => setRenameTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fm-modal-box"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fm-modal-head">
              <span className="fm-modal-title">Rename {renameTarget.kind}</span>
              <button
                type="button"
                className="fm-btn"
                style={{ padding: '2px 6px' }}
                onClick={() => setRenameTarget(null)}
              >
                <X size={14} />
              </button>
            </div>
            <form onSubmit={submitRename}>
              <div className="fm-modal-body" style={{ minHeight: 'auto', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>New Name</label>
                <input
                  type="text"
                  autoFocus
                  className="fm-search-input"
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    background: 'var(--bg)',
                  }}
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                />
              </div>
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="fm-btn"
                  onClick={() => setRenameTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fm-btn fm-btn-primary"
                  disabled={!renameInput.trim()}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Empty Trash Confirmation Modal ────────────────────────────────────── */}
      {isEmptyTrashConfirmOpen && (
        <div
          className="fm-modal-backdrop"
          onClick={() => setIsEmptyTrashConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fm-modal-box"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fm-modal-head">
              <span className="fm-modal-title" style={{ color: '#dc2626' }}>
                Empty Trash Permanently?
              </span>
              <button
                type="button"
                className="fm-btn"
                style={{ padding: '2px 6px' }}
                onClick={() => setIsEmptyTrashConfirmOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="fm-modal-body" style={{ minHeight: 'auto', gap: 12, lineHeight: 1.5 }}>
              <p>
                Are you sure you want to permanently delete all items in Trash?
              </p>
              <div className="storage-gauge-warning" style={{ background: '#fee2e2', color: '#991b1b' }}>
                <strong>Warning:</strong> This action cannot be undone. All files, vector chunks, extracted OCR text, and search indexes will be permanently erased immediately.
              </div>
            </div>
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="fm-btn"
                onClick={() => setIsEmptyTrashConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fm-btn fm-btn-danger"
                onClick={handleEmptyTrash}
              >
                Yes, Empty Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Upload Queue Manager Panel */}
      <UploadQueuePanel
        queue={uploadQueue}
        onCancel={cancelUpload}
        onRetry={retryUpload}
        onDismiss={dismissUpload}
        onClearCompleted={clearCompletedUploads}
      />
    </div>
  );
}
