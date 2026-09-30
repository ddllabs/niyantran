// Identity hashes of an ingest job (spec "Identity and hashes"). Pure apart from SHA-256.
//
//   ocr_hash     = SHA-256(canonicalJson({ file_sha256, model_id, ...OCR_FLAGS }))
//                  keys the raw OCR (document_ocr_pages). Pages per call are deliberately NOT an
//                  input, so tuning the OCR range never forces a re-OCR.
//   extract_hash = SHA-256(canonicalJson({ ocr_hash, page_chunk_version, composition_version }))
//                  with page_chunk_version = PAGE_CHUNK_VERSION (_shared/chunking.ts) and
//                  composition_version = COMPOSITION_VERSION (_shared/pageText.ts). It keys the
//                  composed pages and blocks (chunk-contract R6).
//
// The canonical form is JSON with object keys sorted recursively (by UTF-16 code unit, the default
// sort) and no whitespace. Array order is kept.

import { PAGE_CHUNK_VERSION } from '../_shared/chunking.ts';
import { COMPOSITION_VERSION } from '../_shared/pageText.ts';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { type AdvancePatch, IngestError, type IngestJob, OCR_FLAGS, OCR_MODEL } from './types.ts';

/** Canonical JSON: sorted keys, no whitespace. Throws on anything JSON cannot represent exactly. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: cannot represent a ${typeof value}`);
}

/** The object hashed into ocr_hash. */
export function ocrHashInput(fileSha256: string, modelId: string): Record<string, unknown> {
  return { file_sha256: fileSha256, model_id: modelId, ...OCR_FLAGS };
}

export function ocrHash(fileSha256: string, modelId: string): Promise<string> {
  return sha256Hex(canonicalJson(ocrHashInput(fileSha256, modelId)));
}

export interface ExtractVersions {
  page_chunk_version: number;
  composition_version: number;
}

export const EXTRACT_VERSIONS: Readonly<ExtractVersions> = Object.freeze({
  page_chunk_version: PAGE_CHUNK_VERSION,
  composition_version: COMPOSITION_VERSION,
});

/** `versions` is for tests; production always uses the current constants. */
export function extractHash(ocrHashValue: string, versions: ExtractVersions = EXTRACT_VERSIONS): Promise<string> {
  return sha256Hex(canonicalJson({ ocr_hash: ocrHashValue, ...versions }));
}

export interface JobIdentity {
  modelId: string;
  ocrHash: string;
  extractHash: string;
  /** The values the job did not have yet; the step puts them in its first AdvancePatch. */
  newFields: Pick<AdvancePatch, 'model_id' | 'ocr_hash' | 'extract_hash'>;
}

/**
 * The job's model and hashes. A value already on the job is used as is (the model is pinned once
 * set); a missing one is computed, with OCR_MODEL for a job that has no model yet, and reported in
 * `newFields`. A hash without the value it derives from cannot be trusted and is refused.
 */
export async function jobHashes(
  job: Pick<IngestJob, 'file_sha256' | 'model_id' | 'ocr_hash' | 'extract_hash'>,
): Promise<JobIdentity> {
  if (job.ocr_hash && !job.model_id) {
    throw new IngestError('job_identity_inconsistent', 'job has ocr_hash but no model_id', true);
  }
  if (job.extract_hash && !job.ocr_hash) {
    throw new IngestError('job_identity_inconsistent', 'job has extract_hash but no ocr_hash', true);
  }
  const newFields: JobIdentity['newFields'] = {};
  const modelId = job.model_id ?? (newFields.model_id = OCR_MODEL);
  const ocr = job.ocr_hash ?? (newFields.ocr_hash = await ocrHash(job.file_sha256, modelId));
  const extract = job.extract_hash ?? (newFields.extract_hash = await extractHash(ocr));
  return { modelId, ocrHash: ocr, extractHash: extract, newFields };
}
