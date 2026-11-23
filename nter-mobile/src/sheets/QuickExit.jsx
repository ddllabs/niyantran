// The Quick Exit shutter: five blades (the persona's buckets) around a hub; the dock below lists
// the documents in the chosen bucket. A document opens the Make page for the record on screen.
import { useState } from 'react';
import { useApp } from '../state/app.jsx';
import { QE_DATA, BLADE_HUES, fillKind, FILL_TEXT } from '../data/quickExit.js';
import { irisGeom } from '../ui/iris.js';
import Icon from '../ui/Icon.jsx';
import { SheetShell } from '../ui/kit.jsx';

const tint = (hex, t) => {
  const v = parseInt(hex.slice(1), 16);
  const m = (c) => Math.round(c + (255 - c) * t);
  return `rgb(${m(v >> 16)},${m((v >> 8) & 255)},${m(v & 255)})`;
};

function splitLabel(b) {
  const words = b.split(' ');
  if (b.length <= 11 || words.length < 2) return [b, ''];
  let best = 1e9; let pair = [b, ''];
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '); const c = words.slice(k).join(' ');
    const m = Math.max(a.length, c.length);
    if (m < best) { best = m; pair = [a, c]; }
  }
  return pair;
}

function Iris({ qp, sel, onPick, hasRecord }) {
  const n = qp.buckets.length;
  const g = irisGeom(195, 150, 136, 52, n);
  const f = (x) => x.toFixed(1);
  return (
    <svg className="iris" viewBox="0 0 390 300" role="group" aria-label="Quick Exit buckets">
      {qp.buckets.map((b, i) => {
        const bl = g.blades[i]; const on = sel === i; const hue = BLADE_HUES[i % 5];
        const cnt = qp.docs.filter((d) => d.bucket === b).length;
        const [l1, l2] = splitLabel(b);
        const lift = on ? 6 : 0;
        return (
          <g key={b} transform={lift ? `translate(${f(bl.ux * lift)} ${f(bl.uy * lift)})` : undefined}>
            <path className="blade" d={bl.d} fill={on ? hue : tint(hue, 0.16)} strokeWidth={on ? 3.5 : 2.5} onClick={() => onPick(i)}
              role="button" tabIndex={0} aria-label={`${b}: ${cnt} documents`} aria-pressed={on}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(i); }}
              style={{ transitionDelay: `${i * 40}ms`, ...(on ? { filter: 'drop-shadow(0 6px 10px rgba(19,19,19,.3))' } : {}) }} />
            <text className="bl" x={f(bl.cx)} y={f(bl.cy - (l2 ? 8 : 3))}>{l1.toUpperCase()}</text>
            {l2 ? <text className="bl" x={f(bl.cx)} y={f(bl.cy + 3)}>{l2.toUpperCase()}</text> : null}
            <text className="bc" x={f(bl.cx)} y={f(bl.cy + (l2 ? 14 : 9))}>{cnt} DOC{cnt === 1 ? '' : 'S'}</text>
          </g>
        );
      })}
      <path className="hub" d={g.hubD} />
      <g style={{ pointerEvents: 'none' }}>
        <text className="hn" x="195" y="146">{hasRecord ? qp.docs.length : 0}</text>
        <text className="ht" x="195" y="156">{hasRecord ? 'FOR THIS RECORD' : 'NO RECORD'}</text>
        <text className="ht" x="195" y="166" style={{ fontSize: '5.8px', opacity: 0.75 }}>{qp.name.toUpperCase()}</text>
      </g>
    </svg>
  );
}

export default function QuickExitSheet({ record }) {
  const { persona, push, closeSheet, openSheet } = useApp();
  const qp = QE_DATA[persona?.qe ?? 0];
  const [sel, setSel] = useState(0);
  const bucket = qp.buckets[sel];
  const docs = qp.docs.filter((d) => d.bucket === bucket);
  const hue = BLADE_HUES[sel % 5];
  const ready = qp.docs.filter((d) => d.trade).length;
  const make = (d) => { closeSheet(); push({ v: 'make', qeId: d.id, record, key: d.id }); };

  return (
    <SheetShell size="tall" label="Quick Exit">
      <div className="iriswrap">
        <span className="hint">QUICK EXIT</span>
        <Iris qp={qp} sel={sel} onPick={setSel} hasRecord={Boolean(record)} />
        <button type="button" className="x" onClick={closeSheet} aria-label="Close"><Icon name="close" /></button>
      </div>
      {record ? (
        <div className="sh-body" style={{ padding: 0 }}>
          <div className="dock-hd"><div>
            <div className="k">QUICK EXITS · {qp.name.toUpperCase()}</div>
            <h2>Documents for this record</h2>
            <p>{qp.docs.length} documents you can make from this record · {ready} in a ready-to-submit format</p>
          </div></div>
          <div className="dock-rec"><span className="k">FOR</span><span className="chip soft"><i /><span>{record.title}</span></span></div>
          <div className="bkt"><b style={{ background: hue }}>{bucket.toUpperCase()}</b><span>{qp.lines?.[bucket] || ''}</span><em>{sel + 1} / {qp.buckets.length} · {docs.length} DOC{docs.length === 1 ? '' : 'S'}</em></div>
          {docs.map((d, i) => {
            const k = fillKind(d.fill);
            return (
              <button key={d.id} type="button" className="qcard" onClick={() => make(d)} style={{ animation: `rise .35s ${40 + i * 45}ms both` }}>
                <span className="n">{d.name}</span>
                <span className="w">{d.what}</span>
                <span className="m"><span className={`f ${k}`}>{FILL_TEXT[k]}</span>{d.trade ? <span className="rf">READY</span> : null}</span>
                <span className="go">MAKE →</span>
              </button>
            );
          })}
          <div className="dock-foot">
            <span><i style={{ background: 'var(--live)' }} />Full / Most — fills from the record today</span>
            <span><i style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)' }} />Half</span>
            <span><i style={{ background: 'var(--red-soft)', border: '1px solid var(--red)' }} />Skeleton until text</span>
            <span style={{ color: 'var(--purple)' }}>READY = comes out in its submission form</span>
          </div>
        </div>
      ) : (
        <div className="empty" style={{ padding: '30px 28px' }}>
          <b>Attach a record first</b>
          Quick Exits are written from one record plus one question. Choose a bill, a question, an order or a release and the blades fill with documents for it.
          <div style={{ marginTop: 16 }}><button type="button" className="pbtn sm" onClick={() => openSheet('picker')}>Choose a record</button></div>
        </div>
      )}
    </SheetShell>
  );
}
