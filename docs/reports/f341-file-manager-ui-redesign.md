# F341 (main: F417) File Manager UI/UX Redesign Evidence Report

> **Status: Historical (2026-11-16).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

**Branch status:** Implementation & Verification in Progress  
**Date:** 2026-11-16  
**Reference Design:** Information Architecture & Presentation per Reference Specification  
**Target Branch:** `file-manager`  

---

## 1. Executive Summary & Design System Conformance

The Niyantran AI File Manager has been redesigned from a conventional vertical-sidebar layout into a streamlined, information-dense workspace aligned with enterprise document workbenches.

### Preserved Niyantran Brand Tokens
- **Theme & Surfaces:** Warm off-white background (`--bg: #f8f5f0`), pure white panels (`--panel: #ffffff`), and subtle line dividers (`--line: #e4ddd4`).
- **Typography:** Strict adherence to `--font-ui` (Inter/system-ui) and tabular numeric data in `--font-mono`.
- **Accent Palette:** Royal Blue primary accent (`--accent: #012ea1`, `--accent-soft: #e8eef8`) and Niyantran danger red (`#dc2626`).
- **Iconography:** Lucide icons matching the wider workbench suite.

---

## 2. Information Architecture & Layout Changes

### 2.1 Navigation & Header
- **Left:** Branded File Manager icon container, title `File Manager`, and description: *"Your files, documents and AI-ready knowledge in one place."*
- **Right:** Global Search field with clear action and modal exit button.

### 2.2 Navigation Tabs
1. **My Files:** Primary user personal drive (`view = 'all'`).
2. **Organisation Files:** Dedicated tab with `Enterprise` badge explaining workspace team policies.
3. **AI Artifacts:** Saved research briefs and LLM outputs (`view = 'artifacts'`).
4. **Trash:** 30-day retention store with quota accounting (`view = 'trash'`).
- **Shared with me:** Permanently removed per specification.

### 2.3 Filter & Action Toolbar
Single horizontal row directly beneath navigation:
- **Left Filters:** `All Types`, `Any Index Status`, `Owned by Anyone`, with a one-click `Reset` button.
- **Right Actions:**
  - `Index Queue` (with job badge and drawer trigger)
  - `New Folder` (modal trigger)
  - `New Base` (connected to Knowledge Base system)
  - `New Doc` (connected to Terminal Editor)
  - `Upload Here` (prominent primary blue action)

### 2.4 File Table Structure
Recreated 8 normative columns:
1. `Selection`: Checkbox for single and multi-selection
2. `Name`: File/folder type icon and title
3. `Documents`: Associated document/page count or `—`
4. `Indexing`: AI indexing status pill (`Searchable`, `Processing`, `Queued`, `Not searchable`, `Failed`)
5. `Size`: Byte size or `—`
6. `Owner`: Authenticated tenant identifier
7. `Shared With`: `—` (unsupported backend capability)
8. `Connected`: `—` (unsupported backend capability)
9. `Actions`: Preview, Download, and Context Menu

---

## 3. Upload & Indexing Pipeline Integrity
- Existing F341 50 MB upload limit and quota tracking preserved.
- Dual-status tracking (Upload status vs Index status) orthogonal and accurate.
- Zero mock data or localStorage simulation.

---

## 4. Verification Evidence & Quality Gates

### 4.1 Unit & Acceptance Tests (Vitest)
```bash
npm test src/fileManager/
```
Output:
- `src/fileManager/fileManager.test.jsx`: 58 passed
- `src/fileManager/authSecurity.test.js`: 9 passed
- `src/fileManager/fileManagerE2E.test.jsx`: 3 passed
- **Total: 70 tests passed (100% green)**

### 4.2 Linter Cleanliness (ESLint)
```bash
npx eslint src/fileManager/
```
Output:
- Exited with code 0 (0 errors, 0 warnings).

### 4.3 Production Build (Vite)
```bash
npm run build
```
Output:
- `dist/assets/FileManagerShell-CqCUqQlz.js`: 90.03 kB (gzip: 22.36 kB)
- `dist/assets/FileManagerShell-DLiI_r5h.css`: 25.10 kB (gzip: 4.70 kB)
- Built cleanly in 43.23s.

### 4.4 API Router Compatibility
```bash
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
```
Output:
- `router import ok`

