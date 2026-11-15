import { assertEquals } from 'jsr:@std/assert@1';
import { attribution, clip, clipEnd, mapStatus, normaliseClaim, stripAttribution } from './claimText.ts';

Deno.test('normalisation ignores case, punctuation and spacing but not content', () => {
  assertEquals(normaliseClaim('  Crime fell by 20%.  '), normaliseClaim('crime FELL by 20 %'));
  assertEquals(normaliseClaim('Rs 20,000 crore'), normaliseClaim('rs 20000 crore'));
  assertEquals(normaliseClaim('गृह मंत्री ने कहा।'), normaliseClaim('गृह  मंत्री ने कहा'));
  assertEquals(normaliseClaim('Crime fell') === normaliseClaim('Crime rose'), false);
});

Deno.test('clip counts characters, not UTF-16 units, drops control characters and never splits a pair', () => {
  assertEquals(clip('abcdef', 3), 'abc');
  assertEquals(clip('😀😀😀', 2), '😀😀');
  assertEquals(clip('a\u0000b\u0007c\n d', 50), 'abc d');
  assertEquals(clip('  padded  ', 50), 'padded');
  assertEquals([...clip('अ'.repeat(400), 300)].length, 300);
});

Deno.test('status mapping: a checkable claim is pending, an unresolved one needs context, everything else is not checkable', () => {
  const m = (kind: string, checkable: boolean, needs_context: boolean) =>
    mapStatus({ kind, checkable, needs_context } as never);
  assertEquals(m('claim', true, false), 'pending');
  assertEquals(m('claim', true, true), 'needs_context');
  assertEquals(m('claim', false, true), 'needs_context');
  assertEquals(m('claim', false, false), 'not_checkable');
  for (const kind of ['opinion', 'prediction', 'question']) {
    for (const [c, n] of [[true, false], [true, true], [false, false], [false, true]] as const) {
      assertEquals(m(kind, c, n), 'not_checkable', `${kind} ${c} ${n}`);
    }
  }
});

Deno.test('attribution is removed from the claim text when the claimant or reporter is named as the one who said it', () => {
  const cases: [string, string | null, string | null, string][] = [
    ['Amit Shah said that crime fell by 20 percent.', 'Amit Shah', null, 'Crime fell by 20 percent.'],
    ['amit shah stated crime fell by 20 percent.', 'Amit Shah', null, 'Crime fell by 20 percent.'],
    [
      'The Home Minister claimed that the bridge collapsed in 2024.',
      'The Home Minister',
      'the anchor',
      'The bridge collapsed in 2024.',
    ],
    ['The anchor reported that the bridge collapsed.', 'Home Minister', 'The anchor', 'The bridge collapsed.'],
    ['According to the Finance Minister, GDP grew 7 percent.', 'Finance Minister', null, 'GDP grew 7 percent.'],
    ['Rahul Gandhi alleged that the deal cost Rs 500 crore.', null, null, 'The deal cost Rs 500 crore.'],
    ['The speaker said that the dam is 80 years old.', 'speaker', null, 'The dam is 80 years old.'],
    ['Narendra Modi told that India built 4 crore houses.', 'Narendra Modi', null, 'India built 4 crore houses.'],
    ['Amit Shah said that Rahul Gandhi claimed that taxes fell.', 'Amit Shah', null, 'Taxes fell.'],
  ];
  for (const [claim, claimant, reportedBy, expected] of cases) {
    assertEquals(stripAttribution(claim, claimant, reportedBy), expected, claim);
  }
});

Deno.test('claims that merely contain a speech verb, or have nothing left after stripping, are left alone', () => {
  const keep: [string, string | null][] = [
    ['Inflation claimed 3 lives in the state.', 'Minister'],
    ['Crime fell by 20 percent.', 'Amit Shah'],
    ['The report said nothing.', null],
    ['Amit Shah said that.', 'Amit Shah'],
    ['Taliban claimed responsibility for the attack.', 'Taliban'],
    ['Delhi Police reported 3 thefts in the district.', 'Delhi Police'],
    ['The bridge is said to be 80 years old.', null],
  ];
  for (const [claim, claimant] of keep) {
    assertEquals(stripAttribution(claim, claimant, null), claim, claim);
  }
});

Deno.test('the minus sign survives normalisation: "-5 degrees" is not "5 degrees", but a hyphenated range is still one claim', () => {
  assertEquals(normaliseClaim('It was -5 degrees') === normaliseClaim('It was 5 degrees'), false);
  assertEquals(normaliseClaim('-5 degrees') === normaliseClaim('5 degrees'), false);
  assertEquals(normaliseClaim('Budget 2020-21') === normaliseClaim('budget 2020 21'), true);
  assertEquals(normaliseClaim('It was −5 degrees') === normaliseClaim('it was -5 degrees'), true);
});

Deno.test('clipEnd keeps the end of a long text, by characters', () => {
  assertEquals(clipEnd('abcdef', 3), 'def');
  assertEquals(clipEnd('😀😀😀', 2), '😀😀');
  assertEquals(clipEnd('short', 50), 'short');
});

Deno.test('a strip whose remainder starts with a pronoun is not applied: the "it" would lose its referent', () => {
  for (
    const claim of [
      'Tehran stated that it will not bow down.',
      'The government claimed that it had built 3 crore houses.',
      'BJP said that they won 240 seats.',
      'Shah said that he visited Delhi.',
      'Modi said that this scheme helped farmers.',
      'Rahul said that we lost the election.',
      'The minister said that his ministry spent Rs 5 crore.',
      "The PM said that it's a record.",
    ]
  ) assertEquals(stripAttribution(claim, null, null), claim, claim);
});

Deno.test('the reviewer cases: titles, places and occasions between the name and the verb', () => {
  const a = attribution(
    "India's Prime Minister Narendra Modi announced that India's GDP grew by 40% in the last quarter.",
    'speaker',
    null,
  );
  assertEquals(a.text, "India's GDP grew by 40% in the last quarter.");
  assertEquals(a.subject, "India's Prime Minister Narendra Modi");
  const b = attribution('BJP said that Congress lied.', null, null);
  assertEquals([b.text, b.subject], ['Congress lied.', 'BJP']);
  const c = attribution('Amit Shah stated at the India Today Conclave that crime fell by 20 percent.', null, null);
  assertEquals([c.text, c.subject], ['Crime fell by 20 percent.', 'Amit Shah']);
  const d = attribution('Amit Shah, speaking in Patna, said that 4 crore houses were built.', null, null);
  assertEquals([d.text, d.subject], ['4 crore houses were built.', 'Amit Shah']);
  const e = attribution('Amit Shah said at a rally in Patna that taxes fell.', null, null);
  assertEquals([e.text, e.subject], ['Taxes fell.', 'Amit Shah']);
});

Deno.test('the stripped subject is reported so the caller can fill an empty or placeholder claimant', () => {
  assertEquals(attribution('Amit Shah said that crime fell by 20 percent.', 'Amit Shah', null).subject, 'Amit Shah');
  assertEquals(attribution('Crime fell by 20 percent.', null, null).subject, null);
  assertEquals(attribution('Tehran stated that it will not bow down.', null, null).subject, null);
});
