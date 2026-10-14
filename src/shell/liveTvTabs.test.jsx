// F61 (F171 B15): Live TV's channel categories claimed to be tabs (role="tablist") without
// behaving like tabs, and its lower tabs were plain buttons. The categories are now pressed
// buttons; the lower tabs are real tabs with one tab stop and a labelled panel.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LiveTvModal from './LiveTvModal.jsx';

describe('Live TV keyboard roles (F61)', () => {
  const html = renderToStaticMarkup(<LiveTvModal open onClose={() => {}} />);

  it('category filters are pressed buttons, not a fake tab list', () => {
    expect(html).not.toMatch(/class="ltv-category-bar" role="tablist"/);
    expect(html).toMatch(/class="ltv-category-pill[^"]*"[^>]*aria-pressed="(true|false)"/);
  });

  it('the lower tabs are tabs with exactly one tab stop and a labelled panel', () => {
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) || [];
    expect(tabs).toHaveLength(4);
    expect(tabs.filter((t) => /tabindex="0"/.test(t))).toHaveLength(1);
    expect(tabs.filter((t) => /aria-selected="true"/.test(t))).toHaveLength(1);
    expect(html).toMatch(/role="tabpanel" aria-labelledby="ltv-tab-videos"/);
  });
});
