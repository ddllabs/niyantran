// CitationSource: one namespace, two kinds. Declared here so chatStream.ts can
// type its `sources` frame; the RAG spec §G owns the frontend twin
// (src/types/citation.js) and the desk-row spec consumes the `row` variant.

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
