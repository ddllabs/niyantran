import { expect, it } from 'vitest';
import { isEditableCopy } from './copyPolicy.js';
const input = { closest: () => ({}) };
it('allows copy in inputs and nested editable content without changing record copy', () => {
  expect(isEditableCopy({ target: input })).toBe(true);
  expect(isEditableCopy({ target: { closest: () => null } })).toBe(false);
});
it('recognizes a document-targeted copy from the focused editor', () => {
  const document = { activeElement: input };
  expect(isEditableCopy({ target: document }, document)).toBe(true);
});
