# NTER Phase 2.1 — AI Chat & Work Mode Validation Report

**Modules:** AI Chat (`Agent 1`), Work Mode (`Agent 2`), Model Registry (`Agent 3`)  
**Status:** VALIDATED  
**Date:** 2026-11-20  

---

## 1. Chat Execution & Model Pipeline

### 1.1 OpenRouter & Model Inventory
The application sources enabled models from `public.ai_models` joined with OpenRouter availability from `public.model_pricing`:
- Anthropic Claude (`anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5`, `anthropic/claude-opus-5.5`)
- Google Gemini (`google/gemini-3.5-flash-lite`, `google/gemini-3.7-flash`, `google/gemini-3.1-pro`)
- DeepSeek (`deepseek/deepseek-v4-flash`)
- OpenAI (`openai/gpt-6-astra`)

No mock or placeholder provider labels exist in the model picker.

### 1.2 Model Switching & Context Preservation
- Tapping model pill opens the mobile bottom sheet modal.
- Selecting another model updates `modelChoice` in `AiPanel.jsx`.
- Existing conversation messages, active citations, and research focus remain intact without reloading the thread.

---

## 2. Chat-to-Work State Contract

| Attribute | Chat Source | Work Mode Destination | State Integrity |
|---|---|---|---|
| **Topic / Question** | `chat.title` or `user` message | `nter-carried-title` | Dynamic |
| **Cited Sources** | `research.sources` | `nter-carried-desc` | Derived (`sources.length`) |
| **Model Badge** | `picked.label` | `nter-carried-tag` | Real configured label |
| **Jurisdiction / Focus** | `focusMeta.en` | `nter-carried-tag` | Grounded focus |
| **Document Type** | Quick template click | `selectedTemplate` | Immediate reactivity |

---

## 3. Document Generation & Export

1. **Templates:**
   - `01` Case-law & citation note
   - `02` Legal notice
   - `03` Case brief
   - `04` Written submissions
   - `05` Chronology of facts
2. **Export Engine:**
   - Downloads `.doc` format via Blob `application/msword;charset=utf-8`.
   - Formatted with standard legal typography (`Calibri`, 1.5 line spacing, structured headings).
3. **Artifact Vaulting:**
   - `saveArtifactToFiles()` saves markdown brief to `AI Artifacts` in Private Files.
