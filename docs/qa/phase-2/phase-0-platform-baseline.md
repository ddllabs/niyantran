# NTER PHASE 2: MASTER ORCHESTRATION — PHASE 0 PLATFORM BASELINE
## Comprehensive Architectural, Codebase, Database & Working-Tree Baseline Audit

> **Status: Normative Record**  
> **Phase:** Phase 2 — Orchestrated Platform Implementation  
> **Stage:** Phase 0 — Repository Audit & Baseline Verification  
> **Lead:** Agent 0 — Integration Supervisor / Technical Architect  
> **Participating Specialists:** Agents 1 through 7  
> **Date:** 2026-11-20  
> **Branch:** `file-manager` (Work uncommitted per `AGENTS.md`)  
> **Quality Gate:** PASS

---

## 1. Executive Summary & Objective

In accordance with the **NTER Master Multi-Agent Orchestration Protocol**, Phase 0 establishes the definitive technical and architectural baseline of the Niyantran Terminal (NTER) repository before concurrent specialist execution.

The objective is to ground all engineering agents in the verified reality of the existing codebase, honoring the product vision set forth in:
1. **Source A:** Lawyer Mobile Journey (`terminal-lawyer-mobile-journey.pdf`)
2. **Source B:** NTER Four-Week Development Scope and Milestones (`NTER_4_Week_Development_Scope_and_Milestones.pdf`)
3. **Source C:** Authoritative Mobile Reference Images (Screens 1 to 4)

**Core Mandate:** Do not rebuild the platform or replace working subsystems. Discover existing implementations, preserve working contracts, identify genuine gaps, and implement the reference-accurate experience across mobile, tablet, and desktop.

---

## 2. Git & Working-Tree Integrity Audit

Per `AGENTS.md`, all coding agents operate with strict change control:
- **Current Local Branch:** `file-manager`
- **Remote Configuration:** `origin` (`https://github.com/ddl-labs/niyantran-react.git`)
- **Working Tree State:** Clean baseline with pre-existing uncommitted F341/F342 changes and completed Phase 2 / Step 1 mobile header integration.
- **Untracked Directories & Artifacts:**
  - `docs/qa/screenshots/step-1/`: 12 verified browser screenshots across all required viewports.
  - `docs/qa/step-1-visual-manifest.json`: Verified visual manifest with SHA-256 hashes and layout health assertions.
  - `src/shell/MobileHeader.jsx`: Shared mobile header component with `[ Chat | Work ]` segmented switch.
  - `src/shell/mobileHeader.test.jsx`: Passing Vitest unit suite (4/4 tests).
  - `scripts/verify-step-1-mobile-shell.mjs`: Programmatic headless Chrome CDP capture harness.

No commits, pushes, merges, deployments, or remote migrations are authorized.

---

## 3. Subsystem Architectural Audits

### 3.1 Frontend & Shell Architecture (Owner: Agent 2, Supervisor: Agent 0)
- **Framework:** React 18 with Vite 5.4.
- **Styling Architecture:** High-performance scoped CSS + global design tokens (`src/index.css`, `src/shell/mobileNav.css`, `src/ai/research.css`).
- **Shell Layout (`src/shell/TerminalShell.jsx`):**
  - **Desktop ($\ge 768\text{px}$):** Persistent `.topbar` with brand identity, directory search, Live TV modal, theme toggles, and side-panel docking.
  - **Mobile ($< 768\text{px}$):** Sticky `.nter-mobile-header` (`[ ☰ ]` `[ Chat | Work ]` `[ π / Doc ]`), drawer overlay (`DeskRail`), and 5-tab bottom navigation (`MobileBottomNav`).
  - **Safe-Area Tokens:** Integrated CSS environment variables (`--sat`, `--sab`, `--sal`, `--sar`) with fallback defaults preventing content clipping under notches and home indicator bars.

### 3.2 Authentication & User Profiles (Owner: Agent 1)
- **Engine:** Supabase Auth (`supabase.auth.getSession()`, `supabase.auth.signInWithPassword()`, OAuth via Google).
- **Session Store (`src/lib/userStore.js`):** `sessionUser()` backed by `localStorage` (`niy_session_user`).
- **Persona Data Model (`src/lib/personas.js`):**
  - Canonical personas: `lawyer`, `student`, `journalist`, `analyst`, `researcher`, `academic`, `policy`.
  - Database mapping: `user_type` enum in Supabase.
  - Onboarding synchronization: Handled via RPC `public.update_my_onboarding_profile` and local preference hydration (`hydrateUserPrefs`).
  - Separation of Concerns: Persona, Practice Area, and Jurisdiction are stored as profile-level attributes, distinct from per-chat conversation focus.

