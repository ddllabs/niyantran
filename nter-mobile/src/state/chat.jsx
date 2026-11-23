// The Ask AI conversation: what is attached, the chosen model, effort, focus and web search,
// the turns on screen, and sending, stopping and reopening conversations. Any screen can
// attach a record or story and jump here ("Ask AI about this").
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/index.js';
import { applyFrame, finishTurn, newTurn, turnsFromMessages } from '../services/chatState.js';
import { planAllows, turnKey } from '../services/shape.js';
import { useApp } from './app.jsx';

const ChatCtx = createContext(null);
export const useChat = () => useContext(ChatCtx);

export const FOCUS = [
  { id: 'law_orders', label: 'Law · Order archives', desk: 'law', collection: 'Order archives', hint: 'Searches Law desk and Order archives first' },
  { id: 'auto', label: 'Automatic', hint: 'Attached items when there are any; otherwise the desk you came from, or everything' },
  { id: 'attached', label: 'Attached only', hint: 'Only the records and files you attached' },
  { id: 'desk', label: 'This desk', hint: 'The desk and module the question came from' },
  { id: 'broad', label: 'Broad context', hint: 'Every desk, the documents corpus and your attachments' },
];
export const EFFORT_LABEL = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export function ChatProvider({ children }) {
  const { models, plan, signedIn, refreshCredits, requireSignIn, toast } = useApp();
  const [conversationId, setConversationId] = useState(null);
  const [title, setTitle] = useState('');
  const [turns, setTurns] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [deskContext, setDeskContext] = useState(null);
  const [focus, setFocus] = useState('auto');
  const [modelId, setModelId] = useState(null);
  const [effort, setEffort] = useState(null);
  const [web, setWeb] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);

  // The default model is the one nter.pro marks as default and this plan may use.
  const model = useMemo(() => {
    const allowed = models.filter((m) => planAllows(plan, m.min_plan));
    return models.find((m) => m.model_id === modelId && planAllows(plan, m.min_plan))
      || allowed.find((m) => m.is_default) || allowed[0] || models[0] || null;
  }, [models, modelId, plan]);
  const efforts = useMemo(() => (Array.isArray(model?.efforts) && model.efforts.length ? model.efforts : ['low']), [model]);
  const effortValue = efforts.includes(effort) ? effort : (efforts.includes('low') ? 'low' : efforts[0]);

  useEffect(() => { if (!signedIn) { setTurns([]); setConversationId(null); } }, [signedIn]);

  const attach = useCallback((item) => {
    setAttachments((old) => {
      if (old.some((a) => a.key && a.key === item.key)) return old;
      if (old.length >= 12) { toast('Up to 12 attachments per question'); return old; }
      return [...old, item];
    });
  }, [toast]);
  const detach = useCallback((i) => setAttachments((old) => old.filter((_, j) => j !== i)), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null); setTitle(''); setTurns([]); setAttachments([]); setDeskContext(null); setDraft(''); setBusy(false);
  }, []);

  const loadConversation = useCallback(async (conv) => {
    abortRef.current?.abort();
    try {
      const rows = await api.getMessages(conv.id);
      setConversationId(conv.id); setTitle(conv.title || ''); setTurns(turnsFromMessages(rows)); setAttachments([]); setBusy(false);
    } catch (e) { toast(e.message); }
  }, [toast]);

  const send = useCallback(async (text) => {
    const message = String(text ?? draft).trim();
    if (!message || busy) return;
    if (!requireSignIn('Sign in to ask the AI. Your credits and conversations are the same as on nter.pro.')) return;
    const att = attachments;
    const resolvedFocus = focus !== 'auto' ? focus : (att.length ? 'attached' : (deskContext ? 'desk' : 'broad'));
    const body = {
      ...(conversationId ? { conversation_id: conversationId } : {}),
      message: message.slice(0, 4000),
      turn_key: turnKey(),
      ...(model?.model_id ? { model: model.model_id } : {}),
      reasoning: effortValue,
      focus: resolvedFocus,
      attachments: att.map(({ key: _k, label: _l, icon: _i, record: _r, note: _n, ...a }) => a),
      ...(deskContext ? { desk_context: deskContext } : {}),
      ...(web ? { web_search: true } : {}),
    };
    let turn = newTurn({ question: message, attachments: att.map((a) => a.label || a.title), model: model?.label, effort: effortValue, web, focus: resolvedFocus });
    const id = turn.id;
    setTurns((old) => [...old, turn]);
    setDraft('');
    setBusy(true);
    if (!title) setTitle(message.slice(0, 60));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const update = (next) => { turn = next; setTurns((old) => old.map((t) => (t.id === id ? next : t))); };
    try {
      await api.sendTurn(body, {
        signal: ctrl.signal,
        onFrame: (frame) => {
          update(applyFrame(turn, frame));
          if (frame.conversation?.id) setConversationId(frame.conversation.id);
        },
      });
      update(finishTurn(turn));
    } catch (e) {
      if (e?.name === 'AbortError') update(finishTurn(turn, { error: 'Stopped.', code: 'cancelled' }));
      else {
        const code = e?.body?.code || (e?.status === 402 ? 'no_credits' : e?.status === 403 ? 'model_requires_plan' : 'error');
        update(finishTurn(turn, { error: e?.message || 'The AI could not answer.', code }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      refreshCredits();
    }
  }, [draft, busy, requireSignIn, attachments, focus, deskContext, conversationId, model, effortValue, web, title, refreshCredits]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    if (conversationId) api.cancelTurn(conversationId).catch(() => {});
  }, [conversationId]);

  const value = useMemo(() => ({
    conversationId, title, turns, attachments, attach, detach, setAttachments, deskContext, setDeskContext,
    focus, setFocus, model, modelId: model?.model_id || modelId, setModelId, efforts, effort: effortValue, setEffort, web, setWeb, draft, setDraft, busy,
    send, stop, newChat, loadConversation,
  }), [conversationId, title, turns, attachments, attach, detach, deskContext, focus, model, modelId, efforts, effortValue, web, draft, busy, send, stop, newChat, loadConversation]);

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}
