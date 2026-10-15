import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as threads from '../lib/aiThreads.js';
import * as streaming from '../lib/researchChat.js';
import * as identity from '../lib/userStore.js';
import * as registry from '../lib/aiRegistry.js';
import { partitionAttachments } from '../lib/aiDrop.js';
import { setChatWebSearch } from '../lib/aiConversations.js';
import { OPEN_CONVERSATION_EVENT, conversationCredits, loadCreditEstimates, refreshCredits, takeWantedConversation } from '../lib/creditsStore.js';
import { defaultEffortFor, effortsFor } from './ModelPicker.jsx';

export function normalizeResearchChoice(models, value = {}) {
  const allowed = models.filter(m => m && m.enabled !== false && m.allowed !== false && typeof m.model_id === 'string' && m.model_id.trim());
  const model = allowed.find(m => m.model_id === value.modelId) || allowed.find(m => m.is_default) || allowed[0];
  const effort = effortsFor(allowed, model?.model_id).includes(value.effort)
    ? value.effort
    : defaultEffortFor(allowed, model?.model_id);
  return { modelId: model?.model_id || '', effort };
}

// F14: the reader's model and effort, kept per browser so a reload does not
// reset them. A preference, not account state; storage can be absent or throw
// (private windows, blocked site data), and then the default applies.
const CHOICE_KEY = 'niyResearchChoice';

export function readSavedChoice(storage) {
  try {
    const value = JSON.parse(storage?.getItem(CHOICE_KEY) || 'null');
    return value && typeof value.modelId === 'string' && typeof value.effort === 'string'
      ? { modelId: value.modelId, effort: value.effort }
      : null;
  } catch {
    return null;
  }
}

function saveChoice(storage, choice) {
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage blocked or full: the choice still applies for this page */
  }
}

