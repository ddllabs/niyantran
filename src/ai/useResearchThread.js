import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as threads from '../lib/aiThreads.js';
import * as streaming from '../lib/researchChat.js';
import * as identity from '../lib/userStore.js';
import * as registry from '../lib/aiRegistry.js';
import { defaultEffortFor, effortsFor } from './ModelPicker.jsx';

export function normalizeResearchChoice(models, value = {}) {
  const allowed = models.filter(m => m && m.enabled !== false && m.allowed !== false && typeof m.model_id === 'string' && m.model_id.trim());
  const model = allowed.find(m => m.model_id === value.modelId) || allowed.find(m => m.is_default) || allowed[0];
  const effort = effortsFor(allowed, model?.model_id).includes(value.effort)
    ? value.effort
    : defaultEffortFor(allowed, model?.model_id);
  return { modelId: model?.model_id || '', effort };
}

// This controller owns only the research path. Its injected dependencies use
// the same B4 identity and D7/D8 store interfaces as the production defaults.
export function createResearchThread(overrides = {}) {
  const deps = { ...threads, ...streaming, ...identity, ...registry, ...overrides };
  const emptyStore = () => ({ chats: [], activeId: '', loaded: false });
  let data = { ready: false, loading: true, error: '', draft: '', viewer: null, store: emptyStore(),
    // No effort yet, rather than 'off': the model list has not loaded, so this
    // is the absence of a choice and must normalise to the default once it can.
    // 'off' here would be indistinguishable from a reader who picked it.
    registry: { models: [], roles: [] }, choice: { modelId: '', effort: '' }, submitting: false,
    cancelRequested: false, cancelPending: false, cancelError: '', identityVersion: 0 };
  let view = data;
  let owner = null, generation = 0, sequence = 0, active = false, operation = null;
  let subscriptions = [];
  const listeners = new Set();
  const token = () => ({ owner, generation });
  const valid = t => active && t.owner && owner === t.owner && generation === t.generation;
  const current = async t => valid(t) && await deps.localIdentityIsCurrent(t.owner) && valid(t);
  const contextChat = context => data.store.chats.find(c => context?.draftId ? c.draftId === context.draftId : c.id === context?.chatId);
  function emit(patch = {}) {
    data = { ...data, ...patch };
    const chat = data.store.chats.find(c => c.id === data.store.activeId) || null;
    const candidate = owner ? deps.streamState(chat?.id || '') : null;
    // The transport keeps the first draft alias for recovery. An acknowledged
    // alias belongs to its server conversation, never a later empty draft.
    const stream = candidate?.conversationId && candidate.conversationId !== chat?.id ? null : candidate;
    const storedRunning = chat?.messages?.some(m => m.role === 'assistant' && m.status === 'running'
      && Date.parse(m.execution_expires_at) > Date.now());
    const savedTerminal = stream?.messageId && chat?.messages?.some(m => m.id === stream.messageId && m.status !== 'running');
    const live = !savedTerminal && stream?.status !== 'idle' && Boolean(stream?.isPending || stream?.isStreaming || stream?.streamingText || stream?.error);
    const request = owner && stream ? deps.retryRequest(chat?.id || '') : null;
    const messages = (chat?.messages || []).filter(m => !(live && m.role === 'assistant'
      && (m.id === stream.messageId || (request?.turn_key && m.turn_key === request.turn_key))));
    const savedSources = [...(chat?.messages || [])].reverse().find(m => m.role === 'assistant' && m.sources?.length)?.sources || [];
    view = { ...data, chat, stream, messages, live, storedRunning,
      canStop: data.ready && Boolean(data.submitting || stream?.isPending || stream?.isStreaming || storedRunning),
      locked: !data.ready || data.loading || data.submitting || Boolean(stream?.isPending || stream?.isStreaming || storedRunning),
      sources: stream?.sources?.length ? stream.sources : savedSources,
      recoverable: Boolean(request && stream?.retryable && !stream?.isStreaming && !data.submitting),
      choice: normalizeResearchChoice(data.registry.models, data.choice) };
    for (const fn of listeners) fn();
  }
  async function hydrate() {
    const seq = ++sequence, version = generation;
    emit({ loading: true, error: '' });
    try {
      const verified = await deps.verifiedLocalIdentity();
      if (!active || seq !== sequence || version !== generation) return;
      if (!verified || !await deps.localIdentityIsCurrent(verified)) {
        if (version === generation) emit({ ready: false, loading: false, error: 'Sign in to use AI research.' });
        return;
      }
      if (!active || version !== generation) return;
      owner = verified;
      const t = token();
      const [store, choices] = await Promise.all([deps.hydrateConversations(), deps.loadRegistry()]);
      if (!await current(t) || seq !== sequence) return;
      const hydrated = store.chats.length ? store : deps.createAiChat();
      emit({ store: hydrated, registry: choices, ready: true, loading: false });
    } catch {
      if (active && seq === sequence && version === generation) emit({ loading: false, error: 'Research could not be loaded. Try Reload.' });
    }
  }
  function invalidate(id, event) {
    generation++; sequence++; owner = null; operation = null;
    emit({ ready: false, loading: Boolean(id), error: id ? '' : 'Sign in to use AI research.', store: emptyStore(),
      draft: '', viewer: null, submitting: false, cancelRequested: false, cancelPending: false, cancelError: '',
      identityVersion: data.identityVersion + 1 });
    // Never invoke another Auth method inside its synchronous event callback.
    if (id) queueMicrotask(() => { if (active) void hydrate(); });
  }
  async function settleSaved(conversationId, snapshot) {
    // Fence the matching operation before the read begins. Reconciliation is
    // what retires the transport, so that operation's promise can settle with
    // an obsolete identity_changed result while this read is still verifying.
    // Such a result waits for the authoritative outcome instead of racing it.
    const fenced = operation && contextChat(operation.context)?.id === conversationId ? operation : null;
    let lift;
    const fence = fenced ? new Promise(resolve => { lift = resolve; }) : null;
    if (fenced) fenced.fence = fence;
    try {
      const settled = await deps.reconcileSavedTurn(conversationId);
      if (!await current(snapshot)) return false;
      if (settled) {
        // The verified read retires the transport. Its pending promise can now
        // resolve as detached; that obsolete result cannot replace saved state.
        const matchesOperation = fenced && operation === fenced;
        if (matchesOperation) operation = null;
        const activeConversation = view.chat?.id === conversationId;
        emit({ ...(matchesOperation ? { submitting: false } : {}),
          ...(activeConversation ? { error: '', cancelRequested: false, cancelPending: false, cancelError: '' } : {}) });
      } else emit();
      return settled;
    } finally {
      // No authoritative saved row, or a failed read, releases the operation
      // unchanged: its transport result is still the best information there is.
      if (fenced) { if (fenced.fence === fence) fenced.fence = null; lift(); }
    }
  }
  async function finishTurn(result, context, t) {
    if (!valid(t)) return;
    if (result.error) emit({ error: result.error });
    if (['complete', 'cancelled', 'truncated', 'interrupted', 'error'].includes(result.status) && !result.isPending) emit({ cancelRequested: false, cancelPending: false });
    if (result.conversationId) {
      try {
        const store = await deps.reconcileTurn(result.conversationId, context);
        if (!await current(t)) return;
        emit({ store });
        await settleSaved(result.conversationId, t);
        if (!await current(t)) return;
        if (!result.isPending && result.messageId && store.chats.some(c => c.id === result.conversationId
          && c.messages.some(m => m.id === result.messageId && m.status !== 'running'))) {
          deps.clearStream(result.conversationId); emit();
        }
      } catch { if (valid(t)) emit({ error: 'The saved result could not be loaded. Try Reload.' }); }
    }
  }
  async function execute(body, replay = false) {
    if (!data.ready || data.submitting || (!replay && view.locked)) return false;
    const t = token(), context = deps.captureConversationContext(view.chat?.id || '');
    if (!context) return false;
    const op = { context }; operation = op;
    emit({ submitting: true, error: '', cancelError: '' });
    try {
      if (!await current(t)) return false;
      if (!replay) {
        body = { ...body, turn_key: body.turn_key || crypto.randomUUID(),
          ...(view.chat?.id ? { conversation_id: view.chat.id } : {}) };
        const chosen = normalizeResearchChoice(data.registry.models, data.choice);
        if (!chosen.modelId) throw new Error('No research model is available. Reload the model list.');
        body.model = chosen.modelId;
        // Send 'off' rather than omitting the field. The server now reads an
        // omitted field as its own default, so silence would mean "decide for
        // me" and could not express the picker's "No reasoning".
        body.reasoning = chosen.effort === 'off' ? 'off' : chosen.effort;
        deps.appendAiMessage(context.chatId, { role: 'user', content: body.message, turn_key: body.turn_key });
        emit({ draft: '', store: deps.loadAiState() });
      }
      const options = { onConversation: async conversation => {
        if (!await current(t)) return;
        emit({ store: deps.adoptConversation(conversation, context) });
      } };
      op.dispatched = true;
      const pending = replay ? deps.retryTurn(view.chat?.id || '', options) : deps.sendTurn(body, options);
      if (op.stopQueued) void api.stop();
      const result = await pending;
      // An authoritative reconciliation already reading this conversation
      // outranks this result; it may retire the operation while we wait.
      while (op.fence) await op.fence;
      if (valid(t) && operation === op) await finishTurn(result, context, t);
      return true;
    } catch (error) {
      if (valid(t)) emit({ error: error?.message || 'The research request failed.' });
      return false;
    } finally {
      if (valid(t) && operation === op) { operation = null; emit({ submitting: false }); }
    }
  }
  const api = {
    getSnapshot: () => view,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async start() {
      if (active) return;
      active = true;
      subscriptions = [deps.subscribeLocalIdentity(invalidate),
        deps.subscribeAiChats(store => { if (owner) emit({ store }); }),
        deps.subscribeStream(() => { if (owner) emit(); }),
        deps.subscribeRegistry(choices => { if (owner) emit({ registry: choices }); })];
      await hydrate();
    },
    dispose() { active = false; subscriptions.forEach(fn => fn()); subscriptions = []; invalidate(null); },
    reportError(error) { if (data.ready) emit({ error }); },
    setDraft(draft) { if (data.ready) emit({ draft }); },
    setChoice(choice) { if (data.ready) emit({ choice: normalizeResearchChoice(data.registry.models, choice) }); },
    openSource(source) { if (data.ready) emit({ viewer: { kind: source?.kind || 'list', source: source || null } }); },
    closeViewer() { emit({ viewer: null }); },
    newChat() {
      if (!data.ready || data.submitting || deps.streamState('new').isPending) return false;
      emit({ store: deps.createAiChat(), draft: '', viewer: null, error: '', cancelRequested: false, cancelError: '' }); return true;
    },
    async selectChat(id) {
      if (!data.ready || data.submitting) return;
      const t = token();
      emit({ store: deps.setActiveAiChat(id), viewer: null, draft: '', loading: true, error: '', cancelRequested: false, cancelError: '' });
      try { const store = await deps.loadMessages(id); if (await current(t)) emit({ store }); }
      catch { if (valid(t)) emit({ error: 'Conversation messages could not be loaded. Try Reload.' }); }
      finally { if (valid(t)) emit({ loading: false }); }
    },
    deleteChat(id) { if (data.ready && !view.locked) { deps.deleteAiChat(id); emit({ store: deps.loadAiState(), viewer: null }); } },
    async attach(materialize) {
      if (!data.ready || view.locked) return false;
      const t = token(), context = deps.captureConversationContext(view.chat?.id || '');
      try {
        const attachments = await materialize();
        if (!await current(t) || !contextChat(context)) return false;
        deps.addChatAttachments(contextChat(context).id, attachments);
        emit({ store: deps.loadAiState() }); return true;
      } catch { if (valid(t)) emit({ error: 'The attachment could not be loaded.' }); return false; }
    },
    send: body => execute(body),
    recover: () => view.recoverable ? execute(null, true) : Promise.resolve(false),
    async stop() {
      if (!view.canStop || data.cancelPending) return;
      if (operation && !operation.dispatched) { operation.stopQueued = true; emit({ cancelRequested: true }); return; }
      const t = token(), id = view.chat?.id || '';
      emit({ cancelPending: true, cancelError: '' });
      try {
        const result = view.stream?.isPending || view.stream?.isStreaming
          ? await deps.stopTurn(id) : id ? await deps.recordChatCancellation(id) : await deps.stopTurn('new');
        if (await current(t)) emit({ cancelRequested: Boolean(result?.cancelRequested || result?.queued), cancelError: result?.cancelError || '' });
      } catch { if (valid(t)) emit({ cancelError: 'Stop could not be requested. Try Stop again.' }); }
      finally { if (valid(t)) emit({ cancelPending: false }); }
    },
    async reload() {
      if (!data.ready) return hydrate();
      const t = token(), id = view.chat?.id;
      if (!id) { emit(); return; }
      emit({ loading: true, error: '' });
      try {
        const store = await deps.loadMessages(id);
        if (!await current(t)) return;
        emit({ store });
        await settleSaved(id, t);
      }
      catch { if (valid(t)) emit({ error: 'The saved result could not be loaded. Try Reload.' }); }
      finally { if (valid(t)) emit({ loading: false }); }
    },
  };
  emit();
  return api;
}
export default function useResearchThread(enabled) {
  const controller = useRef(null);
  controller.current ??= createResearchThread();
  const view = useSyncExternalStore(controller.current.subscribe,controller.current.getSnapshot,controller.current.getSnapshot);
  useEffect(()=>{if(!enabled)return;void controller.current.start();return()=>controller.current.dispose()},[enabled]);
  return { ...view, actions:controller.current };
}
