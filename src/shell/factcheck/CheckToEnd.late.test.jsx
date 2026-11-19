// B7 (review 12): the figure for "Check to the end" may arrive after the start screen opened.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { Choose } = await import('./FactCheckPanel.jsx');
const { COVERS_REST_TEXT } = await import('./factCheckText.js');

const noop = () => {};
const view = { flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, balance: 1000000 };
const props = (remainingSeconds) => ({ view, isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, covered: null, onShowPart: noop, sharing: false, remainingSeconds });
const options = (out) => [...elements(out)].filter((e) => e.props?.['data-minutes'] !== undefined);
const pressed = (out) => options(out).filter((e) => e.props['aria-pressed']).map((e) => e.props['data-minutes']);
const hinted = (out) => options(out).filter((e) => JSON.stringify(e.props.children).includes(COVERS_REST_TEXT)).map((e) => e.props['data-minutes']);

beforeEach(() => { harness.reset(); });

describe('Check to the end, figure arriving late', () => {
  it('unknown at mount, then known while the user has not touched a length: applied', () => {
    let out = harness.render(Choose, props(null));
    expect(pressed(out)).toEqual([5]);
    expect(hinted(out)).toEqual([]);
    out = harness.render(Choose, props(420));
    expect(pressed(out)).toEqual([10]);
    expect(hinted(out)).toEqual([10]);
  });
  it('never changes a length the user picked', () => {
    let out = harness.render(Choose, props(null));
    options(out).find((e) => e.props['data-minutes'] === 2).props.onClick();
    out = harness.render(Choose, props(null));
    expect(pressed(out)).toEqual([2]);
    out = harness.render(Choose, props(420));
    expect(pressed(out)).toEqual([2]);
    expect(hinted(out)).toEqual([10]); // the hint may show, the choice stays
  });
  it('known at mount stays as it was: a later figure does not move it', () => {
    let out = harness.render(Choose, props(420));
    expect(pressed(out)).toEqual([10]);
    out = harness.render(Choose, props(100));
    expect(pressed(out)).toEqual([10]);
    expect(hinted(out)).toEqual([10]);
  });
  it('more than 30 minutes at mount is a known figure: no hint, and a later smaller one does not apply', () => {
    let out = harness.render(Choose, props(2400));
    expect(pressed(out)).toEqual([5]);
    out = harness.render(Choose, props(420));
    expect(pressed(out)).toEqual([5]);
    expect(hinted(out)).toEqual([]);
  });
});
