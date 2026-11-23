// One AI turn as the screen draws it, built frame by frame from research-chat's event stream
// (the same frames nter.pro reads in src/lib/researchChat.js). Live and sample mode both feed
// frames through applyFrame, so the answer view has a single code path.

export function newTurn({ question, attachments = [], model = null, effort = null, web = false, focus = null } = {}) {
  return {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    question: String(question || ''),
    attachments,
    requested: { model, effort, web },
    focus,
    text: '',
    activity: [],
    evidence: null,
    authorities: [],
    sources: [],
    webSources: [],
    webLive: [],
    followUps: [],
    model: null,
    timing: null,
    usage: null,
    truncated: null,
    notice: null,
    web: null,
    status: 'streaming', // streaming | complete | truncated | error | cancelled | interrupted | unknown
    error: '',
    errorCode: '',
    conversationId: null,
    messageId: null,
    credits: null,
    duplicate: false,
    createdAt: new Date().toISOString(),
  };
}

const mergePages = (have, pages) => {
  const seen = new Set(have.map((p) => p.url));
  return [...have, ...(Array.isArray(pages) ? pages.filter((p) => p?.url && !seen.has(p.url) && seen.add(p.url)) : [])];
};

export function applyFrame(turn, frame) {
  if (!frame || typeof frame !== 'object') return turn;
  const t = { ...turn };
  if (frame.conversation?.id) t.conversationId = frame.conversation.id;
  else if (frame.duplicate) t.duplicate = true;
  else if (typeof frame.reasoning === 'string') t.activity = [...t.activity, { type: 'activity', text: frame.reasoning }];
  else if (frame.web && typeof frame.web === 'object') t.web = frame.web;
  else if (frame.webProgress) t.webLive = mergePages(t.webLive, frame.webProgress.pages);
  else if (frame.tool) {
    const tool = frame.tool;
    t.activity = tool.phase === 'start' || tool.name === 'web_search'
      ? [...t.activity, { type: 'tool', ...tool }]
      : t.activity.map((a) => (a.type === 'tool' && a.name !== 'web_search' && a.step === tool.step ? { ...a, ...tool } : a));
  } else if (typeof frame.chunk === 'string') t.text += frame.chunk;
  else if (frame.patch && Number.isInteger(frame.patch.from) && typeof frame.patch.text === 'string') {
    t.text = t.text.slice(0, Math.max(0, Math.min(frame.patch.from, t.text.length))) + frame.patch.text;
  } else if (frame.model) t.model = frame.model;
  else if (frame.evidence && typeof frame.evidence === 'object') t.evidence = frame.evidence;
  else if (Array.isArray(frame.authorities)) t.authorities = frame.authorities;
  else if (Array.isArray(frame.sources)) t.sources = frame.sources;
  else if (Array.isArray(frame.webSources)) t.webSources = frame.webSources;
  else if (Array.isArray(frame.followUpQuestions)) t.followUps = frame.followUpQuestions.filter((q) => typeof q === 'string').slice(0, 4);
  else if (frame.truncated) t.truncated = frame.truncated;
  else if (frame.notice) t.notice = frame.notice;
  else if (frame.timing) { t.timing = frame.timing; t.usage = frame.usage ?? null; }
  else if (frame.saveFailed) { t.error = 'The answer could not be saved. Reload the conversation.'; t.errorCode = 'save_failed'; }
  else if (typeof frame.error === 'string') {
    t.error = frame.error;
    t.errorCode = frame.code || 'stream_error';
    if (['cancelled', 'interrupted'].includes(frame.code)) t.status = frame.code;
  } else if (frame.done) {
    t.messageId = frame.done.message_id || null;
    if (t.status === 'streaming') t.status = t.errorCode && t.errorCode !== 'truncated' ? 'error' : (t.truncated ? 'truncated' : 'complete');
  } else if ('credits' in frame && (frame.credits === null || Number.isFinite(frame.credits))) t.credits = frame.credits;
  return t;
}

export function finishTurn(turn, { error, code } = {}) {
  if (turn.status !== 'streaming') return turn;
  if (error) return { ...turn, status: code === 'cancelled' ? 'cancelled' : 'error', error, errorCode: code || 'error' };
  return { ...turn, status: turn.text.trim() ? 'complete' : 'unknown', error: turn.text.trim() ? '' : 'The connection ended before an answer arrived.' };
}

// Saved chat_messages rows (user + assistant pairs) back into turns.
export function turnsFromMessages(rows, now = Date.now()) {
  const turns = [];
  let pending = null;
  for (const m of rows || []) {
    if (m.role === 'user') {
      if (pending) turns.push(pending);
      pending = { ...newTurn({ question: m.content }), id: m.id, status: 'unknown', createdAt: m.created_at, requested: { model: m.model_requested, effort: m.reasoning_effort } };
      continue;
    }
    if (m.role !== 'assistant') continue;
    const base = pending || newTurn({ question: '' });
    const expired = m.status === 'running' && m.execution_expires_at && Date.parse(m.execution_expires_at) < now;
    turns.push({
      ...base,
      text: m.content || '',
      sources: Array.isArray(m.sources) ? m.sources : [],
      webSources: Array.isArray(m.web_sources) ? m.web_sources : [],
      followUps: Array.isArray(m.follow_ups) ? m.follow_ups : [],
      activity: Array.isArray(m.activity) ? m.activity : [],
      timing: m.timing || null,
      model: m.model_served ? { served: m.model_served } : null,
      status: expired ? 'interrupted' : (m.status === 'running' ? 'streaming' : (m.status || 'complete')),
      error: m.error_message || '',
      messageId: m.id,
    });
    pending = null;
  }
  if (pending) turns.push(pending);
  return turns;
}
