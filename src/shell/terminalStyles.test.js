import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAZY_ROOTS, OUTPUT, render, staticImports, terminalStyles, walk } from '../../scripts/build-terminal-styles.mjs';

// F145: a signed-out visitor no longer downloads the terminal, admin or persona chooser; their
// stylesheets stay in the entry, in the same order, so the cascade does not change.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('terminal on demand', () => {
  it('keeps src/shell/terminalStyles.js in step with what the lazy modules import', () => {
    expect(read(OUTPUT), 'out of date: run npm run build:terminal-styles').toBe(render(terminalStyles()));
    expect(terminalStyles().length).toBeGreaterThan(10);
  });

  it('loads the terminal, admin and chooser lazily from App.jsx, with their styles where the terminal was', () => {
    const app = read('src/App.jsx');
    expect(app).not.toMatch(/^import .* from '\.\/(shell\/TerminalShell|admin\/AdminApp|shell\/PersonaChooser)\.jsx';$/m);
    const imports = [...app.matchAll(/^import .*?'([^']+)';$/gm)].map(m => m[1]);
    expect(imports.slice(1, 4)).toEqual(['./marketing/MarketingSite.jsx', './marketing/legalRoutes.js', './shell/terminalStyles.js']);
    expect(app).toMatch(/const TerminalShell = lazy\(loadTerminal\);/);
    expect(app).toMatch(/const AdminApp = lazy\(\(\) => import\('\.\/admin\/AdminApp\.jsx'\)\);/);
    expect(app).toMatch(/const PersonaChooser = lazy\(\(\) => import\('\.\/shell\/PersonaChooser\.jsx'\)\);/);
  });

  it('reaches none of the lazy modules from the entry, yet every stylesheet they need', () => {
    const modules = new Set();
    const entryStyles = walk(['src/main.jsx'], { modules });
    const reached = [...modules].map(m => m.slice(m.indexOf('/src/') + 1));
    LAZY_ROOTS.forEach(r => expect(reached, r).not.toContain(r));
    const lazyStyles = walk(LAZY_ROOTS);
    lazyStyles.forEach(s => expect(entryStyles, s).toContain(s));
  });

  // Review: forms the scanner must read, and the ones it must not follow.
  it('reads imports with comments inside braces, without spaces, and skips commented-out ones', () => {
    const code = [
      "import { a, // the first",
      "  b, /* the second */ c } from './m.js';",
      "import'./tight.css';",
      "// import './commented.css';",
      "/* import './blocked.css'; */",
      "export * from './re.js';",
      "const url = 'https://example.com/x.css';",
      "const note = 'see src/data/personas/*.md';",
      "import './after-note.css';",
      "const later = () => import('./lazy.jsx');",
    ].join('\n');
    expect(staticImports(code)).toEqual(['./m.js', './tight.css', './re.js', './after-note.css']);
  });
});

