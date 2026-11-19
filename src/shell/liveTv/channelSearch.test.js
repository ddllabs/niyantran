// B6: finding a channel by name, official name or language; Devanagari included.
import { describe, expect, it } from 'vitest';
import { matchChannels, normalizeText, primaryLanguage, regionChips } from './channelSearch.js';

// Channel names are Latin script only. A Devanagari NAME finds nothing; a Devanagari LANGUAGE word finds that
// language's channels, and so do the names of the lists a channel is in.
const lists = [
  { id: 'top-hi', name: 'Top · Hindi news', short: 'Hindi' },
  { id: 'education', name: 'Education & UPSC', short: 'Education' },
  { id: 'parliament', name: 'Parliament & Govt', short: 'Parliament & Govt' },
  { id: 'regional', name: 'Regional', short: 'Regional' },
];
const channels = [
  { id: 'aaj-tak', name: 'Aaj Tak', lang: 'Hindi', lists: ['top-hi'] },
  { id: 'abp-majha', name: 'ABP Majha', officialName: 'ABP MAJHA', lang: 'Marathi', lists: ['regional'] },
  { id: 'rep', name: 'Republic TV', officialName: 'Republic World', lang: 'English', lists: ['top-hi'] },
  { id: 'zee', name: 'Zee News', lang: 'Hindi · English', lists: ['top-hi'] },
  { id: 'tv9', name: 'TV9 Telugu', officialName: 'TV9 Telugu Live', lang: 'Telugu', lists: ['regional'] },
  { id: 'ganga', name: 'ABP Ganga', lang: 'Hindi (UP/UK)', lists: ['regional'] },
  { id: 'khan', name: 'Khan GS Research Centre', lang: 'Hindi', lists: ['education'] },
  { id: 'sansad', name: 'Sansad TV', lang: 'Hindi · English', lists: ['top-hi', 'parliament'] },
];
const ids = (q) => matchChannels(channels, q, lists).map((c) => c.id);

describe('matchChannels', () => {
  it('matches the name, ignoring case', () => {
    expect(ids('aaj')).toEqual(['aaj-tak']);
    expect(ids('REPUBLIC')).toEqual(['rep']);
  });
  it('matches the official name', () => {
    expect(ids('republic world')).toEqual(['rep']);
    expect(ids('telugu live')).toEqual(['tv9']);
  });
  it('matches the language in English', () => {
    expect(ids('marathi')).toEqual(['abp-majha']);
    expect(ids('telugu')).toEqual(['tv9']);
  });
  it('finds the channels of a language written in its own script', () => {
    const hindi = ['aaj-tak', 'zee', 'ganga', 'khan', 'sansad'];
    expect(ids('हिंदी')).toEqual(hindi);
    expect(ids('हिन्दी')).toEqual(hindi);
    expect(ids('मराठी')).toEqual(['abp-majha']);
    expect(ids('तेलुगु')).toEqual(['tv9']);
  });
  it('does not find a channel by a Devanagari spelling of its name: channel names are Latin script only', () => {
    expect(ids('आज तक')).toEqual([]);
    expect(ids('ज़ी')).toEqual([]); // not a language word; it must not match inside another word either
  });
  it('matches an alias only as a whole word, never inside another word', () => {
    expect(ids('ज़ी')).toEqual([]);
    expect(ids('अंग्रेज')).toEqual([]);
    expect(ids('अंग्रेज़ी')).toEqual(['rep', 'zee', 'sansad']);
  });
  it('finds the channels of a list by the list\'s name or its short name', () => {
    expect(ids('upsc')).toEqual(['khan']);
    expect(ids('parliament')).toEqual(['sansad']);
    expect(ids('govt')).toEqual(['sansad']);
    expect(ids('regional')).toEqual(['abp-majha', 'tv9', 'ganga']);
    expect(ids('education')).toEqual(['khan']);
  });
  it('needs every word of the query', () => {
    expect(ids('abp ganga')).toEqual(['ganga']);
    expect(ids('abp telugu')).toEqual([]);
    expect(ids('regional marathi')).toEqual(['abp-majha']);
  });
  it('treats a blank query as no match request: every channel', () => {
    expect(ids('')).toHaveLength(8);
    expect(ids('   ')).toHaveLength(8);
  });
  it('works without the lists', () => {
    expect(matchChannels(channels, 'aaj').map((c) => c.id)).toEqual(['aaj-tak']);
    expect(matchChannels(channels, 'upsc')).toEqual([]);
  });
  it('finds nothing for text that is no channel, and is not fooled by pattern characters', () => {
    expect(ids('zzz')).toEqual([]);
    expect(ids('.*')).toEqual([]);
    expect(ids('[a-z]')).toEqual([]);
  });
  it('ignores zero-width marks and different Unicode forms of the same text', () => {
    expect(normalizeText('आज\u200c तक')).toBe(normalizeText('आज तक'));
    expect(normalizeText('Cafe\u0301')).toBe(normalizeText('Caf\u00e9'));
  });
});

describe('primaryLanguage and regionChips', () => {
  it('takes the first language of the line', () => {
    expect(primaryLanguage('Hindi · English')).toBe('Hindi');
    expect(primaryLanguage('Hindi (UP/UK)')).toBe('Hindi');
    expect(primaryLanguage('Marathi')).toBe('Marathi');
    expect(primaryLanguage('')).toBe('');
    expect(primaryLanguage(undefined)).toBe('');
  });
  it('lists each language once, in alphabetical order, with a count', () => {
    expect(regionChips(channels)).toEqual([
      { label: 'English', count: 1 }, { label: 'Hindi', count: 5 }, { label: 'Marathi', count: 1 }, { label: 'Telugu', count: 1 },
    ]);
  });
});
