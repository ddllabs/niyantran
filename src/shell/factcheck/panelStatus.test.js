// F366 slice B: the panel header's status line and the block line, from figures the view already carries.
import { describe, expect, it } from 'vitest';
import { blockLine, statusLine } from './panelStatus.js';

const s = (over = {}) => ({ status: 'running', minutesBought: 5, secondsLeft: 200, creditsHeld: 2500, transcript: [], claims: [], final: null, ...over });

describe('statusLine', () => {
  it('names only states the session already has', () => {
    expect(statusLine(s({ status: 'idle' }))).toMatchObject({ text: 'Off', tone: 'off' });
    expect(statusLine(s({ status: 'choosing' }))).toMatchObject({ text: 'Choose a length', tone: 'off' });
    expect(statusLine(s({ status: 'sharing' }))).toMatchObject({ text: 'Waiting for sharing', tone: 'wait' });
    expect(statusLine(s({ status: 'starting' }))).toMatchObject({ text: 'Starting…', tone: 'wait' });
    expect(statusLine(s({ status: 'ending' }))).toMatchObject({ text: 'Finishing…', tone: 'wait' });
    expect(statusLine(s({ status: 'ended' }))).toMatchObject({ text: 'Ended', tone: 'off' });
    expect(statusLine(s({ status: 'error' }))).toMatchObject({ text: 'Stopped by an error', tone: 'bad' });
  });
  it('listens until there is something to check, then shows the time used', () => {
    expect(statusLine(s())).toMatchObject({ text: 'Listening…', tone: 'on' });
    expect(statusLine(s({ transcript: [{ seq: 1, text: 'x' }] }))).toMatchObject({ text: 'Checking · 1:40 elapsed', tone: 'on' });
    expect(statusLine(s({ claims: [{ id: 'c' }] })).text).toBe('Checking · 1:40 elapsed');
  });
});

describe('blockLine', () => {
  it('is null where the view has no block', () => {
    expect(blockLine(s({ status: 'idle', minutesBought: 0 }))).toBeNull();
    expect(blockLine(s({ status: 'choosing', minutesBought: 0 }))).toBeNull();
    expect(blockLine(s({ minutesBought: 0 }))).toBeNull();
  });
  it('shows time used of minutes bought while running', () => {
    expect(blockLine(s())).toEqual({ text: '1:40 of 5 minutes used', fraction: 100 / 300, low: false });
    expect(blockLine(s()).text).not.toMatch(/credit|held/); // the rate line already says what is held
  });
  it('says one minute left at one minute or less', () => {
    expect(blockLine(s({ secondsLeft: 60 }))).toMatchObject({ text: 'Less than a minute left in this block', low: true });
    expect(blockLine(s({ secondsLeft: 12 })).low).toBe(true);
    expect(blockLine(s({ secondsLeft: 61 })).low).toBe(false);
  });
  it('F424: a one-minute block is low only for its last 30 seconds, and says so in seconds', () => {
    expect(blockLine(s({ minutesBought: 1, secondsLeft: 60 })).low).toBe(false);
    expect(blockLine(s({ minutesBought: 1, secondsLeft: 31 })).low).toBe(false);
    expect(blockLine(s({ minutesBought: 1, secondsLeft: 30 }))).toMatchObject({ text: 'Less than 30 seconds left in this block', low: true });
    expect(blockLine(s({ minutesBought: 2, secondsLeft: 60 }))).toMatchObject({ text: 'Less than a minute left in this block', low: true });
  });
  it('uses the single minute word for a one-minute block', () => {
    expect(blockLine(s({ minutesBought: 1, secondsLeft: 100 })).text).toContain('of 1 minute used');
  });
  it('after the end reports the minutes used the server returned, when it did', () => {
    expect(blockLine(s({ status: 'ended', secondsLeft: 0, final: { minutes_used: 3 } }))).toEqual({ text: '3 of 5 minutes used', fraction: 0.6, low: false });
    expect(blockLine(s({ status: 'ended', secondsLeft: 0, final: null }))).toBeNull();
  });
  it('never exceeds a full bar', () => {
    expect(blockLine(s({ secondsLeft: -5 })).fraction).toBe(1);
  });
});
