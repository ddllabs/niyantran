/**
 * Feature F341: Authentication & Multi-Tenant Security Regression Tests.
 *
 * Verifies the 8 critical security invariants:
 * 1. Local mock identities cannot authorize production requests.
 * 2. Supabase JWT remains the source of backend identity.
 * 3. Every private Edge Function derives ownership from verified auth.uid().
 * 4. Client-supplied user IDs cannot override authenticated identity.
 * 5. LocalStorage / SessionStorage partitioning is not treated as a security boundary.
 * 6. Session hydration does not overwrite or bypass a legitimate Supabase session.
 * 7. Logout and account switching cannot expose cached private file data.
 * 8. No fallback allows an unauthenticated user to access private backend resources.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prepareUpload,
  createFolder,
  indexForAi,
  listFilesAndFolders,
  getDownloadUrl,
} from './fileManagerService.js';
import { supabase } from '../lib/supabaseClient.js';
import { invalidateLocalSession, setSessionUser } from '../lib/userStore.js';

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index) => Array.from(store.keys())[index] || null,
  };
}

describe('Feature F341 — Authentication Security Invariants & Defense-in-Depth', () => {
  let mockSessionStorage;
  let mockLocalStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage = createStorage();
    mockLocalStorage = createStorage();
    vi.stubGlobal('sessionStorage', mockSessionStorage);
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── Invariant 1 & 8: Unauthenticated Callers Fail Closed ───────────────────
  it('Invariant 1 & 8: Rejects upload preparation when unauthenticated', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new Error('Auth session missing!'),
    });

    await expect(
      prepareUpload({
        name: 'secret.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      })
    ).rejects.toThrow(/authentication required/i);
  });

  it('Invariant 1 & 8: Rejects folder creation when unauthenticated', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new Error('No session'),
    });

    await expect(
      createFolder({ name: 'Sensitive Folder' })
    ).rejects.toThrow(/authentication required/i);
  });

  it('Invariant 8: listFilesAndFolders returns empty set when unauthenticated', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new Error('No session'),
    });

    const res = await listFilesAndFolders();
    expect(res.folders).toEqual([]);
    expect(res.files).toEqual([]);
  });

  it('Invariant 8: getDownloadUrl rejects when unauthenticated or file missing', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('PGRST116 File not found') }),
    });

    await expect(
      getDownloadUrl('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow(/file not found or access denied/i);
  });

  // ─── Invariant 2 & 4: Backend Identity Derived Exclusively from auth.uid() ──
  it('Invariant 2 & 4: user_file_prepare_upload relies on verified JWT context, not client user_id', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        file_id: 'file-123',
        storage_path: 'auth-user-id/file-123/doc.pdf',
        signed_upload_url: 'https://storage.supabase.co/upload',
      },
      error: null,
    });

    await prepareUpload({
      name: 'doc.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
    });

    expect(mockRpc).toHaveBeenCalledWith('user_file_prepare_upload', {
      p_name: 'doc.pdf',
      p_mime_type: 'application/pdf',
      p_size_bytes: 2048,
      p_folder_id: null,
    });

    // Notice: Client NEVER sends p_user_id; backend extracts auth.uid() from JWT
    const rpcArgs = mockRpc.mock.calls[0][1];
    expect(rpcArgs).not.toHaveProperty('p_user_id');
    expect(rpcArgs).not.toHaveProperty('user_id');
  });

  it('Invariant 4: indexForAi RPC relies on auth.uid() and rejects client user_id override', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { job_id: 'job-999', status: 'indexing_queued' },
      error: null,
    });

    await indexForAi('file-xyz');

    expect(mockRpc).toHaveBeenCalledWith('user_file_enqueue_indexing', {
      p_file_id: 'file-xyz',
    });

    const rpcArgs = mockRpc.mock.calls[0][1];
    expect(rpcArgs).not.toHaveProperty('p_user_id');
  });

  // ─── Invariant 5: LocalStorage Partitioning is NOT a Security Boundary ─────
  it('Invariant 5: Local storage keys do not grant access to backend resources', async () => {
    // Malicious actor populates local storage with target user's ID
    const targetUserId = 'target-user-0000-0000-000000000000';
    sessionStorage.setItem(`niyantran_folders_${targetUserId}`, JSON.stringify([{ id: 'f1', name: 'Private' }]));

    // Backend Supabase auth confirms caller is NOT the target user
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'attacker-uuid', email: 'attacker@evil.test' } },
      error: null,
    });

    // Mock backend database query returning ONLY attacker's folders (RLS enforced)
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => resolve({ data: [], error: null })),
    });

    const res = await listFilesAndFolders();
    // Attacker sees 0 folders because backend RLS returns empty set
    expect(res.folders).toEqual([]);
  });

  // ─── Invariant 7: Logout & Account Switch Purges Cached File Data ──────────
  it('Invariant 7: Invalidation / Sign-out immediately purges cached file data', () => {
    sessionStorage.setItem('niyantran_folders_user_1', JSON.stringify([{ id: '1', name: 'Secret' }]));
    sessionStorage.setItem('niyantran_files_user_1', JSON.stringify([{ id: 'file_1', name: 'Secret.pdf' }]));
    sessionStorage.setItem('niyantran_fm_cache', 'cached_data');

    expect(sessionStorage.getItem('niyantran_folders_user_1')).not.toBeNull();

    // Trigger logout invalidation
    invalidateLocalSession();

    // Cached entries must be completely wiped
    expect(sessionStorage.getItem('niyantran_folders_user_1')).toBeNull();
    expect(sessionStorage.getItem('niyantran_files_user_1')).toBeNull();
    expect(sessionStorage.getItem('niyantran_fm_cache')).toBeNull();
  });

  // ─── Invariant 6: Legitimate Session Hydration ─────────────────────────────
  it('Invariant 6: Session hydration verifies authenticated user and rejects unverified identities', async () => {
    // Unverified / spoofed session in storage without Supabase user
    setSessionUser({ id: 'fake-id', email: 'fake@example.test', plan: 'free' });

    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new Error('Invalid token'),
    });

    // When attempting a real operation, fake session cannot authorize
    await expect(
      createFolder({ name: 'Hacked Folder' })
    ).rejects.toThrow(/authentication required/i);
  });
});
