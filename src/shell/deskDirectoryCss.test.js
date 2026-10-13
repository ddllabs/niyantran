import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./deskDirectory.css', import.meta.url), 'utf8');
// Top-level rules only: media query blocks are cut out, so a rule found here applies at every width.
const topLevel = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const rule = (sel) => topLevel.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] || '';

// F133 (owner 2026-10-13): the desk tabs are their own row under a full-width line at every width.
describe('desk tabs in the header', () => {
  const tabs = rule('.with-v6-directory .v6-landing-tabs');

  it('sit on their own row under a line, at every width', () => {
    expect(tabs).toMatch(/order:3/);
    // The row's side padding sits inside its full width, so it never overhangs the header.
    expect(tabs).toMatch(/box-sizing:border-box/);
    expect(tabs).toMatch(/border-top:1px solid var\(--line\)/);
    expect(tabs).toMatch(/flex:0 0 calc\(100% \+ 2 \* var\(--topbar-gutter\)\)/);
    expect(css).not.toMatch(/max-width:1799px/);
  });

  it('use a 42px row that each tab fills from line to line, with no space around it', () => {
    expect(tabs).toMatch(/min-height:42px/);
    expect(topLevel).toMatch(/\.with-v6-directory \.v6-landing-tabs \{ align-items:stretch; \}/);
    expect(rule('.with-v6-directory .v6-landing-tabs button')).toMatch(/min-height:0;border-radius:0/);
    expect(rule('.with-v6-directory .v6-landing-tabs button[aria-current=page]::after')).toMatch(/bottom:0/);
    expect(css).not.toMatch(/\.v6-landing-tabs \{ min-height:52px/);
  });
});
