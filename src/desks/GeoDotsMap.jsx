import { useEffect, useRef } from 'react';
import landmap from '../data/landmap.json';

let LAND = null;
function landCells() {
  if (LAND) return LAND;
  const bytes = atob(landmap.b);
  const cells = [];
  const n = landmap.w * landmap.h;
  for (let i = 0; i < n; i++) {
    if (bytes.charCodeAt(i >> 3) & (1 << (i & 7))) {
      const gy = Math.floor(i / landmap.w);
      const gx = i % landmap.w;
      cells.push([-180 + ((gx + 0.5) / landmap.w) * 360, 90 - ((gy + 0.5) / landmap.h) * 180]);
    }
  }
  LAND = cells;
  return LAND;
}

function proj(lon, lat, w, h) {
  return [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
}

export default function GeoDotsMap({ points, legend, onPick, ariaLabel }) {
  const canvasRef = useRef(null);
  const tipRef = useRef(null);
  const ptsRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    function draw() {
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const og = ctx.createLinearGradient(0, 0, 0, cssH);
      og.addColorStop(0, 'rgba(16,26,44,.55)');
      og.addColorStop(1, 'rgba(7,11,20,.78)');
      ctx.fillStyle = og;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(96,128,168,.075)';
      for (let lon = -150; lon <= 150; lon += 30) {
        const a = proj(lon, 84, cssW, cssH);
        const b = proj(lon, -84, cssW, cssH);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const a = proj(-180, lat, cssW, cssH);
        const b = proj(180, lat, cssW, cssH);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      const e0 = proj(-180, 0, cssW, cssH);
      const e1 = proj(180, 0, cssW, cssH);
      ctx.strokeStyle = 'rgba(96,128,168,.15)';
      ctx.beginPath();
      ctx.moveTo(e0[0], e0[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,184,109,.26)';
      landCells().forEach((c) => {
        const p = proj(c[0], c[1], cssW, cssH);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 0.9, 0, 6.283);
        ctx.fill();
      });
      ptsRef.current = (points || []).map((pt) => {
        const p = proj(pt.lon, pt.lat, cssW, cssH);
        const inten = pt.intensity || 40;
        const r = 3 + (inten / 100) * 9;
        const col = pt.color || '#ff6f6f';
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 2.5);
        g.addColorStop(0, col);
        g.addColorStop(0.42, `${col}66`);
        g.addColorStop(1, `${col}00`);
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 2.5, 0, 6.283);
        ctx.fill();
        if (inten >= 70) {
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p[0], p[1], r + 3.5, 0, 6.283);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.7, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.1, 0, 6.283);
        ctx.fill();
        return { x: p[0], y: p[1], r: r * 2.5, d: pt };
      });
      ctx.globalAlpha = 1;
    }
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points]);

  function hitAt(e) {
    const canvas = canvasRef.current;
    const rc = canvas.getBoundingClientRect();
    const mx = e.clientX - rc.left;
    const my = e.clientY - rc.top;
    let hit = null;
    ptsRef.current.forEach((pt) => {
      const dx = mx - pt.x;
      const dy = my - pt.y;
      if (dx * dx + dy * dy < (pt.r + 4) * (pt.r + 4)) hit = pt;
    });
    return hit;
  }

  return (
    <div className="geo-mapwrap">
      <canvas
        ref={canvasRef}
        className="geo-map"
        aria-label={ariaLabel || 'Maritime chokepoints map'}
        onMouseMove={(e) => {
          const tip = tipRef.current;
          const hit = hitAt(e);
          const canvas = canvasRef.current;
          if (hit && tip) {
            tip.hidden = false;
            tip.style.left = `${hit.x + 12}px`;
            tip.style.top = `${hit.y - 8}px`;
            tip.innerHTML = `<b>${hit.d.name}</b><br>${hit.d.statusL || ''} · ${hit.d.intensity ?? ''}`;
            canvas.style.cursor = 'pointer';
          } else if (tip) {
            tip.hidden = true;
            canvas.style.cursor = 'default';
          }
        }}
        onMouseLeave={() => {
          if (tipRef.current) tipRef.current.hidden = true;
        }}
        onClick={(e) => {
          const hit = hitAt(e);
          if (hit) onPick?.(hit.d);
        }}
      />
      <div ref={tipRef} className="geo-tip" hidden />
      <div className="geo-map-legend">
        {(legend || []).map(([color, label]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
