import { assert, assertEquals } from 'jsr:@std/assert@1';
import { reviewLawAnswer } from './lawAnswer.ts';
import type { EvidenceMap } from './sources.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { ModelEvent, StreamRequest } from '../_shared/openrouterStream.ts';

const evidence: EvidenceMap = new Map([
  ['ref:abcdef-1', { kind: 'text', chunk: { document_id: 'national-bill', desk_tier: 'national',
    document_role: 'as_passed_both_houses', title: 'Amendment Bill, 2025',
    content: '9. In section 12 of the principal Act, for the words "Board", the words "Central Government" shall be substituted.' } as Chunk }],
  ['ref:abcdef-2', { kind: 'text', chunk: { document_id: 'national-bill', desk_tier: 'national',
    document_role: 'as_passed_both_houses', title: 'Amendment Bill, 2025',
    content: '1. It shall come into force on such date as the Central Government may, by notification in the Official Gazette, appoint.' } as Chunk }],
]);
const selection = { passages: ['p1', 'p2'] };
const valid = { claims: [{ text: 'Clause 9 substitutes Central Government for Board in section 12 of the principal Act.', evidence: 'p1' }], uncertain: false };
const finish: ModelEvent = { type: 'finish', reason: 'stop', usage: null, served: null, generationId: null };
function replay(values: unknown[], seen: StreamRequest[]) {
  return async function* (request: StreamRequest): AsyncGenerator<ModelEvent> {
    seen.push(request);
    yield { type: 'text', text: JSON.stringify(values.shift()) };
    yield finish;
  };
}
function request() {
  // Extra draft data deliberately must never enter the source-only provider input.
  return { model: 'test', question: 'What does clause 9 change in section 12?', evidence,
    mode: 'provision' as const, draft: 'UNSUPPORTED DRAFT: the Agency Board already has new powers.',
    signal: new AbortController().signal };
}

Deno.test('F254 provision synthesis selects original clauses and preserves source-owned citations', async () => {
  const seen: StreamRequest[] = [];
  const result = await reviewLawAnswer(replay([selection, valid], seen), request());
  assert(result);
  assertEquals(result.sources, [{ id: 1, source: 'ref:abcdef-1' }]);
  assert(result.answer.includes('Clause 9'));
  assertEquals(seen.length, 2);
  assert(!JSON.stringify(seen).includes('UNSUPPORTED DRAFT'));
  const prompts = seen.map(r => String(r.messages[0].content)).join('\n');
  assert(/amendment clause/i.test(prompts) && /principal.{0,20}(?:Act|section)/i.test(prompts), 'provision prompts must distinguish amendment clause from principal Act section');
  assert(/commencement|come into force/i.test(prompts) && /notification|condition/i.test(prompts), 'conditional commencement must not be presented as already effective');
});

Deno.test('F254 provision input retains the original document role for version attribution', async () => {
  const seen: StreamRequest[] = [];
  await reviewLawAnswer(replay([selection, valid], seen), request());
  for (const call of seen) {
    const payload = JSON.parse(String(call.messages[1].content));
    assert(JSON.stringify(payload.passages).includes('as_passed_both_houses'), 'source role/version must reach both selection and synthesis');
  }
});

for (const claim of [
  { text: 'Clause 9 substitutes Central Government for Board.', evidence: 'invented-source' },
  { text: 'The bill says "All powers commenced immediately upon introduction".', evidence: 'p1' },
]) Deno.test(`F254 provision rejects fabricated ${claim.evidence === 'p1' ? 'quotation' : 'source'}`, async () => {
  const seen: StreamRequest[] = [];
  const invalid = { claims: [claim], uncertain: false };
  assertEquals(await reviewLawAnswer(replay([selection, invalid, invalid], seen), request()), null);
  assertEquals(seen.length, 3, 'same bounded correction budget as existing source review');
});

for (const unsupported of [
  'The Act has not yet been brought into force.',
  'The Act has not yet come into force.',
  'The Act is not yet effective.',
  'The commencement date is not yet appointed.',
]) Deno.test(`F254 conditional commencement does not prove current negative status: ${unsupported}`, async () => {
  const seen: StreamRequest[] = [];
  const claim = { claims: [{ text: unsupported, evidence: 'p2' }], uncertain: false };
  const result = await reviewLawAnswer(replay([selection, claim, claim], seen), request());
  assertEquals(result, null, 'a conditional appointment clause cannot prove a notification has not occurred');
  assertEquals(seen.length, 3);
});

