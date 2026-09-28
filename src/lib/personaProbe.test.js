// The admin persona probe talks to research-chat directly (plan task D4): it
// names the persona by its database value and reads the streamed answer.
import { describe, expect, it, vi } from 'vitest';
import { runPersonaProbe } from './personaProbe.js';

function sse(frames) {
  const text = frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('runPersonaProbe', () => {
  it('sends the persona as its database value and assembles the answer', async () => {
    const send = vi.fn(async () => sse([
      { conversation: { id: 'c1' } },
      { model: { requested: 'm', served: 'google/gemini-3.8-flash' } },
      { chunk: 'RESEARCH QUESTION' },
      { chunk: ' / EVIDENCE' },
      { patch: { from: 8, text: ' QUESTION / EVIDENCE / CHRONOLOGY' } },
      { done: { message_id: 'x' } },
      '[DONE]',
    ]));
    const out = await runPersonaProbe({ typeId: 'academic', message: 'Test' }, { send });
    const { body } = send.mock.calls[0][0];
    expect(body).toMatchObject({ message: 'Test', focus: 'attached', attachments: [], persona_probe: 'academic' });
    expect(body.turn_key).toMatch(/^probe-/);
    expect(body).not.toHaveProperty('conversation_id');
    expect(out).toEqual({ text: 'RESEARCH QUESTION / EVIDENCE / CHRONOLOGY', model: 'google/gemini-3.8-flash', conversationId: 'c1' });
  });

  it('maps frontend ids to database personas and keeps the thread on follow-ups', async () => {
    const send = vi.fn(async () => sse([{ chunk: 'ok' }, '[DONE]']));
    await runPersonaProbe({ typeId: 'student', message: 'Q', conversationId: 'c9' }, { send });
    expect(send.mock.calls[0][0].body).toMatchObject({ persona_probe: 'upsc_aspirant', conversation_id: 'c9' });
  });

  it('surfaces server and stream errors', async () => {
    await expect(runPersonaProbe({ typeId: 'lawyer', message: 'Q' }, {
      send: async () => new Response(JSON.stringify({ error: 'persona_probe must be one of …' }), { status: 400 }),
    })).rejects.toThrow(/persona_probe/);
    await expect(runPersonaProbe({ typeId: 'lawyer', message: 'Q' }, {
      send: async () => sse([{ error: 'model unavailable', code: 'error' }]),
    })).rejects.toThrow('model unavailable');
  });

  it('refuses an unknown persona or an empty message before sending', async () => {
    const send = vi.fn();
    await expect(runPersonaProbe({ typeId: 'wizard', message: 'Q' }, { send })).rejects.toThrow(/Unknown persona/);
    await expect(runPersonaProbe({ typeId: 'policy', message: '  ' }, { send })).rejects.toThrow(/Message missing/);
    expect(send).not.toHaveBeenCalled();
  });
});
