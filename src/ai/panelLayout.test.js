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