for (const unsupported of [
  'Clause 9 replaces the Agency’s governing board with the Central Government.',
  'Clause 9 replaces the Agency Board with the Central Government.',
]) Deno.test(`F254 undefined Board cannot be expanded: ${unsupported}`, async () => {
  const seen: StreamRequest[] = [];
  const claim = { claims: [{ text: unsupported, evidence: 'p1' }], uncertain: false };
  assertEquals(await reviewLawAnswer(replay([selection, claim, claim], seen), request()), null);
  assertEquals(seen.length, 3);
});

for (const supported of [
  'The Act has not yet been brought into force.',
  'The commencement date is not yet appointed.',
  'Board means the Agency’s governing board.',
  'Board means the Agency Board.',
]) Deno.test(`F254 explicit original supports the otherwise unsafe proposition: ${supported}`, async () => {
  const seen: StreamRequest[] = [];
  const original: EvidenceMap = new Map([['ref:abcdef-1', { kind: 'text', chunk: {
    document_id: 'national-bill', desk_tier: 'national', document_role: 'as_passed_both_houses',
    content: supported,
  } as Chunk }]]);
  const claim = { claims: [{ text: supported, evidence: 'p1' }], uncertain: false };
  const result = await reviewLawAnswer(replay([{ passages: ['p1'] }, claim], seen), { ...request(), evidence: original });
  assert(result, 'explicit source wording must remain usable');
  assertEquals(result.sources, [{ id: 1, source: 'ref:abcdef-1' }]);
});

for (const text of [
  'Clause 9 replaces "Board" with "Central Government" in section 12.',
  'In section 12, the words "Board" are replaced by "Central Government" under clause 9.',
]) Deno.test(`F254 quoted substitutions preserve short quote boundaries: ${text}`, async () => {
  const seen: StreamRequest[] = [];
  const reasons: string[] = [];
  const claim = { claims: [{ text, evidence: 'p1' }], uncertain: false };
  const result = await reviewLawAnswer(replay([selection, claim, claim], seen), {
    ...request(), report: reason => reasons.push(reason),
  });
  assert(result, `exact quoted source terms must survive validation: ${reasons.join(', ')}`);
  assertEquals(result.sources, [{ id: 1, source: 'ref:abcdef-1' }]);
  assertEquals(seen.length, 2, 'valid short/long quotations need no correction');
  assert(result.answer.includes(text));
});

Deno.test('F254 quoted substitutions still reject an altered long quotation after a short term', async () => {
  const seen: StreamRequest[] = [];
  const reasons: string[] = [];
  const claim = { claims: [{ text: 'Clause 9 replaces "Board" with "State Government" in section 12.', evidence: 'p1' }], uncertain: false };
  const result = await reviewLawAnswer(replay([selection, claim, claim], seen), {
    ...request(), report: reason => reasons.push(reason),
  });
  assertEquals(result, null);
  assertEquals(reasons, ['unsupported_quotation', 'unsupported_quotation']);
  assertEquals(seen.length, 3, 'altered quoted wording remains rejected after bounded correction');
});

for (const [opening, closing] of [['‘', '’'], ["'", "'"]]) {
  for (const word of ['accepted', 'rejected']) Deno.test(`F254 quotes preserve internal apostrophes: ${opening}${word}${closing}`, async () => {
    const original: EvidenceMap = new Map([['ref:abcdef-1', { kind: 'text', chunk: { document_id: 'bill', content: "The debtor's application was accepted." } as Chunk }]]);
    const claim = { claims: [{ text: `The text says ${opening}The debtor's application was ${word}.${closing}`, evidence: 'p1' }], uncertain: false };
    const seen: StreamRequest[] = [];
    const result = await reviewLawAnswer(replay([{ passages: ['p1'] }, claim, claim], seen), { ...request(), evidence: original });
    assertEquals(Boolean(result), word === 'accepted');
  });
}
