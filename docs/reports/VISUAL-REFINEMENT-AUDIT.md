# NTER Mobile — Visual Refinement, Brand Consistency & UI/UX Audit

> **Status:** Normative Visual Audit  
> **Author:** Antigravity Principal UI/UX Architect & Multi-Agent Orchestration Team  
> **Date:** 2026-11-23  
> **Target Applications:** NTER Mobile (`nter-mobile/src/`), Workbench Shell (`src/shell/`, `src/ai/`)  
> **Scope:** Phase 1 Visual Inspection, Brand Assets, Typography Scale, Layout & Metadata Integrity

---

## 1. Executive Summary

This audit establishes the baseline visual inspection of the NTER Mobile platform following acceptance testing (Screenshots 01–31). While the core 8-screen lawyer journey, document ingestion, and multi-file RAG pipelines are functionally verified, several prominent visual and ergonomic defects degrade the user experience:

1. **Oversized Terminal Logo Overlap:** An unconstrained 128×128 image asset (`/brand/logo-128.webp`) is rendered in `Ask.jsx:AskHeader` without width/height dimensions or CSS classes in `app.css`, causing it to overflow the 52px header and appear clipped/distorted behind interactive controls.
2. **Document Masthead Proportions:** In `Studio.jsx` (Document Editor), the masthead logo (`.pb-pi`) is unstyled and renders at full 128px intrinsic size, dominating the legal document paper and crowding out the document title.
3. **Metadata Label Concatenations:**
   - In `Studio.jsx`, research tags render as `LAWORDER ARCHIVESNYAI PRO` due to missing flex layout and padding on `.co-tags-row` and `.co-tag`.
   - In `Ask.jsx`, legal authority cards render title and verification status as a concatenated string (`Authority 01 · Supreme Court orderVerified`) because `.auth-card-top`, `.auth-card-title`, and `.auth-status-pill` lack flex layout, margins, and tag styling.
4. **Typographic Density & Excessive Weight:** Response bodies, user bubbles, and card contents overuse 600/700 font weights, creating visual noise and reducing legal document legibility.
5. **Attachment Picker & Action Overflow:** Action buttons and modal footers require normalized safe-area padding to prevent clipping on compact (360px) and standard (390px) mobile viewports.

---

## 2. Component-by-Component Root Cause Analysis

| Finding ID | Component & File | Observed Problem | Root Cause | Proposed Correction | Regression Risk |
|---|---|---|---|---|:---:|
| **AUD-LOGO-01** | `AskHeader` (`Ask.jsx:58-61`) | Oversized, partially visible Terminal logo behind/beside ChatWork header. | `<img className="hd-pi-icon">` has no CSS rule in `app.css`; renders at 128×128 inside a 52px flex row. | Add `.hd-right-brand { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }` and `.hd-pi-icon { width: 24px; height: 24px; object-fit: contain; }`. | Very Low |
| **AUD-LOGO-02** | `Empty` Hero (`Ask.jsx:243-245`) | Chat empty state logo icon renders unconstrained. | `.pi-center-icon img` lacks explicit dimensions. | Constrain `.pi-center-icon img` to 36×36 px with subtle accent glow and proper clear space. | Very Low |
| **AUD-LOGO-03** | `Editor` Masthead (`Studio.jsx:199-205`) | Document paper masthead has giant logo and tall header crowding out document title. | `.paper-brand-hd`, `.pb-brand`, `.pb-pi`, and `.pb-type` lack CSS rules. `.pb-pi` renders at 128px. | Add `.paper-brand-hd` flex styling; constrain `.pb-pi` to 18×18 px; restrain typography to 11px uppercase monospace masthead. | Low |
| **AUD-META-01** | `CarriedOverCard` (`Studio.jsx:304-308`) | Tags concatenate into `LAWORDER ARCHIVESNYAI PRO`. | `Studio.jsx` uses `.co-tags-row` and `.co-tag` whereas `app.css` defined `.carried-over-chips .pill`. | Style `.co-tags-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }` and `.co-tag` with background, border-radius, and font styling. | Very Low |
| **AUD-META-02** | `AuthorityCard` (`Ask.jsx:391-406`) | Card header renders as `Authority 01 · Supreme Court orderVerified`. | `.auth-card-top`, `.auth-card-title`, and `.auth-status-pill` lack CSS rules. Inline spans collapse without gap. | Add `.auth-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }` and style `.auth-status-pill` as a distinct status pill. | Very Low |
| **AUD-TYPO-01** | Global Typography (`app.css`, `kit.jsx`) | Interface feels dense and heavy; AI responses and paragraphs use heavy weights. | Lack of strict design-token typography scale; body text inheriting heavy weights; excessive bolding in Markdown. | Implement central typography scale (24px 600, 20px 600, 16px 600, 15px 600, 14px 400, 13px 400, 12px 400, 11px 500); enforce normal 400 weight on `.user-text` and `.body-md p`. | Low |
| **AUD-RESP-01** | Attachment Picker & Footer (`SheetHost.jsx`) | Action buttons risk clipping on 360px viewport or overlapping home indicator. | Bottom action areas lacking explicit `env(safe-area-inset-bottom)` clearance and minimum 44px tap targets. | Apply `padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px))` and min-height 44px on primary CTA buttons. | Very Low |

---

## 3. Brand Consistency & Design Tokens Strategy

### 3.1 Approved Terminal Brand Assets
- **Primary Logo:** `/brand/logo-128.webp` (Terminal Pi mark). Aspect ratio: strictly 1:1 square.
- **Allowed Header Sizing:** 24 × 24 px (header action), 32 × 32 px (welcome/login avatar), 18 × 18 px (document masthead).
- **Prohibited Treatments:** Unconstrained width/height, stretching, background watermark scaling $> 48\text{px}$, or overlapping title bars.

### 3.2 Restrained Typographic Scale
- **Main Heading:** 24px, weight 600, line-height 1.25
- **Secondary Heading:** 20px, weight 600, line-height 1.3
- **Card Heading:** 16px, weight 600, line-height 1.35
- **Section Heading:** 15px, weight 600, line-height 1.4
- **Standard Body Text:** 14px, weight 400, line-height 1.55 (Inter)
- **Supporting Text:** 13px, weight 400, line-height 1.5
- **Metadata:** 12px, weight 400, line-height 1.4 (JetBrains Mono / Inter)
- **Small Badges & Pills:** 11px, weight 500, line-height 1.3
- **Buttons & Action Pills:** 13.5–14px, weight 600, height $\ge 40\text{px}$

---

## 4. Remediation Plan & Workstream Division

- **Workstream 1:** Brand Assets, Logo Sizing & Mastheads (`Ask.jsx`, `Studio.jsx`, `app.css`).
- **Workstream 2:** ChatWork UI, Metadata De-concatenation & Citation Cards (`Ask.jsx`, `chat.jsx`, `app.css`).
- **Workstream 3:** Central Design System Tokens, Typography & Layout Ergonomics (`app.css`, `SheetHost.jsx`, `FileManager.jsx`).
- **Workstream 4:** Visual Verification Harness, 21 Fresh Screenshots & Result Report (`scripts/smoke-visual-refinement.mjs`).
