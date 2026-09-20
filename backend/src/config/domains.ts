/**
 * Central domain and base URL configuration.
 */

const getEnvVar = (key: string): string | undefined => {
  if (typeof process !== "undefined" && process?.env && process.env[key]) {
    return process.env[key];
  }
  if (typeof import.meta !== "undefined" && (import.meta as any)?.env && (import.meta as any).env[key]) {
    return (import.meta as any).env[key];
  }
  return undefined;
};

export const PRODUCTION_URL = getEnvVar("APP_URL") || getEnvVar("SITE_URL") || "https://niyantran.ai";

export function getAppBaseUrl(overrideOrigin?: string): string {
  if (overrideOrigin) return overrideOrigin;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return getEnvVar("APP_URL") || getEnvVar("SITE_URL") || getEnvVar("APP_BASE_URL") || getEnvVar("VITE_APP_BASE_URL") || PRODUCTION_URL;
}

