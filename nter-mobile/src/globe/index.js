// nter.pro's own home-page globe (the <nter-data-globe> custom element from the website build),
// pointed at the textures shipped in /textures. Loaded on demand by the welcome screen.
import { asset } from '../lib/asset.js';
let loading = null;

export function loadGlobe() {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return Promise.resolve(false);
  if (customElements.get('nter-data-globe')) return Promise.resolve(true);
  if (!loading) {
    window.NTER_GLOBE_TEX = {
      day: asset('/textures/day.webp'),
      clouds: asset('/textures/clouds.webp'),
      oceans: asset('/textures/oceans.webp'),
      fallback: asset('/textures/globe-still.webp'),
    };
    loading = import('./nterGlobe.app.js').then(() => true, () => false);
  }
  return loading;
}
