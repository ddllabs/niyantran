// The website's static data files (/data/… on www.nter.pro), such as the analysis packs the bill,
// question, pipeline and regulatory desk cards read. Phone apps ask www.nter.pro directly (native
// HTTP, no CORS); a browser build asks its own site, which forwards /data like /api (the dev proxy
// in vite.config.js, the rewrite in vercel.json).
import { API_BASE, WEB_API_BASE } from './config.js';
import { isNative } from './platform.js';

export const websiteDataUrl = (path) => `${isNative() ? API_BASE : WEB_API_BASE}${path}`;
