// F348: pure helpers for the Live TV embed, kept out of React so they can be tested.
import { isYoutubeUrl } from './youtubePlayerBridge.js';

// The iframe key. It must not contain the mute state: a mute toggle must not remount the player.
export const embedFrameKey = ({ channelId, broadcastId, mode, reloadKey }) => `${channelId}-${broadcastId}-${mode}-${reloadKey}`;

// The address for a NEW mount: exactly one mute parameter with the wanted value, the player API on
// for YouTube only, and the page origin.
export function buildEmbedSrc({ url, muted, origin }) {
  if (!url) return '';
  let u;
  try { u = new URL(url); } catch { return url; }
  u.searchParams.set('mute', muted ? '1' : '0');
  if (isYoutubeUrl(url)) u.searchParams.set('enablejsapi', '1');
  if (origin) u.searchParams.set('origin', origin);
  return u.toString();
}
