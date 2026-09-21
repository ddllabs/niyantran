// The only file in this function that touches Deno.env or the network.
// Everything it builds is an interface the handler declares, so the turn
// itself stays testable with fakes.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { deskCatalogBlock } from '../_shared/deskCatalog.ts';
import { embedTexts } from '../_shared/embed.ts';
import { log } from '../_shared/logging.ts';
import { loadRegistry } from '../_shared/models.ts';
import { promptFile } from '../_shared/personaMap.ts';
import { streamChat } from '../_shared/openrouterStream.ts';
import { search } from '../_shared/retrieval.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { executeSearchDeskRows, type DeskRow } from '../_shared/tools/searchDeskRows.ts';
import { handleResearchChat, type AssistantMessage, type ConversationRow, type HandlerDeps, type UserDb } from './handler.ts';
import type { ModelCallRow, Pricing, TurnTraceRow } from './telemetry.ts';

const PERSONA_DIR = new URL('../_shared/personas/', import.meta.url);
const DEFAULT_PERSONA = 'analyst.md';

const personaCache = new Map<string, string>();

async function personaText(file: string): Promise<string> {
  const cached = personaCache.get(file);
  if (cached !== undefined) return cached;
  try {
    const text = await Deno.readTextFile(new URL(file, PERSONA_DIR));
    personaCache.set(file, text);
    return text;
  } catch {
    personaCache.set(file, '');
    return '';
  }
}

/** The caller's persona prompt, from their profile. A missing profile is not an error. */
async function persona(userId: string): Promise<string> {
  const { data } = await serviceClient().from('user_profiles').select('persona').eq('user_id', userId).maybeSingle();
  return personaText(promptFile(data?.persona as string | undefined) ?? DEFAULT_PERSONA);
}

function supabaseDb(client: SupabaseClient): UserDb {
  return {
    async getConversation(id) {
      const { data, error } = await client.from('conversations').select('id, title').eq('id', id).maybeSingle();
      if (error) throw new Error(`conversations read: ${error.message}`);
      return data ? ({ id: data.id as string, title: data.title as string } as ConversationRow) : null;
    },
    async createConversation(a) {
      const { data, error } = await client
        .from('conversations')
        .insert({ title: a.title || 'New research', desk_tier: a.desk_tier ?? null, desk_feature: a.desk_feature ?? null, model_id: a.model_id, last_message_at: new Date().toISOString() })
        .select('id, title')
        .single();
      if (error) throw new Error(`conversations insert: ${error.message}`);
      return { id: data.id as string, title: data.title as string };
    },
    async insertUserMessage(a) {
      const { data, error } = await client
        .from('chat_messages')
        .insert({ conversation_id: a.conversation_id, role: 'user', content: a.content, turn_key: a.turn_key })
        .select('id')
        .single();
      // The question row is the claim on the send; a second copy of the same
      // send loses the race here, before any model call or charge.
      if (error?.code === '23505') return 'duplicate';
      if (error) throw new Error(`chat_messages insert: ${error.message}`);
      return { id: data.id as string };
    },
    async recentMessages(conversationId) {
      const { data, error } = await client
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw new Error(`chat_messages read: ${error.message}`);
      return (data ?? [])
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content ?? '') }));
    },
    async insertAssistantMessage(row: AssistantMessage) {
      const { data, error } = await client
        .from('chat_messages')
        .insert({
          conversation_id: row.conversation_id,
          role: 'assistant',
          content: row.content,
          sources: row.sources,
          follow_ups: row.follow_ups,
          activity: row.activity,
          model_requested: row.model_requested,
          model_served: row.model_served,
          reasoning_effort: row.reasoning_effort,
          status: row.status,
          error_message: row.error_message,
          usage: row.usage,
          timing: row.timing,
        })
        .select('id')
        .single();
      if (error) throw new Error(`chat_messages insert: ${error.message}`);
      return { id: data.id as string };
    },
    async touchConversation(id, title) {
      const patch: Record<string, unknown> = { last_message_at: new Date().toISOString() };
      if (title) patch.title = title;
      await client.from('conversations').update(patch).eq('id', id);
    },
    async cancelRequestedSince(conversationId, since) {
      const { data } = await client.from('chat_cancellations').select('cancel_requested_at').eq('conversation_id', conversationId).maybeSingle();
      const at = data?.cancel_requested_at as string | undefined;
      return Boolean(at && at >= since);
    },
    async clearCancellation(conversationId) {
      await client.from('chat_cancellations').delete().eq('conversation_id', conversationId);
    },
    async resolveDocumentIds(keys) {
      if (!keys.length) return [];
      const { data, error } = await serviceClient().from('documents').select('id, metadata').in('metadata->>document_key', keys);
      if (error) {
        log('research_chat.document_scope_failed', { message: error.message });
        return [];
      }
      return (data ?? []).map((d) => d.id as string);
    },
    async findDeskRow(tier, feature, rowKey) {
      const { data, error } = await client
        .from('desk_rows')
        .select('tier, feature, row_key, row, record_text, document_key, snapshot_at')
        .eq('tier', tier)
        .eq('feature', feature)
        .eq('row_key', rowKey)
        .maybeSingle();
      if (error || !data) return null;
      return data as unknown as DeskRow;
    },
  };
}

