import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/reasoningSegments.json';
import { MAX_REASONING_SEGMENTS, MAX_SEGMENT_CHARS, MIN_SEGMENT_CHARS, segmentReasoning } from './reasoningSegments.js';

describe('reasoningSegments (client, mirrored in _shared/reasoningSegments.ts)', () => {
  it('reproduces every fixture case', () => {
    expect(fixture.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture) expect(segmentReasoning(c.input), c.name).toEqual(c.segments);
  });

  it('does not cut after list numbering or initials', () => {
    const s = segmentReasoning('1. Check the bill number. 2. Read the committee report by R. Kumar. Then decide what to search for next.');
    expect(s).toEqual(['1. Check the bill number.', '2. Read the committee report by R. Kumar.', 'Then decide what to search for next.']);
  });

  it('merges short pieces backwards, the first one forwards', () => {
    const s = segmentReasoning('Okay. The user asks about the Delimitation Bill and its current stage. Fine. Search the desk rows first.');
    expect(s).toEqual(['Okay. The user asks about the Delimitation Bill and its current stage. Fine.', 'Search the desk rows first.']);
    for (const seg of s) expect(seg.length).toBeGreaterThanOrEqual(MIN_SEGMENT_CHARS);
  });

  it('caps the count and the length', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} is about twenty-nine chars.`).join(' ');
    const s = segmentReasoning(many);
    expect(s.length).toBe(MAX_REASONING_SEGMENTS);
    for (const seg of s) expect(seg.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
    expect(segmentReasoning('')).toEqual([]);
    expect(segmentReasoning(null)).toEqual([]);
  });
});
