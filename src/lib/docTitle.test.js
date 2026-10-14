import { describe, expect, it } from 'vitest';
import { tidyDocTitle } from './docTitle.js';

// F52 (F171 B14): display-only tidy of malformed stored titles, safe cases only.
describe('tidyDocTitle', () => {
  it.each([
    ['The Farmers (Old Age Allowance Bill,2000', 'The Farmers (Old Age Allowance) Bill, 2000'],
    ['The Appropriation (No.4) Bill,2025', 'The Appropriation (No.4) Bill, 2025'],
    ['The Constitution (Amendment) Bill,2022.', 'The Constitution (Amendment) Bill, 2022.'],
    ['The Doubtful Voters (Special Provisions) Bill, 2020)', 'The Doubtful Voters (Special Provisions) Bill, 2020'],
    ['The  Data   Protection Bill, 2023', 'The Data Protection Bill, 2023'],
  ])('%s', (raw, want) => expect(tidyDocTitle(raw)).toBe(want));

  it('leaves what it cannot fix safely', () => {
    expect(tidyDocTitle('The Indian Telecom Privacy and Security) Bill, 2023')).toBe('The Indian Telecom Privacy and Security) Bill, 2023');
    expect(tidyDocTitle('विधेयक (संशोधन')).toBe('विधेयक (संशोधन');
  });

  it('is idempotent and safe on empty input', () => {
    const once = tidyDocTitle('The Farmers (Old Age Allowance Bill,2000');
    expect(tidyDocTitle(once)).toBe(once);
    expect(tidyDocTitle(null)).toBe('');
    expect(tidyDocTitle('')).toBe('');
  });
});
