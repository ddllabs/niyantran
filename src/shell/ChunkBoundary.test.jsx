import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChunkBoundary from './ChunkBoundary.jsx';

// Review (F145): the terminal now loads on demand, so a failed download (a deploy since the page
// opened, or the network) would unmount the app and leave a white screen. The boundary offers a reload.
// React runs error boundaries only in the browser, so the boundary is driven through its own methods.
describe('ChunkBoundary', () => {
  it('shows its children until something below it fails', () => {
    const boundary = new ChunkBoundary({ children: <p>terminal</p> });
    expect(renderToStaticMarkup(boundary.render())).toBe('<p>terminal</p>');
  });

  it('offers a reload when a part of the app fails to load', () => {
    const boundary = new ChunkBoundary({ children: <p>terminal</p> });
    boundary.state = { ...boundary.state, ...ChunkBoundary.getDerivedStateFromError(new Error('Failed to fetch dynamically imported module')) };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('role="alert"');
    expect(html).toContain('This page could not finish loading.');
    expect(html).toMatch(/<button type="button" class="app-load-retry">Reload<\/button>/);
    expect(html).not.toContain('terminal');
  });
});
