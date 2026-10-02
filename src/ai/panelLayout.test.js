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
