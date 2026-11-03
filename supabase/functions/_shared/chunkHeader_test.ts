import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { buildChunkHeader, CHUNK_HEADER_MAX_CHARS, chunkHeaderPrefix, HEADER_VERSION } from './chunkHeader.ts';
import { normalise, sha256Hex } from './textNormalise.ts';

// The metadata shapes below are the stored shapes read from the rehearsal replica on 2026-11-04
// (documents.metadata, trimmed to the fields a header can use). All of it is public court or
// parliament data.

const NCLT = 'NCLT / NCLAT (Insolvency)';
const PQ = 'Parliamentary Question Database';
const BILLS = 'Bill Passage Probability Index';
const REG = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';

const ncltCitation = {
  kind: 'tribunal_order',
  bench: '',
  forum: 'NCLT',
  source: 'IBBI_NCLT',
  members: [],
  remarks: 'APPROVAL OF RESOLUTION PLAN',
  section: '',
  forum_name: 'National Company Law Tribunal',
  order_date: '2024-07-04',
  order_type: '',
  petitioner: '',
  respondent: '',
  case_number: 'I.A. 22-2024 in C.P. No. IB- 638-ND-2020',
  order_status: '',
  case_details_found: true,
};

const pqTitle = 'Lok Sabha Unstarred Question No. 2564: Development of Additive Manufacturing (3D Printing) in India';
const pqCitation = {
  kind: 'parliamentary_question',
  house: 'Lok Sabha',
  source: 'sansad.in',
  session: '182',
  subject: 'Development of Additive Manufacturing (3D Printing) in India',
  asked_by: ['P P Chaudhary'],
  ministry: 'ELECTRONICS AND INFORMATION TECHNOLOGY',
  answered_on: '07.08.2024',
  question_no: '2564',
  question_type: 'UNSTARRED',
};

Deno.test('NCLT: forum, case number, order date and the order outcome follow the title', () => {
  assertEquals(
    buildChunkHeader({
      title: 'Approval of Resolution Plan - Clarion Township Pvt. Ltd.',
      desk_tier: 'law',
      desk_feature: NCLT,
      metadata: { citation: ncltCitation },
    }),
    'NCLT / NCLAT (Insolvency) | Approval of Resolution Plan - Clarion Township Pvt. Ltd.\n' +
      'I.A. 22-2024 in C.P. No. IB- 638-ND-2020 | NCLT | 2024-07-04 | APPROVAL OF RESOLUTION PLAN',
  );
});

Deno.test('NCLT: section, bench and an order type are used when present; remarks only stand in for an empty order type', () => {
  const header = buildChunkHeader({
    title: 'In the matter of API Engineers and Equipment Pvt. Ltd.',
    desk_tier: 'law',
    desk_feature: NCLT,
    metadata: {
      citation: {
        ...ncltCitation,
        case_number: 'CP (IB) No.448-MB-I-2022',
        order_date: '2023-10-11',
        section: '7',
        bench: 'Mumbai Bench - III',
        order_type: 'Final order',
        remarks: 'Dismissed',
      },
    },
  });
  assertEquals(
    header,
    'NCLT / NCLAT (Insolvency) | In the matter of API Engineers and Equipment Pvt. Ltd.\n' +
      'CP (IB) No.448-MB-I-2022 | NCLT | 2023-10-11 | Bench Mumbai Bench - III | Section 7 | Final order',
  );
});

Deno.test('NCLT: remarks that only say "Others" carry no information and are left out', () => {
  for (const remarks of ['OTHERS', 'Others', ' others ']) {
    const header = buildChunkHeader({
      title: 'T',
      desk_feature: NCLT,
      metadata: { citation: { ...ncltCitation, remarks } },
    });
    assert(!/others/i.test(header), header);
  }
});

Deno.test('Parliamentary Questions: facts already in the title are not repeated; the answer date is ISO', () => {
  assertEquals(
    buildChunkHeader({
      title: pqTitle,
      desk_tier: 'national',
      desk_feature: PQ,
      metadata: { citation: pqCitation, doc_type: 'parl_question', source_host: 'sansad.in' },
    }),
    `Parliamentary Question | ${pqTitle}\n` +
      'Ministry: ELECTRONICS AND INFORMATION TECHNOLOGY | answered 2024-08-07 | session 182',
  );
});

