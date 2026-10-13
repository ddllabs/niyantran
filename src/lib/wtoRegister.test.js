import { describe, expect, it } from 'vitest';
import { memberName, parseStatuses, parseWtoRegister, wtoText } from './wtoRegister.js';

// F129 L2: the WTO register is read from the WTO's own data files, as text, never executed.
const ARRAYS = `
var ds_status = new Array();
ds_status[ds_status.length] = {
    status_code: "ST1",
    status_name: "In consultations"
};
//ds_status[ds_status.length] = { status_code: "ST14", status_name: "Settled or terminated (withdrawn, mutually agreed solution)", status_highlight: false };
ds_status[ds_status.length] = {
    status_code: "ST9",
    status_name: "Report(s) adopted, with recommendation to bring measure(s) into conformity"
};
var ds_agreement = new Array();
ds_agreement[1] = {
    agreement_id: "A9",
    agreement_name: "General Agreement on Tariffs and Trade 1994",
    agreement_short_name: "GATT 1994",
    agreement_url: "gatt_e.htm"
};
ds_agreement[2] = {
    agreement_id: "A11",
    agreement_name: "Agreement on Import Licensing Procedures",
    agreement_short_name: "Import Licensing",
    agreement_url: "il_e.htm"
};`;

const CASES = `
var ds_array = new Array();
ds_array[1] = {
    code: "DS1",
    title: "Prohibition of Imports of Polyethylene and Polypropylene",
    origin: "SGP",
    destination: "MYS",
    start_date: "1995/01/10",
    short_title: "",
    agreement: "A9_885#A9_889#A11_121",
    update_date: "2010/02/24",
    status: "ST14#1995_03_29",
    third_party: "",
    reports_adopted: "FALSE"
};
ds_array[600] = {
    code: "DS600",
    title: "Certain Measures Concerning Palm Oil and Oil Palm Crop-Based Biofuels",
    origin: "MYS",
    destination: "EEC",
    start_date: "2021/01/15",
    short_title: "EU and certain Member States &mdash; Palm Oil (Malaysia)",
    agreement: "A9_885",
    update_date: "2026/01/10",
    status: "ST9#2025_03_14",
    third_party: "AUS#CHT#OR#TUR",
    reports_adopted: "TRUE"
};
ds_array[7] = {
    code: "DS7",
    title: "Trade Description of Scallops \\"quoted\\" <b>bold</b>",
    origin: "CAN#EEC",
    destination: "EEC",
    start_date: "1995/05/19",
    status: "ST99#1995_07_05",
    third_party: "",
    reports_adopted: "FALSE"
};`;

describe('WTO register parsing', () => {
  const rows = parseWtoRegister(CASES, ARRAYS, { asOf: '2026-10-13T12:00:00Z' });

  it('reads one row per dispute, in DS order, with the official case page', () => {
    expect(rows.map((r) => r.ds_number)).toEqual(['DS1', 'DS7', 'DS600']);
    expect(rows[0].source_url).toBe('https://www.wto.org/english/tratop_e/dispu_e/cases_e/ds1_e.htm');
    expect(rows[0]).toMatchObject({ complainants: ['Singapore'], respondent: 'Malaysia', consultations_requested: '1995-01-10', source: 'World Trade Organization', as_of: '2026-10-13T12:00:00Z' });
  });

  it('names a status kept only in a commented-out line, and says "Not stated" for an unknown one', () => {
    expect(rows[0]).toMatchObject({ status: 'Settled or terminated (withdrawn, mutually agreed solution)', status_date: '1995-03-29' });
    expect(rows[1].status).toBe('Not stated');
    expect(rows[2]).toMatchObject({ status: 'Report(s) adopted, with recommendation to bring measure(s) into conformity', status_date: '2025-03-14', reports_adopted: true });
  });

  it('names the EU and Türkiye by the date of the dispute, as the WTO does, and keeps an unknown code as written', () => {
    expect(rows[1]).toMatchObject({ complainants: ['Canada', 'European Communities'], respondent: 'European Communities' });
    expect(rows[2].respondent).toBe('European Union');
    // Third parties follow the WTO's exception lists (none here), not the date: TUR is Türkiye.
    expect(rows[2].third_parties).toEqual(['Australia', 'Chinese Taipei', 'OR', 'Türkiye']);
    expect(memberName('TUR', '2020-01-01')).toBe('Turkey');
    expect(memberName('EEC', '2009-12-01')).toBe('European Union');
  });

  it('decodes entities once, strips tags, keeps escaped quotes, and lists agreements by short name, once each', () => {
    expect(rows[2].short_title).toBe('EU and certain Member States — Palm Oil (Malaysia)');
    expect(rows[1].title).toBe('Trade Description of Scallops "quoted" bold');
    expect(rows[0].agreements).toEqual(['GATT 1994', 'Import Licensing']);
    expect(rows[0].short_title).toBe('');
  });

  it('treats the files as text: code inside a value is a string, never run', () => {
    const hostile = 'ds_array[9] = {\n    code: "DS9",\n    title: "x\\"; globalThis.__pwned = 1; //",\n    origin: "USA",\n    destination: "CHN",\n    start_date: "2001/01/01"\n};';
    const [row] = parseWtoRegister(hostile, ARRAYS);
    expect(row.title).toBe('x"; globalThis.__pwned = 1; //');
    expect(globalThis.__pwned).toBeUndefined();
  });

  it('decodes WTO text conservatively', () => {
    expect(wtoText('T&uuml;rkiye&nbsp;&mdash; &unknown; &#233;')).toBe('Türkiye — &unknown; é');
    expect(parseStatuses('').size).toBe(0);
  });
});

