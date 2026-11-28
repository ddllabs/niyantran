/**
 * Feature F341: Personal File Manager Shell (Redesigned UI/UX).
 *
 * Implements reference information architecture & visual design:
 * - Header: Niyantran icon, title, description, global search field.
 * - Navigation Tabs: My Files, Organisation Files, AI Artifacts, Trash (Shared with me removed).
 * - Filter & Action Toolbar: All Types, Any Index Status, Owned by Anyone on left;
 *   Index Queue, New Folder, New Base, New Doc, Upload Here on right.
 * - Table Structure: 8 columns with normative data presentation.
 * - Responsive layouts for Desktop, Tablet, and Mobile.
 */

import { useRef, useState } from 'react';
import {
  Folder,
  FolderPlus,
  Sparkles,
  Trash2,
  Upload,
  Search,
  List,
  LayoutGrid,
  Loader2,
  X,
  Building2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import './fileManager.css';
import { useFileManager } from './useFileManager.js';
import StorageUsageGauge from './StorageUsageGauge.jsx';
import DriveBreadcrumbs from './DriveBreadcrumbs.jsx';
import DriveBrowser from './DriveBrowser.jsx';
import DriveBulkBar from './DriveBulkBar.jsx';
import DriveJobsDrawer from './DriveJobsDrawer.jsx';
import FilePreviewModal from './FilePreviewModal.jsx';
import IndexConfirmationModal from './IndexConfirmationModal.jsx';
import MoveItemsModal from './MoveItemsModal.jsx';
import UploadQueuePanel from './UploadQueuePanel.jsx';

export default function FileManagerShell({ onClose } = {}) {
  const {
    view,
    currentFolder,
    pathSegments,
    viewMode,
    sort,

    // Data & User state
    folders,
    files,
    displayFolders,
    displayFiles,
    currentUser,
    quota,
    loading,
    error,
    selectedFolderIds,
    selectedFileIds,
    selectedCount,
    totalSelectedSizeBytes,
    hasSelectedPdf,
    uploadQueue,

    // Filters & Notices
    searchQuery,
    typeFilter,
    indexStatusFilter,
    ownerFilter,
    noticeMessage,

    // Modals
    isJobsOpen,
    previewFile,
    isCreateFolderOpen,
    renameTarget,
    isEmptyTrashConfirmOpen,

    // Setters
    setView,
    setViewMode,
    setSearchQuery,
    setTypeFilter,
    setIndexStatusFilter,
    setOwnerFilter,
    setSort,
    setIsJobsOpen,
    setPreviewFile,
    setIsCreateFolderOpen,
    setRenameTarget,
    setIsEmptyTrashConfirmOpen,

    // Actions
    refresh,
    clearFilters,
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
  const [indexConfirmTarget, setIndexConfirmTarget] = useState(null);
  const [isBulkIndexConfirmOpen, setIsBulkIndexConfirmOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);

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

  const hasActiveFilters =
    typeFilter !== 'all' || indexStatusFilter !== 'any' || ownerFilter !== 'anyone';

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
            Files will be stored in {currentFolder ? `“${currentFolder.name}”` : 'My Files'}
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

      {/* ─── 1. Header (Left: Icon, Title, Desc; Right: Global Search & Close) ─── */}
      <header className="fm-header">
        <div className="fm-header-left">
          <div className="fm-header-icon-box">
            <Folder size={20} className="fm-header-icon" />
          </div>
          <div className="fm-header-titles">
            <h1 className="fm-header-title">File Manager</h1>
            <p className="fm-header-desc">
              Your files, documents and AI-ready knowledge in one place.
            </p>
          </div>
        </div>

        <div className="fm-header-right">
          <div className="fm-global-search">
            <Search size={14} className="fm-search-icon" />
            <input
              type="search"
              className="fm-global-search-input"
              placeholder="Search files, folders and supported documents"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search files, folders and supported documents"
            />
            {searchQuery && (
              <button
                type="button"
                className="fm-search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              className="fm-btn fm-btn-close"
              onClick={onClose}
              title="Close File Manager"
              aria-label="Close File Manager"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {/* ─── 2. Navigation Tabs (My Files, Organisation Files, AI Artifacts, Trash) ─ */}
      <div className="fm-tabs-bar">
        <nav className="fm-tabs-nav" aria-label="File manager navigation tabs">
          <button
            type="button"
            className={`fm-tab-btn ${view === 'all' ? 'active' : ''}`}
            onClick={() => setView('all')}
          >
            <Folder size={14} />
            <span>My Files</span>
          </button>

          <button
            type="button"
            className={`fm-tab-btn ${view === 'organisation' ? 'active' : ''}`}
            onClick={() => setView('organisation')}
          >
            <Building2 size={14} />
            <span>Organisation Files</span>
            <span className="fm-tab-tag">Enterprise</span>
          </button>

          <button
            type="button"
            className={`fm-tab-btn ${view === 'artifacts' ? 'active' : ''}`}
            onClick={() => setView('artifacts')}
          >
            <Sparkles size={14} />
            <span>AI Artifacts</span>
          </button>

          <button
            type="button"
            className={`fm-tab-btn fm-tab-trash ${view === 'trash' ? 'active' : ''}`}
            onClick={() => setView('trash')}
          >
            <Trash2 size={14} />
            <span>Trash</span>
          </button>
        </nav>

        {/* Compact Storage Quota Indicator */}
        <div className="fm-tabs-quota">
          <StorageUsageGauge quota={quota} onRetry={() => refresh(false)} compact={true} />
        </div>
      </div>

      {/* ─── Notice / Info Banner (e.g. New Base, New Doc) ───────────────────── */}
      {noticeMessage && (
        <div className="fm-notice-banner" role="status">
          <AlertCircle size={14} style={{ color: 'var(--accent)' }} />
          <span>{noticeMessage}</span>
        </div>
      )}

      {/* ─── 3. Filter and Action Toolbar (Single Horizontal Bar) ─────────────── */}
      <div className="fm-filter-action-toolbar">
        {/* Left-side filters */}
        <div className="fm-toolbar-filters">
          <div className="fm-select-wrap">
            <select
              className="fm-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by file type"
            >
              <option value="all">All Types</option>
              <option value="folders">Folders</option>
              <option value="pdf">PDF Documents</option>
              <option value="spreadsheets">Spreadsheets</option>
              <option value="code">Code Files</option>
              <option value="images">Images</option>
            </select>
          </div>

          <div className="fm-select-wrap">
            <select
              className="fm-select"
              value={indexStatusFilter}
              onChange={(e) => setIndexStatusFilter(e.target.value)}
              aria-label="Filter by index status"
            >
              <option value="any">Any Index Status</option>
              <option value="indexed">Searchable</option>
              <option value="indexing">Processing</option>
              <option value="queued">Queued</option>
              <option value="not_indexed">Not Searchable</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="fm-select-wrap">
            <select
              className="fm-select"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              aria-label="Filter by owner"
            >
              <option value="anyone">Owned by Anyone</option>
              <option value="me">Owned by Me</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="fm-btn fm-btn-ghost fm-btn-reset-filters"
              onClick={clearFilters}
              title="Reset all active filters"
            >
              <Filter size={12} />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Right-side actions */}
        <div className="fm-toolbar-actions-group">
          {/* Index Queue Action */}
          <button
            type="button"
            className="fm-btn fm-btn-toolbar"
            onClick={() => setIsJobsOpen(true)}
            title="View AI background indexing queue"
          >
            <Sparkles size={14} />
            <span>Index Queue</span>
          </button>

          {view !== 'trash' ? (
            <>
              {/* New Folder Action */}
              <button
                type="button"
                className="fm-btn fm-btn-toolbar"
                onClick={openCreateFolderModal}
                title="Create a new folder"
              >
                <FolderPlus size={14} />
                <span>New Folder</span>
              </button>

              {/* Upload Here Action (Primary Accent) */}
              <button
                type="button"
                className="fm-btn fm-btn-primary fm-btn-upload-here"
                onClick={() => fileInputRef.current?.click()}
                title="Upload files from device (up to 50 MB each)"
              >
                <Upload size={14} />
                <span>Upload Here</span>
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

          {/* View Mode Toggle (List / Grid) */}
          <div className="fm-view-toggle">
            <button
              type="button"
              className={`fm-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-label="Switch to list view"
            >
              <List size={13} />
            </button>
            <button
              type="button"
              className={`fm-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
              aria-label="Switch to grid view"
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Breadcrumb Navigation Rail ───────────────────────────────────────── */}
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

      {/* ─── 4. Main Table / Browser Content ──────────────────────────────────── */}
      <main className="fm-main-content">
        {loading && (
          <div className="fm-loading-indicator">
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
          folders={displayFolders}
          files={displayFiles}
          selectedFolderIds={selectedFolderIds}
          selectedFileIds={selectedFileIds}
          viewMode={viewMode}
          view={view}
          searchQuery={searchQuery}
          sort={sort}
          quota={quota}
          loading={loading}
          currentUser={currentUser}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
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
          onIndexFile={(f) => setIndexConfirmTarget(f)}
          onChatWithFile={handleChatWithFile}
          onRenameItem={openRenameModal}
          onTrashItem={(item, kind) => handleSoftDelete([item.id], kind)}
          onRestoreItem={(item, kind) => handleRestore([item.id], kind)}
          onPermanentDeleteItem={(item, kind) => handlePermanentDelete([item.id], kind)}
          onUploadClick={() => fileInputRef.current?.click()}
        />
      </main>

      {/* ─── Floating Multi-Selection Action Bar ─────────────────────────────── */}
      <DriveBulkBar
        selectedCount={selectedCount}
        totalSizeBytes={totalSelectedSizeBytes}
        view={view}
        hasPdfFiles={hasSelectedPdf}
        onIndex={() => setIsBulkIndexConfirmOpen(true)}
        onMove={() => setIsMoveModalOpen(true)}
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

      {/* ─── Floating / Docked Upload Queue Panel ────────────────────────────── */}
      <UploadQueuePanel
        queue={uploadQueue}
        onCancel={cancelUpload}
        onRetry={retryUpload}
        onDismiss={dismissUpload}
        onClearCompleted={clearCompletedUploads}
      />

      {/* ─── Jobs Drawer ─────────────────────────────────────────────────────── */}
      <DriveJobsDrawer
        isOpen={isJobsOpen}
        onClose={() => setIsJobsOpen(false)}
        onJobUpdated={() => refresh(true)}
      />

      {/* ─── Preview Modal ───────────────────────────────────────────────────── */}
      <FilePreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownload}
        onChatWithFile={handleChatWithFile}
      />

      {/* ─── AI Indexing Confirmation Modal (Single File) ────────────────────── */}
      <IndexConfirmationModal
        file={indexConfirmTarget}
        isOpen={!!indexConfirmTarget}
        onClose={() => setIndexConfirmTarget(null)}
        onConfirm={() => {
          if (indexConfirmTarget) {
            handleIndex(indexConfirmTarget);
          }
        }}
      />

      {/* ─── AI Indexing Confirmation Modal (Batch) ──────────────────────────── */}
      <IndexConfirmationModal
        isBatch
        batchFiles={files.filter((f) => selectedFileIds.includes(f.id) && f.mime_type === 'application/pdf')}
        isOpen={isBulkIndexConfirmOpen}
        onClose={() => setIsBulkIndexConfirmOpen(false)}
        onConfirm={handleBulkIndex}
      />

      {/* ─── Move Items Modal ────────────────────────────────────────────────── */}
      <MoveItemsModal
        isOpen={isMoveModalOpen}
        onClose={() => setIsMoveModalOpen(false)}
        folders={folders}
        selectedFolderIds={selectedFolderIds}
        selectedFileIds={selectedFileIds}
        onConfirmMove={handleMove}
      />

      {/* ─── Create Folder Modal ─────────────────────────────────────────────── */}
      {isCreateFolderOpen && (
        <div className="fm-modal-backdrop" onClick={() => setIsCreateFolderOpen(false)}>
          <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-title">New Folder</div>
            <form onSubmit={submitCreateFolder}>
              <input
                type="text"
                className="fm-input"
                placeholder="Folder name"
                autoFocus
                value={folderNameInput}
                onChange={(e) => setFolderNameInput(e.target.value)}
              />
              <div className="fm-modal-actions">
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
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Rename Modal ────────────────────────────────────────────────────── */}
      {renameTarget && (
        <div className="fm-modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-title">Rename {renameTarget.kind}</div>
            <form onSubmit={submitRename}>
              <input
                type="text"
                className="fm-input"
                placeholder="New name"
                autoFocus
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
              />
              <div className="fm-modal-actions">
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

      {/* ─── Empty Trash Confirmation Modal ──────────────────────────────────── */}
      {isEmptyTrashConfirmOpen && (
        <div className="fm-modal-backdrop" onClick={() => setIsEmptyTrashConfirmOpen(false)}>
          <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-title" style={{ color: '#dc2626' }}>
              Empty Trash?
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 16px' }}>
              All items currently in Trash will be permanently deleted. This action cannot be
              undone.
            </p>
            <div className="fm-modal-actions">
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
                onClick={() => {
                  handleEmptyTrash();
                  setIsEmptyTrashConfirmOpen(false);
                }}
              >
                Empty Trash Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
