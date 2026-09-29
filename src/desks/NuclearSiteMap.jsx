import { useEffect, useRef } from 'react';
import { fillSiteLabel } from '../lib/geoTip.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function project(lat, lon, z) {
  const size = 256 * 2 ** z;
  const s = Math.sin((clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}
function unproject(x, y, z) {
  const size = 256 * 2 ** z;
  const lon = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: ((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))), lon };
}
export function zoomFor(p) {
  if (/country centroid/i.test(p.precision)) return 4;
  if (/approximate|regional/i.test(p.precision)) return 8;
  if (/mine|power reactor|research reactor|facility|complex|site/i.test(p.facilityKind || p.kind)) return 11;
  return 9;
}
export function coordText(p) {
  const d = /approximate|regional|country/i.test(p.precision) ? 2 : 4;
  return `${Number(p.lat).toFixed(d)}, ${Number(p.lon).toFixed(d)}`;
}

export default function NuclearSiteMap({ selected, facilities, onPick }) {
  const rootRef = useRef(null);
  const stateRef = useRef({ lat: +selected.lat, lon: +selected.lon, zoom: zoomFor(selected), drag: null, fail: 0 });

  useEffect(() => {
    stateRef.current.lat = +selected.lat;
    stateRef.current.lon = +selected.lon;
    stateRef.current.zoom = zoomFor(selected);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id]);

  function dims() {
    const r = rootRef.current.getBoundingClientRect();
    return { w: Math.max(320, Math.round(r.width)), h: Math.max(220, Math.round(r.height)) };
  }
  function center(x, y) {
    const q = unproject(x, y, stateRef.current.zoom);
    stateRef.current.lat = clamp(q.lat, -85, 85);
    stateRef.current.lon = ((q.lon + 540) % 360) - 180;
  }
  function draw() {
    const root = rootRef.current;
    if (!root) return;
    const tiles = root.querySelector('.nww-map-tiles');
    const markers = root.querySelector('.nww-map-markers');
    const offline = root.querySelector('.nww-map-offline');
    if (!tiles || !markers) return;
    const d = dims();
    const z = stateRef.current.zoom;
    const n = 2 ** z;
    const c = project(stateRef.current.lat, stateRef.current.lon, z);
    const left = c.x - d.w / 2;
    const top = c.y - d.h / 2;
    const minX = Math.floor(left / 256);
    const maxX = Math.floor((left + d.w) / 256);
    const minY = Math.max(0, Math.floor(top / 256));
    const maxY = Math.min(n - 1, Math.floor((top + d.h) / 256));
    tiles.innerHTML = '';
    stateRef.current.fail = 0;
    if (offline) offline.style.display = 'none';
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const w = ((tx % n) + n) % n;
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'strict-origin-when-cross-origin';
        img.src = `https://tile.openstreetmap.org/${z}/${w}/${ty}.png`;
        img.style.left = `${Math.round(tx * 256 - left)}px`;
        img.style.top = `${Math.round(ty * 256 - top)}px`;
        img.onerror = () => {
          stateRef.current.fail += 1;
          if (offline && stateRef.current.fail > 4) offline.style.display = 'grid';
        };
        tiles.appendChild(img);
      }
    }
    markers.innerHTML = '';
    facilities.forEach((x) => {
      if (/country centroid/i.test(x.precision) && z > 6) return;
      const q = project(+x.lat, +x.lon, z);
      let dx = q.x - c.x;
      if (dx > d.w / 2) dx -= 256 * n;
      if (dx < -d.w / 2) dx += 256 * n;
      const dy = q.y - c.y;
      const px = d.w / 2 + dx;
      const py = d.h / 2 + dy;
      if (px < -20 || py < -20 || px > d.w + 20 || py > d.h + 20) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `nww-map-marker${x.id === selected.id ? ' is-selected' : ''}${px > d.w * 0.66 ? ' nww-label-left' : ''}`;
      b.style.left = `${px}px`;
      b.style.top = `${py}px`;
      b.setAttribute('aria-label', x.name);
      fillSiteLabel(b, x);
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick?.(x);
      };
      markers.appendChild(b);
    });
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(root);
    function onDown(e) {
      if (e.target.closest?.('.nww-map-marker')) return;
      if (e.target.closest?.('.nww-map-controls, .nww-map-attrib')) return;
      const c = project(stateRef.current.lat, stateRef.current.lon, stateRef.current.zoom);
      stateRef.current.drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
      root.setPointerCapture(e.pointerId);
      root.classList.add('is-dragging');
    }
    function onMove(e) {
      if (!stateRef.current.drag) return;
      center(stateRef.current.drag.cx - (e.clientX - stateRef.current.drag.x), stateRef.current.drag.cy - (e.clientY - stateRef.current.drag.y));
      draw();
    }
    function onEnd(e) {
      if (!stateRef.current.drag) return;
      stateRef.current.drag = null;
      root.classList.remove('is-dragging');
      try {
        root.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onEnd);
    root.addEventListener('pointercancel', onEnd);
    return () => {
      ro.disconnect();
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onEnd);
      root.removeEventListener('pointercancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilities, selected.id, onPick]);

  function zoom(d) {
    const z = clamp(stateRef.current.zoom + d, 2, 15);
    if (z !== stateRef.current.zoom) {
      stateRef.current.zoom = z;
      draw();
    }
  }

  return (
    <div className="nww-mapwrap">
      <div
        ref={rootRef}
        className="nww-map"
        tabIndex={0}
        role="application"
        aria-label={`Interactive public-source map centred on ${selected.name}`}
      >
        <div className="nww-map-tiles" />
        <div className="nww-map-offline">Map tiles unavailable · public coordinates remain active</div>
        <div className="nww-map-markers" />
        <span className="nww-map-label">
          {selected.name} · {coordText(selected)}
          <br />
          {selected.precision}
        </span>
        <div className="nww-map-controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)}>
            −
          </button>
          <button
            type="button"
            className="nww-home"
            onClick={() => {
              stateRef.current.lat = +selected.lat;
              stateRef.current.lon = +selected.lon;
              stateRef.current.zoom = zoomFor(selected);
              draw();
            }}
          >
            Selected
          </button>
        </div>
        <div className="nww-map-key">
          <i />
          selected · drag or scroll · click any visible facility
        </div>
        <a className="nww-map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors · ODbL
        </a>
      </div>
    </div>
  );
}
