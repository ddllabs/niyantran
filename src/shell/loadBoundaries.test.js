import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { staticImports, walk } from '../../scripts/build-terminal-styles.mjs';

it('keeps unrelated routes and optional panels outside the terminal static dependency closure', () => {
  const modules = new Set();
  walk(['src/shell/TerminalShell.jsx'], { modules });
  const paths=[...modules].map(p=>p.replace(process.cwd()+'/', ''));
  for(const path of ['src/desks/HomeDesk.jsx','src/desks/DeskView.jsx','src/desks/DeskLandingView.jsx','src/shell/credits/CreditsPage.jsx','src/shell/LiveTvModal.jsx','src/ai/AiPanel.jsx']) expect(paths,path).not.toContain(path);
});
it('does not eagerly ship unrelated archive snapshots with shared chat/catalogue code', () => {
  const source=readFileSync(new URL('../lib/archiveFeed.js',import.meta.url),'utf8');
  const imports=staticImports(source);
  for(const pack of ['alliances','sanctions','global-aid','nuclear-watch']) expect(imports).not.toContain(`../data/${pack}.json`);
});
it('marks every existing TV opener as visited, including events and the hash entry', () => {
  const source=readFileSync(new URL('./TerminalShell.jsx',import.meta.url),'utf8');
  for(const fn of ['function onOpenLiveTv()', 'function checkLiveTvHash()']) {
    const block=source.slice(source.indexOf(fn),source.indexOf(fn)+240);
    expect(block).toContain('setLiveTvVisited(true)');
  }
});
