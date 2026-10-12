// Public policy pages served at clean paths (also reachable as #/<page>).
export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  about: '/about',
  contact: '/contact',
  refunds: '/refunds',
  delivery: '/delivery',
};

export const isLegalPathname = path => Object.values(LEGAL_PATHS).includes(path);
