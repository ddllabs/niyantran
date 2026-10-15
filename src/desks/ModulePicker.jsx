/**
 * F196: the Table control of the RBI handbook modules and the Cross-State Comparison Engine
 * (src/lib/modulePicker.js). A native select with a visible label, styled as MLA Directory's State
 * control; tables are grouped by module where the picker names groups.
 */
export default function ModulePicker({ picker, value, onChange }) {
  const shown = picker.options.some((o) => o.value === value) ? value : picker.defaultValue;
  const groups = [];
  for (const option of picker.options) {
    const last = groups[groups.length - 1];
    if (last && last.name === (option.group || '')) last.options.push(option);
    else groups.push({ name: option.group || '', options: [option] });
  }
  const render = (o) => <option key={o.value} value={o.value}>{o.label}</option>;
  return (
    <div className="mla-state module-picker">
      <label htmlFor={picker.id}>{picker.label}</label>
      <select id={picker.id} value={shown} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => (g.name ? <optgroup key={g.name} label={g.name}>{g.options.map(render)}</optgroup> : g.options.map(render)))}
      </select>
    </div>
  );
}
