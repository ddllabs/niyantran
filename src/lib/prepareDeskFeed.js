import { applyNewsDedupToFeed, isNewsWireFeature } from './newsDedup.js';
import { applySensitiveShapingToFeed } from './sensitiveData.js';
import { applyRecordChecklistToFeed } from './recordChecklist.js';
import { applyGlobalBoardShapingToFeed } from './shapeGlobalBoards.js';
import { applyParliamentaryQuestionShapingToFeed } from './shapeQuestions.js';
import { applyCitationGuardToFeed } from './citationGuard.js';
import { applyOpenTenderFilterToFeed } from './shapeTenders.js';
import { preferEnglishRows, shapeCabinetEnglishRows } from './textStyle.js';
import { isMpCardsFeature } from './national.js';
import { shapeMpRows } from './parliament.js';

/** Run client-side cleanup passes on a feature-feed body before paint. */
export function prepareDeskFeed(feed) {
  if (!feed) return feed;
  let next = feed;
  if (/cabinet decisions/i.test(String(next.feature || ''))) {
    const shaped = shapeCabinetEnglishRows(next.rows);
    // If live feed was Hindi-only, keep stored English rows already on the envelope when present.
    next = {
      ...next,
      rows: shaped.length ? shaped : preferEnglishRows(next.rows, {
        titleKeys: ['topic', 'title', 'headline', 'subject', 'decision', 'name'],
        strict: true,
      }),
    };
  }
  // F126: the MP register's house (from each member's Sansad link) and unified party names.
  if (isMpCardsFeature(next.feature) && Array.isArray(next.rows)) next = { ...next, rows: shapeMpRows(next.rows) };
  if (next?.meta) {
    const scrub = (s) =>
      String(s || '')
        .replace(/\bORDER\s+ARCHIVE\b/gi, 'ORDERS BY TOPIC')
        .replace(/\bARCHIVE(D)?\b/gi, '')
        .replace(/\barchiv(e|ed)\b/gi, '')
        .replace(/\u2014/g, ' - ')
        .replace(/\u2013/g, '-')
        .replace(/\s*[·|]\s*[·|]\s*/g, ' · ')
        .replace(/^\s*[·|]\s*|\s*[·|]\s*$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    next = {
      ...next,
      meta: {
        ...next.meta,
        section: next.meta.section ? scrub(next.meta.section) : next.meta.section,
        status: next.meta.status ? scrub(next.meta.status) : next.meta.status,
        note: next.meta.note ? scrub(next.meta.note) : next.meta.note,
        heading: next.meta.heading
          ? scrub(String(next.meta.heading).replace(/\bJudgments?\b/gi, 'Judgements').replace(/\bJudgement\b/g, 'Judgements'))
          : next.meta.heading,
      },
    };
  }
  if (next?.source?.note) {
    next = {
      ...next,
      source: {
        ...next.source,
        note: String(next.source.note)
          .replace(/\barchiv(e|ed)\b/gi, 'stored snapshot')
          .replace(/\u2014/g, ' - ')
          .replace(/\u2013/g, '-'),
      },
    };
  }
  if (String(next.tier || '').toLowerCase() === 'local' || /booth|panchayat|municipal|hyperlocal|local governance/i.test(String(next.feature || ''))) {
    next = {
      ...next,
      source: {
        ...(next.source || {}),
        note: String(next.source?.note || '')
          .replace(/\barchiv(e|ed)|last-known-good|data check\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/\s*[·.]\s*$/, '')
          .trim(),
      },
      meta: next.meta
        ? {
            ...next.meta,
            status: next.meta.status
              ? String(next.meta.status).replace(/\bARCHIVE(D)?\b/gi, 'REGISTER').replace(/\bdata check\b/gi, '')
              : next.meta.status,
            note: next.meta.note
              ? String(next.meta.note).replace(/\barchiv(e|ed)|data check\b/gi, '').replace(/\s{2,}/g, ' ').trim()
              : next.meta.note,
            quality: undefined,
          }
        : next.meta,
    };
  }
  if (
    /^(climate|carbon)$/i.test(String(next.tier || '')) ||
    /carbon|climate|cbam|ccts|ets & tax/i.test(String(next.feature || ''))
  ) {
    const scrubClimate = (s) =>
      String(s || '')
        .replace(/\barchiv(e|ed)|last-known-good|data check|verification\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*[·.|]\s*$/, '')
        .trim();
    next = {
      ...next,
      source: {
        ...(next.source || {}),
        note: scrubClimate(next.source?.note),
      },
      meta: next.meta
        ? {
            ...next.meta,
            section: next.meta.section
              ? scrubClimate(String(next.meta.section).replace(/\bCLIMATE NEWSWIRE\b/gi, 'Climate wire'))
              : next.meta.section,
            status: next.meta.status ? scrubClimate(next.meta.status) : next.meta.status,
            note: next.meta.note ? scrubClimate(next.meta.note) : next.meta.note,
            quality: undefined,
          }
        : next.meta,
    };
  }
  if (isNewsWireFeature(next.feature)) next = applyNewsDedupToFeed(next);
  if (
    /^(climate|carbon)$/i.test(String(next.tier || '')) ||
    /^climate newswire$/i.test(String(next.feature || ''))
  ) {
    next = {
      ...next,
      rows: Array.isArray(next.rows)
        ? next.rows.map((r) => {
            if (!r || r.status === 'source_status') return r;
            const { verification, related_count, related_outlets, related_links, ...rest } = r;
            return rest;
          })
        : next.rows,
    };
  }
  next = applyCitationGuardToFeed(next);
  next = applyOpenTenderFilterToFeed(next);
  next = applySensitiveShapingToFeed(next);
  next = applyGlobalBoardShapingToFeed(next);
  next = applyParliamentaryQuestionShapingToFeed(next);
  next = applyRecordChecklistToFeed(next);
  return next;
}
