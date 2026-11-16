# F341 Production Storage Quota Defect: Root Cause Analysis, Repair & Verification Report

**Status:** Completed & Verified  
**Date:** 2026-11-16  
**Target Branch:** `file-manager`  
**Environments:** 
- Vercel: `https://niyantran-git-file-manager-ddl-labs.vercel.app`
- Production Supabase: `vfgcppstyzjarlzyqdac.supabase.co`

---

## 1. Executive Summary & Root Cause Analysis

### The Reported Defect
Users accessing the Niyantran File Manager on Vercel observed:
- **Plan:** `FREE`
- **Gauge:** `500 MB used / 500 MB (100% full)` in red warning state.
- **Banner:** *"Storage quota exceeded. New uploads are blocked until items are deleted from Trash."*
- **File Browser:** Completely empty (`0` files, `0` folders).
- **Upload Action:** Attempting to upload any file (e.g. `7.1 KB`) failed immediately with toast: *"You have reached your storage limit."*
- **Network Trace:** `POST /rest/v1/rpc/user_storage_quota_bytes` returned HTTP `200 OK` with JSON number `524288000`.

### Exact Root Cause
The RPC `public.user_storage_quota_bytes` in PostgreSQL returns the user's **storage ceiling limit** (500 MB = 524,288,000 bytes for the Free tier), **NOT** the user's consumed bytes.

In `src/fileManager/fileManagerService.js`:
```javascript
// BUGGY CODE (PREVIOUS):
const { data: rpcData, error: rpcError } = await supabase.rpc('user_storage_quota_bytes');
...
const usedBytes = rpcData; // <--- FATAL BUG: Assumed ceiling was used bytes!
const remainingBytes = Math.max(0, quotaBytes - usedBytes); // = 0
```
This inverted the ceiling into consumed usage:
1. `usedBytes` was set to `524288000` (500 MB).
2. `remainingBytes` was computed as `524288000 - 524288000 = 0`.
3. `percentUsed` was computed as `100%`.
4. In `src/fileManager/useFileManager.js`:
   ```javascript
   if (file.size > quota.remaining_bytes) {
     toast.error('You have reached your storage limit.');
     return;
   }
   ```
   Because `remaining_bytes` was `0`, every upload attempt—even a 1 KB file—was blocked before reaching the network.

---

## 2. End-to-End Architectural Repairs

### 1. Service Layer Hardening (`src/fileManager/fileManagerService.js`)
- **Separated Ceiling and Consumed Usage:**
  `quotaBytes` is assigned from `public.user_storage_quota_bytes(user.id)`.
  `usedBytes` is computed from `public.user_storage_used_bytes(user.id)` with a direct query fallback:
  ```javascript
  supabase
    .from('user_files')
    .select('size_bytes')
    .eq('user_id', user.id)
    .neq('upload_status', 'upload_failed')
  ```
  Excluding abandoned uploads (`pending_upload` older than 2 hours).
- **Robust Numeric Parsing:**
  Added `parseNumericBytes()` to safely handle PostgREST raw numbers, BigInt string serialization, nulls, and nested JSONB payloads without producing `NaN` or `Infinity`.
- **Honest Database Offline / Unavailable State:**
  When database/RPCs are unreachable or failing, `quota.unavailable = true` is set. The UI shows an informative retry state rather than misleading the user with a "100% full" danger warning.
- **Immediate Reservation Cleanup:**
  Exported `cleanupPendingUpload(fileId)` to actively remove orphaned rows in `public.user_files` if a browser transport error or user abort occurs during upload.

### 2. UI/UX Refinement (`src/fileManager/StorageUsageGauge.jsx` & `DriveBrowser.jsx`)
- **Gauge Protection:**
  Clamped `percentUsed` between 0% and 100%. If `unavailable` is true, suppressed the red danger bar and rendered a retry button.
- **Empty Folder Context:**
  When a folder is empty but account storage is occupied, `DriveBrowser` provides clear guidance:
  *"Your storage is occupied by files or pending uploads that are not currently visible in this folder."*

### 3. Database Function & Migration (`supabase/migrations/20261115000001_private_file_manager.sql`)
- Added `public.user_storage_used_bytes(p_user_id uuid)` with owner isolation security checks.
- Updated `user_file_prepare_upload` to filter out `upload_failed` and abandoned reservations older than 2 hours.
- Added explicit `GRANT` statements for `authenticated` and `service_role`.

---

## 3. Verification & Test Evidence

All 14 production quota scenarios were implemented in `src/fileManager/fileManager.test.jsx` and verified:

```bash
npm test src/fileManager/
```
**Outcome: 40/40 tests PASSED (100% green)**
- `src/fileManager/authSecurity.test.js`: 9 passed
- `src/fileManager/fileManager.test.jsx`: 28 passed (including all 14 quota scenarios)
- `src/fileManager/fileManagerE2E.test.jsx`: 3 passed

### Linters & Builds
- `npm run lint`: **PASS (0 errors, 0 warnings)**
- `npm run build`: **PASS (Vite production build completed)**
- `node -e "import('./api/router.js')"`: **PASS (Vercel router import ok)**
