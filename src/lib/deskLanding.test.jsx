import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskLandingView from '../desks/DeskLandingView.jsx';

describe('Desk Landing Architecture & Views', () => {
  const sampleBuckets = [
    {
      label: 'Parliamentary Register',
      items: [
        { htmlFeature: 'Bill Passage Probability Index', title: 'Bill Passage Probability Index' },
        { htmlFeature: 'Parliamentary Question Database', title: 'Parliamentary Question Database' },
      ],
    },
    {
      label: 'Executive & Tenders',
      items: [
        { htmlFeature: 'Central Tender Aggregator + Constituency Filter', title: 'Central Tender Aggregator + Constituency Filter' },
      ],
    },
  ];

  it('renders desk landing view with live counters and module capability cards', () => {
    const html = renderToStaticMarkup(
      <DeskLandingView
        tab="national"
        label="National Intelligence"
        buckets={sampleBuckets}
        onFeature={() => {}}
      />
    );

    // Header & identity
    expect(html).toContain('desk-landing-view');
    expect(html).toContain('National Intelligence');
    expect(html).toContain('Desk Intelligence &amp; Registers');

    // Live counters strip
    expect(html).toContain('desk-counters-grid');
    expect(html).toContain('Verified Records');
    expect(html).toContain('Distinct Sectors/Stages');
    expect(html).toContain('Primary Sources');
    expect(html).toContain('Active Modules');
    expect(html).toContain('3'); // 3 sample modules

    // Module capability cards
    expect(html).toContain('Parliamentary Register');
    expect(html).toContain('Bill Passage Probability Index');
    expect(html).toContain('Parliamentary Question Database');
    expect(html).toContain('Executive &amp; Tenders');
    expect(html).toContain('Launch Module →');

    // Chart container
    expect(html).toContain('desk-chart-section');
    expect(html).toContain('Bill Distribution by Legislative Stage');
  });

  it('renders desk landing correctly for Geopolitics / Global desk', () => {
    const globalBuckets = [
      {
        label: 'Fronts & Hostilities',
        items: [
          { htmlFeature: 'Open Fronts', title: 'Open Fronts' },
          { htmlFeature: 'Sanctions', title: 'Sanctions' },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <DeskLandingView
        tab="global"
        label="Global Intelligence"
        buckets={globalBuckets}
        onFeature={() => {}}
      />
    );

    expect(html).toContain('Global Intelligence');
    expect(html).toContain('Fronts by Geopolitical Theatre');
    expect(html).toContain('Open Fronts');
    expect(html).toContain('Sanctions');
  });
});
