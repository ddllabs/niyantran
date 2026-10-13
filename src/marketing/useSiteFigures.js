import { useEffect, useState } from 'react';
import { fetchSiteFigures, mergeLiveFigures } from '../lib/liveFigures.js';
import { SITE_FIGURES } from '../lib/siteFigures.js';

/** F142: the site figures, measured at first and live once /api/site-figures answers. */
export function useSiteFigures() {
  const [figures, setFigures] = useState(SITE_FIGURES);
  useEffect(() => {
    let mounted = true;
    fetchSiteFigures().then((live) => {
      if (mounted) setFigures(mergeLiveFigures(SITE_FIGURES, live));
    });
    return () => { mounted = false; };
  }, []);
  return figures;
}
