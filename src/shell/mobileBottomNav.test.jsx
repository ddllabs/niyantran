import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileBottomNav from './MobileBottomNav.jsx';
import { watchPopover } from './credits/BalancePill.jsx';

describe('MobileBottomNav component', () => {
  it('renders all 5 navigation items with correct accessibility labels', () => {
    const html = renderToStaticMarkup(
      <MobileBottomNav
        activeTab="home"
        aiOpen={false}
        filesOpen={false}
        accountOpen={false}
        lang="en"
      />
    );

    expect(html).toContain('aria-label="Mobile Navigation"');
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('aria-label="Browse desks"');
    expect(html).toContain('aria-label="Ask AI"');
    expect(html).toContain('aria-label="Files"');
    expect(html).toContain('aria-label="Account"');
    expect(html).toContain('mob-nav-fab');
  });

  it('renders Hindi labels when lang is hi', () => {
    const html = renderToStaticMarkup(
      <MobileBottomNav
        activeTab="home"
        aiOpen={false}
        filesOpen={false}
        accountOpen={false}
        lang="hi"
      />
    );

    expect(html).toContain('aria-label="मोबाइल नेविगेशन"');
    expect(html).toContain('aria-label="मुख्य पृष्ठ"');
    expect(html).toContain('aria-label="डेस्क नेविगेशन"');
    expect(html).toContain('aria-label="एआई शोध"');
    expect(html).toContain('aria-label="निजी फ़ाइलें"');
    expect(html).toContain('aria-label="खाता एवं क्रेडिट"');
  });

  it('reflects active states accurately', () => {
    const htmlAi = renderToStaticMarkup(
      <MobileBottomNav
        activeTab="national"
        aiOpen={true}
        filesOpen={false}
        accountOpen={false}
      />
    );
    expect(htmlAi).toContain('mob-nav-fab active');

    const htmlFiles = renderToStaticMarkup(
      <MobileBottomNav
        activeTab="home"
        aiOpen={false}
        filesOpen={true}
        accountOpen={false}
      />
    );
    expect(htmlFiles).toContain('mob-nav-item active');
    expect(htmlFiles).toContain('Files');

    const htmlAccount = renderToStaticMarkup(
      <MobileBottomNav
        activeTab="home"
        aiOpen={false}
        filesOpen={false}
        accountOpen={true}
      />
    );
    expect(htmlAccount).toContain('mob-nav-item active');
    expect(htmlAccount).toContain('Account');
  });

  it('watchPopover does not close when interaction occurs on mobile navigation or popover', () => {
    const onClose = vi.fn();
    const focusPill = vi.fn();
    const listeners = {};
    const fakeDoc = {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
    };

    const root = {
      contains: vi.fn(() => false),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const stop = watchPopover({ doc: fakeDoc, root, onClose, focusPill });
    expect(typeof listeners.mousedown).toBe('function');

    // Simulate click on mobile bottom nav button
    const navTarget = {
      closest: (sel) => (sel.includes('.mobile-bottom-nav') ? {} : null),
    };
    listeners.mousedown({ target: navTarget });
    expect(onClose).not.toHaveBeenCalled();

    // Simulate click inside profile-pop
    const popTarget = {
      closest: (sel) => (sel.includes('.profile-pop') ? {} : null),
    };
    listeners.mousedown({ target: popTarget });
    expect(onClose).not.toHaveBeenCalled();

    // Simulate click outside everything
    const outsideTarget = {
      closest: () => null,
    };
    listeners.mousedown({ target: outsideTarget });
    expect(onClose).toHaveBeenCalledTimes(1);

    stop();
    expect(listeners.mousedown).toBeUndefined();
  });
});
