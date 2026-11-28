# NTER Phase 8 — AI Quality, Guardrails & Evaluation Report

**Module:** AI Quality & Evaluation (`Agent 7`)  
**Status:** ACCEPTED  
**Date:** 2026-11-20  
**Authority:** `docs/specs/retrieval-eval.md` & `AGENTS.md`  

---

## 1. Executive Summary

Phase 8 verifies AI safety, citation groundedness, refusal behavior, and benchmark adherence for legal and regulatory research.

---

## 2. Evaluation Criteria & Quality Gates

### 2.1 Groundedness & Citation Strictness
- Prohibits fabricated citations, hallucinated page numbers, and fake docket numbers.
- If a legal proposition or order is absent from the indexed corpus, the assistant strictly returns "Not in record."
- Citations must include primary gazette or court registry references (`isReadableCitation`).

### 2.2 Domain Guardrails
- Refuses financial recommendations (buy/sell/hold).
- Adheres to Indian jurisdictional constraints (Supreme Court of India, Delhi High Court, Bombay High Court, NCLAT).

---

## 3. Verification Evidence

- Evaluation datasets under `eval/retrieval/` verified.
- Citations validated through `ActivityTicker.jsx` and `SourceList.jsx`.
