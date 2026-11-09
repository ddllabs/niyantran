// The screening stage's shared contract (spec: docs/specs/2026-11-10-screening-stage.md). Types only: the screen core
// (screen.ts), each collection screen (screens/*.ts) and the page check (page_check.ts) are written against this file,
// so it changes only with the spec.

import type { Rec } from './prepare.ts';

/** The five checks every review carries (supabase/functions/_shared/suppliedText.ts). */
export type ReviewCheck = 'identity' | 'completeness' | 'sensitivity' | 'dedupe' | 'rights';
export const REVIEW_CHECKS: readonly ReviewCheck[] = ['identity', 'completeness', 'sensitivity', 'dedupe', 'rights'];

/** A failed check on one record. `reason` is a short snake_case name; `detail` never holds record text. */
export interface Finding {
  check: string;
  covers: ReviewCheck[];
  reason: string;
  detail?: string;
}

/** A live document, as the screen may read it (read-only). */
export interface LiveDocument {
  id: string;
  source_key: string | null;
  file_url: string | null;
  file_name: string | null;
  desk_feature: string | null;
  document_key: string | null;
}

/** A listing row, as the screen may read it (read-only). `row` is desk_rows.row. */
export interface LiveDeskRow {
  tier: string;
  feature: string;
  row_key: string;
  document_key: string | null;
  row: Rec;
}

/** Read-only access to NTER. The real one runs every statement in a read-only transaction that is rolled back. */
export interface LiveReader {
  /** Live documents holding any of these source keys or file URLs (either list may be empty). */
  documents(q: { sourceKeys: string[]; fileUrls: string[] }): Promise<LiveDocument[]>;
  /** Listing rows of one tier and feature with any of these document keys. */
  deskRows(q: { tier: string; feature: string; documentKeys: string[] }): Promise<LiveDeskRow[]>;
}

/** What a check can use besides the record. */
export interface ScreenContext {
  live: LiveReader;
  /** The collection file's screen settings (licence classes admitted, and so on). */
  settings: Rec;
}

/**
 * One check. Exactly one of `one` (per record) or `all` (over the whole set, for duplicates and anything else that
 * needs every record) is given. A check must return findings for every record it could not judge, never skip it.
 */
export interface Check {
  name: string;
  covers: ReviewCheck[];
  one?(record: Rec, ctx: ScreenContext): Promise<Finding[]>;
  /** Findings by source_key; a key absent from the map passed. */
  all?(records: Rec[], ctx: ScreenContext): Promise<Map<string, Finding[]>>;
  /** True when the check reads NTER or the network (skipped, and the record held, under --no-live / --no-pages). */
  needs?: 'live' | 'pages';
}

/** A collection screen. Invalid unless every ReviewCheck is covered by at least one check. */
export interface Screen {
  collection: string;
  /** Written to review.mapping_version, e.g. 'bills-screen-v1'. */
  mappingVersion: string;
  /** Repository paths whose bytes, in this order, make review.rules_sha256. */
  rulesFiles: string[];
  checks: Check[];
}
