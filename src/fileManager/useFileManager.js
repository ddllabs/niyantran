/**
 * Feature F341: useFileManager React Hook.
 *
 * Encapsulates client-side state management, query orchestration, file uploads,
 * multi-selection, and action handlers across all 13 approved v1 capabilities:
 * - Dedicated Upload Queue with cancel, retry, pre-validation & batch isolation.
 * - Normalized error handling (Phase 5).
 * - Multi-selection and bulk action handlers.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  listFilesAndFolders,
  getStorageQuota,
  getCurrentUser,
  prepareUpload,
  uploadBinary,
  completeUpload,
  cleanupPendingUpload,
  calculateSha256,
  createFolder,
  renameFolder,
  renameFile,
  moveItems,
  softDelete,
  restore,
  emptyTrash,
  permanentlyDeleteItems,
  indexForAi,
  getDownloadUrl,
  normalizeFileManagerError,
  logFileManagerError,
  getUniqueFileName,
} from './fileManagerService.js';
import { MAX_FILE_SIZE_BYTES, isPdfMimeType } from '../types/fileManager.ts';
import { openAiResearch } from '../lib/aiDrop.js';

export const KNOWLEDGE_BASE_NOTICE = 'Knowledge Base creation is configured in Niyantran Knowledge Bases.';
export const NEW_DOC_NOTICE = 'New Document creation is managed in Niyantran Terminal Editor.';

export function filterDisplayFolders(folders = [], { view = 'all', typeFilter = 'all', indexStatusFilter = 'any', ownerFilter = 'anyone', currentUser = null } = {}) {
  if (view === 'organisation') return [];
  if (typeFilter !== 'all' && typeFilter !== 'folders') return [];
  if (indexStatusFilter !== 'any') return [];
  if (ownerFilter === 'me' && currentUser?.id) {
    return folders.filter((f) => !f.user_id || f.user_id === currentUser.id);
  }
  return folders;
}

export function filterDisplayFiles(files = [], { view = 'all', typeFilter = 'all', indexStatusFilter = 'any', ownerFilter = 'anyone', currentUser = null } = {}) {
  if (view === 'organisation') return [];
  return files.filter((file) => {
    if (ownerFilter === 'me' && currentUser?.id && file.user_id && file.user_id !== currentUser.id) {
      return false;
    }
    if (typeFilter === 'folders') return false;
    if (typeFilter === 'pdf' && !isPdfMimeType(file.mime_type)) return false;
    if (typeFilter === 'spreadsheets') {
      const m = (file.mime_type || '').toLowerCase();
      const ext = (file.name?.split('.').pop() || '').toLowerCase();
      if (!m.includes('spreadsheet') && !m.includes('csv') && !['csv', 'xlsx', 'xls', 'tsv'].includes(ext)) {
        return false;
      }
    }
    if (typeFilter === 'images') {
      const m = (file.mime_type || '').toLowerCase();
      const ext = (file.name?.split('.').pop() || '').toLowerCase();
      if (!m.startsWith('image/') && !['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
        return false;
      }
    }
    if (typeFilter === 'code') {
      const ext = (file.name?.split('.').pop() || '').toLowerCase();
      if (!['js', 'ts', 'jsx', 'tsx', 'json', 'md', 'html', 'css', 'py', 'sql', 'yaml', 'yml'].includes(ext)) {
        return false;
      }
    }

    if (indexStatusFilter === 'indexed' && file.index_status !== 'indexed') return false;
    if (indexStatusFilter === 'queued' && file.index_status !== 'indexing_queued') return false;
    if (indexStatusFilter === 'indexing' && !['indexing_extracting', 'indexing_chunking'].includes(file.index_status)) return false;
    if (indexStatusFilter === 'not_indexed' && file.index_status !== 'not_indexed') return false;
    if (indexStatusFilter === 'failed' && file.index_status !== 'indexing_failed') return false;

    return true;
  });
}

export function useFileManager(initialFolderId = null) {
  // Navigation & View state
  const [view, setView] = useState('all'); // 'all' | 'trash' | 'artifacts'
  const [currentFolder, setCurrentFolder] = useState(null); // null = Root
  const [pathSegments, setPathSegments] = useState([]); // [{ id, name, path }]
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState('folder'); // 'folder' | 'everywhere'
  const [sort, setSort] = useState({ field: 'name', direction: 'asc' });
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'folders' | 'pdf' | 'spreadsheets' | 'code' | 'images'
  const [indexStatusFilter, setIndexStatusFilter] = useState('any'); // 'any' | 'indexed' | 'indexing' | 'queued' | 'not_indexed' | 'failed'
  const [ownerFilter, setOwnerFilter] = useState('anyone'); // 'anyone' | 'me'
  const [currentUser, setCurrentUser] = useState(null);
  const [noticeMessage, setNoticeMessage] = useState(null);
  const noticeTimeoutRef = useRef(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) setCurrentUser(u);
    }).catch(() => {});
  }, []);

  const showNotice = useCallback((msg) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNoticeMessage(msg);
    noticeTimeoutRef.current = setTimeout(() => {
      setNoticeMessage(null);
    }, 4500);
  }, []);

  const handleNewBase = useCallback(() => {
    showNotice(KNOWLEDGE_BASE_NOTICE);
  }, [showNotice]);

  const handleNewDoc = useCallback(() => {
    showNotice(NEW_DOC_NOTICE);
  }, [showNotice]);


  // Data state
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Selection state
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  // Active Modals & Dialogs
  const [isJobsOpen, setIsJobsOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null); // { item, kind: 'file' | 'folder' }
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isEmptyTrashConfirmOpen, setIsEmptyTrashConfirmOpen] = useState(false);

  // Dedicated Upload Queue state (Phase 3)
  const [uploadQueue, setUploadQueue] = useState([]);
  const uploadControllersRef = useRef({});

  // ─── Fetch Current Folder & Files ──────────────────────────────────────────
  const refresh = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const [itemsRes, quotaRes] = await Promise.all([
        listFilesAndFolders({
          folder_id: currentFolder?.id || null,
          view,
          search: searchQuery,
          scope: searchScope,
          sort,
        }),
        getStorageQuota(),
      ]);

      setFolders(itemsRes.folders || []);
      setFiles(itemsRes.files || []);
      setQuota(quotaRes);
    } catch (err) {
      logFileManagerError('Failed to load file manager items', err);
      setError(normalizeFileManagerError(err));
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [currentFolder, view, searchQuery, searchScope, sort]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clear selection on view or folder change
  useEffect(() => {
    setSelectedFolderIds([]);
    setSelectedFileIds([]);
  }, [currentFolder, view]);

  // ─── Navigation Handlers ───────────────────────────────────────────────────
  const navigateToFolder = useCallback((folderId) => {
    if (!folderId) {
      setCurrentFolder(null);
      setPathSegments([]);
      return;
    }

    const clickedFolder = folders.find((f) => f.id === folderId);
    if (clickedFolder) {
      setCurrentFolder(clickedFolder);
      setPathSegments((prev) => [...prev, { id: clickedFolder.id, name: clickedFolder.name }]);
    } else {
      // Direct jump (e.g. from breadcrumb click)
      const targetIndex = pathSegments.findIndex((s) => s.id === folderId);
      if (targetIndex !== -1) {
        const nextSegments = pathSegments.slice(0, targetIndex + 1);
        const target = nextSegments[nextSegments.length - 1];
        setCurrentFolder({ id: target.id, name: target.name });
        setPathSegments(nextSegments);
      } else {
        setCurrentFolder({ id: folderId, name: 'Folder' });
      }
    }
  }, [folders, pathSegments]);

  const changeView = useCallback((nextView) => {
    setView(nextView);
    setCurrentFolder(null);
    setPathSegments([]);
    setSearchQuery('');
  }, []);

  // ─── Selection Handlers ────────────────────────────────────────────────────
  const handleSelectFolder = useCallback((id, isShift, isCtrl) => {
    setSelectedFolderIds((prev) => {
      if (isCtrl) {
        return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      }
      return prev.includes(id) && prev.length === 1 ? [] : [id];
    });
  }, []);

  const handleSelectFile = useCallback((id, isShift, isCtrl) => {
    setSelectedFileIds((prev) => {
      if (isCtrl) {
        return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      }
      return prev.includes(id) && prev.length === 1 ? [] : [id];
    });
  }, []);

  const handleSelectAll = useCallback((checked) => {
    if (!checked) {
      setSelectedFolderIds([]);
      setSelectedFileIds([]);
    } else {
      setSelectedFolderIds(folders.map((f) => f.id));
      setSelectedFileIds(files.map((f) => f.id));
    }
  }, [folders, files]);

  const clearSelection = useCallback(() => {
    setSelectedFolderIds([]);
    setSelectedFileIds([]);
  }, []);

  // Total selected size calculation
  const totalSelectedSizeBytes = useMemo(() => {
    const selectedFiles = files.filter((f) => selectedFileIds.includes(f.id));
    return selectedFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
  }, [files, selectedFileIds]);

  const hasSelectedPdf = useMemo(() => {
    const selectedFiles = files.filter((f) => selectedFileIds.includes(f.id));
    return selectedFiles.some((f) => f.mime_type?.toLowerCase() === 'application/pdf');
  }, [files, selectedFileIds]);

  // Backward-compatible uploadMap derived from uploadQueue
  const uploadMap = useMemo(() => {
    const map = {};
    for (const item of uploadQueue) {
      map[item.id] = {
        name: item.name,
        percent: item.percent,
        status: item.status === 'completed' ? 'uploaded' : item.status,
        error: item.error,
      };
    }
    return map;
  }, [uploadQueue]);

  // ─── File Upload Execution (Phase 3) ───────────────────────────────────────
  const executeSingleUpload = useCallback(async (item) => {
    const controller = new AbortController();
    uploadControllersRef.current[item.id] = controller;

    setUploadQueue((prev) =>
      prev.map((q) =>
        q.id === item.id ? { ...q, status: 'uploading', percent: 0, error: null } : q
      )
    );

    let prep = null;

    try {
      // Step 1: Pre-flight reservation
      prep = await prepareUpload({
        name: item.name,
        mime_type: item.file?.type || 'application/octet-stream',
        size_bytes: item.size,
        folder_id: item.folderId,
      });

      // Step 2: Binary transport with cancellation support
      await uploadBinary(
        prep.signed_upload_url,
        item.file,
        ({ percent }) => {
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, percent } : q))
          );
        },
        { signal: controller.signal }
      );

      // Step 3: Transition to processing while finalizing metadata & checksum
      setUploadQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'processing', percent: 100 } : q
        )
      );

      const sha256 = await calculateSha256(item.file);

      // Step 4: Finalize upload in database
      await completeUpload({ file_id: prep.file_id, sha256 });

      // Step 5: Finalized! Never show completed until both DB & storage succeed
      setUploadQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'completed', percent: 100, error: null } : q
        )
      );
    } catch (err) {
      // Release reservation so aborted/failed upload does not falsely occupy quota
      if (prep?.file_id) {
        await cleanupPendingUpload(prep.file_id);
      }

      if (controller.signal.aborted || err?.name === 'AbortError') {
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'failed', error: 'Upload cancelled by user.' }
              : q
          )
        );
      } else {
        logFileManagerError(`Upload ${item.name}`, err);
        const userMsg = normalizeFileManagerError(err);
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'failed', error: userMsg } : q
          )
        );
      }
    } finally {
      delete uploadControllersRef.current[item.id];
    }
  }, []);

  const uploadFiles = useCallback(async (fileList) => {
    const rawFiles = Array.from(fileList || []);
    if (rawFiles.length === 0) return;

    const currentFolderId = currentFolder?.id || null;
    let runningRemainingQuota = quota?.remaining_bytes;

    const newItems = [];
    const runnableItems = [];

    for (const file of rawFiles) {
      const tempId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const uniqueName = getUniqueFileName(file.name, files);

      // Client-side Pre-validation 1: File size limit (< 50 MB)
      if (file.size > MAX_FILE_SIZE_BYTES) {
        newItems.push({
          id: tempId,
          file,
          name: uniqueName,
          originalName: file.name,
          size: file.size,
          status: 'failed',
          percent: 0,
          error: 'This file exceeds the 50 MB upload limit.',
          folderId: currentFolderId,
        });
        continue;
      }

      // Client-side Pre-validation 2: Storage quota availability & limit
      if (quota?.unavailable) {
        newItems.push({
          id: tempId,
          file,
          name: uniqueName,
          originalName: file.name,
          size: file.size,
          status: 'failed',
          percent: 0,
          error: 'Storage usage is temporarily unavailable. Please retry.',
          folderId: currentFolderId,
        });
        continue;
      }

      if (
        runningRemainingQuota !== undefined &&
        runningRemainingQuota !== null &&
        runningRemainingQuota < file.size
      ) {
        newItems.push({
          id: tempId,
          file,
          name: uniqueName,
          originalName: file.name,
          size: file.size,
          status: 'failed',
          percent: 0,
          error: 'You have reached your storage limit.',
          folderId: currentFolderId,
        });
        continue;
      }

      // Decrement simulated running quota for batch isolation pre-check
      if (typeof runningRemainingQuota === 'number') {
        runningRemainingQuota -= file.size;
      }

      const item = {
        id: tempId,
        file,
        name: uniqueName,
        originalName: file.name,
        size: file.size,
        status: 'queued',
        percent: 0,
        error: null,
        folderId: currentFolderId,
      };

      newItems.push(item);
      runnableItems.push(item);
    }

    setUploadQueue((prev) => [...prev, ...newItems]);

    // Process each runnable item independently (Batch isolation)
    for (const item of runnableItems) {
      await executeSingleUpload(item);
    }

    // Refresh listing & storage quota after batch finishes
    await refresh(true);
  }, [currentFolder, files, quota, executeSingleUpload, refresh]);

  const cancelUpload = useCallback((id) => {
    const controller = uploadControllersRef.current[id];
    if (controller) {
      controller.abort();
    } else {
      setUploadQueue((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status: 'failed', error: 'Upload cancelled by user.' } : q
        )
      );
    }
  }, []);

  const retryUpload = useCallback(async (id) => {
    let targetItem = null;
    setUploadQueue((prev) => {
      targetItem = prev.find((q) => q.id === id);
      return prev;
    });
    if (targetItem && targetItem.file) {
      await executeSingleUpload(targetItem);
      await refresh(true);
    }
  }, [executeSingleUpload, refresh]);

  const dismissUpload = useCallback((id) => {
    setUploadQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const clearCompletedUploads = useCallback(() => {
    setUploadQueue((prev) => prev.filter((q) => q.status !== 'completed'));
  }, []);

  // ─── Mutation Handlers ─────────────────────────────────────────────────────
  const handleCreateFolder = useCallback(async (name) => {
    try {
      await createFolder({
        name,
        parent_id: currentFolder?.id || null,
      });
      setIsCreateFolderOpen(false);
      await refresh(true);
    } catch (err) {
      logFileManagerError('createFolder', err);
      alert(`Failed to create folder: ${normalizeFileManagerError(err)}`);
    }
  }, [currentFolder, refresh]);

  const handleRename = useCallback(async (newName) => {
    if (!renameTarget) return;
    try {
      if (renameTarget.kind === 'folder') {
        await renameFolder({ id: renameTarget.item.id, name: newName });
      } else {
        await renameFile({ id: renameTarget.item.id, name: newName });
      }
      setRenameTarget(null);
      await refresh(true);
    } catch (err) {
      logFileManagerError('rename', err);
      alert(`Failed to rename: ${normalizeFileManagerError(err)}`);
    }
  }, [renameTarget, refresh]);

  const handleSoftDelete = useCallback(async (ids, kind) => {
    try {
      await softDelete({ ids, kind });
      clearSelection();
      await refresh(true);
    } catch (err) {
      logFileManagerError('softDelete', err);
      alert(`Failed to delete items: ${normalizeFileManagerError(err)}`);
    }
  }, [clearSelection, refresh]);

  const handleRestore = useCallback(async (ids, kind) => {
    try {
      await restore({ ids, kind });
      clearSelection();
      await refresh(true);
    } catch (err) {
      logFileManagerError('restore', err);
      alert(`Failed to restore items: ${normalizeFileManagerError(err)}`);
    }
  }, [clearSelection, refresh]);

  const handlePermanentDelete = useCallback(async (ids, kind) => {
    if (!window.confirm('Are you sure you want to permanently erase these items? This cannot be undone.')) {
      return;
    }
    try {
      const res = await permanentlyDeleteItems({ ids, kind });
      if (!res.success && res.failed_count > 0) {
        alert(`Storage cleanup encountered issues for ${res.failed_count} item(s). Database records have been preserved for retry: ${res.storage_error}`);
      }
      clearSelection();
      await refresh(true);
    } catch (err) {
      logFileManagerError('permanentDelete', err);
      alert(`Failed to permanently delete items: ${normalizeFileManagerError(err)}`);
    }
  }, [clearSelection, refresh]);

  const handleEmptyTrash = useCallback(async () => {
    try {
      await emptyTrash();
      setIsEmptyTrashConfirmOpen(false);
      clearSelection();
      await refresh(true);
    } catch (err) {
      logFileManagerError('emptyTrash', err);
      alert(`Failed to empty Trash: ${normalizeFileManagerError(err)}`);
    }
  }, [clearSelection, refresh]);

  const handleMove = useCallback(async (targetFolderId) => {
    try {
      await moveItems({
        fileIds: selectedFileIds,
        folderIds: selectedFolderIds,
        targetFolderId,
      });
      setIsMoveOpen(false);
      clearSelection();
      await refresh(true);
    } catch (err) {
      logFileManagerError('moveItems', err);
      alert(`Failed to move items: ${normalizeFileManagerError(err)}`);
    }
  }, [selectedFileIds, selectedFolderIds, clearSelection, refresh]);

  const handleIndex = useCallback(async (file) => {
    try {
      await indexForAi(file.id);
      setIsJobsOpen(true);
      await refresh(true);
    } catch (err) {
      logFileManagerError('indexForAi', err);
      alert(`Indexing request failed: ${normalizeFileManagerError(err)}`);
    }
  }, [refresh]);

  const handleBulkIndex = useCallback(async () => {
    const targetFiles = files.filter(
      (f) =>
        selectedFileIds.includes(f.id) &&
        f.mime_type?.toLowerCase() === 'application/pdf' &&
        f.index_status !== 'indexed'
    );
    for (const f of targetFiles) {
      try {
        await indexForAi(f.id);
      } catch (err) {
        logFileManagerError(`bulkIndex ${f.name}`, err);
      }
    }
    setIsJobsOpen(true);
    clearSelection();
    await refresh(true);
  }, [files, selectedFileIds, clearSelection, refresh]);

  const handleDownload = useCallback(async (file) => {
    try {
      const url = await getDownloadUrl(file.id, { download: true, fileName: file.name });
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      logFileManagerError('download', err);
      alert(`Download failed: ${normalizeFileManagerError(err)}`);
    }
  }, []);

  const handleBulkDownload = useCallback(async () => {
    const selectedFiles = files.filter((f) => selectedFileIds.includes(f.id));
    for (const file of selectedFiles) {
      await handleDownload(file);
    }
  }, [files, selectedFileIds, handleDownload]);

  const handleChatWithFile = useCallback((file) => {
    openAiResearch({
      focus: 'attached',
      file: {
        id: file.id,
        name: file.name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
      },
      mode: 'ask_ai',
      promptSeed: `Regarding ${file.name}: `,
    });
  }, []);

  const displayFolders = useMemo(() => {
    return filterDisplayFolders(folders, {
      view,
      typeFilter,
      indexStatusFilter,
      ownerFilter,
      currentUser,
    });
  }, [folders, view, typeFilter, indexStatusFilter, ownerFilter, currentUser]);

  const displayFiles = useMemo(() => {
    return filterDisplayFiles(files, {
      view,
      typeFilter,
      indexStatusFilter,
      ownerFilter,
      currentUser,
    });
  }, [files, view, typeFilter, indexStatusFilter, ownerFilter, currentUser]);

  const clearFilters = useCallback(() => {
    setTypeFilter('all');
    setIndexStatusFilter('any');
    setOwnerFilter('anyone');
    setSearchQuery('');
  }, []);

  return {
    // Navigation & View state
    view,
    currentFolder,
    pathSegments,
    viewMode,
    sort,

    // Data state
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
    selectedCount: selectedFolderIds.length + selectedFileIds.length,
    totalSelectedSizeBytes,
    hasSelectedPdf,
    uploadMap,
    uploadQueue,

    // Filters & Notices
    searchQuery,
    searchScope,
    typeFilter,
    indexStatusFilter,
    ownerFilter,
    noticeMessage,

    // Modals
    isJobsOpen,
    previewFile,
    isCreateFolderOpen,
    renameTarget,
    isMoveOpen,
    isEmptyTrashConfirmOpen,

    // Setters
    setView: changeView,
    setViewMode,
    setSearchQuery,
    setSearchScope,
    setTypeFilter,
    setIndexStatusFilter,
    setOwnerFilter,
    setSort,
    setIsJobsOpen,
    setPreviewFile,
    setIsCreateFolderOpen,
    setRenameTarget,
    setIsMoveOpen,
    setIsEmptyTrashConfirmOpen,

    // Actions
    refresh,
    clearFilters,
    handleNewBase,
    handleNewDoc,
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
  };
}
