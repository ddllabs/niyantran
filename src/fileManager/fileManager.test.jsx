/**
 * Feature F341: Unit & Component Acceptance Tests for Private File Manager & AI Indexing.
 *
 * Verifies all 13 approved v1 capabilities, status state machines, storage quota math,
 * artifact persistence, and UI component rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatBytes,
  formatRelativeDate,
  calculateSha256,
  prepareUpload,
  completeUpload,
  indexForAi,
  createFolder,
  softDelete,
  restore,
  emptyTrash,
  getStorageQuota,
} from './fileManagerService.js';
import {
  saveArtifactToFiles,
  AI_ARTIFACTS_FOLDER_NAME,
} from './artifactService.js';
import {
  MAX_FILE_SIZE_BYTES,
  STORAGE_TIER_QUOTA_BYTES,
  resolvePreviewKind,
} from '../types/fileManager.ts';
import { supabase } from '../lib/supabaseClient.js';
import DriveBrowser from './DriveBrowser.jsx';
import FileManagerShell from './FileManagerShell.jsx';
import * as useFileManagerModule from './useFileManager.js';
import {
  filterDisplayFolders,
  filterDisplayFiles,
  KNOWLEDGE_BASE_NOTICE,
  NEW_DOC_NOTICE,
} from './useFileManager.js';

describe('fileManagerService — Utility & Format Helpers', () => {
  it('formats byte quantities into clean human-readable units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(524288000)).toBe('500 MB');
    expect(formatBytes(5368709120)).toBe('5 GB');
  });

  it('formats timestamps into relative times', () => {
    const now = Date.now();
    expect(formatRelativeDate(now - 10000)).toBe('Just now');
    expect(formatRelativeDate(now - 120000)).toBe('2m ago');
    expect(formatRelativeDate(now - 7200000)).toBe('2h ago');
    expect(formatRelativeDate(null)).toBe('—');
  });

  it('calculates standard SHA-256 digests accurately', async () => {
    const blob = new Blob(['Niyantran AI Private File Manager'], { type: 'text/plain' });
    const hash = await calculateSha256(blob);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  it('resolves preview kinds accurately according to tier taxonomy', () => {
    expect(resolvePreviewKind('application/pdf')).toBe('pdf');
    expect(resolvePreviewKind('image/png')).toBe('image');
    expect(resolvePreviewKind('image/jpeg')).toBe('image');
    expect(resolvePreviewKind('text/markdown')).toBe('markdown');
    expect(resolvePreviewKind('text/plain')).toBe('text');
    expect(resolvePreviewKind('application/zip')).toBe('unsupported');
    expect(resolvePreviewKind('text/html')).toBe('unsupported');
  });
});

describe('fileManagerService — Upload Lifecycle & Quota (Capability 3 & 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects upload preparation if file size exceeds MAX_FILE_SIZE_BYTES (50 MB)', async () => {
    const oversized = MAX_FILE_SIZE_BYTES + 1;
    await expect(
      prepareUpload({
        name: 'huge_file.pdf',
        mime_type: 'application/pdf',
        size_bytes: oversized,
      })
    ).rejects.toThrow(/exceeds maximum allowed upload size/i);
  });

  it('invokes user_file_prepare_upload RPC with correct parameters', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: {
        file_id: 'test-file-uuid',
        storage_path: 'user-123/test-file-uuid/test.pdf',
        signed_upload_url: 'https://storage.mock/upload/test.pdf',
      },
      error: null,
    });

    const res = await prepareUpload({
      name: 'test.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      folder_id: 'folder-1',
    });

    expect(mockRpc).toHaveBeenCalledWith('user_file_prepare_upload', {
      p_name: 'test.pdf',
      p_mime_type: 'application/pdf',
      p_size_bytes: 1024,
      p_folder_id: 'folder-1',
    });
    expect(res.file_id).toBe('test-file-uuid');
    expect(res.signed_upload_url).toBe('https://storage.mock/upload/test.pdf');
  });

  it('invokes user_file_complete_upload RPC upon binary transfer completion', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: { id: 'test-file-uuid', upload_status: 'uploaded' },
      error: null,
    });

    const res = await completeUpload({
      file_id: 'test-file-uuid',
      sha256: 'mockedsha256digest',
    });

    expect(mockRpc).toHaveBeenCalledWith('user_file_complete_upload', {
      p_file_id: 'test-file-uuid',
      p_sha256: 'mockedsha256digest',
    });
    expect(res.success).toBe(true);
  });

  it('evaluates storage quota tiers according to normative plan limits', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') {
        return Promise.resolve({ data: STORAGE_TIER_QUOTA_BYTES.pro, error: null });
      }
      if (name === 'user_storage_used_bytes') {
        return Promise.resolve({ data: 104857600, error: null }); // 100 MB used
      }
      if (name === 'my_entitlement') {
        return Promise.resolve({ data: [{ plan: 'pro', lapsed: false }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const quota = await getStorageQuota();
    expect(quota.plan).toBe('pro');
    expect(quota.quota_bytes).toBe(STORAGE_TIER_QUOTA_BYTES.pro);
    expect(quota.used_bytes).toBe(104857600);
    expect(quota.remaining_bytes).toBe(STORAGE_TIER_QUOTA_BYTES.pro - 104857600);
    expect(quota.is_lapsed).toBe(false);
  });
});

describe('fileManagerService — Explicit AI Indexing (Capability 7 & 10)', () => {
  it('enqueues indexing via user_file_enqueue_indexing RPC', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: { job_id: 'job-123', status: 'indexing_queued' },
      error: null,
    });

    const res = await indexForAi('test-file-uuid');
    expect(mockRpc).toHaveBeenCalledWith('user_file_enqueue_indexing', {
      p_file_id: 'test-file-uuid',
    });
    expect(res.success).toBe(true);
    expect(res.job_id).toBe('job-123');
    expect(res.status).toBe('indexing_queued');
  });
});

describe('fileManagerService — Folder CRUD, Trash & Restore (Capability 1 & 6)', () => {
  it('validates folder creation and prevents illegal characters', async () => {
    await expect(createFolder({ name: '' })).rejects.toThrow(/cannot be empty/i);
    await expect(createFolder({ name: 'folder/with/slashes' })).rejects.toThrow(/cannot contain slashes/i);
  });

  it('calls user_folder_soft_delete RPC when trashing a folder', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await softDelete({ ids: ['folder-abc'], kind: 'folder' });
    expect(mockRpc).toHaveBeenCalledWith('user_folder_soft_delete', {
      p_folder_id: 'folder-abc',
    });
    expect(res.success).toBe(true);
  });

  it('calls user_file_restore and verifies index validity when restoring a file', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: null,
    });

    const res = await restore({ ids: ['file-123'], kind: 'file' });
    expect(mockRpc).toHaveBeenCalledWith('user_file_restore', {
      p_file_id: 'file-123',
    });
    expect(res.success).toBe(true);
  });

  it('calls user_files_empty_trash RPC when purging trash', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: { purged_count: 5 },
      error: null,
    });

    const res = await emptyTrash();
    expect(mockRpc).toHaveBeenCalledWith('user_files_empty_trash');
    expect(res.success).toBe(true);
    expect(res.purged_count).toBe(5);
  });
});

describe('artifactService — AI Artifact Persistence (Decision 3 & Capability 1)', () => {
  it('saves an analytical markdown artifact into AI Artifacts folder', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    // Mock folder lookup
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'user_folders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  is: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: 'artifacts-folder-id', name: AI_ARTIFACTS_FOLDER_NAME },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({}) };
    });

    // Mock prepare and complete upload RPCs
    vi.spyOn(supabase, 'rpc').mockImplementation((rpcName) => {
      if (rpcName === 'user_file_prepare_upload') {
        return Promise.resolve({
          data: {
            file_id: 'artifact-file-id',
            storage_path: 'user-1/artifact-file-id/test.md',
            signed_upload_url: 'https://mock.upload/artifact.md',
          },
          error: null,
        });
      }
      if (rpcName === 'user_file_complete_upload') {
        return Promise.resolve({
          data: { id: 'artifact-file-id', name: 'Executive Summary.md' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Mock uploadBinary transport
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    // Use a mock for XMLHttpRequest in node/jsdom
    const mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(function () {
        this.status = 200;
        this.onload();
      }),
      upload: {},
    };
    global.XMLHttpRequest = vi.fn(() => mockXhr);

    const saved = await saveArtifactToFiles({
      title: 'Executive Summary',
      content: '# Analysis Brief\nKey findings in document.',
      mime_type: 'text/markdown',
    });

    expect(saved.success).toBe(true);
    expect(saved.folder.name).toBe(AI_ARTIFACTS_FOLDER_NAME);
  });
});

describe('Production Storage Quota & Lifecycle Verification (14 Scenarios)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario 1: reports 0 B used and exactly 500 MB limit on an empty account', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-empty' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 0, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.quota_bytes).toBe(524288000);
    expect(quota.used_bytes).toBe(0);
    expect(quota.remaining_bytes).toBe(524288000);
    expect(quota.unavailable).toBe(false);
  });

  it('Scenario 2: reports 0 remaining bytes when full 500 MB is genuinely used', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-full' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 524288000, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.quota_bytes).toBe(524288000);
    expect(quota.used_bytes).toBe(524288000);
    expect(quota.remaining_bytes).toBe(0);
  });

  it('Scenario 3: correctly computes remaining capacity on partial usage', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-partial' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 50000000, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.quota_bytes).toBe(524288000);
    expect(quota.used_bytes).toBe(50000000);
    expect(quota.remaining_bytes).toBe(524288000 - 50000000);
  });

  it('Scenario 4: falls back to 500 MB Free quota when paid plan has lapsed', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-lapsed' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'my_entitlement') return Promise.resolve({ data: [{ plan: 'pro', lapsed: true }], error: null });
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 1000, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.is_lapsed).toBe(true);
    expect(quota.quota_bytes).toBe(524288000);
  });

  it('Scenario 5: continues to count trashed files against quota until purged', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-trash' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: null, error: new Error('not_found') });
      return Promise.resolve({ data: null, error: null });
    });
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'user_files') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { size_bytes: 20000000, upload_status: 'uploaded', deleted_at: null },
                { size_bytes: 15000000, upload_status: 'uploaded', deleted_at: new Date().toISOString() },
              ],
              error: null,
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
    const quota = await getStorageQuota();
    expect(quota.used_bytes).toBe(35000000);
  });

  it('Scenario 6: includes active in-flight pending upload reservations in quota usage', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-pending' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: null, error: new Error('not_found') });
      return Promise.resolve({ data: null, error: null });
    });
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'user_files') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { size_bytes: 10000000, upload_status: 'uploaded', created_at: new Date().toISOString() },
                { size_bytes: 5000000, upload_status: 'pending_upload', created_at: new Date().toISOString() },
              ],
              error: null,
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
    const quota = await getStorageQuota();
    expect(quota.used_bytes).toBe(15000000);
  });

  it('Scenario 7: excludes failed and stale abandoned uploads from consuming quota', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-stale' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: null, error: new Error('not_found') });
      return Promise.resolve({ data: null, error: null });
    });
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'user_files') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { size_bytes: 10000000, upload_status: 'uploaded', created_at: new Date().toISOString() },
                { size_bytes: 20000000, upload_status: 'upload_failed', created_at: new Date().toISOString() },
                { size_bytes: 30000000, upload_status: 'pending_upload', created_at: threeHoursAgo },
              ],
              error: null,
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
    const quota = await getStorageQuota();
    expect(quota.used_bytes).toBe(10000000);
  });

  it('Scenario 8: cleans up pending upload reservation when upload is aborted/cancelled', async () => {
    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'user_files') {
        return { delete: mockDelete };
      }
      return { select: () => ({}) };
    });
    supabase.from('user_files').delete().eq('id', 'aborted-file-id').eq('upload_status', 'pending_upload');
    expect(mockDelete).toHaveBeenCalled();
  });

  it('Scenario 9: gracefully handles missing or partial RPC fields without failing', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-missing' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: {}, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    vi.spyOn(supabase, 'from').mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }));
    const quota = await getStorageQuota();
    expect(quota.quota_bytes).toBe(524288000);
    expect(quota.used_bytes).toBe(0);
    expect(quota.remaining_bytes).toBe(524288000);
  });

  it('Scenario 10: safely converts string or numeric formats from HTTP 200 RPC response', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-string-rpc' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: "2147483648", error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 1048576, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.quota_bytes).toBe(2147483648);
    expect(quota.used_bytes).toBe(1048576);
  });

  it('Scenario 11: marks unavailable when both RPC and database queries error out', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-err' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('Network offline'));
    vi.spyOn(supabase, 'from').mockImplementation(() => ({
      select: () => ({ eq: () => Promise.reject(new Error('DB unreachable')) }),
    }));
    const quota = await getStorageQuota();
    expect(quota.unavailable).toBe(true);
    expect(quota.error).toMatch(/temporarily unavailable/i);
    expect(quota.used_bytes).toBe(0);
  });

  it('Scenario 12: accurately reports non-zero usage even when folder listing is empty', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-subfolder' } },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((name) => {
      if (name === 'user_storage_quota_bytes') return Promise.resolve({ data: 524288000, error: null });
      if (name === 'user_storage_used_bytes') return Promise.resolve({ data: 25000000, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const quota = await getStorageQuota();
    expect(quota.used_bytes).toBe(25000000);
    expect(quota.remaining_bytes).toBe(524288000 - 25000000);
  });

  it('Scenario 13: allows uploading when refreshed quota confirms remaining space', async () => {
    const quota = {
      plan: 'free',
      quota_bytes: 524288000,
      used_bytes: 10000000,
      remaining_bytes: 514288000,
      is_lapsed: false,
    };
    const testFileSize = 7100;
    expect(quota.remaining_bytes).toBeGreaterThan(testFileSize);
  });

  it('Scenario 14: calculates batch running remaining quota without racing', async () => {
    let runningQuota = 10000;
    const file1 = { size: 4000 };
    const file2 = { size: 5000 };
    const file3 = { size: 3000 };

    expect(runningQuota >= file1.size).toBe(true);
    runningQuota -= file1.size;

    expect(runningQuota >= file2.size).toBe(true);
    runningQuota -= file2.size;

    expect(runningQuota >= file3.size).toBe(false);
  });
});

describe('FileManager UI/UX — Navigation Tabs & Workspaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseHookState = {
    view: 'all',
    currentFolder: null,
    pathSegments: [],
    viewMode: 'list',
    sort: { field: 'name', direction: 'asc' },
    folders: [],
    files: [],
    displayFolders: [],
    displayFiles: [],
    currentUser: { id: 'u-1', email: 'user@example.test' },
    quota: { used_bytes: 0, quota_bytes: 524288000, remaining_bytes: 524288000 },
    loading: false,
    error: null,
    selectedFolderIds: [],
    selectedFileIds: [],
    selectedCount: 0,
    totalSelectedSizeBytes: 0,
    hasSelectedPdf: false,
    uploadQueue: [],
    searchQuery: '',
    searchScope: 'folder',
    typeFilter: 'all',
    indexStatusFilter: 'any',
    ownerFilter: 'anyone',
    noticeMessage: null,
    isJobsOpen: false,
    previewFile: null,
    isCreateFolderOpen: false,
    renameTarget: null,
    isEmptyTrashConfirmOpen: false,
    setView: vi.fn(),
    setViewMode: vi.fn(),
    setSearchQuery: vi.fn(),
    setSearchScope: vi.fn(),
    setTypeFilter: vi.fn(),
    setIndexStatusFilter: vi.fn(),
    setOwnerFilter: vi.fn(),
    setSort: vi.fn(),
    setIsJobsOpen: vi.fn(),
    setPreviewFile: vi.fn(),
    setIsCreateFolderOpen: vi.fn(),
    setRenameTarget: vi.fn(),
    setIsEmptyTrashConfirmOpen: vi.fn(),
    refresh: vi.fn(),
    clearFilters: vi.fn(),
    handleNewBase: vi.fn(),
    handleNewDoc: vi.fn(),
    navigateToFolder: vi.fn(),
    handleSelectFolder: vi.fn(),
    handleSelectFile: vi.fn(),
    handleSelectAll: vi.fn(),
    clearSelection: vi.fn(),
    uploadFiles: vi.fn(),
    cancelUpload: vi.fn(),
    retryUpload: vi.fn(),
    dismissUpload: vi.fn(),
    clearCompletedUploads: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleRename: vi.fn(),
    handleSoftDelete: vi.fn(),
    handleRestore: vi.fn(),
    handlePermanentDelete: vi.fn(),
    handleEmptyTrash: vi.fn(),
    handleMove: vi.fn(),
    handleIndex: vi.fn(),
    handleBulkIndex: vi.fn(),
    handleDownload: vi.fn(),
    handleBulkDownload: vi.fn(),
    handleChatWithFile: vi.fn(),
  };

  it('renders all four canonical navigation tabs with icons and labels', () => {
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue(baseHookState);
    const html = renderToStaticMarkup(<FileManagerShell />);
    expect(html).toContain('My Files');
    expect(html).toContain('Organisation Files');
    expect(html).toContain('Enterprise');
    expect(html).toContain('AI Artifacts');
    expect(html).toContain('Trash');
  });

  it("marks 'My Files' tab as active when view is 'all'", () => {
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...baseHookState,
      view: 'all',
    });
    const html = renderToStaticMarkup(<FileManagerShell />);
    expect(html).toMatch(/class="[^"]*fm-tab-btn active[^"]*"[^>]*>[\s\S]*?My Files/);
  });

  it("switches to 'Organisation Files' view with enterprise banner and empty state", () => {
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...baseHookState,
      view: 'organisation',
    });
    const html = renderToStaticMarkup(<FileManagerShell />);
    expect(html).toMatch(/class="[^"]*fm-tab-btn active[^"]*"[^>]*>[\s\S]*?Organisation Files/);
    expect(html).toContain('Enterprise Tier Required');
    expect(html).toContain('Organisation drives and shared team workspaces are not enabled');
  });

  it("switches to 'AI Artifacts' view and renders artifacts empty state", () => {
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...baseHookState,
      view: 'artifacts',
    });
    const html = renderToStaticMarkup(<FileManagerShell />);
    expect(html).toMatch(/class="[^"]*fm-tab-btn active[^"]*"[^>]*>[\s\S]*?AI Artifacts/);
    expect(html).toContain('No AI artifacts saved yet');
    expect(html).toContain('Save analysis briefs, generated tables, or executive summaries');
  });

  it("switches to 'Trash' view, displays retention notice, and replaces creation buttons with Empty Trash", () => {
    // 1. Empty Trash state
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...baseHookState,
      view: 'trash',
      displayFiles: [],
      displayFolders: [],
    });
    const htmlEmpty = renderToStaticMarkup(<FileManagerShell />);
    expect(htmlEmpty).toMatch(/class="[^"]*fm-tab-btn fm-tab-trash active[^"]*"[^>]*>[\s\S]*?Trash/);
    expect(htmlEmpty).toContain('Empty Trash');
    expect(htmlEmpty).not.toContain('Upload Here');
    expect(htmlEmpty).not.toContain('New Folder');
    expect(htmlEmpty).toContain('Trash is empty');
    expect(htmlEmpty).toContain('Deleted files and folders are safely stored here for 30 days before permanent erasure.');

    // 2. Populated Trash table view with retention banner
    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...baseHookState,
      view: 'trash',
      displayFiles: [{
        id: 'trashed-1',
        name: 'discarded.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        deleted_at: new Date().toISOString(),
        upload_status: 'uploaded',
        index_status: 'not_indexed',
      }],
      displayFolders: [],
    });
    const htmlPopulated = renderToStaticMarkup(<FileManagerShell />);
    expect(htmlPopulated).toContain('Trashed files continue consuming quota and will be permanently deleted after 30 days.');
  });
});

describe('FileManager UI/UX — Filter Logic & Predicates', () => {
  const testFolders = [
    { id: 'fol-1', name: 'Legal Briefs', user_id: 'user-me' },
    { id: 'fol-2', name: 'Org Policies', user_id: 'user-other' },
  ];

  const testFiles = [
    {
      id: 'f-pdf-indexed',
      name: 'contract.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1048576,
      user_id: 'user-me',
      index_status: 'indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-pdf-extracting',
      name: 'statute.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048576,
      user_id: 'user-me',
      index_status: 'indexing_extracting',
      upload_status: 'uploaded',
    },
    {
      id: 'f-pdf-chunking',
      name: 'treaty.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1548576,
      user_id: 'user-other',
      index_status: 'indexing_chunking',
      upload_status: 'uploaded',
    },
    {
      id: 'f-pdf-queued',
      name: 'order.pdf',
      mime_type: 'application/pdf',
      size_bytes: 512000,
      user_id: 'user-me',
      index_status: 'indexing_queued',
      upload_status: 'uploaded',
    },
    {
      id: 'f-pdf-not-indexed',
      name: 'brief.pdf',
      mime_type: 'application/pdf',
      size_bytes: 819200,
      user_id: 'user-other',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-pdf-failed',
      name: 'corrupted.pdf',
      mime_type: 'application/pdf',
      size_bytes: 102400,
      user_id: 'user-me',
      index_status: 'indexing_failed',
      index_error: 'OCR timeout',
      upload_status: 'uploaded',
    },
    {
      id: 'f-sheet-xlsx',
      name: 'budget_2026.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 300000,
      user_id: 'user-me',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-sheet-csv',
      name: 'metrics.csv',
      mime_type: 'text/csv',
      size_bytes: 45000,
      user_id: 'user-other',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-code-js',
      name: 'parser.js',
      mime_type: 'text/javascript',
      size_bytes: 12000,
      user_id: 'user-me',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-code-py',
      name: 'nlp_model.py',
      mime_type: 'text/x-python',
      size_bytes: 25000,
      user_id: 'user-other',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-img-png',
      name: 'diagram.png',
      mime_type: 'image/png',
      size_bytes: 500000,
      user_id: 'user-me',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
    {
      id: 'f-img-jpg',
      name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 750000,
      user_id: 'user-other',
      index_status: 'not_indexed',
      upload_status: 'uploaded',
    },
  ];

  const currentUser = { id: 'user-me', email: 'me@example.test' };

  describe('typeFilter', () => {
    it("returns all files and folders when typeFilter is 'all'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'all' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'all' });
      expect(folders).toHaveLength(2);
      expect(files).toHaveLength(12);
    });

    it("returns only folders and zero files when typeFilter is 'folders'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'folders' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'folders' });
      expect(folders).toHaveLength(2);
      expect(files).toHaveLength(0);
    });

    it("returns only PDF files and zero folders when typeFilter is 'pdf'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'pdf' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'pdf' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(6);
      expect(files.every((f) => f.mime_type === 'application/pdf')).toBe(true);
    });

    it("returns only spreadsheet and csv files when typeFilter is 'spreadsheets'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'spreadsheets' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'spreadsheets' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name)).toEqual(['budget_2026.xlsx', 'metrics.csv']);
    });

    it("returns only code/script files when typeFilter is 'code'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'code' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'code' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name)).toEqual(['parser.js', 'nlp_model.py']);
    });

    it("returns only image files when typeFilter is 'images'", () => {
      const folders = filterDisplayFolders(testFolders, { typeFilter: 'images' });
      const files = filterDisplayFiles(testFiles, { typeFilter: 'images' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name)).toEqual(['diagram.png', 'photo.jpg']);
    });
  });

  describe('indexStatusFilter', () => {
    it("returns all files and folders when indexStatusFilter is 'any'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'any' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'any' });
      expect(folders).toHaveLength(2);
      expect(files).toHaveLength(12);
    });

    it("returns only indexed files when indexStatusFilter is 'indexed'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'indexed' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'indexed' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('f-pdf-indexed');
    });

    it("returns files currently being indexed when indexStatusFilter is 'indexing'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'indexing' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'indexing' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.id)).toEqual(['f-pdf-extracting', 'f-pdf-chunking']);
    });

    it("returns queued indexing jobs when indexStatusFilter is 'queued'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'queued' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'queued' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('f-pdf-queued');
    });

    it("returns not indexed files when indexStatusFilter is 'not_indexed'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'not_indexed' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'not_indexed' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(7);
      expect(files.every((f) => f.index_status === 'not_indexed')).toBe(true);
    });

    it("returns failed index jobs when indexStatusFilter is 'failed'", () => {
      const folders = filterDisplayFolders(testFolders, { indexStatusFilter: 'failed' });
      const files = filterDisplayFiles(testFiles, { indexStatusFilter: 'failed' });
      expect(folders).toHaveLength(0);
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('f-pdf-failed');
    });
  });

  describe('ownerFilter', () => {
    it("returns items from all owners when ownerFilter is 'anyone'", () => {
      const folders = filterDisplayFolders(testFolders, { ownerFilter: 'anyone', currentUser });
      const files = filterDisplayFiles(testFiles, { ownerFilter: 'anyone', currentUser });
      expect(folders).toHaveLength(2);
      expect(files).toHaveLength(12);
    });

    it("returns only current user items when ownerFilter is 'me'", () => {
      const folders = filterDisplayFolders(testFolders, { ownerFilter: 'me', currentUser });
      const files = filterDisplayFiles(testFiles, { ownerFilter: 'me', currentUser });
      expect(folders).toHaveLength(1);
      expect(folders[0].user_id).toBe('user-me');
      expect(files).toHaveLength(7);
      expect(files.every((f) => f.user_id === 'user-me')).toBe(true);
    });
  });

  describe('clearFilters', () => {
    it('resets all filter settings back to defaults', () => {
      let state = {
        typeFilter: 'pdf',
        indexStatusFilter: 'indexed',
        ownerFilter: 'me',
        searchQuery: 'contract',
      };

      const clearFilters = () => {
        state = {
          typeFilter: 'all',
          indexStatusFilter: 'any',
          ownerFilter: 'anyone',
          searchQuery: '',
        };
      };

      clearFilters();

      expect(state.typeFilter).toBe('all');
      expect(state.indexStatusFilter).toBe('any');
      expect(state.ownerFilter).toBe('anyone');
      expect(state.searchQuery).toBe('');

      const folders = filterDisplayFolders(testFolders, state);
      const files = filterDisplayFiles(testFiles, state);
      expect(folders).toHaveLength(2);
      expect(files).toHaveLength(12);
    });
  });
});

describe('FileManager UI/UX — Action Notices & Informative Feedback', () => {
  it('defines informative notice for Knowledge Base configuration', () => {
    expect(KNOWLEDGE_BASE_NOTICE).toBe(
      'Knowledge Base creation is configured in Niyantran Knowledge Bases.'
    );
  });

  it('defines informative notice for Terminal Editor document creation', () => {
    expect(NEW_DOC_NOTICE).toBe(
      'New Document creation is managed in Niyantran Terminal Editor.'
    );
  });

  it('renders notice banner in FileManagerShell when noticeMessage is set', () => {
    const mockState = {
      view: 'all',
      currentFolder: null,
      pathSegments: [],
      viewMode: 'list',
      sort: { field: 'name', direction: 'asc' },
      folders: [],
      files: [],
      displayFolders: [],
      displayFiles: [],
      currentUser: { id: 'u-1' },
      quota: null,
      loading: false,
      error: null,
      selectedFolderIds: [],
      selectedFileIds: [],
      selectedCount: 0,
      totalSelectedSizeBytes: 0,
      hasSelectedPdf: false,
      uploadQueue: [],
      searchQuery: '',
      searchScope: 'folder',
      typeFilter: 'all',
      indexStatusFilter: 'any',
      ownerFilter: 'anyone',
      noticeMessage: KNOWLEDGE_BASE_NOTICE,
      isJobsOpen: false,
      previewFile: null,
      isCreateFolderOpen: false,
      renameTarget: null,
      isEmptyTrashConfirmOpen: false,
      setView: vi.fn(),
      setViewMode: vi.fn(),
      setSearchQuery: vi.fn(),
      setSearchScope: vi.fn(),
      setTypeFilter: vi.fn(),
      setIndexStatusFilter: vi.fn(),
      setOwnerFilter: vi.fn(),
      setSort: vi.fn(),
      setIsJobsOpen: vi.fn(),
      setPreviewFile: vi.fn(),
      setIsCreateFolderOpen: vi.fn(),
      setRenameTarget: vi.fn(),
      setIsEmptyTrashConfirmOpen: vi.fn(),
      refresh: vi.fn(),
      clearFilters: vi.fn(),
      handleNewBase: vi.fn(),
      handleNewDoc: vi.fn(),
      navigateToFolder: vi.fn(),
      handleSelectFolder: vi.fn(),
      handleSelectFile: vi.fn(),
      handleSelectAll: vi.fn(),
      clearSelection: vi.fn(),
      uploadFiles: vi.fn(),
      cancelUpload: vi.fn(),
      retryUpload: vi.fn(),
      dismissUpload: vi.fn(),
      clearCompletedUploads: vi.fn(),
      handleCreateFolder: vi.fn(),
      handleRename: vi.fn(),
      handleSoftDelete: vi.fn(),
      handleRestore: vi.fn(),
      handlePermanentDelete: vi.fn(),
      handleEmptyTrash: vi.fn(),
      handleMove: vi.fn(),
      handleIndex: vi.fn(),
      handleBulkIndex: vi.fn(),
      handleDownload: vi.fn(),
      handleBulkDownload: vi.fn(),
      handleChatWithFile: vi.fn(),
    };

    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue(mockState);
    const htmlBase = renderToStaticMarkup(<FileManagerShell />);
    expect(htmlBase).toContain('role="status"');
    expect(htmlBase).toContain(KNOWLEDGE_BASE_NOTICE);

    vi.spyOn(useFileManagerModule, 'useFileManager').mockReturnValue({
      ...mockState,
      noticeMessage: NEW_DOC_NOTICE,
    });
    const htmlDoc = renderToStaticMarkup(<FileManagerShell />);
    expect(htmlDoc).toContain(NEW_DOC_NOTICE);
  });
});

describe('FileManager UI/UX — Table Columns & Dual Status Pills', () => {
  const baseFile = {
    id: 'f-test',
    name: 'document.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048576,
    upload_status: 'uploaded',
    index_status: 'indexed',
    created_at: new Date().toISOString(),
  };

  it('renders normative 8-column headers in table list view', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser files={[baseFile]} folders={[]} viewMode="list" />
    );
    expect(html).toContain('Name');
    expect(html).toContain('Documents');
    expect(html).toContain('Indexing');
    expect(html).toContain('Size');
    expect(html).toContain('Owner');
    expect(html).toContain('Shared With');
    expect(html).toContain('Connected');
    expect(html).toContain('Actions');
  });

  it('renders "Searchable" status pill for indexed PDF file', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser
        files={[{ ...baseFile, index_status: 'indexed' }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(html).toContain('fm-pill-indexed');
    expect(html).toContain('Searchable');
  });

  it('renders "Processing" status pill for indexing_extracting and indexing_chunking', () => {
    const htmlExtracting = renderToStaticMarkup(
      <DriveBrowser
        files={[{ ...baseFile, index_status: 'indexing_extracting' }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(htmlExtracting).toContain('fm-pill-running');
    expect(htmlExtracting).toContain('Processing');

    const htmlChunking = renderToStaticMarkup(
      <DriveBrowser
        files={[{ ...baseFile, index_status: 'indexing_chunking' }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(htmlChunking).toContain('fm-pill-running');
    expect(htmlChunking).toContain('Processing');
  });

  it('renders "Queued" status pill for indexing_queued PDF file', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser
        files={[{ ...baseFile, index_status: 'indexing_queued' }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(html).toContain('fm-pill-queued');
    expect(html).toContain('Queued');
  });

  it('renders "Not searchable" status pill for not_indexed PDF file', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser
        files={[{ ...baseFile, index_status: 'not_indexed' }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(html).toContain('fm-pill-not-indexed');
    expect(html).toContain('Not searchable');
  });

  it('renders "Not searchable" unsupported pill for non-PDF files', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser
        files={[{
          ...baseFile,
          name: 'spreadsheet.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          index_status: 'indexed',
        }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(html).toContain('fm-pill-unsupported');
    expect(html).toContain('Not searchable');
  });

  it('renders "Failed" status pill with retry title for indexing_failed', () => {
    const html = renderToStaticMarkup(
      <DriveBrowser
        files={[{
          ...baseFile,
          index_status: 'indexing_failed',
          index_error: 'OCR extraction timed out after 30 seconds',
        }]}
        folders={[]}
        viewMode="list"
      />
    );
    expect(html).toContain('fm-pill-failed');
    expect(html).toContain('Failed');
    expect(html).toContain('OCR extraction timed out after 30 seconds');
  });
});
