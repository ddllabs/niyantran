// The Bill corrigenda screen (F372). Spec: docs/specs/2026-11-21-bill-corrigenda-route.md.
//
// The pack's corrigenda (`doc_type` bill_corrigendum) have no file link, and their citation holds only a kind and a
// source. The bill each one corrects is named by its own `links` (number, year, name, house, key). This screen reads
// that claim (billIdentityFromLinks, the function prepare.ts uses) and holds it to what any bill's links are held to: a
// well-formed identity, links that agree with it, and a listing row of that bill by key, house and whole name. It
// reuses the Bills screen's checks on a view of the record whose citation is the one the links give, so the rules are
// the Bills screen's own, not a copy. What a corrigendum has no use for is left out: the official-file rule and the file
// URL lookups (it has no file link), the page check (it has no official file to compare with) and the role rules (errata
// repeat). A finding holds keys, numbers and reason names, never record text.
import type { Check, Finding, Screen } from '../screen_types.ts';
import { billIdentityFromLinks, type Rec } from '../prepare.ts';
import {
  billNorm,
  citationComplete,
  citationOf,
  duplicateText,
  duplicateTextLive,
  finding,
  isoDay,
  isRec,
  keyOf,
  linksAgree,
  listingRow,
  makeLength,
  makeLicenceAdmitted,
  oneCheck,
  projectWith,
  servableCheck,
  str,
  textBinds,
} from './bills.ts';

const BILLS = 'Bill Passage Probability Index';
const SCHEMA_PREFIX = 'nter.citation_pack/1.';
const PACK_TYPE = 'bill_corrigendum'; // the pack's name for the type (the Bills screen's `corrigendum` was an assumption)
const SOURCE_KEY = /^[0-9a-f]{40}$/;
const LINK_ROLE = 'corrigendum'; // what the pack's links call the role; the adapter's role for it is `errata`
const ROLE = 'errata';
const MIN_CHARS = 200; // as for a bill: D4 of the plan holds the shorter ones
// Measured on the 365 corrigenda of the pack (text length in UTF-16 units): 362 are 11,034 or shorter (median 445), then
// three of 252,800, 351,670 and 486,379, which are whole bills under a corrigendum's label. 20,000 holds the 362 and
// refuses the three, with room above the longest real corrigendum.
const MAX_CHARS = 20_000;

/** The bill a corrigendum's links name, or null (billIdentityFromLinks). */
const identityOf = billIdentityFromLinks;

/**
 * The record as the Bills checks read a bill: its citation is the one the links give, with version errata, and a link's
 * role `corrigendum` is the adapter's `errata`. A record whose links name no single bill is left as it is, so the checks
 * hold it too (corrigendum_identity says why).
 */
function view(r: Rec): Rec {
  const id = identityOf(r);
  if (id === null) return r;
  const links = Array.isArray(r.links)
    ? r.links.map((l) => isRec(l) && l.role === LINK_ROLE ? { ...l, role: ROLE } : l)
    : r.links;
  return { ...r, citation: { ...citationOf(r), ...id, version: ROLE }, links };
}

/** A Bills check asked of the view of each record. Same name, same findings, same live reads. */
function viewed(check: Check): Check {
  return {
    ...check,
    ...(check.one ? { one: (r, ctx) => check.one!(view(r), ctx) } : {}),
    ...(check.all ? { all: (records, ctx) => check.all!(records.map(view), ctx) } : {}),
  };
}

const shape = oneCheck('corrigendum_shape', ['identity'], (r) => {
  const bad: string[] = [];
  if (!str(r.schema) || !r.schema.startsWith(SCHEMA_PREFIX)) bad.push('schema');
  if (!str(r.source_key) || !SOURCE_KEY.test(r.source_key)) bad.push('source_key');
  if (r.desk_tier !== 'national') bad.push('desk_tier');
  if (r.desk_feature !== BILLS) bad.push('desk_feature');
  if (r.desk_rows_feature !== BILLS) bad.push('desk_rows_feature');
  if (r.doc_type !== PACK_TYPE) bad.push('doc_type');
  // A corrigendum that does come with a file link is another route: the official-file rules, the page check.
  if (r.file_url !== undefined && r.file_url !== null) bad.push('file_url');
  return bad.length ? [['bad_shape', bad.join(',')]] : [];
});

const identity = oneCheck('corrigendum_identity', ['identity'], (r) => {
  const links = r.links;
  if (!Array.isArray(links) || links.length === 0) return [['corrigendum_unmapped', 'no links']];
  if (identityOf(r) !== null) return [];
  // No single bill: a link that names none, or links that name two.
  const named = links.filter((l) => isRec(l) && identityOf({ links: [l] }) !== null);
  if (named.length < links.length) {
    return [['corrigendum_unmapped', `${links.length - named.length} link(s) name no bill`]];
  }
  return [['corrigendum_ambiguous', `${links.length} links name more than one bill`]];
});

