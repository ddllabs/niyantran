# NTER PHASE 2: MASTER ORCHESTRATION — PHASE 1 SHELL ACCEPTANCE
## Shared Mobile Shell, Header, Navigation Drawer & Responsive Foundation

> **Status: Normative Record**  
> **Phase:** Phase 2 — Orchestrated Platform Implementation  
> **Stage:** Phase 1 — Shared Shell & Mobile Foundation  
> **Lead:** Agent 2 — Home, Terminal Shell & Navigation  
> **Reviewer:** Agent 0 — Integration Supervisor  
> **Date:** 2026-11-20  
> **Quality Gate:** **APPROVED (PASS)**

---

## 1. Scope & Execution Overview

Phase 1 establishes the unified navigation shell and mobile header architecture required by the approved NTER Lawyer Mobile Journey (`terminal-lawyer-mobile-journey.pdf`) and the authoritative reference screenshots.

### Deliverables Audited & Verified:
1. `src/shell/MobileHeader.jsx`:
   - Left: 44×44px hamburger menu trigger (`☰`) with ARIA label and touch-friendly padding.
   - Center: Segmented control `[ Chat | Work ]` pill with elevated active white pill styling, subtle drop shadows, and responsive typography.
   - Right: NTER brand mark / Pi logo in Chat mode; Document drafting icon in Work mode.
   - Safe-area insets (`--sat`, `--sal`, `--sar`) preventing clipping under device notches.
2. `src/shell/mobileNav.css`:
   - Mobile-first media query constraints (`@media (max-width: 768px)` vs `@media (min-width: 768px)`).
   - Zero horizontal overflow (`docWidth <= winWidth`).
   - Clean dismissal and display states.
3. `src/shell/TerminalShell.jsx`:
   - State management for `aiMode` ('chat' | 'work') and listener for global event `niy-ai-mode`.
   - Wiring of mobile hamburger button to `DeskRail` navigation drawer (`railOpen = true`).
   - Total isolation of desktop workbench (`>= 768px`) with mobile header suppressed.
4. `src/shell/mobileHeader.test.jsx`:
   - 4/4 passing unit tests covering landmark banner role, hamburger clicks, segmented tab switching, ARIA controls, and Hindi localization.
5. Headless Chrome CDP Verification:
   - 12 verified browser screenshots in `docs/qa/screenshots/step-1/` covering 320px to 1440px viewports.

---

## 2. Cross-Module Contract Specifications

### Contract 1: Chat–Work Navigation Bus
```typescript
interface NiyAiModeEventDetail {
  mode: 'chat' | 'work';
}

// Window Event Contract:
window.addEventListener('niy-ai-mode', (e: CustomEvent<NiyAiModeEventDetail>) => {
  // Synchronizes header active pill and switches views in AiPanel
});
```
- **Guarantees:**
  - Tapping `Chat` activates Chat mode without resetting research messages, active citations, or selected models.
  - Tapping `Work` opens `DocumentDraftingSurface` while carrying over all research context from the thread.
  - Tapping `Work` does NOT clear any draft text when toggled back and forth.

### Contract 2: Mobile Navigation Drawer (`DeskRail`)
```typescript
interface DeskRailContract {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDesk: (deskId: string) => void;
  tabs: Array<{ id: string; label: string; labelHi: string }>;
}
```
- **Guarantees:**
  - Hamburger trigger opens drawer over the page regardless of current desk or home status.
  - Dismissible via backdrop scrim tap, close toggle, or `Escape` key.
  - Focus is trapped within drawer while open and returned to trigger on close.

---

## 3. Viewport Verification & Evidence Audit

| Viewport | Mode | Dimensions | Size | Hash (SHA-256) | Status |
|:---|:---|:---|:---|:---|:---:|
| iPhone 13 mini | Chat | 375×812 | 337.3 KB | `961589c3...` | **PASS** |
| iPhone 13 mini | Work | 375×812 | 404.6 KB | `a05d895e...` | **PASS** |
| iPhone 13 mini | Drawer | 375×812 | 419.9 KB | `c9bddce2...` | **PASS** |
| iPhone SE | Min Mobile | 320×568 | 108.5 KB | `bfd366ec...` | **PASS** |
| Galaxy S8 | Standard Android | 360×640 | 122.2 KB | `bc987e33...` | **PASS** |
| iPhone 14 Pro | Storyboard Ref | 390×844 | 485.3 KB | `e9b3f0b6...` | **PASS** |
| iPhone XR/Plus | Large Mobile | 414×896 | 572.1 KB | `8e5ade8f...` | **PASS** |
| iPhone 15/16 Pro Max | Max Mobile | 430×932 | 631.8 KB | `81a8f96e...` | **PASS** |
| iPad Mini | Tablet Boundary | 768×1024 | 1.27 MB | `10f924b1...` | **PASS** |
| iPad Pro / Laptop | Small Desktop | 1024×768 | 1.51 MB | `86d1ee8c...` | **PASS** |
| Laptop 13" | Standard Laptop | 1280×800 | 1.71 MB | `82f9c8bf...` | **PASS** |
| Desktop Display | Full Workbench | 1440×900 | 2.18 MB | `a5ea3c9a...` | **PASS** |

---

## 4. Acceptance Declaration

Phase 1 is formally **ACCEPTED** by Agent 0 (Supervisor) and Agent 2 (Shell Owner). The shared shell foundation satisfies all responsiveness, ergonomics, and visual hierarchy criteria.
