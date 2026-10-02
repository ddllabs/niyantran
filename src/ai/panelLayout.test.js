import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// F46: the composer floated mid-panel. research.css gives the research shell `display: block` so
// its one wrapper (.ai-panel-background, a four-row grid at height 100%) fills it. But main.jsx
// imports App (and so research.css) before index.css, and index.css's `.ai-shell` and
// `.ai-shell-v2` set `display: grid` at the same specificity, later, so they won: the wrapper
// landed in an `auto` grid row and shrank to its content. Layout cannot run in this suite, so this
// resolves the cascade for the shell's classes in the shipped order.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SHELL = ['ai-shell', 'ai-shell-v2', 'ai-shell-research'];

/** The winning value of `prop` for an element with exactly these classes (class-only selectors). */
function cascade(sheets, classes, prop) {
  let best = null;
  let order = 0;
  for (const css of sheets) {
    postcss.parse(css).walkRules((rule) => {
      if (rule.parent?.type === 'atrule') return; // media and other at-rules are not the default state
      for (const sel of rule.selectors) {
        if (!/^(\.[\w-]+)+$/.test(sel.trim())) continue;
        const need = sel.trim().slice(1).split('.');
        if (!need.every((c) => classes.includes(c))) continue;
        rule.walkDecls(prop, (d) => {
          order += 1;
          const rank = [d.important ? 1 : 0, need.length, order];
          if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
            best = { value: d.value, sel, rank };
          }
        });
      }
    });
  }
  return best?.value;
}

describe('the research panel fills its shell', () => {
  it('ships with the component CSS before index.css (the order this test assumes)', () => {
    const main = read('../main.jsx');
    expect(main.indexOf("import App from './App.jsx'")).toBeGreaterThanOrEqual(0);
    expect(main.indexOf("import App from './App.jsx'")).toBeLessThan(main.indexOf("import './index.css'"));
  });

  it('the research shell is a block, so its grid wrapper takes the full height', () => {
    const sheets = [read('./research.css'), read('../index.css')];
    expect(cascade(sheets, SHELL, 'display')).toBe('block');
  });
});

// chat-panel-fixes (F47): the panel's regions (head, chrome, body, foot) sit inside
// .ai-panel-background (AiPanel.jsx), so a rule written `.ai-shell-v2 > .ai-v2-body` matches nothing:
// the history-open dimming, and the regions' stacking, never applied.
describe('rules on the panel\'s regions match its structure', () => {
  const REGION = /\.ai-v2-(head|chrome|body|foot)\b/;
  const regionRules = () => {
    const found = [];
    for (const file of ['../index.css', './research.css']) {
      postcss.parse(read(file)).walkRules((rule) => {
        for (const sel of rule.selectors) if (sel.includes('ai-shell-v2') && REGION.test(sel)) found.push({ file, sel: sel.trim(), rule });
      });
    }
    return found;
  };

  it('every .ai-shell-v2 rule on a region reaches it through .ai-panel-background', () => {
    const wrong = regionRules().filter(({ sel }) => /ai-shell-v2[\w.-]*\s*>\s*\.ai-v2-/.test(sel));
    expect(wrong.map((r) => r.sel)).toEqual([]);
  });

  it('while history is open, the panel behind it is dimmed and takes no pointer events', () => {
    const dim = regionRules().find(({ sel }) => sel.includes('.history-open') && sel.includes('.ai-panel-background > .ai-v2-body'));
    expect(dim).toBeTruthy();
    const decls = {};
    dim.rule.walkDecls((d) => { decls[d.prop] = d.value; });
    expect(decls['pointer-events']).toBe('none');
    expect(Number(decls.opacity)).toBeLessThan(1);
  });
});

