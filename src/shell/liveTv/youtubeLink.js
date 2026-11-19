// B4: pure helpers for a pasted YouTube link. The pasted text is only ever read for an 11-character id;
// every address the page uses is built from that id, never from the text.
const ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_HEADS = new Set(['channel', 'c', 'user']);
const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const MAX_LENGTH = 300;
const NOT_A_VIDEO = new Set(['live_stream']); // 11 characters, but a pseudo id, not a video

const realId = (s) => (typeof s === 'string' && ID.test(s) && !NOT_A_VIDEO.has(s) ? s : '');

/** { ok: true, videoId } for a YouTube video or live address (or a bare id); { ok: false } for anything else. */
export function parseYoutubeLink(input) {
  if (typeof input !== 'string') return { ok: false };
  const text = input.trim();
  if (!text || text.length > MAX_LENGTH) return { ok: false };
  const bare = realId(text);
  if (bare) return { ok: true, videoId: bare };

  let url;
  try {
    // A scheme is optional ("youtu.be/…"); any other scheme is refused below.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`);
  } catch { return { ok: false }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false };
  if (url.username || url.password) return { ok: false };
  if (url.hostname === 'music.youtube.com') return { ok: false, reason: 'channel' };
  if (!HOSTS.has(url.hostname)) return { ok: false };

  const parts = url.pathname.split('/').filter(Boolean);
  // A channel page or a channel's own live address is not one video: say so.
  const head = parts[0] || '';
  if (!url.hostname.endsWith('youtu.be') && (head.startsWith('@') || (CHANNEL_HEADS.has(head) && parts.length >= 2))) {
    return { ok: false, reason: 'channel' };
  }
  let candidate = '';
  if (url.hostname.endsWith('youtu.be')) {
    if (parts.length === 1) candidate = parts[0];
  } else if (parts.length === 1 && parts[0] === 'watch') {
    candidate = url.searchParams.get('v') || '';
  } else if (parts.length === 2 && ['live', 'shorts', 'embed', 'v'].includes(parts[0])) {
    candidate = parts[1];
  }
  const videoId = realId(candidate);
  return videoId ? { ok: true, videoId } : { ok: false };
}

/** The player address for an id, with the parameters the page already uses; '' for anything but an id. */
export const youtubeEmbedUrl = (id) => (realId(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1` : '');

/** The YouTube page for an id; '' for anything but an id. */
export const youtubeWatchUrl = (id) => (realId(id) ? `https://www.youtube.com/watch?v=${id}` : '');

/** What to tell the user for an error code the YouTube player reports. */
export function playerErrorMessage(code) {
  if (code === 101 || code === 150 || code === 153) {
    return "This video can't be played here. Its owner has turned off playback on other sites.";
  }
  if (code === 100) return 'This video is private or was removed.';
  return "This video can't be played here.";
}

/** The codes that mean the video cannot be played here: not found or private (100), embedding off (101, 150, 153). */
export const isBlockingPlayerError = (code) => code === 100 || code === 101 || code === 150 || code === 153;

/**
 * 'recorded' only when the player has said isLive is false AND shows a finite duration above zero. A missing,
 * null or true isLive is 'live' (a live stream with a rewind window reports a positive duration). A live
 * session is private and stores nothing, so a wrong guess in that direction shares nothing.
 */
export function pastedVideoKind(info) {
  if (!info || info.isLive !== false) return 'live';
  const d = info.durationS;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? 'recorded' : 'live';
}
