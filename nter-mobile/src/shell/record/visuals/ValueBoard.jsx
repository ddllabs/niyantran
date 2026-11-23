/** A short board of named values (F121): one row per figure, its note (year, unit or change) beside the label. */
export default function ValueBoard({ title, right, visual }) {
  const rows = visual?.rows || [];
  if (!rows.length) return null;
  return (
    <div className="rp-viz rp-board">
      <div className="rp-viz-head"><span>{title}</span>{right ? <span>{right}</span> : null}</div>
      <dl className="rp-board-rows">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}{r.note ? <small>{r.note}</small> : null}</dt>
            <dd className={r.tone ? `rp-${r.tone}-text` : undefined}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {visual.caption ? <p className="rp-viz-cap">{visual.caption}</p> : null}
    </div>
  );
}
