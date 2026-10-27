// Provider control tokens are not answers. Ordinary prose mentioning them is valid.
const PLACEHOLDERS = ['llm_result'];
export function placeholderAnswer(text: string): boolean {
  return PLACEHOLDERS.includes(text.trim().toLowerCase());
}
export function placeholderPrefix(text: string): boolean {
  const prefix = text.trimStart().toLowerCase();
  return PLACEHOLDERS.some(token => token.startsWith(prefix) || token === prefix.trimEnd());
}

/** Reject visually empty provider output before server notices can mask it.
 * Short substantive answers remain valid; this is structural, not fact checking. */
export function hasAnswerContent(text: string): boolean {
  if (placeholderAnswer(text)) return false;
  const visible = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_entity, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&(?:nbsp|#160|#x0*a0|#8203|#x200b);/gi, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/(?:^|\n)\s*#{1,6}[^\n]*(?=\n|$)/g, '')
    .replace(/\*\*(?:Search widened|Unverified|Observation scope|Web context unavailable)\.\*\*[^\n]*(?=\n|$)/gi, '')
    .replace(/\[(?:\d+|ref:[^\]]+)\](?:\([^)]*\))?/g, '')
    .replace(/[\s*_`~#>|\-]/g, '');
  return /[\p{L}\p{N}]/u.test(visible);
}
