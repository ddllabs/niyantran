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

  it('dispatches National to the full v6 presentation with source-aware summaries', () => {
    const html = renderToStaticMarkup(
      <DeskLandingView
        tab="national"
        label="National Intelligence"
        buckets={sampleBuckets}
        onFeature={() => {}}
      />
    );

    expect(html).toContain('desk-v6');
    expect(html).toContain('National');
    expect(html).toContain('A nation&#x27;s decisions.');
    expect(html).toContain('Records on file');
    expect(html).toContain('17 modules');
    expect(html).toContain('Bill Passage Probability Index');
    expect(html).toContain('Parliamentary Question Database');
    expect(html).toContain('Bills by sector');
    expect(html).not.toContain('Verified Records');
  });

  it('dispatches State to its source-aware v6 landing', () => {
    const html = renderToStaticMarkup(<DeskLandingView tab="state" label="State" buckets={[]} onFeature={() => {}} />);
    expect(html).toContain('data-desk="state"');
    expect(html).toContain('Goa constituencies by district');
    expect(html).toContain('41 modules');
    expect(html).not.toContain('national-landing');
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
    expect(html).toContain('desk-v6');
    expect(html).toContain('The world, through five lenses.');
    expect(html).toContain('16 modules');
    expect(html).toContain('Open Fronts');
    expect(html).toContain('Geopolitics News Wire');
  });
});
