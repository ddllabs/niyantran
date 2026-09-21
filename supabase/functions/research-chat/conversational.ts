// A turn that asks nothing. The system prompt already tells the model to call no
// tool and return no follow-ups for greetings and small talk, and a real turn
// showed that asking is not enough: `hi`, sent with four attached rows, came
// back as a 2,342-character brief with three follow-up chips. The model had
// obeyed the no-tool half and ignored the rest.
//
// So the server decides instead of asking. Detection is deliberately narrow -
// an exact match against a short list, after normalisation - because the cost of
// a false positive is a real question answered as small talk, which is far worse
// than a greeting that gets the full treatment. Anything with a question mark,
// anything longer than a few words, and anything outside the list is an ordinary
// turn.

const GREETINGS = new Set([
  'hi',
  'hii',
  'hiii',
  'hey',
  'heya',
  'hello',
  'helo',
  'yo',
  'hi there',
  'hey there',
  'hello there',
  'good morning',
  'good afternoon',
  'good evening',
  'good day',
  'greetings',
  'namaste',
  'namaskar',
  'salaam',
  'thanks',
  'thank you',
  'thanks a lot',
  'thank you so much',
  'ty',
  'thx',
  'ok',
  'okay',
  'okey',
  'cool',
  'got it',
  'sure',
  'bye',
  'goodbye',
  'see you',
  'good night',
]);

/** Longest accepted greeting is short; anything wordier is a real turn. */
const MAX_WORDS = 4;
const MAX_CHARS = 24;

/**
 * True when the message asks nothing and is plainly small talk.
 *
 * Normalisation lower-cases, collapses whitespace and strips leading/trailing
 * punctuation and emoji-ish trailing characters, so "Hi!", "  hi  " and "hi..."
 * all reduce to "hi". Interior punctuation is left alone: "hi, what changed?"
 * keeps its comma, does not match the list, and is treated as a real question.
 */
export function isConversational(message: string | null | undefined): boolean {
  const raw = String(message ?? '');
  if (!raw.trim()) return false;
  if (raw.includes('?')) return false;
  if (raw.length > MAX_CHARS * 2) return false;

  const normalised = raw
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();

  if (!normalised || normalised.length > MAX_CHARS) return false;
  if (normalised.split(' ').length > MAX_WORDS) return false;
  return GREETINGS.has(normalised);
}
