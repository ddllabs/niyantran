import { describe, expect, it } from 'vitest';
import register from '../../public/data/embedded_csv/national_mp_report_card.json';
import { canonicalParty, isCabinetBody, mpHouseOf, shapeMpRows } from './parliament.js';

// F125: PIB names each release's issuing body; only the Cabinet and its committees issue decisions.
describe('isCabinetBody', () => {
  it('recognises the Cabinet and its committees as PIB names them', () => {
    for (const name of ['Cabinet', 'Cabinet Committee on Economic Affairs (CCEA)', 'Cabinet Committee on Security', 'Appointments Committee of the Cabinet', 'Cabinet Committee on Economic Affairs']) {
      expect(isCabinetBody(name), name).toBe(true);
    }
  });

  it('rejects ministries, the Cabinet Secretariat and the publisher', () => {
    for (const name of ['Cabinet Secretariat', 'Ministry of Finance', 'Prime Minister\'s Office', 'Press Information Bureau', 'PIB Backgrounder', '', null, 'मंत्रिमंडल सचिवालय']) {
      expect(isCabinetBody(name), String(name)).toBe(false);
    }
  });

  it('recognises the Hindi Cabinet names as a fallback', () => {
    expect(isCabinetBody('मंत्रिमंडल')).toBe(true);
    expect(isCabinetBody('आर्थिक मामलों की मंत्रिमंडलीय समिति')).toBe(true);
  });
});

// F126: the house comes from the member's own Sansad link; party names are unified only where the
// full name and the abbreviation are certainly the same party, and the original is kept.
describe('MP register shaping', () => {
  it('reads the house from the sansad.in link and leaves anything else empty', () => {
    expect(mpHouseOf('https://sansad.in/ls/members/biographyM/5241')).toBe('Lok Sabha');
    expect(mpHouseOf('https://sansad.in/rs/members/rs-member-details/2554')).toBe('Rajya Sabha');
    expect(mpHouseOf('https://example.org/ls/x')).toBe('');
    expect(mpHouseOf('http://sansad.in/ls/x')).toBe('');
    expect(mpHouseOf('')).toBe('');
  });

  it('unifies full names with the abbreviations the Lok Sabha rows use', () => {
    expect(canonicalParty('Bharatiya Janata Party')).toBe('BJP');
    expect(canonicalParty('Indian National Congress')).toBe('INC');
    expect(canonicalParty('All India Trinamool Congress')).toBe('AITC');
    expect(canonicalParty('Yuvajana Sramika Rythu Congress Party')).toBe('YSRCP');
    expect(canonicalParty('YSR Congress Party')).toBe('YSRCP');
    expect(canonicalParty('BJP')).toBe('BJP');
  });

  it('leaves a name that could mean two parties exactly as held', () => {
    for (const name of ['Shiv Sena', 'Nationalist Congress Party', 'Independent & Others', 'Some New Party']) expect(canonicalParty(name), name).toBe(name);
  });

  it('shapes the real register: every house matches its link, and the original party is kept', () => {
    const shaped = shapeMpRows(register);
    expect(shaped).toHaveLength(register.length);
    expect(shaped.filter((r) => r.house === 'Lok Sabha')).toHaveLength(540);
    expect(shaped.filter((r) => r.house === 'Rajya Sabha')).toHaveLength(242);
    for (const [i, r] of shaped.entries()) expect(r.party_raw, r.mp_name).toBe(register[i].party);
    expect(shaped.filter((r) => r.party === 'BJP').length).toBe(354); // 240 abbreviated + 114 full names
    expect(register[0]).not.toHaveProperty('party_raw'); // the input is not mutated
  });
});
