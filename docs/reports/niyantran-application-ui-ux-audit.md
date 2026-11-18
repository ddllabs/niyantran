# Niyantran Application UI/UX Comprehensive Audit

> **Status: Normative Record**  
> **Component:** Application-Wide UI/UX Audit & Quality Assessment  
> **Author:** Principal Engineer / UI/UX Design & Frontend Specialist  
> **Scope:** File Manager, AI Research Panel, Terminal Shell, Desks & Modals  
> **Date:** 2026-11-18

---

## 1. Executive Summary

This audit evaluates the user experience, responsiveness, accessibility, typography, and visual polish across the entire Niyantran AI workbench, with focus on the File Manager (F341), AI Chat Panel, Attachment Tray, and modal interfaces.

---

## 2. Key Audit Observations & Recommendations

### 2.1 File Manager UI (`src/fileManager/`)
- **Visual Hierarchy & State Clarity:**
  - File status pills (`Uploaded`, `Indexing`, `Indexed`, `Failed`) use distinct background/border tokens matching the Niyantran design system.
  - Quota bar clearly displays both percentage and exact bytes (`X MB / 500 MB used`), preventing surprise upload rejections.
  - Drag-and-drop target zone provides clear hover states with animated dashed borders.
- **Responsive Layout:**
  - Table view smoothly shifts into card/list view on smaller screens ($\le 768\text{px}$).
  - Truncation on file names uses ellipsis with full title tooltip on hover to preserve readability.
- **Empty & Error States:**
  - Empty directory states feature contextual calls-to-action ("Upload PDF" or "New Folder").
  - Indexing failures show a tooltip explaining the reason (e.g., page limit exceeded or credit hold failure) with a direct "Retry" action.

### 2.2 Billing & Indexing Modal (`IndexConfirmationModal.jsx`)
- **Transparency & Trust:**
  - Clear distinction between the pre-flight authorization hold (40 credits / ₹0.40 per page) and actual settlement.
  - Upfront balance comparison: Shows user's current wallet balance, estimated hold required, and remaining balance post-hold.
  - In cases of insufficient funds, a direct link to the Credits top-up drawer is displayed.

### 2.3 AI Research Chat & Attachments (`src/ai/AttachmentTray.jsx`, `AiPanel.jsx`)
- **Attachment Ergonomics:**
  - Attached files appear in an interactive tray above the composer with thumbnail, file name, and one-click remove action.
  - Multiple file attachments display badge indicators.
  - Visual status icon indicates whether the attached file is full-text indexed (vector retrieval ready) or passed as raw metadata.
- **Citation Badges:**
  - Inline references to user files render distinct badge styling (e.g. `[Doc: Contract.pdf, p. 3]`) distinct from public web and legal corpus links.
  - Clicking a badge opens the document viewer overlay with automatic scroll-to-page.

### 2.4 Terminal Shell & Desktop Workbenches
- **Z-Index & Modal Stacking:** Modals and slide-over drawers use standardized z-index tokens (`z-40` for overlays, `z-50` for dialogs, `z-60` for toast alerts) to eliminate stacking conflicts.
- **Keyboard Navigation:** Escape closes modals, drawers, and context menus cleanly; Enter triggers default primary actions.
