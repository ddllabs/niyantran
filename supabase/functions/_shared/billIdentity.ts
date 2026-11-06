// The owner's text check for a bill (F275): does the opening text show this is the bill it claims to be? The bulk
// runner calls this before registration and records the result as review check `bill_identity`; a collection's policy
// decides whether that check is required. Spec: docs/specs/2026-11-07-bills-adapter.md.
//
// Measured on 2,764 live bills: an as-passed bill shows its title or number 99.6% of the time, and an as-introduced bill
// 84%. A gazette notification names the Act, not the bill, so it cannot pass (1%). Synopses and errata are exempt too:
// they link by key and do not establish identity.
const IDENTITY_ROLES = new Set(['as_introduced', 'as_passed_lok_sabha', 'as_passed_rajya_sabha', 'as_passed_both_houses']);
const OPENING_CHARS = 6000;
const MIN_TITLE_CHARS = 12;

const letters = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

export interface BillTextIdentity {
  /** False for roles that cannot establish identity: the check says nothing about them. */
  applies: boolean;
  title: boolean;
  number: boolean;
  /** Title or number found. Not applicable counts as passing, since nothing was checked. */
  pass: boolean;
}

export function billTextIdentity(text: string, bill: { number: string; name: string }, role: string): BillTextIdentity {
  const opening = text.slice(0, OPENING_CHARS);
  const name = letters(bill.name.replace(/,?\s*\d{4}\s*\.?\s*$/, ''));
  const title = name.length >= MIN_TITLE_CHARS && letters(opening).includes(name);
  const digits = bill.number.replace(/\W/g, '');
  const number = digits !== '' && new RegExp(`bill\\s*no\\.?\\s*${digits}\\b`, 'i').test(opening);
  const applies = IDENTITY_ROLES.has(role);
  return { applies, title, number, pass: !applies || title || number };
}
