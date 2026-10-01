import { describe, expect, it } from 'vitest';
import { createStickToBottom } from './stickToBottom.js';

// F46: the last conversation opened scrolled to the top (scrollTop 0 of 2,208 px) because the
// scroll was written to an element that cannot scroll. This is the rule for the one that does.
const box = (over = {}) => ({ scrollTop: 0, scrollHeight: 2208, clientHeight: 333, ...over });

describe('createStickToBottom', () => {
  it('a newly opened thread lands on its newest message', () => {
    const el = box();
    const stick = createStickToBottom(() => el);
    stick.follow();
    expect(el.scrollTop).toBe(2208);
  });

  it('a reader who scrolled up is not pulled down when the turn finishes', () => {
    const el = box({ scrollTop: 400 });
    const stick = createStickToBottom(() => el);
    stick.onScroll();
    el.scrollHeight = 3000;
    stick.follow();
    expect(el.scrollTop).toBe(400);
  });

  it('a reader at the bottom stays there as content grows', () => {
    const el = box({ scrollTop: 2208 - 333 - 20 });
    const stick = createStickToBottom(() => el);
    stick.onScroll();
    el.scrollHeight = 2600;
    stick.follow();
    expect(el.scrollTop).toBe(2600);
  });

  it('sending (force) and switching threads (reset) go to the bottom again', () => {
    const el = box({ scrollTop: 100 });
    const stick = createStickToBottom(() => el);
    stick.onScroll();
    stick.follow({ force: true });
    expect(el.scrollTop).toBe(2208);
    el.scrollTop = 50; stick.onScroll();
    stick.reset(); stick.follow();
    expect(el.scrollTop).toBe(2208);
  });

  it('no element yet is a no-op', () => {
    expect(() => createStickToBottom(() => null).follow()).not.toThrow();
  });
});
