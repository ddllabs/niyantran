// Provider control tokens are not answers. Ordinary prose mentioning them is valid.
const PLACEHOLDERS = ['llm_result'];
export function placeholderAnswer(text: string): boolean {
  return PLACEHOLDERS.includes(text.trim().toLowerCase());
}
export function placeholderPrefix(text: string): boolean {
  const prefix = text.trimStart().toLowerCase();
  return PLACEHOLDERS.some(token => token.startsWith(prefix) || token === prefix.trimEnd());
}
