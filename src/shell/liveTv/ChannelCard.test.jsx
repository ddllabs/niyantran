// F366: the channel card: large channel tiles with scroll arrows, and the segment chips with counts.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChannelCard } from './ChannelCard.jsx';

const channels = [
  { id: 'a', name: 'Alpha News', short: 'AN', color: '#b91c1c', category: 'NEWS', status: 'live', lang: 'Hindi' },
  { id: 'b', name: 'Beta Learn', category: 'EDUCATION', status: 'recent', lang: 'English' },
];
const base = {
  channels, visible: channels, categories: ['ALL', 'NEWS', 'EDUCATION'], selectedCategory: 'ALL', onSelectCategory() {},
  activeChannelId: 'a', playbackMode: 'live', loading: false, onSelectChannel() {},
};
const render = (over = {}) => renderToStaticMarkup(<ChannelCard {...base} {...over} />);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('channel tiles', () => {
  it('draw tag on the channel colour, name, and a LIVE line (or just the language)', () => {
    const html = render();
    expect(html).toMatch(/class="ltv-chip-tag"[^>]*style="background:#b91c1c"[^>]*>AN</);
    expect(html).toMatch(/>Bet</); // the tag falls back to the first three letters of the name, as before
    expect(text(html)).toContain('Alpha News');
    expect(text(html)).toContain('LIVE · Hindi');
    expect(text(html)).toContain('English');
    expect(text(html)).not.toContain('RECENT');
  });
  it('leave the second line out, with no empty element, when a channel has neither status nor language', () => {
    const html = render({ visible: [{ id: 'z', name: 'Zed', category: 'NEWS', status: 'recent' }], channels: [] });
    expect(html).toContain('Zed');
    expect(html).not.toMatch(/ltv-chip-status/);
  });
  it('style LIVE as before', () => {
    expect(render()).toMatch(/class="ltv-chip-status ltv-chip-status-live">LIVE · Hindi</);
  });
  it('mark the playing channel with aria-current and the active class, only in live mode', () => {
    const html = render();
    expect(html.match(/ltv-channel-chip active/g)).toHaveLength(1);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(render({ playbackMode: 'video' })).not.toMatch(/ltv-channel-chip active/);
  });
  it('show the existing loading and empty messages', () => {
    expect(text(render({ loading: true }))).toContain('Loading curated sources...');
    expect(text(render({ visible: [], selectedCategory: 'NEWS' }))).toContain('No channels found for NEWS');
  });
  it('have left and right arrows that scroll the strip', () => {
    const html = render();
    expect(html).toMatch(/aria-label="Scroll channels left"/);
    expect(html).toMatch(/aria-label="Scroll channels right"/);
  });
});

describe('segments', () => {
  it('are pressed-state chips with the channel count of each category', () => {
    const html = render({ selectedCategory: 'NEWS' });
    expect(html).toMatch(/role="group" aria-label="Channel Categories"/);
    expect(html).toMatch(/class="ltv-category-pill active"[^>]*aria-pressed="true"/);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    const t = text(html);
    expect(t).toContain('ALL 2');
    expect(t).toContain('NEWS 1');
    expect(t).toContain('EDUCATION 1');
  });
  it('are labelled TOP CHANNELS and SEGMENTS, and draw no search or list controls', () => {
    const t = text(render());
    expect(t).toContain('TOP CHANNELS');
    expect(t).toContain('SEGMENTS');
    expect(render()).not.toMatch(/type="search"|My list|Find a channel/);
  });
});
