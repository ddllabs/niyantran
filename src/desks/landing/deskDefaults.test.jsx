import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskLandingFrame from './DeskLandingFrame.jsx';
import { DESK_DEFAULTS } from './deskDefaults.js';
import { DESK_CATALOGUE } from './deskCatalogue.js';
import { TABS, modulesForTier, bucketsFor } from '../catalog.js';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { STATE_PRESENTATION } from './statePresentation.js';

describe('direct sector entry', () => {
  // Sector fronts reveal module links on the reverse; they never open a default module.
  it('picture cards select their sector and open nothing', () => {
    for (const presentation of [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION, STATE_PRESENTATION]) {
      const html = renderToStaticMarkup(<DeskLandingFrame presentation={presentation} onFeature={() => {}}/>);
      const pictureGrid = html.match(/<section[^>]*class="sector-grid"[\s\S]*?<\/section>/)?.[0];
      expect(pictureGrid).toBeDefined();
      expect(pictureGrid).toContain('href=');
      expect(pictureGrid).not.toContain('lucide-arrow-up-right');
      expect(pictureGrid).not.toContain('lucide-arrow-right');
      expect(pictureGrid).not.toContain('lucide-arrow-left');
      expect((pictureGrid.match(/<button[^>]*class="sector-card sector-front"/g) || []).length).toBe(presentation.groups.length);
      expect((pictureGrid.match(/aria-expanded="true"/g) || []).length).toBe(0);
      expect(pictureGrid).toMatch(/aria-controls="[^"]+-modules"/);
      for (const module of presentation.groups[0].modules) {
        expect(html).toContain(`href="/${deskHash(presentation.id, module.feature)}"`);
      }
    }
  });
  it('all 35 defaults belong to their sectors and all 120 modules retain canonical menu routes', () => {
    expect(Object.values(DESK_DEFAULTS).flatMap(Object.values)).toHaveLength(35);
    expect(DESK_CATALOGUE).toHaveLength(120);
    for (const [tab, groups] of Object.entries(DESK_DEFAULTS)) for (const [group, feature] of Object.entries(groups)) {
      expect(DESK_CATALOGUE.some(m => m.tab === tab && m.groupId === group && m.feature === feature && m.configured)).toBe(true);
    }
    for (const m of DESK_CATALOGUE) {
      const tab = TABS.find(t => t.id === m.tab);
      const group = bucketsFor(modulesForTier(tab.tier), tab.tier).find(g => g.label === m.group);
      expect(group.items.some(n => n.htmlTier === m.tier && n.htmlFeature === m.feature)).toBe(true);
      expect(parseDeskHash(deskHash(m.tab, m.feature))).toEqual({ tab: m.tab, feature: m.feature });
    }
  });
});
