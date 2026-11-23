import { describe, expect, it } from 'vitest';
import * as sample from './sample.js';
import {
  formatBytes,
  formatRelativeDate,
  isPdfMimeType,
  isIndexableFile,
  resolvePreviewKind,
  getUniqueFileName,
  normalizeFileManagerError,
  MAX_FILE_SIZE_BYTES,
} from './fileManager.js';

describe('fileManager service & helpers', () => {
  it('formats byte sizes accurately', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2_500_000)).toBe('2.4 MB');
    expect(formatBytes(52_428_800)).toBe('50 MB');
    expect(formatBytes(1_073_741_824)).toBe('1 GB');
  });

  it('formats relative dates accurately', () => {
    expect(formatRelativeDate(null)).toBe('—');
    expect(formatRelativeDate(Date.now() - 5000)).toBe('Just now');
    expect(formatRelativeDate(Date.now() - 15 * 60 * 1000)).toBe('15m ago');
    expect(formatRelativeDate(Date.now() - 2 * 3600 * 1000)).toBe('2h ago');
    expect(formatRelativeDate(Date.now() - 86400 * 1000)).toBe('Yesterday');
    expect(formatRelativeDate(Date.now() - 4 * 86400 * 1000)).toBe('4d ago');
  });

  it('identifies PDF MIME types correctly', () => {
    expect(isPdfMimeType('application/pdf')).toBe(true);
    expect(isPdfMimeType('APPLICATION/PDF')).toBe(true);
    expect(isPdfMimeType('text/plain')).toBe(false);
    expect(isPdfMimeType('')).toBe(false);
  });

  it('determines if files are indexable', () => {
    expect(isIndexableFile({ mime_type: 'application/pdf', name: 'contract.pdf' })).toBe(true);
    expect(isIndexableFile({ mime_type: 'application/octet-stream', name: 'petition.pdf' })).toBe(true);
    expect(isIndexableFile({ mime_type: 'text/csv', name: 'data.csv' })).toBe(true);
    expect(isIndexableFile({ mime_type: 'image/png', name: 'photo.png' })).toBe(false);
  });

  it('resolves correct preview kinds', () => {
    expect(resolvePreviewKind('application/pdf', 'doc.pdf')).toBe('pdf');
    expect(resolvePreviewKind('image/png', 'img.png')).toBe('image');
    expect(resolvePreviewKind('text/markdown', 'notes.md')).toBe('markdown');
    expect(resolvePreviewKind('text/plain', 'info.txt')).toBe('text');
    expect(resolvePreviewKind('text/csv', 'table.csv')).toBe('csv');
    expect(resolvePreviewKind('application/vnd.ms-excel', 'data.xls')).toBe('spreadsheet');
    expect(resolvePreviewKind('video/mp4', 'clip.mp4')).toBe('unsupported');
  });

  it('generates unique filenames when duplicates occur', () => {
    const existing = [
      { name: 'contract.pdf' },
      { name: 'contract (1).pdf' },
      { name: 'brief.docx' },
    ];
    expect(getUniqueFileName('contract.pdf', existing)).toBe('contract (2).pdf');
    expect(getUniqueFileName('other.pdf', existing)).toBe('other.pdf');
    expect(getUniqueFileName('brief.docx', existing)).toBe('brief (1).docx');
  });

  it('normalizes error messages appropriately', () => {
    expect(normalizeFileManagerError('File exceeds 50 MB upload limit')).toBe('This file exceeds the 50 MB upload limit.');
    expect(normalizeFileManagerError('User storage quota exceeded')).toBe('You have reached your storage limit.');
    expect(normalizeFileManagerError('JWT expired')).toBe('Please sign in to manage your files.');
    expect(normalizeFileManagerError('Failed to fetch')).toBe('Network connection issue. Please retry.');
  });
});

