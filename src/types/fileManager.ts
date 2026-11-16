/**
 * Feature F341: Private File Manager & AI Indexing — Frontend TypeScript Contract.
 *
 * Defines normative domain models, status state machines, storage quota types,
 * view modes, search parameters, and helper interfaces for all 13 approved v1
 * UI capabilities.
 *
 * Specifications & Cross-References:
 * - Central Product Reference: docs/specs/private-file-manager-functionality.md
 * - Technical Spec: docs/specs/2026-11-14-private-file-manager.md
 * - Implementation Plan: docs/plans/2026-11-14-private-file-manager.md
 * - Architecture Decision: docs/decisions/0006-private-file-manager-ingestion-rag-integration.md
 * - Backend Twin: supabase/functions/_shared/userFiles.types.ts
 */

// ─── Status & Enumeration Types ──────────────────────────────────────────────

/**
 * Upload lifecycle status for binary files stored in the 'user-files' bucket.
 * Decoupled from AI indexing status.
 */
export type UploadStatus =
  | 'pending_upload'
  | 'uploading'
  | 'uploaded'
  | 'upload_failed';

/**
 * Asynchronous extraction, chunking, and vector embedding status.
 * In v1, strictly PDF files can transition past 'unsupported'/'not_indexed'.
 */
export type IndexStatus =
  | 'not_indexed'
  | 'unsupported'
  | 'indexing_queued'
  | 'indexing_extracting'
  | 'indexing_chunking'
  | 'indexed'
  | 'indexing_failed';

/**
 * Processing status of a background ingestion job in public.user_file_jobs.
 */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Discrete processing step of an active user file ingestion job.
 */
export type JobStep =
  | 'ocr'
  | 'compose'
  | 'chunk'
  | 'embed'
  | 'commit';

/**
 * Subscription plan tiers matching PostgreSQL enum public.app_plan.
 */
export type AppPlan =
  | 'free'
  | 'plus'
  | 'pro'
  | 'max';

/**
 * Top-level view modes supported in the File Manager workspace.
 */
export type FileManagerView =
  | 'all'
  | 'trash'
  | 'artifacts';

/**
 * Search target scope: everywhere across account or restricted to current folder.
 */
export type SearchScope =
  | 'everywhere'
  | 'folder';

/**
 * Sortable attribute columns in the file/folder grid.
 */
export type FileSortField =
  | 'name'
  | 'size_bytes'
  | 'created_at'
  | 'updated_at'
  | 'index_status';

export type SortDirection = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  direction: SortDirection;
}

// ─── Core Domain Entities ────────────────────────────────────────────────────

/**
 * Represents a user-owned folder node in public.user_folders.
 * Isolated strictly to the owning user via auth.uid().
 */
export interface UserFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a user-owned file in public.user_files.
 * Stores binary file metadata, upload status, and independent AI indexing state.
 */
