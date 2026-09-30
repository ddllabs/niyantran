// CitationSource: one namespace, two kinds. Declared here so chatStream.ts can
// type its `sources` frame; the RAG spec §G owns the frontend twin
// (src/types/citation.js) and the desk-row spec consumes the `row` variant.

/** A page chunk's section (chunk-contract spec R2): the heading and margin note in force at its start. */
export interface CitationSection {
  heading?: string;
  note?: string;
}

/** One block's box on a page, normalised to 0..1 of the page; `page` is the physical, 1-based page. */
export interface CitationBox {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An image placed inside the cited span. Content-addressed, so it survives re-extraction. */
export interface CitationImage {
  page: number;
  sha256: string;
  mime: string;
}

export interface TextCitation {
  id: number;
  kind: 'text';
  chunk_id: string;
  document_id: string;
  title: string;
  file_name?: string;
  file_url?: string;
  desk_tier?: string;
  desk_feature?: string;
  char_from: number;
  char_to: number;
  text_hash: string;
  source_kind: 'document' | 'pdf_page';
  page_number?: number;
  // Optional, page-aware documents only (chunk-contract spec, "Citation
  // payload"). A citation of an old chunk carries none of these keys.
  /** The extraction the boxes belong to; the viewer draws no box when it is not the document's current one. */
  extract_hash?: string;
  /** At most MAX_CITATION_BOXES, resolved from the chunk's block_ids. */
  boxes?: CitationBox[];
  images?: CitationImage[];
  section?: CitationSection;
}

export interface RowCitation {
  id: number;
  kind: 'row';
  tier: string;
  feature: string;
  row_key: string;
  title: string;
  row_snapshot: Record<string, string>;
  snapshot_at: string | null;
}

export type CitationSource = TextCitation | RowCitation;
