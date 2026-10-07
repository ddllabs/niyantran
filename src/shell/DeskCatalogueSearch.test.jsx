import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import DeskCatalogueSearch, { CatalogueResults, CatalogueModuleCoverage, catalogueKeySelection } from './DeskCatalogueSearch.jsx';

const noop = () => {};
describe('catalogue discovery UI contract', () => {
  it('presents one discovery trigger instead of competing topbar inputs', () => {
    const html = renderToStaticMarkup(<DeskCatalogueSearch tabs={[]} recordTabs={[]} lockedIds={[]} onOpen={noop} />);
    expect(html).toContain('Find a module');
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).not.toContain('<input');
  });
  it('offers all 79 canonical entries with desk/group labels and honest restricted metadata', () => {
    const html = renderToStaticMarkup(<CatalogueResults results={DESK_CATALOGUE} selected={0} lockedIds={['economics']} listId="results" onSelect={noop} onHighlight={noop} />);
    expect((html.match(/role="option"/g) || [])).toHaveLength(79);
    expect(html).toContain('National / Legislative &amp; Policy Intelligence');
    expect(html).toContain('Economics / Market Intelligence');
    expect(html).toContain('Access restricted');
    expect(html).toContain('Music Charts — United States Top 25');
    expect(html).not.toContain('live records');
  });
  it('shows a useful no-results state without fabricated record totals', () => {
    const html = renderToStaticMarkup(<CatalogueResults results={[]} selected={0} lockedIds={[]} listId="results" onSelect={noop} onHighlight={noop} />);
    expect(html).toContain('No modules found');
    expect(html).not.toContain('role="option"');
  });
  it('presents denied metadata and its exact canonical CTA without showing loaded coverage', () => {
    const entry = DESK_CATALOGUE.find(entry => entry.feature === 'Economic Simulator');
    const html = renderToStaticMarkup(<CatalogueModuleCoverage entry={entry} restricted summary={{ count: 9999, availability: 'ready' }} titleId="title" onOpen={noop} retry={noop} />);
    expect(html).toContain('Access restricted');
    expect(html).toContain('Economics / Macro Indicators &amp; Models');
    expect(html).toContain('/#/economics/Economic%20Simulator');
    expect(html).not.toContain('9999');
    expect(html).not.toContain('No populated fields reported');
  });
  it('uses the shared coverage popup and distinguishes actual zero, failure and retry', () => {
    const entry = DESK_CATALOGUE.find(entry => entry.feature === 'Cricket Wire');
    const render = summary => renderToStaticMarkup(<CatalogueModuleCoverage entry={entry} summary={summary} titleId="title" onOpen={noop} retry={noop} />);
    expect(render({ count: 0, availability: 'empty', sourceMode: 'feed-backed' })).toContain('Feed-backed · empty');
    const error = render({ count: null, availability: 'error', sourceMode: 'unknown' });
    expect(error).toContain('Summary unavailable');
    expect(error).toContain('Retry summary');
    expect(error).toContain('/#/sports/Cricket%20Wire');
  });
  it('keeps arrow selection within results and safe for an empty catalogue', () => {
    expect(catalogueKeySelection('ArrowDown', 0, 3)).toBe(1);
    expect(catalogueKeySelection('ArrowUp', 0, 3)).toBe(0);
    expect(catalogueKeySelection('ArrowDown', 2, 3)).toBe(2);
    expect(catalogueKeySelection('ArrowDown', 0, 0)).toBe(0);
  });
});
