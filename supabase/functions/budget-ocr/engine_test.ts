import { assert, assertEquals } from 'jsr:@std/assert@1';
import { engineFor, VISION_MAX_PAGES, VISION_MODEL } from './engine.ts';
import { LEASE_SECONDS, OCR_TIMEOUT_MS } from './handler.ts';
import { TRIAL_MODELS, TRIAL_PDF_TIMEOUT_MS, TRIAL_TIMEOUT_MS } from './trial.ts';
import { splitVisionPages, VISION_MAX_TOKENS, VISION_PDF_TIMEOUT_MS, VISION_TIMEOUT_MS } from './vision.ts';

// ─── The engine rule (developer decision 2026-11-23) ─────────────────────────

Deno.test('engineFor: every Budget document is Mistral, whatever its page count (1, 4 and 5 pages included)', () => {
  assertEquals(VISION_MAX_PAGES, 0);
  for (const n of [1, 2, 3, 4, 5, 6, 11, 62, 1000]) assertEquals(engineFor(n), 'mistral', String(n));
});

Deno.test('engineFor: a page count that is not a whole number of at least 1 is never the vision model', () => {
  for (const n of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) assertEquals(engineFor(n), 'mistral', String(n));
});

Deno.test('the vision model is GPT-5 mini, one of the models the trial proved', () => {
  assertEquals(VISION_MODEL, 'openai/gpt-5-mini');
  assert(TRIAL_MODELS.includes(VISION_MODEL));
});

// ─── Time limits ─────────────────────────────────────────────────────────────

Deno.test('the vision call keeps the trial limits, and the longest path fits the lease and the Free-plan wall clock', () => {
  assertEquals(VISION_TIMEOUT_MS, TRIAL_TIMEOUT_MS);
  assertEquals(VISION_PDF_TIMEOUT_MS, TRIAL_PDF_TIMEOUT_MS);
  assertEquals(VISION_MAX_TOKENS, 32_000);
  // Both claims run at once (runOnce awaits them together), so one invocation lasts as long as its slowest request.
  const slowest = Math.max(VISION_PDF_TIMEOUT_MS + VISION_TIMEOUT_MS, OCR_TIMEOUT_MS);
  assert(slowest <= 140_000, String(slowest));
  // Under the 300 s lease, and with at least 10 s left for the claim and the report under the 150 s Free-plan limit.
  assert(slowest < LEASE_SECONDS * 1000);
  assert(slowest + 10_000 <= 150_000);
});

// ─── The page split ──────────────────────────────────────────────────────────

Deno.test('splitVisionPages: exactly n markers numbered 1 to n give n page texts, the marker lines removed', () => {
  assertEquals(splitVisionPages('=== PAGE 1 ===\nA\n\n=== PAGE 2 ===\n| a | b |\n=== PAGE 3 ===\n', 3), [
    'A',
    '| a | b |',
    '',
  ]);
  assertEquals(splitVisionPages('\n  \n=== PAGE 1 ===\r\nonly\r\n', 1), ['only']);
  assertEquals(splitVisionPages('  === PAGE 1 ===  \nx\n=== PAGE 2 ===\ny', 2), ['x', 'y']);
});

Deno.test('splitVisionPages: a wrong count, an order other than 1 to n, or text before page 1 is no split', () => {
  const four = '=== PAGE 1 ===\na\n=== PAGE 2 ===\nb\n=== PAGE 3 ===\nc\n=== PAGE 4 ===\nd';
  assertEquals(splitVisionPages(four, 4)?.length, 4);
  assertEquals(splitVisionPages(four, 3), null);
  assertEquals(splitVisionPages(four, 5), null);
  assertEquals(splitVisionPages('=== PAGE 1 ===\na\n=== PAGE 3 ===\nb', 2), null);
  assertEquals(splitVisionPages('=== PAGE 2 ===\na\n=== PAGE 1 ===\nb', 2), null);
  assertEquals(splitVisionPages('=== PAGE 1 ===\na\n=== PAGE 1 ===\nb', 2), null);
  assertEquals(splitVisionPages('Here is the transcription.\n=== PAGE 1 ===\na', 1), null);
  assertEquals(splitVisionPages('no markers at all', 1), null);
  // A marker inside a line is text, not a page break.
  assertEquals(splitVisionPages('=== PAGE 1 ===\nsee === PAGE 2 === below', 2), null);
});