// Search-only desks do the same for web pages and datasets (search_only.ts, unpagedTextBinds): the pack gives such a
// record page_split 'none', no spans and no page count, and text_binds wants a split-less record's count to equal its
// spans, so it is asked with the count the record has, 0. A declared count, or spans, are asked as they are.
const unpagedTextBinds: Check = {
  ...textBinds,
  one: (record, ctx) => {
    const pages = record.pages;
    const unpaged = record.page_split === 'none' && record.page_count == null &&
      (pages === undefined || (Array.isArray(pages) && pages.length === 0));
    return textBinds.one!(unpaged ? { ...record, page_count: 0 } : record, ctx);
  },
};

// Live, one read for the whole set: a document of this source key is already there. (The Bills check also looks up the
// file URL; a corrigendum has none.)
const alreadyLive: Check = {
  name: 'already_live',
  covers: ['dedupe'],
  needs: 'live',
  async all(records, ctx) {
    const out = new Map<string, Finding[]>();
    const keys = records.flatMap((r) => keyOf(r) === null ? [] : [keyOf(r) as string]);
    if (!keys.length) return out;
    const docs = await ctx.live.documents({ sourceKeys: keys, fileUrls: [] });
    const live = new Set(docs.map((d) => d.source_key).filter(str));
    for (const k of keys) if (live.has(k)) out.set(k, [finding('already_live', ['dedupe'], 'already_live')]);
    return out;
  },
};

const SESSION_DAYS = 3; // the listing's own date window (SQL line 89)

/**
 * The listing_row check, and one more hold: a corrigendum states no date, so listing_row accepts any row of the key,
 * house and name. When the rows it matched (same key, house and whole name) were introduced more than 3 days apart they
 * are not one bill's row but the same name in two sessions, and the corrigendum cannot say which it corrects:
 * bill_key_ambiguous. Rows with no valid date are not compared.
 */
function listingRowSameSession(matched: Map<string, string>): Check {
  const base = viewed(listingRow(matched));
  return {
    ...base,
    async all(records, ctx) {
      const out = await base.all!(records, ctx);
      const dks = [...new Set(records.flatMap((r) => matched.get(String(r.source_key)) ?? []))];
      if (!dks.length) return out;
      const rows = await ctx.live.deskRows({ tier: 'national', feature: BILLS, documentKeys: dks });
      for (const r of records) {
        const k = keyOf(r), dk = k === null ? undefined : matched.get(k);
        if (k === null || dk === undefined) continue;
        const c = citationOf(view(r)), name = billNorm(c.bill_name);
        const days = rows
          .filter((x) =>
            x.document_key === dk && isRec(x.row) && x.row.house === c.house && billNorm(x.row.bill_name) === name
          )
          .map((x) => isoDay((x.row as Rec).date_introduced))
          .filter((d): d is number => d !== null);
        if (days.length > 1 && Math.max(...days) - Math.min(...days) > SESSION_DAYS) {
          out.set(k, [
            ...(out.get(k) ?? []),
            finding(
              'listing_row',
              ['identity'],
              'bill_key_ambiguous',
              `${dk}: rows of one name more than ${SESSION_DAYS} days apart`,
            ),
          ]);
        }
      }
      return out;
    },
  };
}

/** The corrigenda screen: its own collection, no page check. */
export function makeBillCorrigendaScreen(): Screen {
  // The key each record's listing row matched, by source_key: written by listing_row, read by project.
  const matched = new Map<string, string>();
  const project = projectWith(matched);
  return {
    collection: 'national-bill-corrigenda',
    mappingVersion: 'bill-corrigenda-screen-v1',
    rulesFiles: [
      'scripts/bulk-runner/screens/bill_corrigenda.ts',
      'scripts/bulk-runner/screens/bills.ts',
      'scripts/bulk-runner/screen.ts',
      'scripts/bulk-runner/screen_types.ts',
      'scripts/bulk-runner/screens/index.ts',
      'scripts/bulk-runner/live.ts',
      'scripts/bulk-runner/prepare.ts',
      'supabase/functions/_shared/suppliedText.ts',
    ],
    checks: [
      shape,
      identity,
      viewed(citationComplete),
      viewed(linksAgree),
      listingRowSameSession(matched),
      unpagedTextBinds,
      makeLength(MIN_CHARS, MAX_CHARS),
      servableCheck,
      makeLicenceAdmitted('bill corrigenda screen'),
      alreadyLive,
      duplicateText,
      duplicateTextLive,
    ],
    // The key and the role the adapter reads, from the view the checks verified; nothing else is added or changed.
    project: (record) => {
      const out = project(view(record));
      return { ...record, document_key: out.document_key, document_role: out.document_role };
    },
  };
}
