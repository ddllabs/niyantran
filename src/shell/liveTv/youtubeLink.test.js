// B4: the pasted-link parser, the embed address built from the id alone, the player-error wording and
// the live-or-recorded decision. Pure, so every hostile string is tried without a page.
import { describe, expect, it } from 'vitest';
import { parseYoutubeLink, youtubeEmbedUrl, youtubeWatchUrl, playerErrorMessage, pastedVideoKind, isBlockingPlayerError } from './youtubeLink.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeLink: forms that are accepted', () => {
  it.each([
    ['a bare id', ID],
    ['a bare id with spaces round it', `  ${ID}\n`],
    ['a watch address', `https://www.youtube.com/watch?v=${ID}`],
    ['a watch address with other parameters before and after', `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`],
    ['a watch address inside a playlist', `https://www.youtube.com/watch?v=${ID}&list=PL1234567890`],
    ['a mobile watch address', `https://m.youtube.com/watch?v=${ID}`],
    ['a youtube.com address with no www', `https://youtube.com/watch?v=${ID}`],
    ['a short address', `https://youtu.be/${ID}`],
    ['a short address with a time', `https://youtu.be/${ID}?t=30`],
    ['a live address', `https://www.youtube.com/live/${ID}`],
    ['a live address with a share parameter', `https://www.youtube.com/live/${ID}?si=abcdef`],
    ['a shorts address', `https://www.youtube.com/shorts/${ID}`],
    ['an embed address', `https://www.youtube.com/embed/${ID}`],
    ['a no-cookie embed address', `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`],
    ['an http address', `http://youtu.be/${ID}`],
    ['an address with no scheme', `youtube.com/watch?v=${ID}`],
    ['a short address with no scheme', `youtu.be/${ID}`],
    ['an upper-case host', `https://WWW.YOUTUBE.COM/watch?v=${ID}`],
  ])('%s', (_n, input) => {
    expect(parseYoutubeLink(input)).toEqual({ ok: true, videoId: ID });
  });

  it('keeps an id with an underscore and a dash', () => {
    expect(parseYoutubeLink('https://youtu.be/a_b-C1d2E3f')).toEqual({ ok: true, videoId: 'a_b-C1d2E3f' });
  });
});

