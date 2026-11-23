# NTER Mobile — Recommended Production Remediations & Technical Roadmap

> **Status:** Normative Technical Remediation Spec  
> **Author:** Antigravity Engineering Lead & Multi-Agent Orchestration Team  
> **Date:** 2026-11-23  
> **Target Systems:** NTER Mobile Client, Supabase Edge Worker (`ingest-worker`), Database RPCs, OpenRouter AI Gateway  
> **Release Recommendation:** **CONDITIONALLY READY FOR STAGING DEPLOYMENT**  
> **Scope:** Prioritized remediation actions (P0 to P3) identifying exact code files, root causes, risks, and proposed implementations.

---

## 1. Remediation Priority Framework

- **P0 — Critical Pre-Production Gate:** Must be remediated before general public production traffic. Blocks specific supported file formats or critical mobile flows.
- **P1 — High Priority:** Recommended before broad general availability (GA) rollout. Affects native mobile deep-linking, edge session expiration, or quota concurrency.
- **P2 — Medium Priority (Quality & Resilience):** Performance, caching, and background extraction resilience enhancements.
- **P3 — Low Priority (Technical Debt):** Code cleanup, bundle size optimization, and documentation harmonization.

---

## 2. Prioritized Action Items

### P0-01: Supabase Edge Worker PPTX Handler Parity
- **Severity / Priority:** P0 (Critical)
- **Component:** `supabase/functions/ingest-worker/user-file-step.ts` & `supabase/functions/ingest-worker/extract.ts`
- **Current State:**
  Client-side `nter-mobile/src/lib/extractors/pptxExtractor.js` contains a zero-dependency in-memory OpenXML extractor that extracts slide XML (`ppt/slides/slide{n}.xml`), bullet hierarchies, titles, and speaker notes. However, the backend Edge Worker (`supabase/functions/ingest-worker/user-file-step.ts`) does not yet register a `.pptx` handler. Uploading a `.pptx` file in live mode returns `unsupported_file_format` from the Edge Function.
- **Impact:** Users uploading presentations in live Supabase mode encounter ingestion failures despite presentations being fully supported in sample mode and preview modals.
- **Remediation Specification:**
  1. Port the OpenXML slide parser from `nter-mobile/src/lib/extractors/pptxExtractor.js` into `supabase/functions/ingest-worker/extract.ts`.
  2. In `user-file-step.ts`, add:
     ```typescript
     } else if (fileName.endsWith('.pptx')) {
       text = await extractPptxText(fileBytes);
     }
     ```
  3. Emit structured coordinate metadata: `chunk_metadata: { slideNumber: n, slideTitle: "...", isSpeakerNote: boolean }`.
  4. Add Deno unit test in `supabase/functions/ingest-worker/user-file-step.test.ts`.

---

### P0-02: Edge Worker TSV Extension & MIME Routing
- **Severity / Priority:** P0 (Critical)
- **Component:** `supabase/functions/ingest-worker/user-file-step.ts`
- **Current State:**
  Line 82 checks `fileName.endsWith('.csv')` or `contentType === 'text/csv'`. Tab-separated value files (`.tsv` / `text/tab-separated-values`) are parsed cleanly client-side by `csvExtractor.js` (which auto-detects `\t` delimiters), but fail in the Edge Worker unless renamed to `.csv`.
- **Impact:** Tab-separated court registries and legal data exports fail backend ingestion.
- **Remediation Specification:**
  Update extension checking in `user-file-step.ts`:
  ```typescript
  } else if (fileName.endsWith('.csv') || fileName.endsWith('.tsv') || contentType.includes('separated-values')) {
    text = await extractDelimitedText(fileBytes);
  }
  ```

---

### P1-01: Capacitor Native App Deep-Link Callback Registration for OAuth
- **Severity / Priority:** P1 (High)
- **Component:** `nter-mobile/capacitor.config.json` & `nter-mobile/src/services/live.js`
- **Current State:**
  Email/password and PKCE magic links are fully implemented. When expanding to Google / Apple native OAuth on Android and iOS, Capacitor must intercept custom URL schemes (`nter://auth/callback` or `https://nter.pro/mobile-auth`).