export interface UserFile {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  upload_status: UploadStatus;
  index_status: IndexStatus;
  index_error: string | null;
  page_count: number | null;
  extract_hash: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Represents an asynchronous ingestion worker task in public.user_file_jobs.
 */
export interface UserFileJob {
  id: string;
  file_id: string;
  user_id: string;
  status: JobStatus;
  step: JobStep;
  attempt_count: number;
  error_message: string | null;
  credits_hold: number;
  credits_settled: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

/**
 * Storage quota entitlement and real-time usage for the authenticated user.
 */
export interface UserStorageQuota {
  plan: AppPlan;
  quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
  is_lapsed: boolean;
  unavailable?: boolean;
  error?: string | null;
}

// ─── 13 Approved v1 UI Capabilities Helper Interfaces ────────────────────────

// Capability 1: Folder Hierarchy & Breadcrumbs
export interface BreadcrumbSegment {
  /** Folder ID or null for root ('Home' / 'All Files'). */
  id: string | null;
  name: string;
  path: string;
  depth: number;
  isCurrent?: boolean;
}

export interface FolderHierarchyNode {
  folder: UserFolder;
  subfolders: FolderHierarchyNode[];
  fileCount: number;
}

// Capability 2: Global & Current-Folder Search
export interface FileSearchFilters {
  query: string;
  scope: SearchScope;
  folderId?: string | null;
  mimeTypeFilter?: string;
  indexStatusFilter?: IndexStatus;
}

export interface FileSearchResult {
  file: UserFile;
  folderPath: string;
  matchField: 'name' | 'metadata';
  matchHighlight?: string;
}

// Capability 3: File Upload & Download
export interface FileUploadProgress {
  tempId: string;
  fileId?: string;
  file: File;
  name: string;
  sizeBytes: number;
  bytesUploaded: number;
  progressPercent: number;
  status: UploadStatus;
  errorMessage?: string;
  startedAt: number;
}

export interface FileDownloadPayload {
  fileId: string;
  name: string;
  signedUrl: string;
  mimeType: string;
  expiresInSeconds: number;
  expiresAt: string;
}

// Capability 4: File Previews
export type PreviewKind =
  | 'pdf'
  | 'image'
  | 'text'
  | 'markdown'
  | 'unsupported';

export interface FilePreviewState {
  isOpen: boolean;
  file: UserFile | null;
  signedUrl: string | null;
  previewKind: PreviewKind;
  isLoading: boolean;
  error: string | null;
}

// Capability 5: File Metadata & Storage Usage
export interface FileMetadataSummary {
  file: UserFile;
  formattedSize: string;
  extension: string;
  isPdf: boolean;
  isIndexable: boolean;
  isSafePreviewable: boolean;
  relativeCreatedAt: string;
  relativeUpdatedAt: string;
}

export interface StorageUsageDisplay {
  quota: UserStorageQuota;
  percentUsed: number;
  formattedUsed: string;
  formattedTotal: string;
  formattedRemaining: string;
  isNearLimit: boolean;
  isExceeded: boolean;
  barColorVariant: 'normal' | 'warning' | 'danger';
}

// Capability 6: Bulk Selection & Operations
export interface BulkSelectionState {
  selectedFileIds: string[];
  selectedFolderIds: string[];
  totalSelected: number;
  isAllSelected: boolean;
  hasFiles: boolean;
  hasFolders: boolean;
}

export type BulkActionType =
  | 'delete'
  | 'restore'
  | 'move'
  | 'index'
  | 'permanent_delete';

export interface BulkActionPayload {
  action: BulkActionType;
  fileIds: string[];
  folderIds: string[];
  targetFolderId?: string | null;
}

export interface BulkActionResult {
  action: BulkActionType;
  succeededCount: number;
  failedCount: number;
  errors?: Array<{ id: string; error: string }>;
}

// Capability 7: Separate Upload & Indexing Statuses
export interface FileDualStatus {
  uploadStatus: UploadStatus;
  indexStatus: IndexStatus;
  uploadStatusLabel: string;
  indexStatusLabel: string;
  uploadStatusBadgeColor: string;
  indexStatusBadgeColor: string;
  isProcessing: boolean;
  canIndex: boolean;
  canRetryIndex: boolean;
}

// Capability 8: Realtime Indexing Progress
export interface RealtimeJobSubscription {
  jobId: string;
  fileId: string;
  status: JobStatus;
  step: JobStep;
  attemptCount: number;
  errorMessage: string | null;
  updatedAt: string;
}

// Capability 9: Job Monitoring Drawer
export interface JobProgressItem {
  job: UserFileJob;
  fileName: string;
  fileSizeBytes: number;
  pageCount?: number | null;
  progressPercent: number;
  stepLabel: string;
  durationMs?: number;
  canCancel: boolean;
  canRetry: boolean;
}

export interface JobDrawerState {
  isOpen: boolean;
  activeJobs: JobProgressItem[];
  completedJobs: JobProgressItem[];
  failedJobs: JobProgressItem[];
}

// Capability 10: Retry & Safe Cancellation
export interface JobActionRequest {
  jobId: string;
  fileId: string;
  action: 'retry' | 'cancel';
}

export interface JobActionResult {
  jobId: string;
  fileId: string;
  action: 'retry' | 'cancel';
  success: boolean;
  message?: string;
}

// Capability 11: Folder Indexing Coverage
export interface FolderIndexingCoverage {
  folderId: string | null;
  totalFiles: number;
  totalPdfFiles: number;
  indexedFiles: number;
  queuedOrRunningFiles: number;
  failedFiles: number;
  unsupportedFiles: number;
  coverageRatio: string;
  coveragePercent: number;
}

// Capability 12: Contextual AI Launch from Files
export interface ContextualAiLaunchPayload {
  file: Pick<UserFile, 'id' | 'name' | 'mime_type' | 'size_bytes'>;
  focus: 'attached';
  mode: 'ask_ai' | 'research_ai';
  promptSeed?: string;
}

// Capability 13: Private Citations & Page Viewing
export interface PrivateCitationPayload {
  id: number;
  kind: 'text';
  source_origin: 'private';
  chunk_id: string;
  file_id: string;
  file_name: string;
  page_number?: number;
  char_from: number;
  char_to: number;
  text_hash: string;
  extract_hash?: string;
}

export interface PrivatePageViewerState {
  isOpen: boolean;
  fileId: string;
  fileName: string;
  pageNumber: number;
  textHash?: string;
  signedUrl: string | null;
  isLoading: boolean;
  error: string | null;
}

// ─── Constants & Limits ──────────────────────────────────────────────────────

/** Maximum size for an individual file upload (50 MB). */
export const MAX_FILE_SIZE_BYTES = 52_428_800;

/** Approved and proposed storage tier allocations in bytes. */
export const STORAGE_TIER_QUOTA_BYTES: Record<AppPlan, number> = Object.freeze({
  free: 524_288_000,        // 500 MB (Approved)
  plus: 2_147_483_648,      // 2 GB (Proposed)
  pro: 5_368_709_120,       // 5 GB (Approved)
  max: 53_687_091_200,      // 50 GB (Proposed)
});

/** MIME types accepted for safe inline browser rendering. */
export const SAFE_PREVIEW_MIME_TYPES: readonly string[] = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/markdown',
]);

/** MIME types confirmed for AI extraction and indexing in v1. */
export const INDEXABLE_MIME_TYPES: readonly string[] = Object.freeze([
  'application/pdf',
]);

// ─── Helper Functions & Type Guards ──────────────────────────────────────────

export function isPdfMimeType(mime: string): boolean {
  return mime.toLowerCase() === 'application/pdf';
}

export function isIndexableMimeType(mime: string): boolean {
  return INDEXABLE_MIME_TYPES.includes(mime.toLowerCase());
}

export function isSafePreviewableMimeType(mime: string): boolean {
  return SAFE_PREVIEW_MIME_TYPES.includes(mime.toLowerCase());
}

export function resolvePreviewKind(mime: string): PreviewKind {
  const m = mime.toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/') && (m === 'image/jpeg' || m === 'image/png' || m === 'image/webp')) return 'image';
  if (m === 'text/markdown') return 'markdown';
  if (m === 'text/plain') return 'text';
  return 'unsupported';
}
