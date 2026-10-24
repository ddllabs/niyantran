import { assert, assertEquals } from 'jsr:@std/assert@1';
import { renderObservation } from './observationAnswer.ts';
const pages = [{ title: 'Definition', url: 'https://worldbank.org/latest/gdp', excerpt: 'Annual growth based on constant local currency. FY26 growth is estimated at 7.6 percent.' }];
const definition = { sourceId: 1, quote: 'Annual growth based on constant local currency.' };
const render = (o: unknown) => renderObservation(JSON.stringify(o), pages, { text: 'India; 2025; 7.57 annual %' });
Deno.test('observation: exact source spans accept whitespace but never changed numbers or paraphrases', () => {
  assert(!render({ definition: { ...definition, quote: 'Annual growth\n based on constant local currency.' }, updates: [] }).invalid);
  for (const quote of ['FY26 growth is estimated at 7.8 percent.', 'Growth of real output.', '']) assert(render({ definition: { sourceId: 1, quote }, updates: [] }).invalid);
});
Deno.test('observation: invalid updates cannot destroy a valid definition or publish invented claims', () => {
  const result = render({ definition, updates: [{ sourceId: 1, quote: 'FY26 growth is estimated at 7.6 percent.' }, { sourceId: 99, quote: 'Fake latest 9%' }] });
  assert(result.invalid);
  const answer = JSON.parse(result.text).answer;
  assert(answer.includes(definition.quote));
  assert(answer.includes('7.6 percent'));
  assert(answer.includes('omitted'));
  assert(!answer.includes('Fake'));
  assert(answer.includes('worldbank.org/latest/gdp'));
});
Deno.test('observation: URLs and citation markers cannot be supplied by extraction', () => {
  for (const extra of [{ url: 'https://evil.example' }, { comparison: 'Same period' }, { releaseDate: '2026-01-01' }]) {
    const result = render({ definition: { ...definition, ...extra }, updates: [] });
    assert(result.invalid);
    assert(!result.text.includes('evil.example'));
  }
  const result = renderObservation(JSON.stringify({ definition: { sourceId: 1, quote: '[1] <script>' }, updates: [] }), [{ ...pages[0], excerpt: '[1] <script>' }]);
  const answer = JSON.parse(result.text).answer;
  assert(answer.includes('［1］'));
  assert(answer.includes('\\<script\\>'));
});
Deno.test('observation: verified record handle is server-owned and supplied context has no fabricated citation', () => {
  const raw = JSON.stringify({ definition, updates: [] });
  assertEquals(JSON.parse(renderObservation(raw, pages, { text: 'India 2025', handle: 'R1' }).text).sources, [{ id: 1, source: 'R1' }]);
  assertEquals(JSON.parse(renderObservation(raw, pages, { text: 'India 2025' }).text).sources, []);
});
Deno.test('observation: rejects extra fields, excessive updates, noninteger IDs and non-http source URLs', () => {
  for (const raw of [{ definition, updates: [], answer: 'latest' }, { definition, updates: [definition, definition, definition] }, { definition: { ...definition, sourceId: 1.5 }, updates: [] }]) assert(render(raw).invalid);
  assert(renderObservation(JSON.stringify({ definition, updates: [] }), [{ ...pages[0], url: 'javascript:alert(1)' }]).invalid);
});
Deno.test('observation: selected spans retain sentence qualifiers, not just a numeric substring', () => {
  const source = [{ ...pages[0], excerpt: 'The forecast is not 7.6 percent. Instead growth is projected at 7.1 percent.' }];
  for (const quote of ['7.6 percent', 'growth is projected at 7.1 percent.']) {
    assert(renderObservation(JSON.stringify({ definition: null, updates: [{ sourceId: 1, quote }] }), source).invalid);
  }
  assert(!renderObservation(JSON.stringify({ definition: null, updates: [{ sourceId: 1, quote: 'Instead growth is projected at 7.1 percent.' }] }), source).invalid);
});