function telemetryDb() {
  return {
    async logModelCall(row: ModelCallRow): Promise<string | null> {
      const { data, error } = await serviceClient().from('model_call_logs').insert(row).select('id').single();
      if (error) {
        log('research_chat.model_call_log_failed', { message: error.message });
        return null;
      }
      return data.id as string;
    },
    async logTurnTraces(rows: TurnTraceRow[]): Promise<void> {
      if (!rows.length) return;
      const { error } = await serviceClient().from('chat_turn_traces').insert(rows);
      if (error) log('research_chat.turn_trace_failed', { message: error.message });
    },
  };
}

const pricingCache = new Map<string, Pricing | null>();

async function pricing(modelId: string): Promise<Pricing | null> {
  if (pricingCache.has(modelId)) return pricingCache.get(modelId) ?? null;
  const { data } = await serviceClient().from('model_pricing').select('prompt_usd, completion_usd').eq('model_id', modelId).maybeSingle();
  const row = data ? ({ prompt_usd: Number(data.prompt_usd), completion_usd: Number(data.completion_usd) } as Pricing) : null;
  pricingCache.set(modelId, row);
  return row;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const headers = corsHeaders(req);
  const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? '';
  const repairModel = Deno.env.get('AI_REPAIR_MODEL') ?? '';
  // One client per request, carrying the caller's JWT, so every conversation
  // read and both tool RPCs run under that user's row-level security.
  const asCaller = userClient(readToken(req));

  const deps: HandlerDeps = {
    requireUser: async (r) => await requireUser(r),
    models: async () => (await loadRegistry()).models,
    pricing,
    persona,
    catalogue: (tier) => deskCatalogBlock(tier),
    db: supabaseDb(asCaller),
    telemetry: telemetryDb(),
    stream: (r) => streamChat({ fetch, apiKey }, r),
    searchDocuments: (args, documentIds) =>
      search(
        {
          embed: async (query) => {
            const r = await embedTexts({ fetch, apiKey }, [query]);
            return { vector: r.vectors[0], model: r.model };
          },
          rpc: async (fn, a) => await asCaller.rpc(fn, a),
        },
        { query: args.query, deskTier: args.desk_tier, documentIds },
      ),
    searchDeskRows: (args) => executeSearchDeskRows({ rpc: async (fn, a) => await asCaller.rpc(fn, a) }, args),
    repairModel,
    headers,
    today: () => new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' (IST)',
    waitUntil: (p) => {
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      runtime?.waitUntil(p);
    },
  };
  return await handleResearchChat(req, deps);
});

function readToken(req: Request): string {
  return (/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '').trim();
}
