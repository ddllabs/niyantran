import { describe, expect, it } from 'vitest';
import register from '../../public/data/embedded_csv/national_mp_report_card.json';
import { cabinetPrefers, cabinetReleaseGroup, canonicalParty, isCabinetBody, mpHouseOf, pickReleasePairs, shapeMpRows } from './parliament.js';

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

// F187: PIB publishes one decision twice on one day, as the ministry's release and as the Cabinet's
// or the CCEA's. These are two of the 62 pairs in backup/NATIONAL/F25_Cabinet_Decisions.xlsx
// (titles and bodies as held; the ministry release has the higher PRID in both).
describe('pickReleasePairs (F187)', () => {
  const NH22 = 'Cabinet approves Upgradation of the Muzaffarpur-Sitamarhi-Sonbarsa Section of NH-22 to 4-Lane Standard in Bihar on Hybrid Annuity Mode (HAM) at total Capital Cost of Rs.3590.73 crore';
  const GOBAR = 'Cabinet approves GOBARdhan, India’s National Unified Scheme for Compressed Biogas, with an outlay of Rs.23,731 crore';
  const release = (prid, date, title, ministry) => ({ prid, date, title, ministry, source_url: `https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}` });

  it('keeps the Cabinet committee release of a real pair, whichever came first', () => {
    const ministry = release('2301145', '2026-08-19', NH22, 'Ministry of Road Transport & Highways');
    const ccea = release('2301144', '2026-08-19', NH22, 'Cabinet Committee on Economic Affairs (CCEA)');
    expect(pickReleasePairs([ministry, ccea])).toEqual([ccea]);
    expect(pickReleasePairs([ccea, ministry])).toEqual([ccea]);
  });

  it('keeps the Cabinet release over a lower-numbered ministry release', () => {
    const ministry = release('2295480', '2026-08-06', GOBAR, 'Ministry of Petroleum & Natural Gas');
    const cabinet = release('2295494', '2026-08-06', GOBAR, 'Cabinet');
    expect(pickReleasePairs([cabinet, ministry])).toEqual([cabinet]);
  });

  it('keeps the lower PRID when neither or both releases are the Cabinet\'s', () => {
    const a = release('2301143', '2026-08-19', NH22, 'Ministry of Railways');
    const b = release('2301142', '2026-08-19', NH22, 'Ministry of Road Transport & Highways');
    expect(pickReleasePairs([a, b])).toEqual([b]);
    const c = release('2301150', '2026-08-19', NH22, 'Cabinet');
    const d = release('2301149', '2026-08-19', NH22, 'Cabinet Committee on Economic Affairs (CCEA)');
    expect(pickReleasePairs([c, d])).toEqual([d]);
  });

  it('matches a title regardless of case and spacing, and a PRID found only in the link', () => {
    const a = { ...release('', '2026-08-19', NH22, 'Cabinet'), prid: undefined, source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301144' };
    const b = { ...release('2301145', '2026-08-19', `  ${NH22.toUpperCase()}  `.replace(/ /g, '  '), 'Ministry of Road Transport & Highways') };
    expect(pickReleasePairs([b, a])).toEqual([a]);
  });

  it('keeps both when the day differs, the title differs, or the day or title is missing', () => {
    const a = release('1', '2026-08-19', NH22, 'Cabinet');
    expect(pickReleasePairs([a, release('2', '2026-08-20', NH22, 'Cabinet')])).toHaveLength(2);
    expect(pickReleasePairs([a, release('3', '2026-08-19', `${NH22} (corrigendum)`, 'Cabinet')])).toHaveLength(2);
    expect(pickReleasePairs([release('4', '', NH22, 'Cabinet'), release('5', '', NH22, 'Cabinet')])).toHaveLength(2);
    expect(pickReleasePairs([release('6', '2026-08-19', '', 'Cabinet'), release('7', '2026-08-19', '', 'Cabinet')])).toHaveLength(2);
  });

  it('keeps the order of the rows it keeps (newest first stays newest first)', () => {
    const newest = release('30', '2026-08-20', 'Cabinet approves the newest scheme', 'Cabinet');
    const pairA = release('22', '2026-08-19', NH22, 'Ministry of Road Transport & Highways');
    const pairB = release('21', '2026-08-19', NH22, 'Cabinet Committee on Economic Affairs (CCEA)');
    const oldest = release('10', '2026-08-06', GOBAR, 'Cabinet');
    expect(pickReleasePairs([newest, pairA, pairB, oldest]).map((r) => r.prid)).toEqual(['30', '21', '10']);
  });

  it('is safe on empty and odd input and does not change its input', () => {
    expect(pickReleasePairs([])).toEqual([]);
    expect(pickReleasePairs(null)).toEqual([]);
    const rows = [release('1', '2026-08-19', NH22, 'Cabinet'), release('2', '2026-08-19', NH22, 'Ministry of Railways')];
    const copy = JSON.parse(JSON.stringify(rows));
    pickReleasePairs(rows);
    expect(rows).toEqual(copy);
  });

  it('exposes the group key and preference the register loader shares', () => {
    expect(cabinetReleaseGroup({ title: ' A  B ', date: '2026-08-19' })).toBe(cabinetReleaseGroup({ title: 'a b', date: '2026-08-19T05:00:00Z' }));
    expect(cabinetReleaseGroup({ title: 'A', date: '' })).toBe('');
    expect(cabinetPrefers({ ministry: 'Cabinet', prid: '9' }, { ministry: 'Ministry of Railways', prid: '1' })).toBe(true);
    expect(cabinetPrefers({ ministry: 'Ministry of Railways', prid: '1' }, { ministry: 'Ministry of Power', prid: '2' })).toBe(true);
  });
});
