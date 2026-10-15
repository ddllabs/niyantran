import { MLA_STATES } from '../lib/mlaStates.js';

/**
 * F190: MLA Directory's State control. "All states" (the default) is the page across every state; a
 * state is that state's whole list (the server reads `state`, server/feedServe.mjs). A native select with
 * a visible label, so the keyboard and screen readers work as they do for any select.
 */
export default function MlaStatePicker({ value, onChange }) {
  const shown = MLA_STATES.includes(value) ? value : '';
  return (
    <div className="mla-state">
      <label htmlFor="mla-state">State</label>
      <select id="mla-state" value={shown} onChange={(e) => onChange(e.target.value)}>
        <option value="">All states</option>
        {MLA_STATES.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
}
