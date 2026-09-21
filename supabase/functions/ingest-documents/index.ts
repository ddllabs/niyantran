import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { secretKey, serviceClient } from '../_shared/supabase.ts';
import { embedTexts } from '../_shared/embed.ts';
import { handleIngest, type CallLogRow, type CommitRow, type DocumentRow, type IngestDeps } from './handler.ts';

/** The four tables behind IngestDeps.db, through the service client (RLS bypassed after the key check). */
export function supabaseDb(client: SupabaseClient): IngestDeps['db'] {
  return {
    async findDocument(sourceKey) {
      const { data, error } = await client.from('documents').select('id, content_sha256, chunker_version').eq('source_key', sourceKey).maybeSingle();
      if (error) throw new Error(`documents read: ${error.message}`);
      return data ? { id: data.id as string, content_sha256: data.content_sha256 as string, chunker_version: (data.chunker_version as number | null) ?? null } : null;
    },
    async upsertDocument(row: DocumentRow) {
      const { data, error } = await client
        .from('documents')
        .upsert({ ...row, chunker_version: null, indexed_at: null }, { onConflict: 'source_key' })
        .select('id')
        .single();
      if (error) throw new Error(`documents upsert: ${error.message}`);
      return { id: data.id as string };
    },
    async updateDocumentMeta(documentId, fields) {
      const { error } = await client.from('documents').update(fields).eq('id', documentId);
      if (error) throw new Error(`documents meta update: ${error.message}`);
    },
    async existingHashes(documentId) {
      const { data, error } = await client.from('document_chunks').select('chunk_hash').eq('document_id', documentId);
      if (error) throw new Error(`document_chunks read: ${error.message}`);
      return new Set((data ?? []).map((r) => r.chunk_hash as string));
    },
    async chunkCommit(documentId, rows: CommitRow[], keep) {
      const { data, error } = await client.rpc('chunk_commit', { p_document_id: documentId, p_rows: rows, p_keep_hashes: keep });
      if (error) throw new Error(`chunk_commit: ${error.message}`);
      return data as { inserted: number; kept: number; deleted: number };
    },
    async markIndexed(documentId, chunkerVersion) {
      const { error } = await client.from('documents').update({ chunker_version: chunkerVersion, indexed_at: new Date().toISOString() }).eq('id', documentId);
      if (error) throw new Error(`documents mark indexed: ${error.message}`);
    },
    async logCall(row: CallLogRow) {
      const { error } = await client.from('model_call_logs').insert(row);
      if (error) throw new Error(`model_call_logs insert: ${error.message}`);
    },
  };
}

Deno.serve((req) => {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? '';
  return handleIngest(req, {
    secretKey: secretKey(),
    embed: (inputs) => embedTexts({ fetch, apiKey }, inputs),
    db: supabaseDb(serviceClient()),
  });
});
