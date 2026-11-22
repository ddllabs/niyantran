// budget-ocr: which engine reads a Budget document (F409, docs/specs/2026-11-21-budget-ocr-text.md, decision 2026-11-22).
// On the Demand for Grants tables Mistral OCR drops the last year's value from every detail row, in markdown and in HTML;
// GPT-5 mini through OpenRouter returned every row and every section total exactly on the two trial documents (1 and 3
// pages). The developer's rule: the vision model for documents of 1 to VISION_MAX_PAGES pages (110 of the 116 held),
// Mistral for longer ones. This module is the one place the rule lives: the Edge function (handler.ts) chooses the call
// by it, and the runner's ocr-collect (scripts/bulk-runner/ocr_route.ts) labels the text by it. No imports, so the runner
// can use it without the function's other modules.

/** The longest document, in pages, the vision model reads. */
export const VISION_MAX_PAGES = 4;
/** The vision model, an exact OpenRouter id (one of the trial's models, trial.ts TRIAL_MODELS). */
export const VISION_MODEL = 'openai/gpt-5-mini';

export type BudgetOcrEngine = 'vision' | 'mistral';

/** The engine for a request of `expectedPages` pages: 1 to VISION_MAX_PAGES is the vision model, anything else Mistral. */
export function engineFor(expectedPages: number): BudgetOcrEngine {
  return Number.isInteger(expectedPages) && expectedPages >= 1 && expectedPages <= VISION_MAX_PAGES
    ? 'vision'
    : 'mistral';
}