Deno.test('Parliamentary Questions: house and number are added when the title does not carry them', () => {
  assertEquals(
    buildChunkHeader({
      title: 'Research on Malnutrition',
      desk_feature: PQ,
      metadata: {
        citation: {
          ...pqCitation,
          subject: 'Research on Malnutrition',
          question_no: '842',
          ministry: 'WOMEN AND CHILD DEVELOPMENT',
          answered_on: '26.07.2024',
        },
      },
    }),
    'Parliamentary Question | Research on Malnutrition\n' +
      'Lok Sabha | Question No. 842 | UNSTARRED | Ministry: WOMEN AND CHILD DEVELOPMENT | answered 2024-07-26 | session 182',
  );
});

Deno.test('Parliamentary Questions without a citation (82 stored documents) get the label and title only', () => {
  assertEquals(
    buildChunkHeader({
      title: '185_AU347_5ukwuB',
      desk_tier: 'national',
      desk_feature: PQ,
      metadata: { doc_type: 'parl_question', source_host: 'sansad.in', title_stem: '185_AU347_5ukwuB' },
    }),
    'Parliamentary Question | 185 AU347 5ukwuB',
  );
});

Deno.test('Bills: the citation shape, with the year left out because the title carries it', () => {
  assertEquals(
    buildChunkHeader({
      title: 'The Protection of Interests in Aircraft Objects Bill, 2025',
      desk_tier: 'national',
      desk_feature: BILLS,
      metadata: {
        citation: {
          kind: 'bill',
          house: 'Rajya Sabha',
          source: 'sansad.in',
          status: 'Passed',
          version: 'as_passed_rajya_sabha',
          ministry: 'CIVIL AVIATION',
          bill_name: 'The Protection of Interests in Aircraft Objects Bill, 2025',
          bill_year: '2025',
          bill_number: 'IX',
          introduced_on: '2025-02-10',
        },
      },
    }),
    'Parliamentary Bill | The Protection of Interests in Aircraft Objects Bill, 2025\n' +
      'Bill No. IX | Rajya Sabha | Ministry: CIVIL AVIATION | Passed | as passed rajya sabha | introduced 2025-02-10',
  );
});

Deno.test('Bills: the top-level shape of the documents without a citation (1,624) is read too', () => {
  assertEquals(
    buildChunkHeader({
      title: 'The Factoring Regulation Bill, 2011',
      desk_tier: 'national',
      desk_feature: BILLS,
      metadata: {
        bill_number: '24',
        house: 'Lok Sabha',
        bill_year: '2011',
        status: 'Assented',
        document_role: 'synopsis',
        doc_type: 'bill',
        source_host: 'sansad.in',
      },
    }),
    'Parliamentary Bill | The Factoring Regulation Bill, 2011\nBill No. 24 | Lok Sabha | Assented | synopsis',
  );
});

Deno.test('Bills: a numeric year that the title lacks is kept; the citation wins over the top-level field', () => {
  const header = buildChunkHeader({
    title: 'Harmful soaps1111202433926PM',
    desk_feature: BILLS,
    metadata: { citation: { house: 'Rajya Sabha', bill_year: 1989 }, house: 'Lok Sabha', bill_year: '2000' },
  });
  assertEquals(header, 'Parliamentary Bill | Harmful soaps1111202433926PM\nRajya Sabha | 1989');
});

Deno.test('Regulatory, Industry and Budget: the label, the file stem as title, and the source', () => {
  assertEquals(
    buildChunkHeader({
      title: 'TRAI_recommendation__Recommendation_Spectrum_15122017_0',
      desk_tier: 'national',
      desk_feature: REG,
      metadata: { doc_type: 'regulatory', source_host: 'trai.gov.in', n_pages: 12 },
    }),
    'Regulatory | TRAI recommendation Recommendation Spectrum 15122017 0\nSource: TRAI (trai.gov.in)',
  );
  assertEquals(
    buildChunkHeader({
      title: 'CCI__antitrustorder__en__1020091652437557',
      desk_feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
      metadata: { doc_type: 'regulatory', source_host: 'cci.gov.in' },
    }),
    'Regulatory | CCI antitrustorder en 1020091652437557\nSource: CCI (cci.gov.in)',
  );
  assertEquals(
    buildChunkHeader({
      title: 'Press_Release_ICI_20260820',
      desk_feature: 'Industry Updates (Ministry Data)',
      metadata: { doc_type: 'industry_report', source_host: 'eaindustry.nic.in' },
    }),
    'Industry Update | Press Release ICI 20260820\nSource: eaindustry.nic.in | industry report',
  );
  assertEquals(
    buildChunkHeader({
      title: 'tab1.2',
      desk_feature: 'Budget Utilisation & Schemes',
      metadata: { doc_type: 'budget_doc', source_host: 'indiabudget.gov.in' },
    }),
    'Budget | tab1.2\nSource: indiabudget.gov.in | budget doc',
  );
});

