import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F140 T1: the homepage globe module (<nter-data-globe>). It is imported here in
// Node, where there is no window, document or customElements, so the import
// itself is part of what is tested.
const SOURCE = readFileSync(new URL('./nterGlobe.js', import.meta.url), 'utf8');
const PUBLIC = new URL('../../public/', import.meta.url);

describe('nterGlobe module', () => {
  it('imports in Node without touching window, document or customElements', async () => {
    expect(typeof customElements).toBe('undefined');
    await expect(import('./nterGlobe.js')).resolves.toBeDefined();
  });

  it('lists the seven design items, in order, with the design titles', async () => {
    const { ITEMS } = await import('./nterGlobe.js');
    expect(ITEMS.map(i => [i.key, i.title])).toEqual([
      ['bills', 'Bills'],
      ['law', 'Laws & judgments'],
      ['regulatory', 'Regulatory notes'],
      ['news', 'News & reporting'],
      ['questions', 'Parliamentary questions'],
      ['economics', 'Economic indicators'],
      ['global', 'Global affairs'],
    ]);
    ITEMS.forEach(i => {
      expect(i.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(i.icon.length).toBeGreaterThan(10);
    });
  });

  it('loads textures and the fallback from /brand/auth-earth files that exist', async () => {
    const { TEXTURE_URLS } = await import('./nterGlobe.js');
    expect(Object.keys(TEXTURE_URLS).sort()).toEqual(['clouds', 'day', 'fallback', 'oceans']);
    Object.values(TEXTURE_URLS).forEach(url => {
      expect(url).toMatch(/^\/brand\/auth-earth\/[a-z]+\.jpg$/);
      expect(existsSync(new URL(url.slice(1), PUBLIC)), url).toBe(true);
    });
  });

  it('embeds no base64 data (the textures are served files)', () => {
    expect(SOURCE).not.toMatch(/base64,/);
    expect(SOURCE).not.toMatch(/[A-Za-z0-9+/=]{300,}/);
  });

  it('puts each orbit plane half in front of Earth and half behind it', async () => {
    const { PLANES, projectOrbit } = await import('./nterGlobe.js');
    expect(PLANES).toHaveLength(2);
    PLANES.forEach(plane => {
      const zs = Array.from({ length: 72 }, (_, i) => projectOrbit(plane, i * 2 * Math.PI / 72, 600).z);
      expect(zs.some(z => z < 0)).toBe(true);
      expect(zs.some(z => z > 0)).toBe(true);
    });
  });

  it('scales and fades a label with depth: nearer is larger and more opaque', async () => {
    const { PLANES, projectOrbit } = await import('./nterGlobe.js');
    PLANES.forEach(plane => {
      const front = projectOrbit(plane, Math.PI / 2, 600);
      const back = projectOrbit(plane, -Math.PI / 2, 600);
      expect(front.z).toBeGreaterThan(0);
      expect(back.z).toBeLessThan(0);
      expect(front.scale).toBeGreaterThan(back.scale);
      expect(front.opacity).toBeGreaterThan(back.opacity);
      expect(back.opacity).toBeGreaterThan(0.75);
      expect(front.opacity).toBeLessThanOrEqual(1.0001);
    });
  });

  it('registers the element only through a guarded define', () => {
    expect(SOURCE).toMatch(/typeof customElements/);
    expect(SOURCE).toMatch(/customElements\.get\('nter-data-globe'\)/);
    expect(SOURCE).toMatch(/new CustomEvent\('data-select',\s*\{\s*detail:\s*\{\s*key/);
  });
});
