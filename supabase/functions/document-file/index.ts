// document-file: wiring. The pure entry point is handler.ts; this module binds its reads to the
// CALLER's supabase-js client (RLS applies) and its one signing call to the service client, which
// is created only when a live document's part has been found for a signed-in caller.
//
// Environment (read through _shared/supabase.ts and _shared/cors.ts only, never logged):
// SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS, ALLOWED_ORIGINS.
//
// Errors thrown here carry fixed text: a PostgREST or Storage message may name the object path.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from '../_shared/logging.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { type DocumentFileDeps, type DocumentRow, handleDocumentFile, type PartRow } from './handler.ts';

export const CORPUS_BUCKET = 'corpus';

const DOCUMENT_COLUMNS = 'id, storage_path, indexed_at, extract_hash, page_count';
const PART_COLUMNS = 'part_index, page_offset, page_count, byte_size, storage_path';

export interface Runtime {
  userClient: (token: string) => SupabaseClient;
  serviceClient: () => SupabaseClient;
  origins?: string[];
  log?: (event: string, fields: Record<string, unknown>) => void;
}

const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
/** int and bigint columns as numbers (PostgREST may send a bigint as a string). */
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN);

export function supabaseDocumentFileDeps(
  r: Pick<Runtime, 'userClient' | 'serviceClient'>,
): Pick<DocumentFileDeps, 'document' | 'parts' | 'sign'> {
  return {
    async document(token, documentId): Promise<DocumentRow | null> {
      const { data, error } = await r.userClient(token)
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('id', documentId)
        .maybeSingle();
      if (error) throw new Error('documents read failed');
      if (!data) return null;
      const d = data as Record<string, unknown>;
      return {
        id: String(d.id),
        storage_path: strOrNull(d.storage_path),
        indexed_at: strOrNull(d.indexed_at),
        extract_hash: strOrNull(d.extract_hash),
        page_count: d.page_count === null || d.page_count === undefined ? null : num(d.page_count),
      };
    },

    // The only part that can hold the page: the one with the largest page_offset below it. The
    // handler applies the full rule (page <= page_offset + page_count) to what comes back.
    async parts(token, documentId, page): Promise<PartRow[]> {
      const { data, error } = await r.userClient(token)
        .from('document_files')
        .select(PART_COLUMNS)
        .eq('document_id', documentId)
        .lt('page_offset', page)
        .order('page_offset', { ascending: false })
        .range(0, 0);
      if (error) throw new Error('document_files read failed');
      return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
        part_index: num(p.part_index),
        page_offset: num(p.page_offset),
        page_count: num(p.page_count),
        byte_size: num(p.byte_size),
        storage_path: String(p.storage_path ?? ''),
      }));
    },

    async sign(path, seconds): Promise<string> {
      const { data, error } = await r.serviceClient().storage.from(CORPUS_BUCKET).createSignedUrl(path, seconds);
      if (error || !data?.signedUrl) throw new Error('storage sign failed');
      return data.signedUrl;
    },
  };
}

export function createDocumentFileHandler(overrides: Partial<Runtime> = {}): (req: Request) => Promise<Response> {
  const r: Runtime = { userClient, serviceClient, ...overrides };
  const deps: DocumentFileDeps = {
    ...supabaseDocumentFileDeps(r),
    // requireUser's check, through the injected user client (as _shared/auth.ts does by default).
    verify: async (token) => {
      const { data, error } = await r.userClient(token).auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
    log: r.log ?? ((event, fields) => log(event, fields)),
    origins: r.origins,
  };
  return (req) => handleDocumentFile(req, deps);
}

if (import.meta.main) Deno.serve(createDocumentFileHandler());
