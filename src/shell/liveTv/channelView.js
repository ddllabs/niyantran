// F366: small pure helpers for the Live TV channel card and the now-playing row.

/** Per-category channel counts for the Segments chips; ALL is the total. Order follows `categories`. */
export function segmentCounts(channels, categories) {
  const list = Array.isArray(channels) ? channels : [];
  return (Array.isArray(categories) ? categories : []).map((category) => ({
    category,
    count: category === 'ALL' ? list.length : list.filter((c) => c?.category === category).length,
  }));
}

/** LIVE, SOON or RECENT, as the channel strip has always labelled a channel. */
export function channelStatusLabel(channel) {
  return channel?.status === 'live' ? 'LIVE' : channel?.status === 'soon' ? 'SOON' : 'RECENT';
}

/** The second line of a channel tile: the status, then the language when the data has one. */
export function channelSubline(channel) {
  return [channelStatusLabel(channel), typeof channel?.lang === 'string' ? channel.lang.trim() : ''].filter(Boolean).join(' · ');
}

/** "channel · language · kind" under the video. */
export function nowPlayingLine({ mode, channel, item = null }) {
  if (!channel) return '';
  const kind = mode === 'video' ? 'Video' : mode === 'archive' ? item?.segment || 'Archive' : channel.category;
  return [channel.name, channel.lang, kind].filter(Boolean).join(' · ');
}
