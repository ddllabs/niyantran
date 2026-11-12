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
  /** metadata->>'house' and metadata->>'document_role' (Bills), and documents.content_sha256. */
  house: string | null;
  document_role: string | null;
  content_sha256: string | null;
  /** metadata->>'document_key_suggested' (search-only desks). Absent from readers that predate the field. */
  document_key_suggested?: string | null;
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
  /**
   * Live documents matching any of the given lists (each may be empty or absent): source keys, file URLs, stored text
   * hashes (documents.content_sha256), document keys (metadata->>'document_key') or suggested keys
   * (metadata->>'document_key_suggested'); document keys and suggested keys only with `tier` and `feature`, which then
   * also restrict those lists' matches to documents of that tier and feature.
   */
  documents(q: {
    sourceKeys: string[];
    fileUrls: string[];
    contentHashes?: string[];
    documentKeys?: string[];
    suggestedKeys?: string[];
    tier?: string;
    feature?: string;
  }): Promise<LiveDocument[]>;
  /** Which database the reader is on, and how much it holds, for the receipt; the screen refuses zero counts. */
  identity(
    q: { tier: string; feature: string },
  ): Promise<{ database: string; server: string; documents: number; deskRows: number }>;
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
  /**
   * Run only on records that no earlier check (in screen order) has found anything on. A record skipped this way is
   * already held, so skipping never lets a record pass; it saves expensive work (the page check) on held records.
   */
  onlyIfClean?: boolean;
}

/** What a report counted in one record: counters by group (a host, for example), never text or values. */
export interface ReportObservation {
  /** A short label such as a host name: letters, digits, dot, dash, underscore; anything else is counted as 'other'. */
  group: string;
  /** Counter name (lower-case letters and underscore) to a count. */
  counts: Record<string, number>;
}

/**
 * A report-only scan. It reads each record and returns counts; the screen adds them up into the receipt. It is not a
 * check: it covers no review check, its result is never read by the hold logic, and a report that fails or returns
 * something unusable only adds to `report_errors` in the receipt. It can never add a hold or remove one.
 */
export interface Report {
  name: string;
  /** A fixed sentence the receipt repeats beside the counts (how to read them). Not built from records. */
  note?: string;
  /**
   * `outcome` says whether the record was screened or held; a report sees every input record either way, so its
   * counts cover the whole input and can be split by outcome.
   */
  one(
    record: Rec,
    ctx: ScreenContext,
    outcome: 'screened' | 'held',
  ): Promise<ReportObservation[]> | ReportObservation[];
}

/** A collection screen. Invalid unless every ReviewCheck is covered by at least one check. */
export interface Screen {
  collection: string;
  /** Written to review.mapping_version, e.g. 'bills-screen-v1'. */
  mappingVersion: string;
  /** Repository paths whose bytes, in this order, make review.rules_sha256. */
  rulesFiles: string[];
  checks: Check[];
  /**
   * Whether the collection has listing rows under the records' desk_feature. 'required' (the default when absent):
   * the live identity read must find documents and listing rows, and zero of either stops the run. 'none': only zero
   * documents stops the run (a desk whose listing uses another spelling, such as Regulatory), and the receipt says so.
   */
  listingRows?: 'required' | 'none';
  /** Report-only scans, counted into the receipt (see Report). Absent: none. */
  reports?: Report[];
  /**
   * What a hold repeats as the record's `source_key`. Absent: the key if it is at most 200 characters, else null.
   * 'hex40': the key only when it is 40 hex characters, else null (a malformed key can be record-controlled text).
   */
  holdKeys?: 'hex40';
  /**
   * Top-level fields the collection's adapter reads, derived only from fields of the record that this screen's checks
   * verified (for Bills: `document_key` from the agreeing links, `document_role` from `citation.version`). Applied to
   * passing records only, after every check passed and before the review is built; it may add fields, never change or
   * remove one. Absent: nothing is added.
   */
  project?(record: Rec): Rec;
}
