/**
 * "What it touches" as four lanes (F121): left → this record → right → far. Each node is a relation
 * on record computed by touchRules; a lane with nothing behind it is drawn empty and says so.
 */
const X = [62, 196, 330, 458];
const SLOTS = ['left', 'center', 'right', 'far'];

function Label({ x, l1, l2, muted }) {
  return (
    <>
      <text x={x} y="112" textAnchor="middle" className={muted ? 'rp-g-muted' : 'rp-g-l1'}>{l1}</text>
      {l2 ? <text x={x} y="127" textAnchor="middle" className="rp-g-l2">{l2}</text> : null}
    </>
  );
}

export default function TouchGraph({ lanes, nodes }) {
  const n = nodes || {};
  const summary = SLOTS.map((slot, i) => `${lanes?.[i] || ''}: ${n[slot]?.l1 || 'nothing on record'}`).join('; ');
  return (
    <svg className="rp-graph" viewBox="0 0 520 140" role="img" aria-label={summary}>
      {(lanes || []).map((lane, i) => <text key={lane} x={X[i]} y="16" textAnchor="middle" className="rp-g-lane">{lane}</text>)}
      {[0, 1, 2].map((i) => {
        const on = i === 0 ? n.left && n.center : i === 1 ? n.center && n.right : n.right && n.far;
        return <line key={i} x1={X[i] + 18} y1="66" x2={X[i + 1] - 18} y2="66" className={on ? 'rp-g-link' : 'rp-g-link off'} />;
      })}
      {SLOTS.map((slot, i) => {
        const node = n[slot];
        if (slot === 'center') {
          return (
            <g key={slot}>
              <circle cx={X[i]} cy="66" r="20" className="rp-g-center" />
              <text x={X[i]} y="70" textAnchor="middle" className="rp-g-code">{node?.code || '•'}</text>
              <Label x={X[i]} l1={node?.l1 || 'This record'} l2={node?.l2} />
            </g>
          );
        }
        if (!node) {
          return (
            <g key={slot}>
              <circle cx={X[i]} cy="66" r="14" className="rp-g-empty" />
              <Label x={X[i]} l1="None on record" muted />
            </g>
          );
        }
        return (
          <g key={slot}>
            <rect x={X[i] - 10} y="56" width="20" height="20" transform={`rotate(45 ${X[i]} 66)`} className={`rp-g-node${slot === 'far' ? ' far' : ''}`} />
            <Label x={X[i]} l1={node.l1} l2={node.l2} />
          </g>
        );
      })}
    </svg>
  );
}