### 3.3 AI Research, Vector RAG & Retrieval (Owner: Agent 3, Evaluator: Agent 7)
- **Backend Edge Function:** `supabase/functions/research-chat/` with streaming SSE.
- **Model Registry & Routing (`src/ai/researchRegistry.js`):**
  - Multi-provider model abstraction via OpenRouter API and local proxies.
  - Supported catalogue: `NYAI Pro` (deep research with citations), `NYAI Lite` (fast daily research), `DeepSeek`, `GPT`, `Gemini`, `Claude`.
  - Fallback and recovery: Graceful fallback to default model if a provider endpoint is throttled or offline.
- **Retrieval Engine & pgvector:**
  - `document_chunks` partitioned by feature.
  - Hybrid search: vector similarity (`halfvec` / cosine distance) + full-text search (`tsvector` / BM25).
  - Traceable Provenance: Every answer returns retrieved source IDs, authority titles, pinpoint paragraph references, and verification status.

### 3.4 Work Mode & Document Generation (Owner: Agent 4)
- **Drafting Surface (`src/ai/DocumentDraftingSurface.jsx`):**
  - Quick Document selector with 5 specialized Lawyer outputs:
    1. *Case-law & citation note*
    2. *Legal notice*
    3. *Case brief*
    4. *Written submissions*
    5. *Chronology of facts*
  - Context Carryover: Receives original question, persona, practice area, jurisdiction, selected model, source records, and citations directly from the Chat thread.
  - Interactive Editing: Fully editable draft surface with live word count, citation checklist, verification alert banners, and auto-save.
  - Export Capabilities: Client-side Word-compatible document generation with structured headers, statutory citations, and court formatting.

### 3.5 Private Files & User Storage (Owner: Agent 5)
- **Storage Subsystem:** Supabase Storage (`user-files` bucket) with user-level isolation enforced via `auth.uid() = owner_id`.
- **Metadata Tables:** `user_folders`, `user_files`, `user_file_chunks`, `user_file_indexing_jobs`.
- **Artifact Vault:** Dedicated `AI Artifacts` system folder automatically created to store and version drafts saved from Work mode without page reloads.

### 3.6 Commercial Lifecycle, Credits & Administration (Owner: Agent 6)
- **Billing Contract:** 1 credit = 1 paisa (₹0.01 INR).
- **Payment Gateway:** Razorpay checkout integration with preflight server validation.
- **Entitlements (`src/lib/planEntitlements.js`):** Active status, renewal grace handling, and feature gate controls.
- **Admin Panel (`src/admin/AdminApp.jsx`):** Permission-gated administrative interface for corpus health, model configuration, and analytics.

---

## 4. Initial Quality Gate Baseline

| Verification Check | Target | Result | Evidence |
|:---|:---|:---:|:---|
| **Vitest Shell Suite** | `src/shell/*.test.jsx` | **PASS** | 67/67 tests passing in 6.12s |
| **ESLint Static Analysis** | Entire repository | **PASS** | 0 errors, 0 warnings (`--max-warnings 0`) |
| **Vercel API Router** | `api/router.js` import | **PASS** | `router import ok` clean import |
| **Production Build** | `npm run build` (Vite) | **PASS** | Clean build in 24.32s; bundle gzip 122.32 kB (< 182.45 kB limit) |
| **CDP Screenshot Runner** | Headless Chrome 12 viewports | **PASS** | 12/12 screenshots captured with unique hashes and zero horizontal scroll |

---

## 5. Specialist Ownership & Execution Matrix

```
┌────────────────────────────────────────────────────────┐
│        Agent 0 — Integration Supervisor / Lead         │
└──────────────────────────┬─────────────────────────────┘
                           │
    ┌───────────────┬──────┴────────┬───────────────┐
    ▼               ▼               ▼               ▼
┌──────────┐  ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Agent 1  │  │ Agent 2  │    │ Agent 3  │    │ Agent 4  │
│ Auth &   │  │ Shell,   │    │ Chat,    │    │ Work &   │
│ Profile  │  │ Nav & UI │    │ RAG & AI │    │ Drafting │
└──────────┘  └──────────┘    └──────────┘    └──────────┘
    │               │               │               │
    ▼               ▼               ▼               ▼
┌──────────┐  ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Agent 5  │  │ Agent 6  │    │ Agent 7  │    │ Agent 0  │
│ Private  │  │ Billing, │    │ AI Evals │    │ Final    │
│ Files    │  │ Admin    │    │ & Safety │    │ Gate     │
└──────────┘  └──────────┘    └──────────┘    └──────────┘
```

Phase 0 audit is complete and verified. Specialists are authorized to proceed to Phase 1 through Phase 8 concurrent implementation and Phase 9 final release gate.
