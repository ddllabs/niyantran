import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F145 (owner approved 2026-10-14): every file was served with max-age=0, must-revalidate, so a
// returning visitor re-checked every script, stylesheet and image.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const cacheFor = (source) => vercel.headers?.find((h) => h.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;

describe('deploy caching', () => {
  it('keeps the hashed build files for a year: their names change with their content', () => {
    expect(cacheFor('/assets/(.*)')).toBe('public, max-age=31536000, immutable');
  });

  it('keeps brand images for a day, refreshing in the background for a week', () => {
    expect(cacheFor('/brand/(.*)')).toBe('public, max-age=86400, stale-while-revalidate=604800');
  });

  it('caches nothing else this way: pages, data and the API keep their own rules', () => {
    expect(vercel.headers.map((h) => h.source).sort()).toEqual(['/assets/(.*)', '/brand/(.*)']);
  });
});
