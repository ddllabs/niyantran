import { assertEquals } from 'jsr:@std/assert@1';
import { checkSet, type CoverageQuestion, scoreCoverage } from './coverage.ts';

const passage = (chunk_id: string) => ({ document_id: 'd', chunk_id, chunk_index: 0, chunk_hash: `h-${chunk_id}` });
const q: CoverageQuestion = {
  id: 'cov-t', question: 'q', document_id: 'd', title: 't', alternate_document_ids: [],
  points: [
    { id: 'p1', fact: 'a', anchors: ['fine of two hundred rupees'], passages: [passage('c1')] },
    { id: 'p2', fact: 'b', anchors: ['within 45 days', 'three witnesses'], passages: [passage('c2'), passage('c3')] },
  ],
};

Deno.test('a point is covered when the answer cites any one of its passages', () => {
  assertEquals(scoreCoverage(q, ['c3']), { points: 2, covered: 1, missing: ['p1'], full: false });
  assertEquals(scoreCoverage(q, ['c1', 'c2', 'x']), { points: 2, covered: 2, missing: [], full: true });
  assertEquals(scoreCoverage(q, []), { points: 2, covered: 0, missing: ['p1', 'p2'], full: false });
});

Deno.test('the set check catches a changed passage, a missing anchor and a one-passage question', () => {
  const replica = new Map([
    ['c1', { chunk_hash: 'h-c1', content: 'a Fine  of two hundred\nrupees' }],
    ['c2', { chunk_hash: 'h-c2', content: 'completed within 45 days' }],
    ['c3', { chunk_hash: 'changed', content: 'signed by three witnesses' }],
  ]);
  assertEquals(checkSet([q], replica), ['cov-t p2: passage c3 changed']);
  const noAnchor = new Map(replica).set('c3', { chunk_hash: 'h-c3', content: 'something else' });
  assertEquals(checkSet([q], noAnchor), ['cov-t p2: no anchor in passage c3']);
  // a passage holding any one of the point's anchors is enough
  assertEquals(checkSet([q], new Map(replica).set('c3', { chunk_hash: 'h-c3', content: 'signed by three witnesses' })), []);
  const onePassage = { ...q, points: q.points.map((p) => ({ ...p, passages: [passage('c1')] })) };
  assertEquals(checkSet([onePassage], new Map([['c1', { chunk_hash: 'h-c1', content: 'fine of two hundred rupees within 45 days' }]])), ['cov-t: every point sits in one passage']);
});
