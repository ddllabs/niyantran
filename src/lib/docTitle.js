/**
 * F52 (F171 B14): some stored document titles are malformed ("The Farmers (Old Age Allowance
 * Bill,2000": an unclosed bracket and no space before the year; 73 of 9,819 bill names have
 * unbalanced brackets and 352 lack the space). This tidies the safe cases for display only; titles
 * are never changed in the database, and ids, search and hashes keep the stored text.
 */
const ORDER_WORD = /\s+(Bill|Act|Ordinance)(,\s*\d{4}\.?)?$/;

export function tidyDocTitle(value) {
  let s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // "…Bill,2000" → "…Bill, 2000" (keeps a trailing full stop).
  s = s.replace(/,(\d{4})(\.?)$/, ', $1$2');
  const open = (s.match(/\(/g) || []).length;
  const close = (s.match(/\)/g) || []).length;
  if (open === close + 1) {
    // One bracket left open, nothing closed after it, and it ends "… Bill/Act/Ordinance, YEAR":
    // close it before that word.
    const lastOpen = s.lastIndexOf('(');
    const tail = s.slice(lastOpen);
    if (!tail.includes(')') && ORDER_WORD.test(tail)) s = s.slice(0, lastOpen) + tail.replace(ORDER_WORD, ') $1$2');
  } else if (close === open + 1 && s.endsWith(')')) {
    // One stray closing bracket at the very end: drop it.
    s = s.slice(0, -1).trimEnd();
  }
  return s;
}
