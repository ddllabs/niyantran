# Supervisor review of the evaluation questions (set v1)

> **Status: Historical (dated 2026-09-30).** 40 questions drawn at random (a fixed-seed LCG)
> from `questions.v1.jsonl` and read against their gold passages, per the eval spec's
> "How the set is built", step 5. The bar is 38 of 40. **Result: 39 of 40 pass.**

**Rubric:** answerable from the passage (details from the document title allowed), specific
to it, and not trivial.

**Pass (39):**
q-0005, q-0006, q-0008, q-0011, q-0014, q-0015, q-0016, q-0017, q-0031, q-0033, q-0037,
q-0040, q-0042, q-0059, q-0067, q-0075, q-0095, q-0102, q-0106, q-0117, q-0119, q-0124,
q-0131, q-0132, q-0139, q-0140, q-0143, q-0144, q-0154, q-0156, q-0158, q-0161, q-0166,
q-0170, q-0178, q-0179, q-0192, q-0193, q-0195.

**Fail (1):** q-0172, "Which financial years are listed for project allocations or coverage
in the Sribhumi district of Assam?" The passage is a garbled OCR table, and the question is
trivial.

**Notes:**
- **Four checked against the full passage,** because the 700-character excerpt didn't show
  the answer: q-0040, q-0075, q-0102 and q-0143. The answers are later in the chunk.
- **Garbled but answerable:** q-0124, q-0193 and q-0195 come from OCR-garbled tables. Their
  answers are present but hard to read. This is the corpus as it is, and exactly what
  page-aware OCR is meant to improve.
- **Build figures** (`questions.v1.build-log.json`):
  - 195 lines: Bills 80, Regulatory 60, Parliamentary Questions 40, Industry 12, Budget 3;
  - 11 marked ambiguous;
  - 18 rejected by the judge, 111 drafts regenerated for 5-word copying;
  - generator `google/gemini-3.8-flash`, judge `anthropic/claude-sonnet-5`;
  - spend $0.54.
