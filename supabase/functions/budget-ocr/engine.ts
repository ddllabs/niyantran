// budget-ocr: which engine reads a Budget document (F409, docs/specs/2026-11-21-budget-ocr-text.md).
// Decision 2026-11-22: GPT-5 mini through OpenRouter for documents of 1 to 4 pages, Mistral OCR for longer ones (on the
// Demand for Grants tables Mistral drops the last year's value from detail rows, in markdown and in HTML).
// Decision 2026-11-23 (developer), after the full live run of 2026-11-22/23: Mistral (markdown tables) for EVERY Budget
// document. GPT-5 mini got the figures right in 80 of 108 documents (the totals check) but garbled the Hindi in 99 of 108,
// copying the PDFs' broken Hindi font layer; Mistral keeps the Hindi intact. So VISION_MAX_PAGES is 0 and engineFor never
// selects the vision model. The vision code (vision.ts, the cron path's branch in handler.ts) and the trial route
// (trial.ts) stay, for future comparisons; raising VISION_MAX_PAGES would route short documents to the vision model again.
// This module is the one place the rule lives: the Edge function (handler.ts) chooses the call by it, and the runner's
// ocr-collect (scripts/bulk-runner/ocr_route.ts) labels the text by it. No imports, so the runner can use it without the
// function's other modules.

/** The longest document, in pages, the vision model reads: 0, none (decision 2026-11-23). */
export const VISION_MAX_PAGES = 0;
/** The vision model, an exact OpenRouter id (one of the trial's models, trial.ts TRIAL_MODELS). */
export const VISION_MODEL = 'openai/gpt-5-mini';

export type BudgetOcrEngine = 'vision' | 'mistral';

/** The engine for a request of `expectedPages` pages: 1 to VISION_MAX_PAGES is the vision model, anything else Mistral. */
export function engineFor(expectedPages: number): BudgetOcrEngine {
  return Number.isInteger(expectedPages) && expectedPages >= 1 && expectedPages <= VISION_MAX_PAGES
    ? 'vision'
    : 'mistral';
}
