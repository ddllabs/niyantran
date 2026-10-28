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
/** A Lok Sabha question answer in the citation pack's shape (synthetic; F266). */
export async function nationalQuestion() {
  const text = 'GOVERNMENT OF INDIA\nLOK SABHA\nUNSTARRED QUESTION NO. 6302\nANSWER\nA written answer.';
  const sha = await sha256Hex(text);
  const source_key = 'a'.repeat(40);
  return {
    source_key,
    title: 'Expanding Khadi Production in Tamil Nadu',
    text,
    text_sha256: sha,
    desk_tier: 'national',
    desk_feature: 'Parliamentary Question Database',
    file_name: 'AU6302_KIQmzb.pdf',
    file_url: 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals',
    citation: {
      kind: 'parliamentary_question', house: 'Lok Sabha', session: '187', question_no: '6302',
      subject: 'Expanding Khadi Production in Tamil Nadu', ministry: 'MICRO, SMALL AND MEDIUM ENTERPRISES', answered_on: '02.04.2026',
    },
    document_key_suggested: 'pq:ls:187:AU6302_KIQmzb',
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
