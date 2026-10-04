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

    expect(html).toContain('national-landing');
    expect(html).toContain('National Intelligence');
    expect(html).toContain('The Republic,');
    expect(html).toContain('Records across registers');
    expect(html).toContain('Modules to explore');
    expect(html).toContain('Bill Passage Probability Index');
    expect(html).toContain('Parliamentary Question Database');
    expect(html).toContain('Bills by sector');
    expect(html).not.toContain('Verified Records');
  });

  it('retains the existing State landing', () => {
    const html = renderToStaticMarkup(<DeskLandingView tab="state" label="State" buckets={[]} onFeature={() => {}} />);
    expect(html).toContain('Electoral Returns by Alliance');
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
    expect(html).toContain('Where the desk looks');
    expect(html).toContain('Open Fronts');
    expect(html).toContain('Sanctions');
  });
});
