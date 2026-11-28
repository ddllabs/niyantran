# NTER Phase 4 — Chat, AI Research & Model Picker Verification Report

> **Status: Historical (2026-11-20).** From the contributor's file-manager branch (a4a09d84); records work as it stood then.

**Module:** Chat & AI Research (`Agent 3`)  
**Branch status:** ACCEPTED  
**Date:** 2026-11-20  
**Authority:** `terminal-lawyer-mobile-journey.pdf` (Reference Images 1, 2, 3) & `AGENTS.md`  

---

## 1. Executive Summary

Phase 4 validates the mobile AI research experience, matching the authoritative storyboard reference images:
- **Reference Image 1:** "Ask the live record" empty hero with `PERSONALISED` crimson badge, centered artistic `π` logo, `FIND AUTHORITY` / `TRACK MATTER` prompt cards, `FOCUS THIS CHAT` pills (`LAW`, `ORDER ARCHIVES`), and rounded composer.
- **Reference Image 2:** "Choose a model" bottom sheet modal with dark scrim, drag handle, close button, and the six standard models: `NYAI Pro` (deep research), `NYAI Lite` (fast research), `DeepSeek` (analysis), `GPT` (reasoning), `Gemini` (multimodal), and `Claude` (nuanced analysis).
- **Reference Image 3:** Grounded AI research answer card featuring `[NP] NYAI PRO • LAW FOCUS`, metric badges (`23 records searched`, `3 sources opened`, `7 citations found`), bold ratio heading, summary, structured Authority cards with pinpoint citations (`¶ 42`, `¶¶ 18–21`), and interactive source trail link (`● 7 cited sources`).

---

## 2. Technical Implementation Details

### 2.1 Empty Chat Hero (`src/ai/AiPanel.jsx` & `src/ai/mobileChatJourney.css`)
- Renders `.nter-empty-chat-hero` when thread is empty and agent is ready.
- Two clickable prompt triggers (`FIND AUTHORITY`, `TRACK MATTER`) populate the draft input without forcing a blank screen.
- Focus bar (`.nter-focus-chat-bar`) allows legal researchers to constrain retrieval to Law feeds and Order archives directly on mobile.

### 2.2 Mobile Model Picker Sheet (`src/ai/ModelPicker.jsx`)
- Uses React Portals (`createPortal(..., document.body)`) to render `.nter-mob-model-sheet-backdrop` anchored to the mobile viewport base.
- Provides immediate selection feedback with blue checkmark badge.
- Desktop viewports maintain the multi-vendor dropdown hierarchy without alteration.

### 2.3 Grounded Citations & Evidence Architecture
- Adheres to `research-chat/validate.ts` retrieval constraints.
- Retains sources across model switching ("Switch any time. Your sources stay attached.").
- Pinpoint references link directly to primary gazette notices and judicial orders.

---

## 3. Verification Evidence

- 0 ESLint errors/warnings.
- Router import clean.
- Vitest tests green.
