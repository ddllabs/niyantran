import { useEffect, useState } from 'react';

let loading;

// One runtime per page, including remounts and React StrictMode.
export function loadEarth() {
  if (customElements.get('nter-earth')) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/brand/earth/nter-earth.js';
    script.async = true;
    const finish = (error) => {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('Earth loading timed out')), 15000);
    script.onload = () => finish(customElements.get('nter-earth') ? null : new Error('Earth registration failed'));
    script.onerror = () => finish(new Error('Earth loading failed'));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export default function NterEarth({ paused = false }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadEarth().then(() => { if (mounted) setReady(true); }).catch(() => {
      // The supplied still image remains visible if the runtime cannot load.
    });
    return () => { mounted = false; };
  }, []);
  return (
    <div className="mkt-earth" aria-hidden="true">
      {ready
        ? <nter-earth paused={paused ? '' : undefined} />
        : <img src="/brand/earth/earth-poster.png" alt="" width="1200" height="1200" />}
    </div>
  );
}
