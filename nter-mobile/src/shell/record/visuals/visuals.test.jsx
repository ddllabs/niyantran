import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PanelMap from './PanelMap.jsx';
import StageTimeline from './StageTimeline.jsx';
import ValueBoard from './ValueBoard.jsx';

// F121: the record visuals say what they are. A map with an approximate marker says so; every visual
// is labelled for assistive technology.
describe('record visuals', () => {
  it('captions a map with any approximate marker as approximate and schematic', () => {
    const html = renderToStaticMarkup(<PanelMap title="Theatre on the map" visual={{ type: 'map', caption: 'Front placed by region.', points: [{ lat: 49, lon: 32, label: 'Russia–Ukraine', tone: 'red', main: true, approximate: true }] }} />);
    expect(html).toContain('Theatre on the map');
    expect(html).toContain('Front placed by region.');
    expect(html).toMatch(/approximate/i);
    expect(html).toMatch(/schematic/i);
    expect(html).toContain('aria-label="Map: Russia–Ukraine"');
  });

  it('does not call exact coordinates approximate', () => {
    const html = renderToStaticMarkup(<PanelMap title="Facility" visual={{ type: 'map', points: [{ lat: 47.5, lon: 34.6, label: 'Zaporizhzhia', tone: 'red', main: true }] }} />);
    expect(html).not.toMatch(/approximate/i);
  });

  it('marks done and current stages', () => {
    const html = renderToStaticMarkup(<StageTimeline title="Procurement stage" visual={{ type: 'timeline', steps: [{ label: 'Negotiation', done: true }, { label: 'Contract signed', now: true }, { label: 'Deliveries' }], caption: 'Step dates are not on record.' }} />);
    expect(html).toMatch(/class="rp-step done"[^>]*>[\s\S]*?Negotiation/);
    expect(html).toMatch(/class="rp-step now"[^>]*aria-current="step"[\s\S]*?Contract signed/);
    expect(html).toContain('Step dates are not on record.');
  });

  it('lists board values with their notes and tones, and its caption', () => {
    const html = renderToStaticMarkup(<ValueBoard title="Latest published year" right="World Bank" visual={{ type: 'board', caption: 'Annual series, not a forecast.', rows: [{ label: 'GDP growth', value: '6.5%', note: '2024', tone: 'green' }, { label: 'Unemployment', value: 'Not on record' }] }} />);
    expect(html).toContain('Latest published year');
    expect(html).toContain('World Bank');
    expect(html).toMatch(/<dt>GDP growth<small>2024<\/small><\/dt><dd class="rp-green-text">6.5%<\/dd>/);
    expect(html).toMatch(/<dt>Unemployment<\/dt><dd>Not on record<\/dd>/);
    expect(html).toContain('Annual series, not a forecast.');
  });

});
