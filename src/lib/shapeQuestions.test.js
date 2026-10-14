import { describe, expect, it } from 'vitest';
import { applyParliamentaryQuestionShapingToFeed } from './shapeQuestions.js';

// F163 (owner, 2026-10-14): the Questions note read like an internal note ("Answer text is missing on
// every row in this archive … until Sansad answer fields are wired"). It now says it in plain words.
const INTERNAL = /archive|wired|Sansad answer fields|Has-answer|missing on every row/i;

describe('the Parliamentary Questions note (F163)', () => {
  it('says answers are not in the dataset yet when no row records one', () => {
    const note = applyParliamentaryQuestionShapingToFeed({ feature: 'Parliamentary Question Database', rows: [{ title: 'Q1' }, { title: 'Q2' }] }).meta.boardNote;
    expect(note).toBe('Search covers all 2 questions. Answers are not in this dataset yet, so "Has answer" shows Not reported.');
    expect(note).not.toMatch(INTERNAL);
  });

  it('says "Has answer" is filled where the source records it when some rows do', () => {
    const note = applyParliamentaryQuestionShapingToFeed({ feature: 'Parliamentary Question Database', rows: [{ title: 'Q1', answer_status: 'Answered' }, { title: 'Q2' }] }).meta.boardNote;
    expect(note).toBe('Search covers all 2 questions. "Has answer" is filled only where the source records whether a question was answered.');
    expect(note).not.toMatch(INTERNAL);
  });
});
