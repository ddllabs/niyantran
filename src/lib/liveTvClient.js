/**
 * Live TV API client.
 * Authoritative backend requests for channels, videos, live streams, schedule, archive, and transcript.
 */

export async function fetchLiveTvChannels(category) {
  try {
    const q = category && category !== 'ALL' ? '?category=' + encodeURIComponent(category) : '';
    const res = await fetch('/api/livetv/channels' + q);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, channels: [], categories: [] };
  }
}

export async function fetchLiveTvLiveStreams() {
  try {
    const res = await fetch('/api/livetv/live');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, liveStreams: [], count: 0 };
  }
}

export async function fetchLiveTvVideos(channelId) {
  if (!channelId) return { ok: false, error: 'channelId required', recentVideos: [], upcomingVideos: [] };
  try {
    const res = await fetch('/api/livetv/videos?channelId=' + encodeURIComponent(channelId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, recentVideos: [], upcomingVideos: [] };
  }
}

export async function fetchLiveTvSchedule(channelId) {
  try {
    const p = channelId ? '?channel=' + encodeURIComponent(channelId) : '';
    const res = await fetch('/api/livetv/schedule' + p);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
}

export async function fetchLiveTvArchive(channelId) {
  try {
    const p = channelId ? '?channel=' + encodeURIComponent(channelId) : '';
    const res = await fetch('/api/livetv/archive' + p);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
}

export async function fetchLiveTvTranscript(broadcastId) {
  if (!broadcastId) return { ok: false, error: 'broadcastId required', cues: [] };
  try {
    const res = await fetch('/api/livetv/transcript?broadcastId=' + encodeURIComponent(broadcastId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message, cues: [] };
  }
}
