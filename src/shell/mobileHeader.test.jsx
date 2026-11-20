import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MobileHeader from './MobileHeader.jsx';

describe('MobileHeader (Phase 2 / Step 1)', () => {
  it('renders mobile header landmark with hamburger, segmented control, and brand logo in chat mode', () => {
    const html = renderToStaticMarkup(
      <MobileHeader activeMode="chat" lang="en" />
    );

    // Landmark banner
    expect(html).toContain('<header class="nter-mobile-header" role="banner" aria-label="Mobile Header"');

    // Hamburger button
    expect(html).toContain('class="nter-mob-hamburger"');
    expect(html).toContain('aria-label="Open navigation menu"');
    expect(html).toContain('class="nter-mob-hamburger-bar"');

    // Segmented tablist
    expect(html).toContain('class="nter-mob-segmented"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Chat and Work mode switcher"');

    // Chat and Work tabs
    expect(html).toMatch(/id="nter-mob-tab-chat"[^>]*aria-selected="true"[^>]*class="nter-mob-segmented-btn active"/);
    expect(html).toMatch(/id="nter-mob-tab-work"[^>]*aria-selected="false"[^>]*class="nter-mob-segmented-btn"/);

    // Brand mark in Chat mode
    expect(html).toContain('class="nter-mob-brand-mark"');
    expect(html).toContain('src="/brand/logo-128.webp"');
    expect(html).not.toContain('class="nter-mob-doc-icon"');
  });

  it('renders work mode active state and document icon in work mode', () => {
    const html = renderToStaticMarkup(
      <MobileHeader activeMode="work" lang="en" />
    );

    // Segmented tablist with Work selected
    expect(html).toMatch(/id="nter-mob-tab-chat"[^>]*aria-selected="false"[^>]*class="nter-mob-segmented-btn"/);
    expect(html).toMatch(/id="nter-mob-tab-work"[^>]*aria-selected="true"[^>]*class="nter-mob-segmented-btn active"/);

    // Document icon present in Work mode
    expect(html).toContain('class="nter-mob-doc-icon"');
    expect(html).toContain('aria-label="Draft document"');
    expect(html).not.toContain('class="nter-mob-brand-mark"');
  });

  it('supports Hindi localized labels and aria attributes', () => {
    const html = renderToStaticMarkup(
      <MobileHeader activeMode="chat" lang="hi" />
    );

    expect(html).toContain('aria-label="मोबाइल हेडर"');
    expect(html).toContain('aria-label="नेविगेशन मेनू खोलें"');
    expect(html).toContain('aria-label="चैट और वर्क मोड"');
    expect(html).toContain('>चैट</button>');
    expect(html).toContain('>वर्क</button>');
  });

  it('maintains proper aria-controls linkage between tabs and panels', () => {
    const html = renderToStaticMarkup(<MobileHeader activeMode="chat" />);
    expect(html).toContain('aria-controls="nter-mob-panel-chat"');
    expect(html).toContain('aria-controls="nter-mob-panel-work"');
  });
});
