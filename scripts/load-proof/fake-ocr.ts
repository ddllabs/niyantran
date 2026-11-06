// The page-path fakes of the F287 harness: Mistral OCR and the corpus bucket, injected at RunDeps as
// `ocr` and `storage`, and used only by the one case that exercises the OCR stage and chunk_commit.
//
// The OCR returns one markdown page per requested part-local index, deterministic in the document URL and
// the index, in the shape callMistralOcr returns (no blocks or images: composeDocument and the chunker
// accept a page without them). The bucket answers every signed URL with a local address nothing fetches.

import type { IngestStorage, OcrCallResult, OcrRequest } from '../../supabase/functions/ingest-worker/types.ts';
import { OCR_MODEL } from '../../supabase/functions/ingest-worker/types.ts';
import { rng, sha256Hex } from './lib.ts';

const WORDS =
  'bill clause section amendment committee house member state authority fund scheme report provision rule schedule act enforcement'
    .split(' ');

export function pageText(seed: string, index: number, paragraphs = 3): string {
  const h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) ^ (index * 2654435761);
  const next = rng(h >>> 0);
  const para = () =>
    Array.from({ length: 70 + Math.floor(next() * 40) }, () => WORDS[Math.floor(next() * WORDS.length)]).join(' ') +
    '.';
  return `# Page ${index + 1} of ${seed.slice(-12)}\n\n` + Array.from({ length: paragraphs }, para).join('\n\n');
}

export interface FakeOcr {
  ocr(request: OcrRequest): Promise<OcrCallResult>;
  /** Page indexes asked for, per call. */
  readonly requests: number[][];
}

export function makeFakeOcr(): FakeOcr {
  const requests: number[][] = [];
  return {
    requests,
    ocr(request) {
      requests.push([...request.pages]);
      const url = request.document.document_url;
      return Promise.resolve({
        pages: request.pages.map((index) => ({
          index,
          markdown: pageText(url, index),
          header: null,
          footer: null,
          dimensions: null,
          blocks: [],
          tables: [],
          images: [],
        })),
        model: OCR_MODEL,
        pagesProcessed: request.pages.length,
        docSizeBytes: 4096,
        bytes: 4096,
        latencyMs: 1,
      });
    },
  };
}

export const fakeStorage: IngestStorage = {
  signedUrl: (path) => Promise.resolve(`http://127.0.0.1/fake-corpus/${path}`),
  exists: () => Promise.resolve(true),
  upload: () => Promise.resolve(),
};

/** A content-addressed name for a fake PDF part, as ingest_register wants it. */
export const fakePdfSha = (name: string) => sha256Hex(`fake-pdf:${name}`);
