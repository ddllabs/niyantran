// B6: finding a channel by name, official name or language; Devanagari included.
import { describe, expect, it } from 'vitest';
import { matchChannels, normalizeText, primaryLanguage, regionChips } from './channelSearch.js';

const channels = [
  { id: 'aaj-tak', name: 'Aaj Tak', lang: 'Hindi' },
  { id: 'abp-majha', name: 'ABP Majha', officialName: 'ABP MAJHA', lang: 'Marathi' },
  { id: 'rep', name: 'Republic TV', officialName: 'Republic World', lang: 'English' },
  { id: 'devanagari', name: 'आज तक', lang: 'Hindi · English' },
  { id: 'tv9', name: 'TV9 Telugu', officialName: 'TV9 Telugu Live', lang: 'Telugu' },
  { id: 'ganga', name: 'ABP Ganga', lang: 'Hindi (UP/UK)' },
];
const ids = (q) => matchChannels(channels, q).map((c) => c.id);

describe('matchChannels', () => {
  it('matches the name, ignoring case', () => {
    expect(ids('aaj')).toEqual(['aaj-tak']);
    expect(ids('REPUBLIC')).toEqual(['rep']);
  });
  it('matches the official name', () => {
    expect(ids('republic world')).toEqual(['rep']);
    expect(ids('telugu live')).toEqual(['tv9']);
  });
  it('matches the language', () => {
    expect(ids('marathi')).toEqual(['abp-majha']);
    expect(ids('hindi')).toEqual(['aaj-tak', 'devanagari', 'ganga']);
  });
  it('matches Devanagari in a name', () => {
    expect(ids('आज')).toEqual(['devanagari']);
    expect(ids('आज तक')).toEqual(['devanagari']);
  });
  it('matches a language written in Devanagari', () => {
    expect(ids('हिंदी')).toEqual(['aaj-tak', 'devanagari', 'ganga']);
    expect(ids('हिन्दी')).toEqual(['aaj-tak', 'devanagari', 'ganga']);
    expect(ids('मराठी')).toEqual(['abp-majha']);
  });
  it('needs every word of the query', () => {
    expect(ids('abp ganga')).toEqual(['ganga']);
    expect(ids('abp telugu')).toEqual([]);
  });
  it('treats a blank query as no match request: every channel', () => {
    expect(ids('')).toHaveLength(6);
    expect(ids('   ')).toHaveLength(6);
  });
  it('finds nothing for text that is no channel, and is not fooled by pattern characters', () => {
    expect(ids('zzz')).toEqual([]);
    expect(ids('.*')).toEqual([]);
    expect(ids('[a-z]')).toEqual([]);
  });
  it('ignores zero-width marks and different Unicode forms of the same text', () => {
    expect(normalizeText('आज\u200c तक')).toBe(normalizeText('आज तक'));
    expect(normalizeText('Café')).toBe(normalizeText('Café'));
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
      { label: 'English', count: 1 }, { label: 'Hindi', count: 3 }, { label: 'Marathi', count: 1 }, { label: 'Telugu', count: 1 },
    ]);
  });
});
