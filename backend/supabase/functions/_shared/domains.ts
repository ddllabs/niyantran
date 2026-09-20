/**
 * Shared domain configuration for edge functions.
 */

export const PRODUCTION_URL = "https://niyantran.ai";

export const LEGACY_HOST = "tenders.ddllabs.ai";
export const NEW_HOSTS = ["niyantran.ai", "www.niyantran.ai", "os.ddllabs.ai", "www.os.ddllabs.ai"];

/** Exact first-party hosts allowed in user-facing links. */
export const TRUSTED_HOSTS = [LEGACY_HOST, ...NEW_HOSTS];

/** Suffixes for preview/sandbox hosts. */
export const TRUSTED_HOST_SUFFIXES = [".lovable.app", ".lovableproject.com", ".vercel.app"];

export const PREVIEW_HOST_FRAGMENTS = [
  "lovableproject.com",
  "lovable.app",
  "lovable.dev",
  "gptengineer.run",
  "vercel.app",
];

export function isTrustedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (TRUSTED_HOSTS.includes(parsed.hostname)) return true;
  return TRUSTED_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
}

export function isPreviewOrigin(origin: string): boolean {
  return PREVIEW_HOST_FRAGMENTS.some((fragment) => origin.includes(fragment));
}

/** Base URL for links sent by email; preview origins fall back to production. */
export function getAppBaseUrl(origin: string | null): string {
  if (!origin) return PRODUCTION_URL;
  return isPreviewOrigin(origin) ? PRODUCTION_URL : origin;
}
