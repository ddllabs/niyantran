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
  it('picture cards link to their explicit defaults without a module-picker step', () => {
    for (const presentation of [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION, STATE_PRESENTATION]) {
      const html = renderToStaticMarkup(<DeskLandingFrame presentation={presentation} onFeature={() => {}}/>);
      for (const feature of Object.values(DESK_DEFAULTS[presentation.id])) {
        expect(html).toContain(`href="/${deskHash(presentation.id, feature)}"`);
      }
      expect(html).not.toContain('class="module-item"');
      expect(html).not.toContain('aria-controls=');
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
