// Strict input validation shared by the actions. Anything that does not match is a 400.

import { ApiError } from './apiError.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const badRequest = (message: string) => new ApiError(400, message, { reason: 'bad_request' });

export type Obj = Record<string, unknown>;

export const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function uuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw badRequest(`${name} must be a UUID.`);
  return v.toLowerCase();
}

/** A string of 1 to max characters (UTF-16 units; the byte size of the body is capped separately). */
export function text(v: unknown, name: string, max: number, min = 1): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw badRequest(`${name} must be text of ${min} to ${max} characters.`);
  }
  return v;
}

export function optionalText(v: unknown, name: string, max: number): string {
  if (v === undefined || v === null) return '';
  return text(v, name, max, 0);
}

/** A finite number from 0 to 10,000,000 (the column's range), or null. */
export function position(v: unknown, name: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000_000) {
    throw badRequest(`${name} must be a number from 0 to 10000000 or null.`);
  }
  return v;
}

export function isoTime(v: unknown, name: string): string {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  const year = Number.isFinite(ms) ? new Date(ms).getUTCFullYear() : 0;
  if (year < 2000 || year > 2100) throw badRequest(`${name} must be an ISO time.`);
  return new Date(ms).toISOString();
}