Deno.test('missing, empty and malformed fields are omitted and never printed as undefined or null', () => {
  const inputs = [
    { title: 'T', desk_feature: NCLT },
    { title: 'T', desk_feature: NCLT, metadata: null },
    { title: 'T', desk_feature: NCLT, metadata: 'not an object' },
    { title: 'T', desk_feature: NCLT, metadata: [] },
    { title: 'T', desk_feature: NCLT, metadata: { citation: null } },
    { title: 'T', desk_feature: NCLT, metadata: { citation: ['x'] } },
    {
      title: 'T',
      desk_feature: NCLT,
      metadata: { citation: { case_number: null, order_date: undefined, forum: '   ', section: 7 } },
    },
    { title: null, desk_tier: null, desk_feature: null, metadata: undefined },
    {},
  ];
  for (const input of inputs) {
    const header = buildChunkHeader(input as never);
    assert(!/undefined|null|NaN|\[object/.test(header), `${JSON.stringify(input)} -> ${header}`);
  }
  assertEquals(buildChunkHeader({ title: 'T', desk_feature: NCLT }), 'NCLT / NCLAT (Insolvency) | T');
  assertEquals(
    buildChunkHeader({ title: 'T', desk_feature: NCLT, metadata: { citation: { section: 7 } } }),
    'NCLT / NCLAT (Insolvency) | T\nSection 7',
  );
  assertEquals(buildChunkHeader({}), '');
  assertEquals(buildChunkHeader({ title: '  ', desk_feature: '', metadata: {} }), '');
});

Deno.test('a section value that already names itself is not prefixed twice', () => {
  const h = buildChunkHeader({ title: 'T', desk_feature: NCLT, metadata: { citation: { section: 'Section 7' } } });
  assertEquals(h, 'NCLT / NCLAT (Insolvency) | T\nSection 7');
  assertEquals(
    buildChunkHeader({ title: 'T', desk_feature: NCLT, metadata: { citation: { section: 'sec 9' } } }),
    'NCLT / NCLAT (Insolvency) | T\nsec 9',
  );
});

Deno.test('dates: ISO kept, day-month-year text converted, impossible dates kept as bounded text', () => {
  const answered = (answered_on: string) =>
    buildChunkHeader({ title: 'T', desk_feature: PQ, metadata: { citation: { answered_on } } });
  assertEquals(answered('07.08.2024'), 'Parliamentary Question | T\nanswered 2024-08-07');
  assertEquals(answered('7/8/2024'), 'Parliamentary Question | T\nanswered 2024-08-07');
  assertEquals(answered('07-08-2024'), 'Parliamentary Question | T\nanswered 2024-08-07');
  assertEquals(answered('2024-08-07'), 'Parliamentary Question | T\nanswered 2024-08-07');
  assertEquals(answered('31.02.2024'), 'Parliamentary Question | T\nanswered 31.02.2024');
  assertEquals(answered('sometime in August'), 'Parliamentary Question | T\nanswered sometime in August');
});

Deno.test('whitespace is normalised and control characters removed from every value', () => {
  const header = buildChunkHeader({
    title: '  In the\u0000 matter\n of   Acme\tLtd  ',
    desk_feature: NCLT,
    metadata: { citation: { case_number: 'CP\u0007 (IB)\n No.1  of 2020', forum: ' NCLT ' } },
  });
  assertEquals(header, 'NCLT / NCLAT (Insolvency) | In the matter of Acme Ltd\nCP (IB) No.1 of 2020 | NCLT');
});

Deno.test('overlong values are cut, the whole header stays within the limit, and no surrogate pair is split', () => {
  const long = 'x'.repeat(500);
  const emoji = '\u{1F600}'.repeat(200);
  for (const text of [long, emoji]) {
    const header = buildChunkHeader({
      title: text,
      desk_feature: NCLT,
      metadata: {
        citation: {
          case_number: text,
          forum: text,
          order_date: text,
          section: text,
          bench: text,
          order_type: text,
          remarks: text,
        },
      },
    });
    assert(header.length <= CHUNK_HEADER_MAX_CHARS, `${header.length} chars`);
    assert(header.split('\n').length <= 2);
    assert(header.isWellFormed(), 'split surrogate pair');
    assert(header.includes('…'));
  }
  const parl = buildChunkHeader({
    title: long,
    desk_feature: PQ,
    metadata: { citation: { ministry: long, session: long, house: long, question_no: long, answered_on: long } },
  });
  assert(parl.length <= CHUNK_HEADER_MAX_CHARS, `${parl.length} chars`);
});

Deno.test('a fact that no longer fits is skipped and a later, shorter one may still be used; the title is always kept', () => {
  const header = buildChunkHeader({
    title: 'y'.repeat(300),
    desk_feature: NCLT,
    metadata: {
      citation: {
        case_number: 'z'.repeat(200),
        forum: 'NCLT',
        order_date: '2024-07-04',
        bench: 'b'.repeat(100),
        section: '7',
        order_type: 'Final',
      },
    },
  });
  const [line1, line2] = header.split('\n');
  assert(header.length <= CHUNK_HEADER_MAX_CHARS, `${header.length} chars`);
  assert(line1.startsWith('NCLT / NCLAT (Insolvency) | yyy') && line1.endsWith('…'));
  // Case number (80), forum, date and bench (40) fill the line; "Section 7" does not fit, "Final" does.
  assert(!line2.includes('Section'), line2);
  assert(line2.endsWith(' | Final'), line2);
});

Deno.test('an unknown feature keeps its own name as the label and uses only the generic fields', () => {
  assertEquals(
    buildChunkHeader({
      title: 'Cabinet note 14',
      desk_tier: 'national',
      desk_feature: 'Cabinet Decisions',
      metadata: { source_host: 'cabinet.gov.in', citation: { case_number: 'ignored' } },
    }),
    'Cabinet Decisions | Cabinet note 14\nSource: cabinet.gov.in',
  );
  assertEquals(buildChunkHeader({ title: 'Doc', desk_tier: 'law', metadata: {} }), 'law | Doc');
});

Deno.test('deterministic: the same input gives the same output, key order does not matter, the input is not changed', () => {
  const a = {
    title: 'T',
    desk_feature: NCLT,
    metadata: { citation: { forum: 'NCLT', case_number: 'C 1', order_date: '2024-01-02' } },
  };
  const b = {
    metadata: { citation: { order_date: '2024-01-02', case_number: 'C 1', forum: 'NCLT' } },
    desk_feature: NCLT,
    title: 'T',
  };
  const frozen = structuredClone(a);
  assertEquals(buildChunkHeader(a), buildChunkHeader(a));
  assertEquals(buildChunkHeader(a), buildChunkHeader(b));
  assertEquals(a, frozen);
});

Deno.test('the prefix puts a blank line between the header and what follows, and is empty without a header', () => {
  assertEquals(chunkHeaderPrefix('H1\nH2'), 'H1\nH2\n\n');
  assertEquals(chunkHeaderPrefix(''), '');
  assertEquals(chunkHeaderPrefix(undefined), '');
});

Deno.test('HEADER_VERSION is pinned to the golden outputs in this file: change one, bump the other', async () => {
  // embed_hash = SHA-256(normalise(embedding input)) names the text that was embedded, so a changed
  // header changes the hash and a pure version bump does not (the vector would be the same). The version
  // is therefore kept honest here: any change to the builder's output must change a golden above and
  // bump this number in the same commit.
  assertEquals(HEADER_VERSION, 1);
  const base = {
    title: 'Approval of Resolution Plan - Clarion Township Pvt. Ltd.',
    desk_feature: NCLT,
    metadata: { citation: ncltCitation },
  };
  const body = 'The resolution plan is approved.';
  const embedded = (h: string) => sha256Hex(normalise(chunkHeaderPrefix(h) + body));
  const withHeader = await embedded(buildChunkHeader(base));
  const sameAgain = await embedded(buildChunkHeader(structuredClone(base)));
  const otherDate = await embedded(
    buildChunkHeader({ ...base, metadata: { citation: { ...ncltCitation, order_date: '2024-07-05' } } }),
  );
  const none = await embedded('');
  assertEquals(withHeader, sameAgain);
  assertNotEquals(withHeader, otherDate);
  assertNotEquals(withHeader, none);
});