// chat-panel-fixes (F47): at 375 × 812 the open dock got 40% of the workspace (268 px), and the
// panel's fixed parts (head, controls, composer) take about that much, so the thread was 18 px tall.
// On a phone the open dock takes the whole workspace; the desk stays mounted, collapsed, until it closes.
describe('on a phone, the open AI dock takes the workspace', () => {
  const phoneRules = () => {
    const found = [];
    postcss.parse(read('../index.css')).walkAtRules('media', (at) => {
      if (!/max-width:\s*640px/.test(at.params)) return;
      at.walkRules((rule) => { for (const sel of rule.selectors) found.push({ sel: sel.trim(), rule }); });
    });
    return found;
  };
  const decl = (rule, prop) => { let v; rule.walkDecls(prop, (d) => { v = d.value; }); return v; };

  it('the workspace gives the dock every row of its height', () => {
    const ws = phoneRules().find(({ sel }) => sel === '.workspace.ai-open');
    expect(ws).toBeTruthy();
    expect(decl(ws.rule, 'grid-template-rows')).toMatch(/^0(px)?\s+minmax\(0,\s*1fr\)/);
  });

  it('the desk is collapsed, not removed, while the dock is open', () => {
    const main = phoneRules().find(({ sel }) => sel === '.workspace.ai-open > .main-col');
    expect(main).toBeTruthy();
    expect(decl(main.rule, 'visibility')).toBe('hidden');
    expect(decl(main.rule, 'display')).toBeUndefined();
  });
});

// F47 leftovers. Measured at 375 × 812: the history list sat at x = -47, anchored to its button's
// right edge (x 255) and 300 px wide; the header's search box was 16 px wider than the header (a
// 100% width plus its padding and border); and the header's actions needed 280 px against the
// 227 px left beside the brand, so the bar scrolled the account button out of view.
describe('on a phone, the header and the history list stay on screen', () => {
  const mediaRules = (width) => {
    const found = [];
    postcss.parse(read('../index.css')).walkAtRules('media', (at) => {
      if (!new RegExp(`max-width:\\s*${width}px`).test(at.params)) return;
      at.walkRules((rule) => { for (const sel of rule.selectors) found.push({ sel: sel.trim(), rule }); });
    });
    return found;
  };
  const decl = (rule, prop) => { let v; rule.walkDecls(prop, (d) => { v = d.value; }); return v; };
  const find = (rules, sel, prop) => rules.filter((r) => r.sel === sel).map((r) => decl(r.rule, prop)).filter(Boolean).pop();

  it('the history list anchors to the panel head, not to its button', () => {
    expect(find(mediaRules(640), '.ai-v2-history-wrap', 'position')).toBe('static');
    expect(find(mediaRules(640), '.ai-v2-history-pop', 'right')).toBe('16px');
  });

  it('the search box counts its padding and border inside its width', () => {
    expect(find(mediaRules(900), '.cmd', 'box-sizing')).toBe('border-box');
  });

  it('the bar drops its duplicate logout button, which the account menu keeps', () => {
    expect(find(mediaRules(900), '.top-actions > .logout-btn', 'display')).toBe('none');
    expect(read('../shell/TerminalShell.jsx')).toMatch(/className="profile-pop-actions"[\s\S]*?className="logout-btn"/);
    expect(find(mediaRules(640), '.top-actions', 'gap')).toBe('4px');
  });

  // Below 900 px the bar scrolls sideways (overflow-x: auto), which also clips the account menu,
  // absolutely positioned inside it, to the bar's 32 px. The menu is fixed there, so the bar
  // cannot clip it and Log out stays reachable.
  it('the account menu is not clipped by the scrolling bar', () => {
    expect(find(mediaRules(900), '.top-actions', 'overflow-x')).toBe('auto');
    expect(find(mediaRules(900), '.profile-pop', 'position')).toBe('fixed');
  });
});

