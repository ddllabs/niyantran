import { afterEach, describe, expect, it, vi } from 'vitest';

// F124: the bill-style National modules need their analysis pack and the ontology before an adapter
// runs; the panel host loads them once and passes them in ctx.packs. Other modules need none.
describe('record packs', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('loads the module\'s analysis pack and the ontology for a bill-style National module', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      seen.push(String(url));
      const body = /ontology/.test(url) ? { nodes: [] } : /identity/.test(url) ? null : { 0: { brief: 'x' } };
      return { ok: true, json: async () => body };
    }));
    const { loadRecordPacks } = await import('./packs.js');
    const packs = await loadRecordPacks('Parliamentary Question Database');
    expect(packs.ready).toBe(true);
    expect(packs.desk.key).toBe('question');
    expect(packs.analysis).toEqual({ 0: { brief: 'x' } });
    expect(packs.ontology).toEqual({ nodes: [] });
    expect(seen.some((u) => u.endsWith('national_question_database_analysis.json'))).toBe(true);
  });

  it('needs no packs for a module outside the bill-style desks', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { loadRecordPacks, packDeskFor } = await import('./packs.js');
    expect(packDeskFor('Cabinet Decisions')).toBeNull();
    expect(await loadRecordPacks('Cabinet Decisions')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades to empty packs when a file cannot be fetched, never throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { loadRecordPacks } = await import('./packs.js');
    const packs = await loadRecordPacks('Regulatory Body Watch (RBI/SEBI/TRAI/CCI)');
    expect(packs.ready).toBe(true);
    expect(packs.analysis).toEqual({});
    expect(packs.ontology).toBeNull();
  });
});
