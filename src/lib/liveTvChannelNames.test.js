import { describe, expect, it } from 'vitest';
import { YOUTUBE_SOURCES } from '../../server/liveTvApi.mjs';
import { catalogueChannelName } from './liveTvChannelNames.js';
import { channelName, factcheckDetails } from './creditUsage.js';

describe('channel names on the usage screen (F384)', () => {
  it('knows every channel the catalogue serves, by its real name', () => {
    expect(YOUTUBE_SOURCES.length).toBe(96);
    for (const c of YOUTUBE_SOURCES) expect(catalogueChannelName(c.id), c.id).toBe(c.name);
  });

  it('shows an added channel by its catalogue name, not its id in words', () => {
    expect(channelName('news18-india')).toBe('News18 India');
    expect(channelName('cnn-news18')).toBe('CNN-News18');
    expect(channelName('tv9-bharatvarsh')).toBe('TV9 Bharatvarsh');
    expect(factcheckDetails({ channel: 'cnn-news18', minutesUsed: 3, videoKind: 'live' })).toEqual(['CNN-News18', '3 min', 'Live']);
  });

  it('shows an original channel by its real name', () => {
    expect(channelName('ndtv-24x7')).toBe('NDTV 24x7');
    expect(channelName('khan-gs')).toBe('Khan GS Research Centre');
  });

  it('falls back to the stored title, then to the id in words, for an id outside the catalogue', () => {
    expect(channelName('removed-channel', 'A pasted debate')).toBe('A pasted debate');
    expect(channelName('removed-channel')).toBe('Removed Channel');
    expect(channelName(null)).toBe('');
  });
});
