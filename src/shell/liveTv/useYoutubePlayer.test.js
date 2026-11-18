// F363: the player hook's seekS: false when the bridge is not running, otherwise whatever the bridge says.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const seekTo = vi.hoisted(() => vi.fn(() => true));
vi.mock('./youtubePlayerBridge.js', () => ({
  createYoutubePlayerBridge: () => ({ start() {}, stop() {}, setMuted() {}, seekTo, getSnapshot: () => ({}) }),
}));
const { useYoutubePlayer } = await import('./useYoutubePlayer.js');

const handlers = { onMutedChange() {}, onFallback() {} };
beforeEach(() => { harness.reset(); seekTo.mockClear(); });

const hook = (active) => harness.render((p) => useYoutubePlayer(p.active, handlers), { active });

describe('seekS', () => {
  it('is false and sends nothing while the bridge is not running', () => {
    expect(hook(false).seekS(130)).toBe(false);
    expect(seekTo).not.toHaveBeenCalled();
  });
  it('hands the second to the bridge and returns what it says', () => {
    const player = hook(true);
    expect(player.seekS(130)).toBe(true);
    expect(seekTo).toHaveBeenCalledWith(130);
    seekTo.mockReturnValueOnce(false);
    expect(player.seekS(5)).toBe(false);
  });
  it('is false again once the bridge stops', () => {
    const player = hook(true);
    hook(false);
    expect(player.seekS(130)).toBe(false);
  });
});
