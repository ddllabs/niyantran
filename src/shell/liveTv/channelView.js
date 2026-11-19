// F366: small pure helpers for the Live TV channel card and the now-playing row.

/** Per-category channel counts for the Segments chips; ALL is the total. Order follows `categories`. */
export function segmentCounts(channels, categories) {
  const list = Array.isArray(channels) ? channels : [];
  return (Array.isArray(categories) ? categories : []).map((category) => ({
    category,
    count: category === 'ALL' ? list.length : list.filter((c) => c?.category === category).length,
  }));
}

/** LIVE or SOON; '' for anything else. The server marks every channel 'recent' unless it detects a live stream, so "RECENT" says nothing and is not printed. */
export function channelStatusLabel(channel) {
  return channel?.status === 'live' ? 'LIVE' : channel?.status === 'soon' ? 'SOON' : '';
}

/** The second line of a channel tile: LIVE or SOON, then the language when the data has one; '' when neither. */
export function channelSubline(channel) {
  return [channelStatusLabel(channel), typeof channel?.lang === 'string' ? channel.lang.trim() : ''].filter(Boolean).join(' · ');
}

/** "channel · language · kind" under the video. */
export function nowPlayingLine({ mode, channel, item = null }) {
  if (!channel) return '';
  const kind = mode === 'video' ? 'Video' : mode === 'archive' ? item?.segment || 'Archive' : channel.category;
  return [channel.name, channel.lang, kind].filter(Boolean).join(' · ');
}

const DETECTED = new Set(['live', 'recent', 'offline']);

/** F367: the status found by a channel's own video lookup, only when the answer came from YouTube data ('dataOrigin' is 'youtube-api'; a fallback, stale or failed lookup says nothing); else null. */
export function detectedStatusOf(data) {
  return data?.ok === true && data.dataOrigin === 'youtube-api' && DETECTED.has(data.status) ? data.status : null;
}

/** F367: the list with each detected status ({ channelId: status }) laid over that channel's own. Never changes its input; returns the same array when nothing differs. */
export function applyDetectedStatuses(channels, detected) {
  const list = Array.isArray(channels) ? channels : [];
  if (!detected || !list.some((c) => detected[c?.id] && detected[c.id] !== c.status)) return list;
  return list.map((c) => (detected[c?.id] && detected[c.id] !== c.status ? { ...c, status: detected[c.id] } : c));
}
