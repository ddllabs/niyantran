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
