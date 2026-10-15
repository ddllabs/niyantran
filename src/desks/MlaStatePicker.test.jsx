// F190: the State control on MLA Directory: a native select with a visible label, "All states" first.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MlaStatePicker from './MlaStatePicker.jsx';
import { MLA_STATES } from '../lib/mlaStates.js';

const markup = (props = {}) => renderToStaticMarkup(<MlaStatePicker value="" onChange={() => {}} {...props} />);

describe('the MLA Directory state picker (F190)', () => {
  it('is a native select with a visible, associated "State" label', () => {
    const html = markup();
    expect(html).toMatch(/<label[^>]*for="(mla-state)"[^>]*>State<\/label>/);
    expect(html).toMatch(/<select[^>]*id="mla-state"/);
  });

  it('offers "All states" first, then the 31 states in the server order', () => {
    const unescape = (t) => t.replace(/&amp;/g, '&');
    const options = [...markup().matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [unescape(m[1]), unescape(m[2])]);
    expect(options).toHaveLength(32);
    expect(options[0]).toEqual(['', 'All states']);
    expect(options.slice(1).map(([, label]) => label)).toEqual([...MLA_STATES]);
    expect(options.slice(1).map(([value]) => value)).toEqual([...MLA_STATES]);
  });

  it('shows the chosen state, and "All states" by default', () => {
    expect(markup()).toMatch(/<option value="" selected="">All states/);
    expect(markup({ value: 'Kerala' })).toMatch(/<option value="Kerala" selected="">Kerala/);
  });

  it('reports a choice as the state name, and "All states" as an empty string', () => {
    const onChange = vi.fn();
    const select = MlaStatePicker({ value: '', onChange }).props.children.find((c) => c?.type === 'select');
    select.props.onChange({ target: { value: 'Kerala' } });
    select.props.onChange({ target: { value: '' } });
    expect(onChange.mock.calls).toEqual([['Kerala'], ['']]);
  });

  it('is not given a value the register does not hold', () => {
    expect(markup({ value: 'Atlantis' })).toMatch(/<option value="" selected="">All states/);
  });
});
