import { describe, expect, it } from 'vitest';
import { shapeCabinetEnglishRows } from './textStyle.js';

// F125: the issuing body is shown as PIB names it; title-casing would turn "(CCEA)" into "(Ccea)".
describe('shapeCabinetEnglishRows', () => {
  it('keeps the issuing body exactly as the source names it', () => {
    const [row] = shapeCabinetEnglishRows([{ title: 'Cabinet approves the Example Scheme', ministry: 'Cabinet Committee on Economic Affairs (CCEA)' }]);
    expect(row.ministry).toBe('Cabinet Committee on Economic Affairs (CCEA)');
  });
});
