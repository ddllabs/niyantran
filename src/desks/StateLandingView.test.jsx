import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./landing/useDeskLandingMotion.js', () => ({ default: () => ({ ref: { current: null }, paused: true, reduced: true, toggle: () => {} }), exploreDeskSectors: () => {} }));
import { StateLandingContent } from './StateLandingView.jsx';
import { ModuleDetail } from './landing/DeskLandingFrame.jsx';
import { STATE_PRESENTATION } from './landing/statePresentation.js';
import { DESK_IMAGES } from './landing/deskImages.js';
const modules = STATE_PRESENTATION.groups.flatMap(group => group.modules);
describe('State landing and terminal popups', () => {
  it('renders reference images and explicit partial geography without fake counts', () => {
    const html = renderToStaticMarkup(<StateLandingContent onFeature={() => {}}/>);
    expect(html).toContain('data-desk="state"');
    expect(html).toContain(DESK_IMAGES[STATE_PRESENTATION.image]);
    expect(html).toContain('35 reference modules + 6 retained destinations');
    expect(html).toContain('Goa constituencies by district');
    expect(html).toContain('Distribution unavailable');
    expect(html).not.toContain('Verified Records');
  });
  it.each(modules)('makes $feature popup target the State shell with its exact name', module => {
    const html = renderToStaticMarkup(<ModuleDetail tab="state" module={module} summary={{ availability: 'unavailable', count: null }} onOpen={() => {}}/>);
    expect(html).toContain(`href="/#/state/${encodeURIComponent(module.feature).replaceAll("'", "&#x27;")}"`);
    expect(html).not.toContain('href="/#/national/');
  });
});