describe('parseYoutubeLink: forms that are refused', () => {
  it.each([
    ['nothing', ''],
    ['spaces', '   '],
    ['not a string', null],
    ['a number', 12345678901],
    ['plain text', 'hello world'],
    ['an id that is too short', 'abc123'],
    ['an id that is too long', 'dQw4w9WgXcQx'],
    ['an id with a bad character', 'dQw4w9WgXc!'],
    ['the live_stream pseudo id', 'live_stream'],
    ['a watch address with a short id', 'https://www.youtube.com/watch?v=abc'],
    ['a watch address with a long id', `https://www.youtube.com/watch?v=${ID}extra`],
    ['a watch address with no id', 'https://www.youtube.com/watch'],
    ['a playlist address', 'https://www.youtube.com/playlist?list=PL1234567890'],
    ['the home page', 'https://www.youtube.com/'],
    ['the live page with no id', 'https://www.youtube.com/live'],
    ['another host with a watch path', `https://example.com/watch?v=${ID}`],
    ['another host that ends in youtube.com', `https://notyoutube.com/watch?v=${ID}`],
    ['a host that starts with youtube.com', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['user information that hides the host', `https://youtube.com@evil.example/watch?v=${ID}`],
    ['a youtube address in another address\'s query', `https://evil.example/?u=https://youtu.be/${ID}`],
    ['a youtube address in another address\'s path', `https://evil.example/https://www.youtube.com/watch?v=${ID}`],
    ['a javascript address', `javascript:alert(1)//youtu.be/${ID}`],
    ['a data address', `data:text/html,<script>alert(1)</script>youtu.be/${ID}`],
    ['a file address', `file:///etc/passwd#youtu.be/${ID}`],
    ['an ftp address', `ftp://youtu.be/${ID}`],
    ['markup', `<script>alert(1)</script>${ID}`],
    ['an address with markup in the id', 'https://youtu.be/<script>aa'],
    ['an address with a path traversal', `https://www.youtube.com/embed/../${ID}`],
    ['two ids', `${ID} ${ID}`],
    ['an id then text', `${ID} please`],
    ['a very long string', `https://www.youtube.com/watch?v=${ID}&x=${'a'.repeat(5000)}`],
  ])('%s', (_n, input) => {
    expect(parseYoutubeLink(input)).toEqual({ ok: false });
  });
});

describe('parseYoutubeLink: a channel page or channel live address says so (B4 fix 10)', () => {
  it.each([
    ['a handle', 'https://www.youtube.com/@sansadtv'],
    ['a handle live address', 'https://www.youtube.com/@sansadtv/live'],
    ['a handle with no scheme', 'youtube.com/@sansadtv/live'],
    ['a channel id address', 'https://www.youtube.com/channel/UCISgnSNwqQ2i8lhCun3KtQg'],
    ['a channel id live address', 'https://www.youtube.com/channel/UCISgnSNwqQ2i8lhCun3KtQg/live'],
    ['a custom name address', 'https://www.youtube.com/c/SansadTV'],
    ['a user address', 'https://www.youtube.com/user/sansadtv'],
    ['a mobile handle', 'https://m.youtube.com/@sansadtv'],
    ['YouTube Music', `https://music.youtube.com/watch?v=${ID}`],
  ])('%s', (_n, input) => {
    expect(parseYoutubeLink(input)).toEqual({ ok: false, reason: 'channel' });
  });
  it('does not call other refused text a channel', () => {
    expect(parseYoutubeLink('hello')).toEqual({ ok: false });
    expect(parseYoutubeLink('https://example.com/@sansadtv')).toEqual({ ok: false });
    expect(parseYoutubeLink('https://www.youtube.com/playlist?list=PL1234567890')).toEqual({ ok: false });
  });
});

describe('the addresses built from the id', () => {
  it('builds the embed from the id alone, with the parameters the page already uses', () => {
    expect(youtubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&mute=1&playsinline=1`);
  });
  it('builds the watch address from the id alone', () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
  it('builds nothing for something that is not an 11-character id', () => {
    expect(youtubeEmbedUrl('<script>')).toBe('');
    expect(youtubeWatchUrl('x'.repeat(12))).toBe('');
    expect(youtubeEmbedUrl(null)).toBe('');
  });
});

describe('playerErrorMessage and isBlockingPlayerError', () => {
  it.each([101, 150])('code %s: the owner has turned off playback on other sites', (code) => {
    expect(playerErrorMessage(code)).toBe("This video can't be played here. Its owner has turned off playback on other sites.");
    expect(isBlockingPlayerError(code)).toBe(true);
  });
  it('code 100: private or removed', () => {
    expect(playerErrorMessage(100)).toBe('This video is private or was removed.');
    expect(isBlockingPlayerError(100)).toBe(true);
  });
  it('code 153 is a page-wide player error: a plain line, not a refusal of the video', () => {
    expect(playerErrorMessage(153)).toBe("This video can't be played here.");
    expect(isBlockingPlayerError(153)).toBe(false);
  });
  it.each([2, 5, 999, null, undefined, 'x'])('code %s does not mean "cannot be played here"', (code) => {
    expect(isBlockingPlayerError(code)).toBe(false);
  });
});

describe('pastedVideoKind: recorded only when the player says isLive false AND shows a finite duration above 0', () => {
  it('is recorded for isLive false with a positive finite duration', () => {
    expect(pastedVideoKind({ durationS: 300, isLive: false })).toBe('recorded');
  });
  it.each([[null], [undefined], [true]])('is live for isLive %s even with a positive duration (a live stream with a rewind window has one)', (isLive) => {
    expect(pastedVideoKind({ durationS: 300, isLive })).toBe('live');
  });
  it.each([[0], [null], [undefined], [NaN], [Infinity], [-5]])('is live for isLive false with a duration of %s', (d) => {
    expect(pastedVideoKind({ durationS: d, isLive: false })).toBe('live');
  });
  it('is live when nothing is known yet', () => {
    expect(pastedVideoKind(null)).toBe('live');
    expect(pastedVideoKind({})).toBe('live');
  });
});
