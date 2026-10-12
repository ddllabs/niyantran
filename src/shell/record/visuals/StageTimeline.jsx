/** Stages a record has passed and the one it is at (F121). Undated steps stay undated. */
export default function StageTimeline({ title, right, visual }) {
  const steps = visual?.steps || [];
  if (!steps.length) return null;
  return (
    <div className="rp-viz rp-timeline">
      <div className="rp-viz-head"><span>{title}</span>{right ? <span>{right}</span> : null}</div>
      <ol className="rp-steps">
        {steps.map((s) => (
          <li key={s.label} className={`rp-step${s.done ? ' done' : ''}${s.now ? ' now' : ''}`} aria-current={s.now ? 'step' : undefined}>
            <i aria-hidden="true" />
            <span><b>{s.label}</b>{s.detail ? <small>{s.detail}</small> : null}</span>
          </li>
        ))}
      </ol>
      {visual.caption ? <p className="rp-viz-cap">{visual.caption}</p> : null}
    </div>
  );
}
