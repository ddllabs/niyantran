// Geometry of the Quick Exit shutter: n curved blades around a polygon hub, from the approved
// Quick Exit Shutter design. Returns SVG paths plus each blade's centroid and outward direction.
export function irisGeom(cx, cy, ro, rp, n) {
  const step = 360 / n;
  const rad = (d) => (d * Math.PI) / 180;
  const Vat = (th, i) => [cx + rp * Math.cos(rad(th + i * step)), cy + rp * Math.sin(rad(th + i * step))];
  const Wof = (v1, v2) => {
    const dx = v2[0] - v1[0], dy = v2[1] - v1[1], px = v1[0] - cx, py = v1[1] - cy;
    const A = dx * dx + dy * dy, B = 2 * (px * dx + py * dy), C = px * px + py * py - ro * ro;
    const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    return [v1[0] + t * dx, v1[1] + t * dy];
  };
  const w0 = Wof(Vat(0, 0), Vat(0, 1));
  const aW = (Math.atan2(w0[1] - cy, w0[0] - cx) * 180) / Math.PI;
  const th0 = -90 - (aW - step / 2);
  const V = (i) => Vat(th0, i);
  const W = (i) => Wof(V(i), V(i + 1));
  const f = (x) => x.toFixed(1);
  const blades = [];
  for (let i = 0; i < n; i++) {
    const v = V(i), wi = W(i), wp = W(i - 1);
    const a1 = Math.atan2(wi[1] - cy, wi[0] - cx), a0 = Math.atan2(wp[1] - cy, wp[0] - cx);
    let da = a1 - a0;
    while (da <= 0) da += Math.PI * 2;
    const pts = [v, wi];
    for (let k = 1; k < 12; k++) { const a = a1 - (da * k) / 12; pts.push([cx + ro * Math.cos(a), cy + ro * Math.sin(a)]); }
    pts.push(wp);
    let A = 0, gx = 0, gy = 0;
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length], c = x1 * y2 - x2 * y1;
      A += c; gx += (x1 + x2) * c; gy += (y1 + y2) * c;
    }
    A /= 2; gx /= 6 * A; gy /= 6 * A;
    const len = Math.hypot(gx - cx, gy - cy) || 1;
    blades.push({ d: `M${f(v[0])} ${f(v[1])} L${f(wi[0])} ${f(wi[1])} A${ro} ${ro} 0 0 0 ${f(wp[0])} ${f(wp[1])} Z`, cx: gx, cy: gy, ux: (gx - cx) / len, uy: (gy - cy) / len });
  }
  const hubD = `${Array.from({ length: n }, (_, i) => { const v = V(i); return `${i ? 'L' : 'M'}${f(v[0])} ${f(v[1])}`; }).join(' ')} Z`;
  return { blades, hubD };
}