// This controller owns only the research path. Its injected dependencies use
// the same B4 identity and D7/D8 store interfaces as the production defaults.
export function createResearchThread(overrides = {}) {
  // setChatWebSearch is imported from the store itself: lib/aiThreads.js is outside F130 T4a's scope.
  const deps = { setChatWebSearch, conversationCredits, loadCreditEstimates, refreshCredits, ...threads, ...streaming, ...identity, ...registry, ...overrides };
  const storage = 'choiceStorage' in overrides ? overrides.choiceStorage
    : (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })();
  const emptyStore = () => ({ chats: [], activeId: '', loaded: false, persistenceError: '' });
  let data = { ready: false, loading: true, error: '', draft: '', viewer: null, store: emptyStore(),
    // No effort yet, rather than 'off': the model list has not loaded, so this
    // is the absence of a choice and must normalise to the default once it can.
    // 'off' here would be indistinguishable from a reader who picked it.
    // A saved choice (F14) is kept as given and normalised once models load.
    registry: { models: [], roles: [] }, choice: readSavedChoice(storage) || { modelId: '', effort: '' }, submitting: false,
    cancelRequested: false, cancelPending: false, cancelError: '', attaching: false, attachNotice: '', identityVersion: 0,
    // F111 §8: why the last turn was refused for credits: '' | 'credits_exhausted' | 'credits_unavailable'.
    creditBlock: '',
    // F111 review R: the refusal's own message, so the panel hides that error and no other, and whether the
    // refusal said the balance is held by answers still running (the 402 body's `held`).
    creditError: '', creditHeld: false,
    // F150: set when research-chat refused the chosen model for the plan (403 model_requires_plan).
    planBlock: '',
    // F151: credits a typical answer costs, by model id; what the server has said, nothing guessed.
    estimates: {},
    // F111 §8: credits charged per answer, by message id. Only what the server has said; an answer it has
    // not (yet) charged has no entry, so nothing is ever shown as 0 by guess.
    answerCredits: {} };
  let view = data;
  let owner = null, generation = 0, sequence = 0, active = false, operation = null;
  // F149: a conversation asked for before the thread was ready to show it.
  let wanted = '';
  let rechecking = null, recheckSequence = 0;
  let subscriptions = [];
  const listeners = new Set();
  const token = () => ({ owner, generation });
  // Bound to the account, not one verification of it: a same-account re-check
  // replaces `owner` without bumping the generation (F43). Work that asks while
  // that re-check runs waits for it, then runs under the re-verified identity.
  const valid = t => active && t.owner && owner?.id === t.owner.id && generation === t.generation;
  const current = async t => {
    if (!valid(t)) return false;
    while (rechecking) await rechecking;
    return valid(t) && await deps.localIdentityIsCurrent(owner) && valid(t);
  };
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
    // F130: the pages searched, kept beside `sources` and never merged into it.
    const savedWebSources = [...(chat?.messages || [])].reverse().find(m => m.role === 'assistant' && m.webSources?.length)?.webSources || [];
    view = { ...data, chat, stream, messages, live, storedRunning,
      // The verified account these values belong to, so the credits shown are never another account's.
      ownerId: owner?.id || '',
      // F66: after a dropped connection (outcome unknown) nothing here is running, so there is
      // nothing to stop; the turn stays pending (no duplicate send) until its saved result is read.
      // The server may still be writing an answer it acknowledged, so Stop (a server cancel) stays
      // for an acknowledged turn; a turn the server never acknowledged has nothing to stop.
      canStop: data.ready && Boolean(data.submitting || stream?.isStreaming || storedRunning
        || (stream?.isPending && (stream?.errorCode !== 'connection_lost' || Boolean(stream?.messageId)))),
      locked: !data.ready || data.loading || data.submitting || data.attaching || Boolean(stream?.isPending || stream?.isStreaming || storedRunning),
      sources: stream?.sources?.length ? stream.sources : savedSources,
      webSources: stream?.webSources?.length ? stream.webSources : savedWebSources,
      // F131: the pages found so far by the turn in flight, for display only; never saved.
      webLive: Array.isArray(stream?.webLive) ? stream.webLive : [],
      // The reader's globe override for the active conversation (true, false, or null for automatic),
      // and the server's decision for the turn in flight, which wins the globe while it runs.
      webSearch: typeof chat?.webSearch === 'boolean' ? chat.webSearch : null,
      web: stream?.web ?? null,
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
        if (version === generation) emit({ ready: false, loading: false, error: deps.identityRefusalMessage('Sign in to use AI research.') });
        return;
      }
      if (!active || version !== generation) return;
      owner = verified;
      const t = token();
      // panel-loading spec B: the read reuses this verification while it is current.
      const [store, choices] = await Promise.all([deps.hydrateConversations(verified), deps.loadRegistry()]);
      if (!await current(t) || seq !== sequence) return;
      const hydrated = store.chats.length ? store : deps.createAiChat();
      emit({ store: hydrated, registry: choices, ready: true, loading: false });
      void loadAnswerCredits(hydrated.activeId, t);
      void loadEstimates(t);
      if (wanted) { const id = wanted; wanted = ''; void api.openConversation(id); }
    } catch {
      if (active && seq === sequence && version === generation) emit({ loading: false, error: 'Research could not be loaded. Try Reload.' });
    }
  }
  function invalidate(id, event) {
    generation++; sequence++; owner = null; operation = null; wanted = '';
    emit({ ready: false, loading: Boolean(id), error: id ? '' : 'Sign in to use AI research.', store: emptyStore(),
      draft: '', viewer: null, submitting: false, attaching: false, attachNotice: '', cancelRequested: false, cancelPending: false, cancelError: '',
      creditBlock: '', creditError: '', creditHeld: false, planBlock: '', estimates: {}, answerCredits: {}, identityVersion: data.identityVersion + 1 });
    // Never invoke another Auth method inside its synchronous event callback.
    if (id) queueMicrotask(() => { if (active) void hydrate(); });
  }
  /**
   * F43: supabase-js re-announces the same account as SIGNED_IN on every tab
   * refocus, and a token refresh is the same account too. Re-verify it without
   * clearing the thread, so an unsent chat keeps its draft and attachments, as
   * the admin panel does (dcf7034). A sign-out or another account still clears
   * everything synchronously, and a failed re-check clears as one would.
   */
  function identityEvent(id, event) {
    if (!id || owner?.id !== id) { invalidate(id, event); return; }
    const seq = ++recheckSequence, version = generation;
    const check = (async () => {
      // Never invoke another Auth method inside its synchronous event callback.
      await null;
      let verified = null;
      try {
        verified = await deps.verifiedLocalIdentity();
        if (verified?.id !== id || !await deps.localIdentityIsCurrent(verified)) verified = null;
      } catch { verified = null; }
      // A sign-out, account change or dispose meanwhile has already cleared.
      if (!active || version !== generation || seq !== recheckSequence) return;
      if (verified) { owner = verified; return; }
      invalidate(null);
      emit({ error: deps.identityRefusalMessage('Sign in to use AI research.') });
    })();
    rechecking = check;
    void check.finally(() => { if (rechecking === check) rechecking = null; });
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
  // The charges the server holds for a saved conversation (my_conversation_credits). Never blocks or fails a load.
  async function loadAnswerCredits(chatId, t) {
    if (!chatId) return;
    try {
      const found = await deps.conversationCredits(chatId);
      if (!found?.size || !await current(t)) return;
      emit({ answerCredits: { ...data.answerCredits, ...Object.fromEntries(found) } });
    } catch { /* an unread charge simply shows nothing */ }
  }
  // What a typical answer costs per model (F151). Never blocks or fails a load; no entry shows nothing.
  async function loadEstimates(t) {
    try {
      const found = await deps.loadCreditEstimates();
      if (!found || !await current(t)) return;
      emit({ estimates: found });
    } catch { /* the picker simply shows no estimate */ }
  }
  // The balance is read by the credits store; a failed read changes nothing and never fails a turn.
  async function refreshWallet() {
    try { await deps.refreshCredits(); } catch { /* the chip keeps its last balance */ }
  }
  // F178: one re-check loop per conversation. A new loop, a new turn in the conversation or a dispose
  // cancels the one that is there, so no earlier loop keeps polling beside it.
  const savedRechecks = new Map();
  function cancelRecheck(conversationId) {
    const loop = savedRechecks.get(conversationId);
    if (!loop) return;
    clearTimeout(loop.timer);
    savedRechecks.delete(conversationId);
  }
  function recheckSaved(conversationId, t, tries = 24, loop = null) {
    if (!loop) {
      cancelRecheck(conversationId);
      loop = { timer: null };
      savedRechecks.set(conversationId, loop);
    }
    const mine = () => savedRechecks.get(conversationId) === loop;
    if (tries <= 0) {
      if (mine()) savedRechecks.delete(conversationId);
      if (valid(t) && view.chat?.id === conversationId) emit({ error: 'Still not saved. Use Recover answer or Reload.' });
      return;
    }
    loop.timer = setTimeout(async () => {
      if (!mine()) return;
      if (!valid(t)) { savedRechecks.delete(conversationId); return; }
      try {
        const done = await settleSaved(conversationId, t);
        if (!mine()) return;
        if (done) savedRechecks.delete(conversationId);
        else recheckSaved(conversationId, t, tries - 1, loop);
      } catch {
        if (mine()) recheckSaved(conversationId, t, tries - 1, loop);
      }
    }, 5000);
  }
  async function finishTurn(result, context, t) {
    if (!valid(t)) return;
    if (result.error) emit({ error: result.error });
    // F111 §3: a turn refused for credits never started. Say which refusal it was.
    if (result.errorCode === 'credits_exhausted' || result.errorCode === 'credits_unavailable') {
      emit({ creditBlock: result.errorCode, creditError: result.error || '', creditHeld: result.errorCode === 'credits_exhausted' && result.held === true });
    }
    // F150: the plan no longer allows the chosen model (a stale plan in the picker). Say so as it was said, and
    // go back to the default model so the next send is one the plan allows.
    if (result.errorCode === 'model_requires_plan') {
      const next = normalizeResearchChoice(data.registry.models, { modelId: '', effort: '' });
      emit({ planBlock: 'model_requires_plan', choice: next });
      saveChoice(storage, next);
    }
    if (['complete', 'cancelled', 'truncated', 'interrupted', 'error'].includes(result.status) && !result.isPending) {
      emit({ cancelRequested: false, cancelPending: false });
      // F111 §8: a finished turn (answered, stopped, failed or refused) has changed the balance, or been refused by it.
      // A turn that ended at `done` is followed by a credits frame whose handler (onCredits) re-reads the balance
      // once the charge has settled; a read here would run before it and be answered with the old balance
      // (review R, M3). Failed, interrupted and refused turns get no such frame, so they re-read here.
      if (!['complete', 'cancelled', 'truncated'].includes(result.status)) void refreshWallet();
    }
    if (result.conversationId) {
      try {
        const store = await deps.reconcileTurn(result.conversationId, context);
        if (!await current(t)) return;
        emit({ store });
        const settled = await settleSaved(result.conversationId, t);
        if (!await current(t)) return;
        // F66: after a dropped connection the answer may still be finishing on the server; its
        // saved result is read again every 5 s, for up to 2 minutes, until it is there.
        if (!settled && result.errorCode === 'connection_lost') recheckSaved(result.conversationId, t);
        if (!result.isPending && result.messageId && store.chats.some(c => c.id === result.conversationId
          && c.messages.some(m => m.id === result.messageId && m.status !== 'running'))) {
          deps.clearStream(result.conversationId); emit();
        }
      } catch { if (valid(t)) emit({ error: 'The saved result could not be loaded. Try Reload.' }); }
    }
  }
  async function execute(body, replay = false) {
    if (!data.ready || data.submitting || data.attaching || (!replay && view.locked)) return false;
    const t = token(), context = deps.captureConversationContext(view.chat?.id || '');
    if (!context) return false;
    const op = { context }; operation = op;
    emit({ submitting: true, error: '', cancelError: '', attachNotice: '', creditBlock: '', creditError: '', creditHeld: false, planBlock: '' });
    try {
      if (!await current(t)) return false;
      if (!replay) {
        body = { ...body, turn_key: body.turn_key || crypto.randomUUID(),
          ...(view.chat?.id ? { conversation_id: view.chat.id } : {}) };
        const chosen = normalizeResearchChoice(data.registry.models, data.choice);
        if (!chosen.modelId) throw new Error('No research model is available. Reload the model list.');
        body.model = chosen.modelId;
        // The override travels only when the reader has set one; absent means automatic, and the
        // server then applies the value stored on the conversation. The thread owns the field.
        if (typeof view.chat?.webSearch === 'boolean') body.web_search = view.chat.webSearch;
        else delete body.web_search;
        // Send 'off' rather than omitting the field. The server now reads an
        // omitted field as its own default, so silence would mean "decide for
        // me" and could not express the picker's "No reasoning".
        body.reasoning = chosen.effort === 'off' ? 'off' : chosen.effort;
        deps.appendAiMessage(context.chatId, { role: 'user', content: body.message, turn_key: body.turn_key });
        emit({ draft: '', store: deps.loadAiState() });
      }
      const options = {
        // F198: the account this turn was composed for; the transport keeps the send across that
        // account's re-announcement (a tab refocus) and refuses any other.
        account: t.owner.id,
        onConversation: async conversation => {
          if (!await current(t)) return;
          emit({ store: deps.adoptConversation(conversation, context) });
        },
        // F111 §3: the settled credits, after the answer was shown as finished. `null` means not settled yet.
        onCredits: async ({ conversationId, messageId, credits }) => {
          if (!valid(t)) return;
          void refreshWallet();
          if (typeof credits === 'number' && messageId) emit({ answerCredits: { ...data.answerCredits, [messageId]: credits } });
          else await loadAnswerCredits(conversationId, t);
        },
      };
      // F178: a new turn replaces the conversation's re-check, only once the turn is really sent.
      cancelRecheck(view.chat?.id || '');
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
      subscriptions = [deps.subscribeLocalIdentity(identityEvent),
        deps.subscribeAiChats(store => { if (owner) emit({ store }); }),
        deps.subscribeStream(() => { if (owner) emit(); }),
        deps.subscribeRegistry(choices => { if (owner) emit({ registry: choices }); })];
      await hydrate();
    },
    dispose() { active = false; subscriptions.forEach(fn => fn()); subscriptions = []; [...savedRechecks.keys()].forEach(cancelRecheck); invalidate(null); },
    reportError(error) { if (data.ready) emit({ error }); },
    setDraft(draft) { if (data.ready) emit({ draft }); },
    setChoice(choice) {
      if (!data.ready) return;
      const next = normalizeResearchChoice(data.registry.models, choice);
      emit({ choice: next });
      saveChoice(storage, next);
    },
    setWebSearch(value) {
      if (!data.ready || view.locked || typeof value !== 'boolean') return false;
      deps.setChatWebSearch(view.chat?.id || '', value);
      emit({ store: deps.loadAiState() });
      return true;
    },
    openSource(source) { if (data.ready) emit({ viewer: { kind: source?.kind || 'list', source: source || null } }); },
    closeViewer() { emit({ viewer: null }); },
    newChat() {
      if (!data.ready || data.submitting || data.attaching || deps.streamState('new').isPending) return false;
      emit({ store: deps.createAiChat(), draft: '', viewer: null, error: '', cancelRequested: false, cancelError: '', attachNotice: '' }); return true;
    },
    async selectChat(id) {
      if (!data.ready || data.submitting || data.attaching) return;
      const t = token();
      emit({ store: deps.setActiveAiChat(id), viewer: null, draft: '', loading: true, error: '', cancelRequested: false, cancelError: '', attachNotice: '' });
      try { const store = await deps.loadMessages(id); if (await current(t)) { emit({ store }); void loadAnswerCredits(id, t); } }
      catch { if (valid(t)) emit({ error: 'Conversation messages could not be loaded. Try Reload.' }); }
      finally { if (valid(t)) emit({ loading: false }); }
    },
    /**
     * F149: show one of the caller's saved conversations (asked for by Plan & billing). Before the thread is
     * ready the request waits for it. Only the chats the panel lists (the 40 most recent) can be shown; any
     * other says so rather than doing nothing, and an answer in progress is never interrupted.
     */
    async openConversation(id) {
      if (typeof id !== 'string' || !id) return false;
      if (!data.ready) { wanted = id; return false; }
      if (!data.store.chats.some(c => c.id === id)) { emit({ error: 'That conversation is not in your recent chats.' }); return false; }
      if (view.locked) { emit({ error: 'Wait for the current answer to finish, then open that conversation.' }); return false; }
      if (view.chat?.id !== id) await api.selectChat(id);
      return true;
    },
    deleteChat(id) { if (data.ready && !view.locked) { deps.deleteAiChat(id); emit({ store: deps.loadAiState(), viewer: null }); } },
    async attach(materialize) {
      if (!data.ready || view.locked) return false;
      const t = token(), context = deps.captureConversationContext(view.chat?.id || '');
      if (!context) return false;
      emit({ attaching: true, attachNotice: '', error: '' });
      try {
        const attachments = await materialize();
        if (!await current(t) || !contextChat(context)) return false;
        // chat-attach-fixes: what is already attached is not added again, and is named.
        const chat = contextChat(context);
        const { fresh, duplicates } = partitionAttachments(chat.attachments, attachments);
        const remaining = Math.max(0, threads.MAX_ATTACHMENTS - (chat.attachments || []).length);
        const admitted = fresh.slice(0, remaining), overflow = fresh.slice(remaining);
        if (admitted.length) deps.addChatAttachments(chat.id, admitted);
        const names = list => [...new Set(list.map(a => a.title || 'item'))].join(', ');
        const notices = [];
        if (duplicates.length) notices.push(`Already attached: ${names(duplicates)}`);
        if (overflow.length) notices.push(`Attachment limit (${threads.MAX_ATTACHMENTS}): not added: ${names(overflow)}`);
        emit({ store: deps.loadAiState(), attachNotice: notices.join('. ') }); return true;
      } catch { if (valid(t)) emit({ error: 'The attachment could not be loaded.' }); return false; }
      finally { if (valid(t)) emit({ attaching: false }); }
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
      if (data.store.persistenceError) return hydrate();
      const t = token(), id = view.chat?.id;
      if (!id) { emit(); return; }
      emit({ loading: true, error: '' });
      try {
        const store = await deps.loadMessages(id);
        if (!await current(t)) return;
        emit({ store });
        void loadAnswerCredits(id, t);
        await settleSaved(id, t);
      }
      catch { if (valid(t)) emit({ error: 'The saved result could not be loaded. Try Reload.' }); }
      finally { if (valid(t)) emit({ loading: false }); }
    },
  };
  emit();
  return api;
}
/**
 * F149: hand the thread the conversation Plan & billing asked for. A request made before the thread existed is
 * taken at once (the shell shows the AI panel, and this thread is created as it mounts); later ones follow the
 * event. Returns the function that stops listening.
 */
export function bindOpenConversation(actions, { target = typeof window === 'undefined' ? null : window, take = takeWantedConversation } = {}) {
  const early = take();
  if (early) void actions.openConversation(early);
  if (!target) return () => {};
  const onOpen = event => {
    take();
    const id = event?.detail?.conversationId;
    if (typeof id === 'string' && id) void actions.openConversation(id);
  };
  target.addEventListener(OPEN_CONVERSATION_EVENT, onOpen);
  return () => target.removeEventListener(OPEN_CONVERSATION_EVENT, onOpen);
}
export default function useResearchThread(enabled) {
  const controller = useRef(null);
  controller.current ??= createResearchThread();
  const view = useSyncExternalStore(controller.current.subscribe,controller.current.getSnapshot,controller.current.getSnapshot);
  useEffect(()=>{if(!enabled)return;void controller.current.start();const unbind=bindOpenConversation(controller.current);return()=>{unbind();controller.current.dispose()}},[enabled]);
  return { ...view, actions:controller.current };
}
