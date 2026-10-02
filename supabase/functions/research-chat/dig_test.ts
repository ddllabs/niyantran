import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { Chunk } from '../_shared/retrieval.ts';
import { DIG_REFERENCES, digNudge, gaveUpEarly, unfollowedReferences } from './dig.ts';

const passage = (id: string, content: string, document_id = 'bill'): Chunk => ({
  id, document_id, content, similarity: 0.5, chunk_index: 0, source_kind: 'document', char_from: 0, char_to: content.length, title: 'A Bill', text_hash: 'hash',
});

// research-coverage S1: a cited passage points at a provision of its own document that the turn
// never retrieved. The model saw "section 12" named but not what section 12 says.
Deno.test('S1 names a section the cited passage refers to when no retrieved passage of its document begins it', () => {
  const penalty = passage('p', '13. Whoever contravenes any provisions of section 12 shall be punishable with imprisonment which may extend to seven years.');
  assertEquals(unfollowedReferences([penalty], [penalty]), ['section 12']);
});

Deno.test('S1 is quiet once a retrieved passage of the same document begins the provision', () => {
  const penalty = passage('p', '13. Whoever contravenes any provisions of section 12 shall be punishable.');
  const twelve = passage('t', 'OFFENCES AND PENALTIES\n\n12. (1) No person shall melt or destroy any coin.');
  assertEquals(unfollowedReferences([penalty], [penalty, twelve]), []);
  // the provision beginning in the cited passage itself counts too
  assertEquals(unfollowedReferences([passage('x', '12. No person shall melt coin.\n\n13. Whoever contravenes section 12 shall be punished.')], []), []);
});

Deno.test('S1 does not count a passage of another document that begins the provision', () => {
  const penalty = passage('p', 'Whoever contravenes section 12 shall be punished.');
  const other = passage('o', '12. (1) No person shall melt coin.', 'other-bill');
  assertEquals(unfollowedReferences([penalty], [penalty, other]), ['section 12']);
});

Deno.test('S1 ignores provisions of other Acts, the principal Act and the Code', () => {
  const text = [
    'Every Registrar shall be deemed to be a public servant within the meaning of section 21 of the Indian Penal Code, 1860.',
    'In section 4 of the principal Act, after sub-section (2), the following sub-sections shall be inserted.',
    'commits an offence under section 30 of the Ancient Monuments and Archaeological Sites and Remains Act, 1958;',
    'grant a temporary injunction under the First Schedule to the Code of Civil Procedure, 1908.',
  ].join('\n');
  assertEquals(unfollowedReferences([passage('p', text)], []), []);
});

Deno.test('S1 names an own Schedule until a passage of the document heads it, and reads "clause N" as a provision', () => {
  const cited = passage('p', 'The rates specified in the Second Schedule apply, subject to clause 7.');
  assertEquals(unfollowedReferences([cited], [cited]), ['the Second Schedule', 'clause 7']);
  const schedule = passage('s', 'THE SECOND SCHEDULE\n\n(See section 3)\n\n1. Rice.');
  const seven = passage('c', '7. The appropriate Government shall rehabilitate the child.');
  assertEquals(unfollowedReferences([cited], [cited, schedule, seven]), []);
});

Deno.test(`S1 lists each provision once, at most ${DIG_REFERENCES}, in the order cited`, () => {
  const cited = passage('p', 'section 9, section 3, section 9, section 4, section 5, section 6 and section 7');
  assertEquals(unfollowedReferences([cited], [cited]), ['section 9', 'section 3', 'section 4', 'section 5'].slice(0, DIG_REFERENCES));
});

// research-coverage S2: "Not in record." after a single search gives up before looking twice.
Deno.test('S2 fires on Not in record. after one search, not after two, and not without the phrase', () => {
  assert(gaveUpEarly('{"answer":"Penalty: **Not in record.**"}', 1));
  assert(gaveUpEarly('Not in record.', 0));
  assert(!gaveUpEarly('**Not in record.**', 2));
  assert(!gaveUpEarly('The fine is two hundred rupees [1].', 1));
});

Deno.test('the nudge names what it found, lets the model answer if it is not needed, and is null with no signal', () => {
  const cited = passage('p', 'Whoever contravenes section 12 shall be punished.');
  const handles = new Map([['ref:abc123-0001', 'p']]);
  const lookup = (h: string) => handles.get(h);
  const draft = '{"answer":"Up to seven years [1].","sources":[{"id":1,"source":"ref:abc123-0001"}],"follow_up_questions":[]}';
  const both = digNudge('{"answer":"**Not in record.** [1]","sources":[{"id":1,"source":"ref:abc123-0001"}]}', [cited], 1, lookup);
  assert(both?.includes('section 12'));
  assert(both?.includes('Not in record.'));
  const one = digNudge(draft, [cited], 2, lookup);
  assert(one?.includes('section 12'));
  assert(one?.includes('If they are not needed'));
  assert(!one?.includes('Not in record.'));
  assertEquals(digNudge('{"answer":"Up to seven years [1]."}', [cited], 2, lookup), null);
});

// Measured on the retrieval eval's gold passages (2026-10-02): these read as references to the
// bill's own provisions but are not.
Deno.test('S1 ignores a list that runs on into another Act, source notes, Schedule headings and new sections', () => {
  const text = [
    'it is proposed to amend section 11 and clause (e) of sub-section (1) of section 12AA of the Essential Commodities Act, 1955.',
    'The Act shall be deemed to have come into force on 18 June, 2010. (Section 1).',
    'THE SCHEDULE (See sections 2 and 3)',
    'A new section 35 AD has been inserted providing a deduction.',
  ].join('\n');
  assertEquals(unfollowedReferences([passage('p', text)], []), []);
});
