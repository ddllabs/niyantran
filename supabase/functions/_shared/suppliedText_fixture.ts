// Synthetic test data only; no client corpus content.
import { sha256Hex } from './textNormalise.ts';
export async function input() {
  const text = '# Judgment\n\nA 😀 court order. The appeal is dismissed.';
  const sha = await sha256Hex(text);
  return {
    source_key: 'law:hc:test/order-1',
    title: 'Order one',
    text,
    text_sha256: sha,
    desk_tier: 'law',
    desk_feature: 'Order Archive by Topic (Cross-Court)',
    citation: { case_number: '1/2025', order_date: '2025-01-01' },
    document_key_suggested: 'hc:test:order-1',
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
    review: {
      status: 'eligible',
      text_sha256: sha,
      rules_sha256: 'a'.repeat(64),
      package_id: 'fixture',
      source_key: 'law:hc:test/order-1',
      mapping_version: 'law-v1',
      decision_id: 'review-1',
      checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
    },
  };
}
/** A National question answer in the citation pack's shape (synthetic; owner decision 2026-10-27). */
export async function nationalQuestion() {
  const text = 'GOVERNMENT OF INDIA\nLOK SABHA\nUNSTARRED QUESTION NO. 1\nANSWER\nA written answer.';
  const sha = await sha256Hex(text);
  const source_key = 'a'.repeat(40);
  return {
    source_key,
    title: 'Lok Sabha Unstarred Question No. 1: Test',
    text,
    text_sha256: sha,
    desk_tier: 'national',
    desk_feature: 'Parliamentary Question Database',
    file_name: 'AU1_aaaaaa.pdf',
    file_url: 'https://sansad.in/getFile/loksabhaquestions/annex/184/AU1_aaaaaa.pdf?source=pqals',
    citation: { kind: 'parliamentary_question', house: 'Lok Sabha', session: '184', question_no: '1', answered_on: '07.02.2025' },
    document_key_suggested: 'pq:ls:184:AU1_aaaaaa',
    page_split: 'exact',
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
    review: {
      status: 'eligible',
      text_sha256: sha,
      rules_sha256: 'b'.repeat(64),
      package_id: 'fixture',
      source_key,
      mapping_version: 'national-pq-v1',
      decision_id: 'review-2',
      checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
    },
  };
}
