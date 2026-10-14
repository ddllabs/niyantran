// The site's name, contact details, search tags and measurement IDs, published with the website
// itself (F175). Every visitor sees these values: nothing saved in a browser changes them, which is
// what the old admin editor did (it wrote to the admin's own localStorage, so no one else saw it).
// To change one, edit it here; the company facts come from COMPANY in legalPolicies.js so the
// header, footer, policies and contact page cannot disagree.
import { COMPANY } from './legalPolicies.js';

export const SITE_SETTINGS = Object.freeze({
  siteName: COMPANY.brand,
  shortName: 'TERMINAL',
  tagline: 'The intelligence layer for government, policy and global affairs.',
  description:
    'NIYANTRAN TERMINAL is an intelligence platform that brings together authoritative information and data sources across government, policy, legislation, economics, global affairs, markets, research, and related areas.',
  metaTitle: 'NIYANTRAN TERMINAL — Government, policy and global affairs intelligence',
  metaDescription:
    'Authoritative intelligence across government, policy, legislation, economics, global affairs, markets and research. Live desks, provenance, and source-backed coverage.',
  metaKeywords:
    'NIYANTRAN, terminal, government intelligence, policy, legislation, parliament, economics, global affairs, markets, research, India',
  canonicalUrl: '',
  robots: 'index,follow',
  locale: 'en_IN',
  author: COMPANY.brand,
  themeColor: '#012EA1',
  ogTitle: '',
  ogDescription: '',
  ogImage: '/brand/logo.png?v=2',
  ogType: 'website',
  twitterCard: 'summary_large_image',
  twitterHandle: '',
  faviconUrl: '/brand/logo.png?v=2',
  googleAnalyticsId: '',
  googleTagManagerId: '',
  customHeadHtml: '',
  contactEmail: COMPANY.email,
  contactWebsite: '',
  contactAddress: COMPANY.address,
});

export function loadSiteSettings() {
  return SITE_SETTINGS;
}
