// F190: the state picker on MLA Directory offers the register's 31 states, from the one list the
// server also uses for the stored variants (server/feedSchedule.mjs), so the two cannot drift.
import { describe, expect, it } from 'vitest';
import { MLA_STATES, MLA_STATE_NAMES, isMlaDirectory } from './mlaStates.js';
import { FEED_REGISTERS, MLA_STATES as SERVER_STATES, mlaStateVariant } from '../../server/feedSchedule.mjs';

describe('the MLA Directory state list (F190)', () => {
  it('is the 31 variants the server stores, in the same order', () => {
    expect(MLA_STATES).toHaveLength(31);
    expect([...MLA_STATES]).toEqual([...FEED_REGISTERS['state:MLA Directory'].values]);
    expect([...MLA_STATES]).toEqual([...SERVER_STATES]);
  });

  it('has each state once, and every name is its own server variant', () => {
    expect(new Set(MLA_STATES).size).toBe(MLA_STATES.length);
    for (const name of MLA_STATES) expect(mlaStateVariant(name), name).toBe(name);
  });

  it('keeps the server-side spellings and codes beside each name', () => {
    expect(MLA_STATE_NAMES.map(([name]) => name)).toEqual([...MLA_STATES]);
    expect(mlaStateVariant('up')).toBe('Uttar Pradesh');
    expect(mlaStateVariant('Orissa')).toBe('Odisha');
  });

  it('is frozen, so a page cannot change what the server reads', () => {
    expect(Object.isFrozen(MLA_STATES)).toBe(true);
  });

  it('names MLA Directory by tier and feature, and nothing else', () => {
    expect(isMlaDirectory('state', 'MLA Directory')).toBe(true);
    expect(isMlaDirectory('state', ' mla directory ')).toBe(true);
    expect(isMlaDirectory('state', 'MLA Report Card + Statement Tracker')).toBe(false);
    expect(isMlaDirectory('state', 'Constituency Register')).toBe(false);
    expect(isMlaDirectory('national', 'MLA Directory')).toBe(false);
    expect(isMlaDirectory(undefined, undefined)).toBe(false);
  });
});
