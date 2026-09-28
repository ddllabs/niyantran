/**
 * One admin persona-probe turn, sent straight to research-chat. The server
 * honours `persona_probe` only for a platform admin (checked there) and then
 * answers with that persona's shipped prompt; anyone else gets their own.
 * Replaces the /api/ai/chat proxy the legacy AI path used (plan task D4).
 */
import { sendResearchTurn } from './aiClient.js';
import { dbPersona } from './personaMap.js';
import { readSseFrames } from './researchChat.js';

export async function runPersonaProbe(
  { typeId, message, conversationId = null, signal },
  { send = sendResearchTurn, frames = readSseFrames } = {},
) {
  const persona = dbPersona(typeId);
  if (!persona) throw new Error(`Unknown persona: ${typeId}`);
  const text = String(message || '').trim();
  if (!text) throw new Error('Message missing.');

  const response = await send({
    signal,
    body: {
      message: text.slice(0, 4000),
      turn_key: `probe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      focus: 'attached',
      attachments: [],
      persona_probe: persona,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `research-chat HTTP ${response.status}`);
  }

  let answer = '';
  let model = '';
  let conversation = conversationId;
  for await (const frame of frames(response, signal)) {
    if (frame.conversation?.id) conversation = frame.conversation.id;
    else if (typeof frame.chunk === 'string') answer += frame.chunk;
    else if (frame.patch && Number.isInteger(frame.patch.from) && typeof frame.patch.text === 'string') {
      answer = answer.slice(0, frame.patch.from) + frame.patch.text;
    } else if (frame.model) model = frame.model.served || frame.model.requested || model;
    else if (typeof frame.error === 'string') throw new Error(frame.error);
  }
  if (!answer.trim()) throw new Error('Empty response from AI research service');
  return { text: answer, model, conversationId: conversation };
}
