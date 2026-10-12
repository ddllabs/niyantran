import { useEffect, useRef, useState } from 'react';

export default function AuthEarth() {
  const host = useRef(null), scene = useRef(null), pointer = useRef(null);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let mounted = true, controller;
    import('./authEarthScene.js').then(({ createAuthEarth }) => {
      if (!mounted) return;
      controller = createAuthEarth(host.current, {
        ready: () => { if (mounted) setState('ready'); },
        fail: () => { if (mounted) setState('fallback'); },
      });
      scene.current = controller;
    }).catch(() => { if (mounted) setState('fallback'); });
    return () => { mounted = false; controller?.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.setPaused(paused); }, [paused, state]);
  function start(event) {
    if (state !== 'ready' || event.button !== 0) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    scene.current?.setDragging(true);
  }
  function move(event) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    scene.current?.rotate((event.clientX - p.x) * .008, (event.clientY - p.y) * .008);
    p.x = event.clientX; p.y = event.clientY;
  }
  function stop() { pointer.current = null; scene.current?.setDragging(false); }
  function keyboard(event) {
    const arrows = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] };
    if (!arrows[event.key] || state !== 'ready') return;
    event.preventDefault(); scene.current?.rotate(...arrows[event.key]);
  }
  return <div className="auth-earth" role="group" aria-label="Earth globe">
    <div className={`auth-earth-view ${state}`} ref={host} role="img"
      aria-label={state === 'ready' ? 'Interactive Earth. Drag or use arrow keys to rotate.' : 'Earth viewed from space'}
      tabIndex={state === 'ready' ? 0 : undefined} onKeyDown={keyboard}
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
      {state !== 'ready' && <img className="auth-earth-poster" src="/images/desks-v6/ddc31bd30cf098243de4.jpg" alt="" />}
    </div>
    <div className="auth-earth-controls">
      {state === 'ready' && <><span>Drag to explore</span><button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume globe' : 'Pause globe'}</button></>}
      <a href="https://ssi.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Earth imagery · Solar System Scope</a>
    </div>
  </div>;
}
