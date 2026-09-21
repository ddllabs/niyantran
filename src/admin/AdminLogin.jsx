import { useEffect, useRef, useState } from 'react';
import './admin.css';
import { signInAdmin } from './adminSession.js';

function Field({ mouse }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pal = ['#012ea1', '#4f1d90', '#c81322', '#176b55'];
    const nodes = Array.from({ length: 64 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00042,
      vy: (Math.random() - 0.5) * 0.00042,
      r: 1.1 + Math.random() * 1.7,
      c: pal[i % pal.length],
    }));

    let raf = 0;

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);

    function frame() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (!reduced) {
        const mx = mouse.current.x;
        const my = mouse.current.y;
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > 1) n.vx *= -1;
          if (n.y < 0 || n.y > 1) n.vy *= -1;
          n.x = Math.min(1, Math.max(0, n.x));
          n.y = Math.min(1, Math.max(0, n.y));

          // Gentle attractor toward cursor.
          const dx = mx - n.x;
          const dy = my - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 0.045 && d2 > 0.0002) {
            n.x += dx * 0.012;
            n.y += dy * 0.012;
          }
        }
      }

      // Synapse lines.
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
          if (d > 160) continue;
          ctx.strokeStyle = `rgba(1,46,161,${0.22 * (1 - d / 160)})`;
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }

      // Node dots.
      for (const n of nodes) {
        ctx.fillStyle = n.c;
        ctx.globalAlpha = 0.62;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mouse]);

  return <canvas ref={ref} className="adm-login-canvas" aria-hidden="true" />;
}

export default function AdminLogin({ onOk, checking = false, message = '' }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const mouse = useRef({ x: 0.72, y: 0.38 });
  const root = useRef(null);

  function onMove(e) {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    mouse.current = { x, y };
    el.style.setProperty('--mx', `${(x * 100).toFixed(2)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(2)}%`);
    el.style.setProperty('--px', `${((x - 0.5) * 28).toFixed(2)}px`);
    el.style.setProperty('--py', `${((y - 0.5) * 18).toFixed(2)}px`);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (pending || checking) return;
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError('');
    const result = await signInAdmin(String(fd.get('user') || ''), String(fd.get('pass') || ''));
    if (result.status === 'verified') onOk();
    else setError(result.message || 'Unable to verify admin access. Please try again.');
    setPending(false);
  }

  return (
    <div className="adm-login" ref={root} onMouseMove={onMove}>
      <div className="adm-login-art" aria-hidden="true">
        <Field mouse={mouse} />
        <span className="scan" />
        <span className="sh navy" />
        <span className="sh sand" />
        <span className="sh purple" />
        <span className="sh red" />
        <span className="ring" />
        <span className="ring r2" />
      </div>
      <main className="adm-login-card">
        <div className="mark">
          <img src="/brand/logo.png?v=2" alt="" />
        </div>
        <h1>CONTROL</h1>
        <div className="tag">ADMIN ACCESS</div>
        <form onSubmit={onSubmit} autoComplete="off">
          <label className="adm-field">
            <span>Admin email</span>
            <input name="user" type="email" autoComplete="username" required autoFocus />
          </label>
          <label className="adm-field">
            <span>Password</span>
            <input name="pass" type="password" autoComplete="current-password" required />
          </label>
          <button className="adm-btn" type="submit" disabled={pending || checking}>
            {pending ? 'Signing in…' : checking ? 'Verifying access…' : 'Enter control plane'}
          </button>
          <div className="adm-msg err" role="alert">
            {error || message}
          </div>
        </form>
        <p className="adm-login-hint">Restricted plane. Analyst terminal logins do not open this console.</p>
      </main>
    </div>
  );
}