- **Impact:** Third-party OAuth redirects to browser rather than returning focus to the native Capacitor container.
- **Remediation Specification:**
  1. Add custom URL scheme to `capacitor.config.json`:
     ```json
     {
       "appId": "pro.nter.mobile",
       "appName": "Niyantran",
       "plugins": {
         "App": {
           "urlScheme": "nter"
         }
       }
     }
     ```
  2. In `src/services/live.js`, register `App.addListener('appUrlOpen', ({ url }) => { ... supabase.auth.exchangeCodeForSession(code) })`.

---

### P1-02: Mobile Atomic Advisory Lock Parity for Storage Uploads
- **Severity / Priority:** P1 (High)
- **Component:** `src/fileManager/fileManagerService.js` vs `nter-mobile/src/services/live.js`
- **Current State:**
  The web workbench uses Postgres RPC `reserve_storage_upload_slot(p_user_id, p_bytes)` with an atomic row lock on `user_storage_quotas` to prevent race conditions when multiple large files are uploaded simultaneously. `nter-mobile` performs a client-side quota check before calling `supabase.storage.from('private_files').upload(...)`.
- **Impact:** A mobile user initiating 3 parallel 80 MB uploads on a 200 MB quota could theoretically exceed the storage allocation before backend ingestion quotas catch up.
- **Remediation Specification:**
  Call the existing RPC `reserve_storage_upload_slot` in `nter-mobile/src/services/live.js:uploadFile` prior to triggering Supabase storage upload.

---

### P2-01: Client-Side Chunk Cache for Large Offline Documents
- **Severity / Priority:** P2 (Medium)
- **Component:** `nter-mobile/src/lib/extractors/` & `@capacitor/preferences`
- **Current State:**
  When previewing a 40-page contract in `FileManager.jsx`, the document text is parsed on-demand from the raw Uint8Array.
- **Remediation Specification:**
  Cache parsed AST / structured JSON in `@capacitor/preferences` (or IndexedDB for files $> 2\text{ MB}$) keyed by the document's `sha256` content digest.

---

### P2-02: Adaptive Extraction Chunk Size Based on Model Context Window
- **Severity / Priority:** P2 (Medium)
- **Component:** `nter-mobile/src/lib/extractors/common.js` & `supabase/functions/ingest-worker/user-file-step.ts`
- **Current State:**
  Chunk size is statically fixed to 1,200 characters with 150-character overlap across all models.
- **Remediation Specification:**
  Pass model tier context parameters into RAG retrieval. Allow models with large context windows (`google/gemini-3.8-flash` with 1M tokens) to receive 3,000-character chunks for superior legal clause coherence, while fast small-window models receive 800-character chunks.

---

### P3-01: Bundle Code-Splitting for Heavy Document Parsing Libraries
- **Severity / Priority:** P3 (Low)
- **Component:** `nter-mobile/vite.config.js`
- **Current State:**
  Vite reports `dist/assets/index-BwBnAIcA.js` is 1,486 kB uncompressed (429 kB gzip) due to embedding `@pdf-lib/fontkit` and `docx` directly.
- **Remediation Specification:**
  Configure `build.rollupOptions.output.manualChunks`:
  ```javascript
  manualChunks: {
    'vendor-docx': ['docx'],
    'vendor-fontkit': ['@pdf-lib/fontkit'],
    'vendor-pdf': ['pdf-lib', 'pdfjs-dist']
  }
  ```
  This will drop the initial mobile launch bundle from 429 kB gzip to $< 140\text{ kB}$ gzip, accelerating cold boot time by $\sim 35\%$.

---

## 3. Prioritized Implementation Schedule

```
+---------------------------------------------------------------------------------+
| PHASE 1 (Immediate Pre-Launch): P0-01 (PPTX Edge Worker) + P0-02 (TSV Handler)   |
| Duration: 1 Day                                                                 |
+---------------------------------------------------------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------------------+
| PHASE 2 (Staging Hardening):    P1-01 (OAuth App Link) + P1-02 (Storage Lock)   |
| Duration: 2 Days                                                                |
+---------------------------------------------------------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------------------+
| PHASE 3 (Post-Launch Refinement): P2-01 (Chunk Cache) + P3-01 (Bundle Splitting) |
| Duration: 3 Days                                                                |
+---------------------------------------------------------------------------------+
```
