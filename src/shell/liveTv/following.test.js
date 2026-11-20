// B6: "My list", kept in the browser only. Storage can be missing, full, blocked or hold anything.
import { describe, expect, it } from 'vitest';
import { FOLLOW_KEY, FOLLOW_MAX, readFollowing, writeFollowing, toggleFollowing } from './following.js';

const memory = (initial) => {
  const m = new Map(initial ? [[FOLLOW_KEY, initial]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
};

describe('readFollowing', () => {
  it('is empty when nothing is stored', () => {
    expect(readFollowing(memory())).toEqual([]);
  });
  it('reads the ids in the order they were followed', () => {
    expect(readFollowing(memory(JSON.stringify({ v: 1, ids: ['b', 'a', 'c'] })))).toEqual(['b', 'a', 'c']);
  });
  it.each([
    ['not JSON', '{oops'],
    ['a number', '5'],
    ['an array', '["a"]'],
    ['an older version', JSON.stringify({ v: 0, ids: ['a'] })],
    ['a newer version', JSON.stringify({ v: 2, ids: ['a'] })],
    ['ids that are not a list', JSON.stringify({ v: 1, ids: 'a' })],
    ['null', 'null'],
  ])('is empty for %s', (_n, raw) => {
    expect(readFollowing(memory(raw))).toEqual([]);
  });
  it('keeps only text ids that look like channel ids, once each, up to the cap', () => {
    const ids = ['a', 'a', 5, null, { x: 1 }, '', '<script>', 'b b', 'ok-1', ...Array.from({ length: FOLLOW_MAX + 20 }, (_, i) => `c${i}`)];
    const out = readFollowing(memory(JSON.stringify({ v: 1, ids })));
    expect(out.slice(0, 3)).toEqual(['a', 'ok-1', 'c0']);
    expect(out).toHaveLength(FOLLOW_MAX);
    expect(new Set(out).size).toBe(out.length);
  });
  it('is empty when storage is missing or throws', () => {
    expect(readFollowing(undefined)).toEqual([]);
    expect(readFollowing(null)).toEqual([]);
    expect(readFollowing({ getItem() { throw new Error('blocked'); } })).toEqual([]);
  });
});

describe('writeFollowing', () => {
  it('stores a versioned list under one key', () => {
    const s = memory();
    writeFollowing(s, ['a', 'b']);
    expect(JSON.parse(s.m.get(FOLLOW_KEY))).toEqual({ v: 1, ids: ['a', 'b'] });
  });
  it('does not throw when storage is missing, full or blocked', () => {
    expect(() => writeFollowing(undefined, ['a'])).not.toThrow();
    expect(() => writeFollowing({ setItem() { throw new Error('quota'); } }, ['a'])).not.toThrow();
  });
});

describe('toggleFollowing', () => {
  it('adds at the end and removes from anywhere, never changing its input', () => {
    const start = ['a', 'b'];
    expect(toggleFollowing(start, 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleFollowing(start, 'a')).toEqual(['b']);
    expect(start).toEqual(['a', 'b']);
  });
  it('does not follow past the cap, but always lets one be removed', () => {
    const full = Array.from({ length: FOLLOW_MAX }, (_, i) => `c${i}`);
    expect(toggleFollowing(full, 'new')).toEqual(full);
    expect(toggleFollowing(full, 'c0')).toHaveLength(FOLLOW_MAX - 1);
  });
  it('ignores an id that is not text', () => {
    expect(toggleFollowing(['a'], undefined)).toEqual(['a']);
    expect(toggleFollowing(['a'], '')).toEqual(['a']);
  });
});

import { FOLLOW_FULL } from './following.js';

describe('the full list message', () => {
  it('says how many and what to do', () => {
    expect(FOLLOW_FULL).toBe('My list is full (60). Unfollow one first.');
  });
});
