/**
 * Feature F341: Private File Manager & Storage Service for NTER Mobile.
 *
 * Implements client-side services for:
 * - Listing stored files with filters (All, PDF, Processing, Ready for AI, Failed, Trash) & search.
 * - File upload to 'user-files' bucket with 50 MB limit and SHA-256 calculation.
 * - Deletion, soft-delete trash lifecycle.
 * - AI indexing initiation & retry for indexable formats (PDF).
 * - File preview URL and text retrieval.
 * - Storage usage & quota accounting.
 */

import { api } from './index.js';

// ─── Constants & Limits ──────────────────────────────────────────────────────

/** Maximum size for an individual file upload (50 MB). */
export const MAX_FILE_SIZE_BYTES = 52_428_800;

/** Storage tier allocations in bytes matching Niyantran plans. */
export const STORAGE_TIER_QUOTA_BYTES = Object.freeze({
  free: 524_288_000,        // 500 MB
  plus: 2_147_483_648,      // 2 GB
  pro: 5_368_709_120,       // 5 GB
  max: 53_687_091_200,      // 50 GB
});

/** MIME types accepted for safe inline mobile rendering. */
export const SAFE_PREVIEW_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/** MIME types supported for AI extraction and indexing. */
export const INDEXABLE_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

export const INDEXABLE_EXTENSIONS = Object.freeze([
  'pdf',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'docx',
  'txt',
  'md',
]);

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Checks if a MIME type represents a PDF document.
 * @param {string} mime
 * @returns {boolean}
 */
export function isPdfMimeType(mime) {
  return (mime || '').toLowerCase() === 'application/pdf';
}

/**
 * Checks if a file is indexable for AI.
 * @param {{ mime_type?: string, name?: string }} file
 * @returns {boolean}
 */
export function isIndexableFile(file) {
  if (!file) return false;
  const m = (file.mime_type || '').toLowerCase();
  if (INDEXABLE_MIME_TYPES.includes(m)) return true;
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
  return INDEXABLE_EXTENSIONS.includes(ext);
}

/**
 * Resolves preview category for a file.
 * @param {string} mime
 * @param {string} fileName
 * @returns {'pdf' | 'image' | 'spreadsheet' | 'csv' | 'markdown' | 'text' | 'word' | 'unsupported'}
 */
export function resolvePreviewKind(mime, fileName = '') {
  const m = (mime || '').toLowerCase();
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(m) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    return 'image';
  }
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  if (m === 'text/plain' || ext === 'txt') return 'text';
  if (m === 'text/csv' || ext === 'csv' || ext === 'tsv') return 'csv';
  if (m.includes('spreadsheet') || m.includes('excel') || ['xlsx', 'xls'].includes(ext)) return 'spreadsheet';
  if (m.includes('wordprocessingml') || ext === 'docx') return 'word';
  return 'unsupported';
}

/**
 * Formats byte counts into human-readable strings (e.g. "2.4 MB").
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Formats ISO timestamp to relative time (e.g. "2h ago", "Yesterday", "Nov 15").
 * @param {string | number | Date} timestamp
 * @returns {string}
 */
export function formatRelativeDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Calculates SHA-256 hex digest using Web Crypto API.
 * @param {Blob | File} blob
 * @returns {Promise<string>}
 */
export async function calculateSha256(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return '';
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `hash-${Date.now()}`;
  }
}

/**
 * Generates an auto-incremented unique filename if duplicates exist.
 * @param {string} name
 * @param {Array<{ name: string, deleted_at?: any }>} existingFiles
 * @returns {string}
 */
export function getUniqueFileName(name, existingFiles = []) {
  if (!name) return 'Untitled';
  const activeExistingNames = new Set(
    (existingFiles || [])
      .filter((f) => !f.deleted_at)
      .map((f) => (f.name || '').toLowerCase())
  );

  if (!activeExistingNames.has(name.toLowerCase())) return name;

  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : '';

  let counter = 1;
  let candidate = `${base} (${counter})${ext}`;
  while (activeExistingNames.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

/**
 * Normalizes backend error messages into clear user explanations.
 * @param {any} err
 * @returns {string}
 */
export function normalizeFileManagerError(err) {
  if (!err) return 'An unexpected error occurred.';
  const msg = typeof err === 'string' ? err : (err.message || '');
  const low = msg.toLowerCase();

  if (low.includes('50 mb') || low.includes('file_too_large') || low.includes('exceeds maximum allowed upload size')) {
    return 'This file exceeds the 50 MB upload limit.';
  }
  if (low.includes('quota') || low.includes('storage limit') || low.includes('storage_limit_exceeded')) {
    return 'You have reached your storage limit.';
  }
  if (low.includes('session') || low.includes('sign in') || low.includes('unauthorized') || low.includes('jwt')) {
    return 'Please sign in to manage your files.';
  }
  if (low.includes('network') || low.includes('failed to fetch') || low.includes('timeout')) {
    return 'Network connection issue. Please retry.';
  }
  return msg || 'An unexpected error occurred.';
}

// ─── Service Methods Delegating to Active API (Live / Sample) ────────────────

/**
 * Lists user files with filter and search criteria.
 * @param {{ filter?: string, search?: string }} [options]
 * @returns {Promise<Array<any>>}
 */
export async function listFiles(options = {}) {
  return api.listFiles(options);
}

/**
 * Uploads a file with optional progress callback.
 * @param {File | Blob} file
 * @param {(progress: { loaded: number, total: number, percent: number }) => void} [onProgress]
 * @returns {Promise<any>}
 */
export async function uploadFile(file, onProgress) {
  return api.uploadFile(file, onProgress);
}

/**
 * Moves a file to Trash / soft-deletes it.
 * @param {string} fileId
 * @returns {Promise<{ success: boolean }>}
 */
export async function deleteFile(fileId) {
  return api.deleteFile(fileId);
}

/**
 * Retries AI indexing on a failed file.
 * @param {string} fileId
 * @returns {Promise<{ success: boolean }>}
 */
export async function retryIndexing(fileId) {
  return api.retryIndexing(fileId);
}

/**
 * Enqueues a file for AI indexing.
 * @param {string} fileId
 * @returns {Promise<{ success: boolean }>}
 */
export async function indexForAi(fileId) {
  return api.indexForAi ? api.indexForAi(fileId) : api.retryIndexing(fileId);
}

/**
 * Gets preview payload (URL and/or text extract).
 * @param {string} fileId
 * @returns {Promise<{ file: any, url: string | null, text: string | null }>}
 */
export async function getFilePreview(fileId) {
  return api.getFilePreview(fileId);
}

export const getFilePreviewUrl = getFilePreview;

/**
 * Gets real-time storage quota and usage.
 * @returns {Promise<{ plan: string, quotaBytes: number, usedBytes: number, remainingBytes: number, percentUsed: number, formattedUsed: string, formattedQuota: string }>}
 */
export async function getStorageUsage() {
  return api.getStorageUsage();
}