describe('sample mode fileManager operations', () => {
  it('lists initial sample files with expected metadata', async () => {
    const files = await sample.listFiles({ filter: 'all' });
    expect(files.length).toBeGreaterThanOrEqual(5);

    const pdfContract = files.find((f) => f.name === 'Q3_Procurement_Contract.pdf');
    expect(pdfContract).toBeDefined();
    expect(pdfContract.index_status).toBe('indexed');
    expect(pdfContract.upload_status).toBe('uploaded');
    expect(pdfContract.page_count).toBe(24);

    const pending = files.find((f) => f.name === 'Arbitration_Petition_2026.pdf');
    expect(pending).toBeDefined();
    expect(['indexing_extracting', 'processing', 'indexing_queued']).toContain(pending.index_status);

    const failed = files.find((f) => f.name === 'Notice_of_Motion_Draft.pdf');
    expect(failed).toBeDefined();
    expect(failed.index_status).toBe('indexing_failed');
    expect(failed.index_error).toContain('OCR');
  });

  it('filters files by type and ingestion status', async () => {
    const pdfs = await sample.listFiles({ filter: 'pdf' });
    expect(pdfs.every((f) => f.mime_type === 'application/pdf' || f.name.endsWith('.pdf'))).toBe(true);

    const ready = await sample.listFiles({ filter: 'ready_for_ai' });
    expect(ready.every((f) => f.index_status === 'indexed' || f.index_status === 'ready_for_ai')).toBe(true);
    expect(ready.some((f) => f.name === 'Q3_Procurement_Contract.pdf')).toBe(true);

    const failed = await sample.listFiles({ filter: 'failed' });
    expect(failed.some((f) => f.name === 'Notice_of_Motion_Draft.pdf')).toBe(true);
  });

  it('searches files by query string', async () => {
    const searchRes = await sample.listFiles({ search: 'arbitration' });
    expect(searchRes.length).toBeGreaterThanOrEqual(1);
    expect(searchRes[0].name).toContain('Arbitration');
  });

  it('calculates storage usage accurately in sample mode', async () => {
    const usage = await sample.getStorageUsage();
    expect(usage.plan).toBe('free');
    expect(usage.quotaBytes).toBe(524_288_000);
    expect(usage.usedBytes).toBeGreaterThan(10_000_000);
    expect(usage.percentUsed).toBeGreaterThan(0);
    expect(usage.formattedQuota).toBe('500 MB');
  });

  it('supports uploading files with progress and size validation', async () => {
    // 1. Rejects files > 50 MB
    const hugeFile = { name: 'huge.iso', size: MAX_FILE_SIZE_BYTES + 1000, type: 'application/octet-stream' };
    await expect(sample.uploadFile(hugeFile)).rejects.toThrow(/50 MB/);

    // 2. Uploads valid file and calls progress
    const progressUpdates = [];
    const newFile = {
      name: 'Supreme_Court_Special_Leave_Petition.pdf',
      size: 3_150_000,
      type: 'application/pdf',
    };
    const uploaded = await sample.uploadFile(newFile, (p) => progressUpdates.push(p.percent));
    expect(uploaded.name).toBe(newFile.name);
    expect(uploaded.upload_status).toBe('uploaded');
    expect(uploaded.index_status).toBe('indexed');
    expect(progressUpdates).toContain(100);

    // 3. Appears in file list
    const updatedList = await sample.listFiles({ search: 'Special_Leave' });
    expect(updatedList.some((f) => f.id === uploaded.id)).toBe(true);
  });

  it('retries indexing on a failed file', async () => {
    const failedList = await sample.listFiles({ filter: 'failed' });
    const target = failedList[0];
    expect(target).toBeDefined();

    const res = await sample.retryIndexing(target.id);
    expect(res.success).toBe(true);

    const rechecked = (await sample.listFiles({ filter: 'all' })).find((f) => f.id === target.id);
    expect(rechecked.index_status).toBe('indexed');
    expect(rechecked.index_error).toBeNull();
  });

  it('supports file preview retrieval', async () => {
    const files = await sample.listFiles({ filter: 'ready_for_ai' });
    const file = files[0];
    const preview = await sample.getFilePreview(file.id);
    expect(preview.file.id).toBe(file.id);
    expect(preview.text.length).toBeGreaterThan(20);
  });

  it('soft-deletes file and removes from active listing', async () => {
    const files = await sample.listFiles({ filter: 'all' });
    const toDelete = files[0];
    const delRes = await sample.deleteFile(toDelete.id);
    expect(delRes.success).toBe(true);

    const after = await sample.listFiles({ filter: 'all' });
    expect(after.some((f) => f.id === toDelete.id)).toBe(false);

    const trash = await sample.listFiles({ filter: 'trash' });
    expect(trash.some((f) => f.id === toDelete.id)).toBe(true);
  });
});