// source-list spec (F51): the sources list had no rules at all, so the browser drew default grey
// buttons in a bulleted list ("it looks like windows 98").
describe('the sources list under an answer is styled', () => {
  const rulesFor = (sel) => {
    const found = [];
    postcss.parse(read('./research.css')).walkRules((rule) => {
      if (rule.selectors.some((s) => s.trim() === sel)) found.push(rule);
    });
    return found;
  };
  const decl = (sel, prop) => rulesFor(sel).flatMap((r) => { const v = []; r.walkDecls(prop, (d) => v.push(d.value)); return v; }).pop();

  it('the list drops its bullets and indent and draws one bordered group', () => {
    expect(decl('.ai-sources', 'list-style')).toBe('none');
    expect(decl('.ai-sources', 'padding')).toBe('0');
    expect(decl('.ai-sources', 'border')).toMatch(/var\(--ai-line/);
  });

  it('a row is a flat, full-width button with a visible keyboard focus', () => {
    expect(decl('.ai-source-chip', 'background')).toBe('transparent');
    expect(decl('.ai-source-chip', 'border')).toBe('0');
    expect(decl('.ai-source-chip', 'width')).toBe('100%');
    expect(decl('.ai-source-chip:focus-visible', 'outline')).toMatch(/var\(--ai-blue/);
  });
});

// side-panel spec point 2 (owner decision 1): one docked width for Desk, Record and AI. The grid
// had a rule per tab (33%, 35% and 38%), so the panel jumped on every switch.
describe('the side panel has one width on every tab', () => {
  const desktopRules = () => {
    const found = [];
    postcss.parse(read('../index.css')).walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /max-width:\s*(900|640)px/.test(rule.parent.params)) return; // stacked layouts
      for (const sel of rule.selectors) {
        if (!/^\.workspace(\.[\w-]+)*$/.test(sel.trim())) continue;
        rule.walkDecls('grid-template-columns', (d) => found.push({ sel: sel.trim(), value: d.value, media: rule.parent?.params ?? null }));
      }
    });
    return found;
  };

  it('every two-column workspace rule sizes the panel from the one chosen width, clamped to 340 px and 60%', () => {
    const twoColumn = desktopRules().filter((r) => r.value.trim() !== '1fr' && !r.sel.includes('panel-collapsed'));
    expect(twoColumn.length).toBeGreaterThan(0);
    for (const r of twoColumn) expect(r.value.replace(/\s+/g, ' ')).toBe('minmax(0, 1fr) clamp(340px, var(--panel-chosen, 36%), 60%)');
  });

  it('collapsed, the panel is a 32 px handle', () => {
    expect(desktopRules().find((r) => r.sel === '.workspace.panel-collapsed')?.value).toBe('minmax(0, 1fr) 32px');
  });
});

// side-panel T5: the rail and the dock are tabs of the side panel now. Their old chrome is gone, so
// no stylesheet may style it, and only the panel draws the panel's left border.
describe('the side panel owns the right of the workspace', () => {
  const sheets = () => ['../index.css', './research.css', '../shell/panel-overlay.css'].map((p) => ({ p, root: postcss.parse(read(p)) }));

  it('no rule names the rail\'s removed tab strip (.rail-tabs)', () => {
    const found = [];
    for (const { p, root } of sheets()) root.walkRules((r) => { if (r.selectors.some((s) => /\.rail-tabs(?![\w-])/.test(s))) found.push(`${p}: ${r.selector}`); });
    expect(found).toEqual([]);
  });

  it('the tab panels inside it draw no left border of their own; the panel draws one', () => {
    const borders = {};
    for (const { root } of sheets()) {
      root.walkRules((r) => {
        if (r.parent?.type === 'atrule') return;
        for (const sel of r.selectors.map((s) => s.trim())) {
          if (!['.right-rail', '.ai-dock', '.side-panel'].includes(sel)) continue;
          r.walkDecls(/^border-left/, (d) => { borders[sel] = d.value; });
        }
      });
    }
    expect(borders['.side-panel']).toMatch(/1px solid/);
    expect(borders['.right-rail']).toBeUndefined();
    expect(borders['.ai-dock']).toBeUndefined();
  });
});

// side-panel spec point 6: below 900 px the panel stacks under the desk. Expand has nothing to do
// there, and the collapsed handle becomes a slim bar under the desk instead of a side strip.
describe('the side panel when stacked (900 px and below)', () => {
  const stacked = () => {
    const found = [];
    postcss.parse(read('../index.css')).walkAtRules('media', (at) => {
      if (!/max-width:\s*900px/.test(at.params)) return;
      at.walkRules((rule) => { for (const sel of rule.selectors) found.push({ sel: sel.trim(), rule }); });
    });
    return found;
  };
  const decl = (sel, prop) => stacked().filter((r) => r.sel === sel).map((r) => { let v; r.rule.walkDecls(prop, (d) => { v = d.value; }); return v; }).filter(Boolean).pop();

  it('hides Expand, with a selector that outranks the action buttons\' display rule', () => {
    // .side-panel-actions button (one class, one element) sets display: grid; a bare
    // .side-panel-expand would lose to it (measured in the browser, 2026-10-03).
    expect(decl('.side-panel-actions .side-panel-expand', 'display')).toBe('none');
    expect(decl('.side-panel-expand', 'display')).toBeUndefined();
  });

  it('collapsed, the panel row shrinks to the handle, laid out across', () => {
    expect(decl('.workspace.panel-collapsed', 'grid-template-rows')).toBe('minmax(0, 1fr) auto');
    expect(decl('.side-panel-handle', 'flex-direction')).toBe('row');
    expect(decl('.side-panel-handle button', 'writing-mode')).toBe('horizontal-tb');
  });
});
