// The lower tabs list Broadcast Schedule and Archived Segments only when they hold something: both are empty in
// production (no source), so an always-present empty tab only confuses.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ schedule: [], archive: [] }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => ({
  fetchLiveTvChannels: async () => ({ ok: true, channels: [], categories: ['NEWS'] }),
  fetchLiveTvVideos: () => new Promise(() => {}),
  fetchLiveTvSchedule: async () => ({ ok: true, items: h.schedule }),
  fetchLiveTvArchive: async () => ({ ok: true, items: h.archive }),
}));
vi.mock('./factcheck/useFactCheck.js', () => ({ useFactCheck: () => ({ view: null, actions: {} }) }));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');

const flush = async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const tabLabels = (out) => [...elements(out)].filter((e) => e.type === 'button' && e.props.role === 'tab').map((e) => text(e));

async function open() {
  render(); await flush(); render(); await flush();
  return render();
}

beforeEach(() => { harness.reset(); h.schedule = []; h.archive = []; delete globalThis.window; });

describe('lower tabs', () => {
  it('lists only Channel Videos while schedule and archive are empty', async () => {
    const labels = tabLabels(await open());
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/^Channel Videos/);
    expect(labels.join('|')).not.toMatch(/Broadcast Schedule|Archived Segments/);
  });
  it('lists the schedule tab, before Channel Videos, once there is a schedule item', async () => {
    h.schedule = [{ id: 's1', title: 'News at nine', startTime: '21:00', endTime: '22:00', description: '' }];
    const labels = tabLabels(await open());
    expect(labels).toHaveLength(2);
    expect(labels[0]).toBe('Broadcast Schedule (1)');
    expect(labels[1]).toMatch(/^Channel Videos/);
  });
  it('lists the archive tab last once there is an archived segment', async () => {
    h.archive = [{ id: 'a1', title: 'Old', embedUrl: 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa' }];
    const labels = tabLabels(await open());
    expect(labels).toHaveLength(2);
    expect(labels[1]).toBe('Archived Segments (1)');
  });
});