// Review fixes (2026-10-13): what the WTO's own page shows, and an untrusted file that cannot crash
// or silently corrupt the register.
describe('WTO register parsing, as the WTO page shows it', () => {
  const EXCEPTIONS = `${ARRAYS}
var eec_exceptions = new Array();
eec_exceptions = ["DS2", "DS50"];
var tur_exceptions = new Array();
tur_exceptions = ["DS50"];`;
  const caseOf = (n, fields) => `ds_array[${n}] = {\n    code: "DS${n}",\n    title: "T${n}",\n    origin: "USA",\n    destination: "CHN",\n    start_date: "2010/01/01",\n${fields}\n};`;

  it('keeps every current stage the WTO lists, each with its date and any added text', () => {
    const [row] = parseWtoRegister(caseOf(30, '    status: "ST9#2019_01_11|ST1#2004_11_26#, in part",'), EXCEPTIONS);
    expect(row.stages).toEqual([
      { status: 'Report(s) adopted, with recommendation to bring measure(s) into conformity', status_date: '2019-01-11' },
      { status: 'In consultations, in part', status_date: '2004-11-26' },
    ]);
    expect(row).toMatchObject({ status: row.stages[0].status, status_date: '2019-01-11' });
  });

  it('names third parties by the WTO’s exception lists, not by the dispute’s date', () => {
    const rows = parseWtoRegister([caseOf(99, '    third_party: "EEC#TUR",'), caseOf(50, '    third_party: "EEC#TUR",')].join('\n'), EXCEPTIONS);
    expect(rows.find((r) => r.ds === 99).third_parties).toEqual(['European Union', 'Türkiye']);
    expect(rows.find((r) => r.ds === 50).third_parties).toEqual(['European Communities', 'Turkey']);
  });

  it('keeps the respondents as a list, and the joined line for the table', () => {
    const [row] = parseWtoRegister(caseOf(600, '    destination: "EEC#FRA",').replace('    destination: "CHN",\n', ''), EXCEPTIONS);
    expect(row.respondents).toEqual(['European Union', 'France']);
    expect(row.respondent).toBe('European Union; France');
  });

  it('keeps an unknown or undated member as written', () => {
    expect(memberName('EEC', '')).toBe('EEC');
    expect(memberName('TUR', '')).toBe('TUR');
  });

  it('never throws on, or emits, an out-of-range or NUL code point', () => {
    expect(wtoText('a &#99999999; b &#0; c &#55296; d')).toBe('a &#99999999; b &#0; c &#55296; d');
  });

  it('does not end a record at a "};" inside a value', () => {
    const [row] = parseWtoRegister('ds_array[5] = {\n    code: "DS5",\n    title: "Duties }; on goods",\n    origin: "USA",\n    destination: "CHN",\n    start_date: "1995/05/03"\n};', ARRAYS);
    expect(row).toMatchObject({ title: 'Duties }; on goods', complainants: ['United States'], respondent: 'China' });
  });
});
