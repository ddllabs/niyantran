import { describe, expect, it } from 'vitest';
import features from '../../data/html-feature-map.json';
import { NATIONAL_PRESENTATION, summarizeModules, moduleAvailability } from './deskPresentation.js';

describe('v6 desk presentation contract', () => {
  it('maps every National reference entry to its own canonical feature', () => {
    const modules = NATIONAL_PRESENTATION.groups.flatMap(group => group.modules);
    expect(modules).toHaveLength(17);
    expect(new Set(modules.map(module => module.feature)).size).toBe(17);
    for (const module of modules) expect(features.some(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toBe(true);
    expect(modules.find(module => module.title === 'Policy Pipeline Tracker').feature).toBe('Policy Pipeline Tracker (Draft-to-Gazette)');
  });
  it('preserves an unknown total, legitimate zero, partial coverage and shared bills', () => {
    const modules = [{ feature: 'bill' }, { feature: 'graph' }, { feature: 'unknown' }];
    expect(summarizeModules(modules, {}).count).toBeNull();
    const summaries = { bill: { count: 9, resourceKey: 'bills' }, graph: { count: 9, resourceKey: 'bills' } };
    expect(summarizeModules(modules, summaries)).toMatchObject({ count: 9, loaded: 1, pending: 1, knownModules: 2 });
    expect(summarizeModules([{ feature: 'empty' }], { empty: { count: 0, resourceKey: 'empty', availability: 'empty' } }).count).toBe(0);
  });
  it('totals only record counts, not reports, projections, promises or data points (F404)', () => {
    const modules = ['bills', 'brief', 'delim', 'promises', 'budget', 'industry', 'plain'].map(feature => ({ feature }));
    const summaries = {
      bills: { count: 100, unit: 'records', resourceKey: 'bills' },
      brief: { count: 171, unit: 'reports', resourceKey: 'brief' },
      delim: { count: 753, unit: 'projection outputs', resourceKey: 'delim' },
      promises: { count: 40, unit: 'promises', resourceKey: 'promises' },
      budget: { count: 13, unit: 'schemes and headline figures', resourceKey: 'budget' },
      industry: { count: 26, unit: 'data points', resourceKey: 'industry' },
      plain: { count: 5, resourceKey: 'plain' },
    };
    // A summary with no unit (Global's) is still counted; every other unit is left out of the total.
    expect(summarizeModules(modules, summaries)).toMatchObject({ count: 105, loaded: 2, knownModules: 7, pending: 0 });
    // Desks that label their total as mixed units ask for all of them.
    expect(summarizeModules(modules, summaries, { allUnits: true }).count).toBe(100 + 171 + 753 + 40 + 13 + 26 + 5);
  });
  it('does not promote a configured source into retrieved coverage', () => {
    expect(moduleAvailability({ configured: true }, undefined)).toBe('Loading summary');
    expect(moduleAvailability({ configured: true }, { availability: 'error', count: null })).toBe('Summary unavailable');
    expect(moduleAvailability({ configured: false }, { availability: 'empty', count: 0, sourceMode: 'unknown' })).toBe('Not connected');
    expect(moduleAvailability({ configured: true }, { availability: 'empty', count: 0, sourceMode: 'stored' })).toBe('Stored register · empty');
  });
});
