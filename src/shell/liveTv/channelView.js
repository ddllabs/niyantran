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
