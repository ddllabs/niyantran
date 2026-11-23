import { describe, expect, it } from 'vitest';
import * as sample from './sample.js';
import { ALL_MODULES } from '../data/desks.js';
import { applyFrame, newTurn } from './chatState.js';

const mod = (feature) => ALL_MODULES.find((m) => m.feature === feature);

describe('the sample service (no network)', () => {
  it('serves module rows from the bundled snapshot', async () => {
    const r = await sample.moduleFeed({ module: mod('Bill Passage Probability Index') });
    expect(r.rows.length).toBeGreaterThan(5);
    expect(r.total).toBe(9819);
    expect(r.columns.length).toBeGreaterThan(2);
  });
  it('fills most modules from the archive or the feed store', async () => {
    let filled = 0;
    for (const m of ALL_MODULES) if ((await sample.moduleFeed({ module: m })).rows.length) filled += 1;
    expect(filled).toBeGreaterThanOrEqual(100);
  });
  it('searches records across desks', async () => {
    const hits = await sample.searchRecords('tribunal');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty('feature');
  });
  it('answers with labelled, cited frames', async () => {
    let t = newTurn({ question: 'Q' });
    await sample.sendTurn({ message: 'What is this?', attachments: [{ kind: 'row', title: 'A bill', text: 'Module: X\nhouse: Lok Sabha', feature: 'X', tier: 'national' }] }, { onFrame: (f) => { t = applyFrame(t, f); } });
    expect(t.status).toBe('complete');
    expect(t.text).toContain('sample-mode');
    expect(t.sources[0]).toMatchObject({ id: 1, kind: 'row', title: 'A bill' });
  });
  it('simulates sign-in on the device only', async () => {
    await expect(sample.signIn({ email: 'bad', password: 'x' })).rejects.toThrow();
    const s = await sample.signIn({ email: 'a@b.co', password: 'secret1' });
    expect(s.user.email).toBe('a@b.co');
    await sample.signOut();
    expect(await sample.getSession()).toBeNull();
  });
});
