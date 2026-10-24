import { assert, assertEquals } from 'jsr:@std/assert@1';
import { renderObservation, observationCandidates, renderObservationSelection } from './observationAnswer.ts';
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
Deno.test('observation: ordinary parentheses remain readable in the NTER Markdown renderer', () => {
  const result = renderObservation(JSON.stringify({ definition: null, updates: [] }), [], { text: 'GDP growth (annual %)' });
  assert(JSON.parse(result.text).answer.includes('GDP growth (annual %)'));
});
Deno.test('observation: World Bank glossary definition cell retains its exact complete sentence', () => {
  const quote = 'Annual percentage growth rate of GDP at market prices based on constant local currency.';
  const source = [{ ...pages[0], excerpt: `| Code | NY.GDP.MKTP.KD.ZG | | Long definition | ${quote} Aggregates are based on constant local currency. |` }];
  const result = renderObservation(JSON.stringify({ definition: { sourceId: 1, quote }, updates: [] }), source);
  assert(!result.invalid);
  assert(JSON.parse(result.text).answer.includes(quote));
  for (const prefix of ['| Forecast | ', '| Not a definition | ', '| Value | ']) {
    assert(renderObservation(JSON.stringify({ definition: { sourceId: 1, quote }, updates: [] }), [{ ...source[0], excerpt: prefix + quote }]).invalid);
  }
  assert(renderObservation(JSON.stringify({ definition: null, updates: [{ sourceId: 1, quote }] }), source).invalid, 'definition-cell exception is not a numerical update boundary');
});

Deno.test('observation selection: server sentences retain typography and qualifiers; numeric table fragments are unavailable', () => {
  const source = [{ title: 'Public report', url: 'https://example.org/report', excerpt: 'World Bank projects India’s economy to grow by 6.7 per cent in the next fiscal year starting in April, slightly higher than in the current fiscal year. Growth was 6.5 percent last year.' },
    { title: 'Table', url: 'https://example.org/table', excerpt: 'TABLE 2022 2023 2024e 2025f India 2 7.6 9.2 6.5 6.3' }];
  const candidates = observationCandidates(source);
  const first = candidates.find(c => c.quote === source[0].excerpt.split('. ')[0] + '.');
  assert(first?.update);
  assert(!candidates.some(c => c.quote === 'India 2 7.6 9.2 6.5 6.3'));
  const rendered = renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[first.id]}),source);
  assert(!rendered.invalid);
  assert(JSON.parse(rendered.text).answer.includes('India’s economy'));
  assert(JSON.parse(rendered.text).answer.includes('slightly higher than in the current fiscal year'));
  assert(renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[999]}),source).invalid);
  assert(renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[first.id],quote:'fake'}),source).invalid);
});
Deno.test('observation selection: definition table candidates cannot become numerical updates and survive bad correction',()=>{
  const source=[{title:'Glossary',url:'https://example.org/definition',excerpt:'| Long definition | Annual percentage growth based on constant local currency. |'}];
  const c=observationCandidates(source).find(c=>c.quote.startsWith('Annual'))!;
  assert(c && !c.update);
  const previous=JSON.stringify({definitionId:c.id,updateIds:[]});
  assert(!renderObservationSelection(previous,source).invalid);
  assert(renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[c.id]}),source).invalid);
  const saved=renderObservationSelection('broken',source,undefined,previous);
  assert(JSON.parse(saved.text).answer.includes(c.quote));
});
Deno.test('observation selection: decimals, abbreviations and negated forecasts remain complete',()=>{
 const quote='The U.S. GDP forecast is not 7.6 percent.';
 const source=[{...pages[0],excerpt:quote+' Instead growth is projected at 7.1 percent.'}];
 const c=observationCandidates(source);
 assert(c.some(v=>v.quote===quote));
 assert(!c.some(v=>v.quote==='GDP forecast is not 7.6 percent.'));
 assert(!c.some(v=>v.quote==='6 percent.'));
 assert(renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[1,1]}),source).invalid);
 assert(renderObservationSelection(JSON.stringify({definitionId:1.5,updateIds:[]}),source).invalid);
});
Deno.test('observation selection: captured transcription failure cannot alter selected source text',()=>{
 const exact='World Bank projects India’s economy to grow by 6.7 per cent in the next fiscal year starting in April, slightly higher than in the current fiscal year.';
 const source=[{...pages[0],excerpt:exact}];
 const changed="World Bank projects India's economy to grow by 6.7 per cent in the next fiscal year starting in April.";
 assert(renderObservation(JSON.stringify({definition:null,updates:[{sourceId:1,quote:changed}]}),source).invalid);
 const selected=renderObservationSelection(JSON.stringify({definitionId:null,updateIds:[1]}),source);
 assert(!selected.invalid);
 assert(JSON.parse(selected.text).answer.includes(exact));
});
Deno.test('observation selection: excerpt gaps and ellipsis-ended table rows are not complete sentences',()=>{
 const source=[{...pages[0],excerpt:'Mexico 3.7 3.3 1.5 0.2 ... India 7.6 6.3 ... Growth is projected at 6.6 percent in FY27. ... Another observation is incomplete ...'}];
 const c=observationCandidates(source);
 assert(!c.some(v=>v.quote.includes('...')));
 assert(c.some(v=>v.update&&v.quote==='Growth is projected at 6.6 percent in FY27.'));
});
