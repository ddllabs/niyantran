import { describe, expect, it } from 'vitest';
import { applyParliamentaryQuestionShapingToFeed, shapeParliamentaryQuestionRows } from './shapeQuestions.js';
import { pqAnswerKey, pqSession } from './pqAnswerKey.js';

// F163 (owner, 2026-10-14): the Questions note read like an internal note ("Answer text is missing on
// every row in this archive … until Sansad answer fields are wired"). It now says it in plain words.
const INTERNAL = /archive|wired|Sansad answer fields|Has-answer|missing on every row/i;

describe('the Parliamentary Questions note (F163)', () => {
  it('describes register answer fields without claiming corpus answer absence', () => {
    const note = applyParliamentaryQuestionShapingToFeed({ feature: 'Parliamentary Question Database', rows: [{ title: 'Q1' }, { title: 'Q2' }] }).meta.boardNote;
    expect(note).toBe('Search covers all 2 questions. "Has answer" describes the question register only; Not reported does not establish whether answer text is available.');
    expect(note).not.toMatch(INTERNAL);
  });

  it('says "Has answer" is filled where the source records it when some rows do', () => {
    const note = applyParliamentaryQuestionShapingToFeed({ feature: 'Parliamentary Question Database', rows: [{ title: 'Q1', answer_status: 'Answered' }, { title: 'Q2' }] }).meta.boardNote;
    expect(note).toBe('Search covers all 2 questions. "Has answer" is Yes where sansad.in publishes the answer or the source records one.');
    expect(note).not.toMatch(INTERNAL);
  });
});

// F266 (owner, 2026-10-29): every listed question links sansad.in's answer file, which names its session.
describe('session and Has answer from the answer file URL (F266)', () => {
  const url = 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals';
  it('derives the session and Yes from the answer URL when the pack has neither', () => {
    const [row] = shapeParliamentaryQuestionRows([{ id: '1', subject: 'Khadi', source_url: url }]);
    expect(row).toMatchObject({ session: '187', has_answer: 'Yes', has_answer_key: 'yes' });
  });
  it('keeps the pack values when they exist, and Not reported without an answer URL', () => {
    const [kept] = shapeParliamentaryQuestionRows([{ session: '18th LS', answer_status: 'pending', source_url: url }]);
    expect(kept).toMatchObject({ session: '18th LS', has_answer: 'No', has_answer_key: 'no' });
    const [none] = shapeParliamentaryQuestionRows([{ subject: 'Q', source_url: 'https://sansad.in/x/AU1.pdf' }]);
    expect(none).toMatchObject({ session: 'Not reported', has_answer: 'Not reported', has_answer_key: 'unknown' });
  });
  it('uses one answer-key rule (pq_answer_key in SQL, pqAnswerKey in suppliedText.ts)', () => {
    expect(pqAnswerKey(url)).toBe('pq:ls:187:AU6302_KIQmzb');
    expect(pqAnswerKey(url.replace('?source=pqals', ''))).toBe('pq:ls:187:AU6302_KIQmzb');
    expect(pqAnswerKey(url.replace('https:', 'http:'))).toBeNull();
    expect(pqAnswerKey(url + '&x=1')).toBeNull();
    expect(pqSession(url)).toBe('187');
  });
});
