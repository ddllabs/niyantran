// Runtime configuration. Defaults point at the live NTER backend that nter.pro itself uses.
// The publishable key is public by design: it is in every nter.pro page, and row-level
// security in the database decides what a signed-in reader may see.
const env = import.meta.env || {};

export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://vfgcppstyzjarlzyqdac.supabase.co';
export const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';
export const API_BASE = (env.VITE_API_BASE || 'https://www.nter.pro').replace(/\/$/, '');
// In a browser build, where /api is served from (empty = this site, rewritten to nter.pro).
export const WEB_API_BASE = (env.VITE_WEB_API_BASE ?? '').replace(/\/$/, '');
export const DATA_MODE = (env.VITE_DATA_MODE || 'live') === 'sample' ? 'sample' : 'live';
// 1 only once NTER's Supabase redirect URLs include pro.nter.app://auth/callback.
export const GOOGLE_ON_PHONE = env.VITE_GOOGLE_ON_PHONE === '1';
export const STREAM_CHAT = env.VITE_STREAM_CHAT === '1';
export const NTER_NEWS = 'https://nter.news';
export const APP_VERSION = '0.1.0';

export const functionsUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
