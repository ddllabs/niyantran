import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { staticImports, walk } from '../../scripts/build-terminal-styles.mjs';

it('keeps unrelated routes and optional panels outside the terminal static dependency closure', () => {
  const modules = new Set();
  walk(['src/shell/TerminalShell.jsx'], { modules });
  const paths=[...modules].map(p=>p.replace(process.cwd()+'/', ''));
  for(const path of ['src/desks/HomeDesk.jsx','src/desks/DeskView.jsx','src/desks/DeskLandingView.jsx','src/shell/credits/CreditsPage.jsx','src/shell/LiveTvPage.jsx','src/ai/AiPanel.jsx']) expect(paths,path).not.toContain(path);
});
it('does not eagerly ship unrelated archive snapshots with shared chat/catalogue code', () => {
  const source=readFileSync(new URL('../lib/archiveFeed.js',import.meta.url),'utf8');
  const imports=staticImports(source);
  for(const pack of ['alliances','sanctions','global-aid','nuclear-watch']) expect(imports).not.toContain(`../data/${pack}.json`);
});
it('marks the page visited for every Live TV opener: the hash, the event and the header button', () => {
  const source=readFileSync(new URL('./TerminalShell.jsx',import.meta.url),'utf8');
  // The hash and the event both arrive through watchLiveTv; the first visit mounts the lazy page.
  const block=source.slice(source.indexOf('watchLiveTv('),source.indexOf('watchLiveTv(')+240);
  expect(block).toContain('setLiveTvVisited(true)');
  expect(source).toContain('goLiveTv()');
});
// F359: Live TV is a page, not a pop-up. An Escape press or a click elsewhere used to close it and end a
// paid session; neither may be listened for in the shell for Live TV any more.
it('does not close Live TV on Escape or on a click outside it', () => {
  const source=readFileSync(new URL('./TerminalShell.jsx',import.meta.url),'utf8');
  expect(source).not.toMatch(/['"]Escape['"]/);
  expect(source).not.toMatch(/['"]mousedown['"]/);
  expect(source).not.toContain("closest?.('.tv-wrap')");
});
