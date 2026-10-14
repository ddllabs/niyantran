import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F145 (owner approved 2026-10-14): every file was served with max-age=0, must-revalidate, so a
// returning visitor re-checked every script, stylesheet and image.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const cacheFor = (source) => vercel.headers?.find((h) => h.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;

describe('deploy caching', () => {
  // Owner 2026-10-14 (after the live check): Vercel applies headers to 404s too, so the rule covers
  // only the top-level build files Vite emits; a 404 for anything else under /assets/ is not
  // remembered for a year.
  it('keeps the hashed build files for a year, and only them: their names change with their content', () => {
    expect(cacheFor('/assets/([^/]+)')).toBe('public, max-age=31536000, immutable');
    const source = new RegExp(`^${'/assets/([^/]+)'}$`);
    for (const built of ['/assets/index-DMZyeH5j.js', '/assets/index-U4dvl4lu.css', '/assets/pdf.worker.min-rsCePomN.mjs', '/assets/cursor-editorTextHighlight-kG3uUOwL.svg']) {
      expect(source.test(built), built).toBe(true);
    }
    expect(source.test('/assets/uploads/9f81b07d6546ab87bbe5e498890a5b6d54aad173.jpg')).toBe(false);
  });

  it('keeps brand images for a day, refreshing in the background for a week', () => {
    expect(cacheFor('/brand/(.*)')).toBe('public, max-age=86400, stale-while-revalidate=604800');
  });

  // F154 (owner approved 2026-10-14): shipped data files revalidated on every visit; a returning
  // visitor now reuses them for five minutes and gets a stale copy at once while one is fetched.
  it('keeps shipped data files for five minutes, refreshing in the background for a day', () => {
    expect(cacheFor('/data/(.*)')).toBe('public, max-age=300, stale-while-revalidate=86400');
  });

  it('caches nothing else this way: pages and the API keep their own rules', () => {
    expect(vercel.headers.map((h) => h.source).sort()).toEqual(['/assets/([^/]+)', '/brand/(.*)', '/data/(.*)']);
  });

  // F154: the function ran in iad1 (US East) while users and Supabase (ap-south-1) are in India.
  it('runs the API in Mumbai, next to the database', () => {
    expect(vercel.regions).toEqual(['bom1']);
  });
});
