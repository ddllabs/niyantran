import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStream, createTextCoalescer, readSseFrames, sendTurn, streamState } from './researchChat.js';

/** An SSE Response whose body arrives in awkward chunks. */
function sse(payloads, chunkSize = 9) {
  const text = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(gen) {
  const out = [];
  for await (const f of gen) out.push(f);
  return out;
}

/** Run every queued animation frame synchronously. */
function frameQueue() {
  const queue = [];
  return { schedule: (fn) => queue.push(fn), run: () => queue.splice(0).forEach((fn) => fn()), get length() { return queue.length; } };
}

describe('readSseFrames', () => {
  it('frames across chunk boundaries, skips malformed frames and ends on [DONE]', async () => {
    const got = await collect(readSseFrames(sse([{ conversation: { id: 'c1', title: 'T' } }, 'not json', { chunk: 'Hello' }, { done: { message_id: 'm1' } }], 5)));
    expect(got).toEqual([{ conversation: { id: 'c1', title: 'T' } }, { chunk: 'Hello' }, { done: { message_id: 'm1' } }]);
  });

  it('stops at [DONE] and ignores anything after it', async () => {
    const body = 'data: {"chunk":"a"}\n\ndata: [DONE]\n\ndata: {"chunk":"never"}\n\n';
    const got = await collect(readSseFrames(new Response(body)));
    expect(got).toEqual([{ chunk: 'a' }]);
  });

  it('a response with no body yields nothing', async () => {
    expect(await collect(readSseFrames({ body: null }))).toEqual([]);
  });
});

describe('createTextCoalescer', () => {
  it('commits once per frame however many deltas arrived', () => {
    const q = frameQueue();
    const commits = [];
    const c = createTextCoalescer((t) => commits.push(t), q.schedule);
    c.push('He');
    c.push('llo ');
    c.push('there');
    expect(commits).toEqual([]);
    q.run();
    expect(commits).toEqual(['Hello there']);
    c.push('!');
    q.run();
    expect(commits).toEqual(['Hello there', 'Hello there!']);
  });

  it('patch rewrites from an offset and flush commits immediately', () => {
    const q = frameQueue();
    const commits = [];
    const c = createTextCoalescer((t) => commits.push(t), q.schedule);
    c.push('It reached committee [7].');
    q.run();
    c.patch(21, '[1].');
    c.flush();
    expect(commits.at(-1)).toBe('It reached committee [1].');
    expect(c.text).toBe('It reached committee [1].');
  });
});

describe('sendTurn', () => {
  const body = { message: 'hi', turn_key: 't1', focus: 'broad' };
  beforeEach(() => clearStream('new'));
  afterEach(() => vi.restoreAllMocks());

  it('streams text into the state, records sources and follow-ups, and ends not streaming', async () => {
    const q = frameQueue();
    const send = () =>
      Promise.resolve(
        sse([
          { conversation: { id: 'conv-9', title: 'Bills' } },
          { reasoning: 'Looking at the desk rows.' },
          { tool: { name: 'search_desk_rows', phase: 'start', step: 1, input: { tier: 'national' } } },
          { tool: { name: 'search_desk_rows', phase: 'end', step: 1, resultCount: 20 } },
          { chunk: 'There are ' },
          { chunk: '**412** bills [1].' },
          { sources: [{ id: 1, kind: 'row', row_key: 'k', title: 'A bill' }] },
          { followUpQuestions: ['Which ministries introduced them?'] },
          { timing: { search_ms: 5, reasoning_ms: 1, writing_ms: 2, total_ms: 8 } },
          { done: { message_id: 'msg-3' } },
        ]),
      );
    const result = await sendTurn(body, { send, schedule: q.schedule });
    q.run();
    expect(result).toMatchObject({ conversationId: 'conv-9', messageId: 'msg-3' });
    const s = streamState('conv-9');
    expect(s.isStreaming).toBe(false);
    expect(s.streamingText).toBe('There are **412** bills [1].');
    expect(s.sources).toHaveLength(1);
    expect(s.followUps).toEqual(['Which ministries introduced them?']);
    expect(s.activity.filter((a) => a.type === 'reasoning')).toHaveLength(1);
    const tool = s.activity.find((a) => a.type === 'tool');
    expect(tool).toMatchObject({ step: 1, phase: 'end', resultCount: 20 });
    clearStream('conv-9');
  });

  it('a patch frame rewrites the streamed answer from its offset', async () => {
    const q = frameQueue();
    const send = () =>
      // The server patches from the first character that differs, as it does
      // when the ladder renumbers a marker the reader has already seen.
      Promise.resolve(sse([{ conversation: { id: 'c-p', title: 'T' } }, { chunk: 'Cited [7] here.' }, { patch: { from: 7, text: '1] here.' } }, { done: { message_id: 'm' } }]));
    await sendTurn({ ...body, conversation_id: undefined }, { send, schedule: q.schedule });
    q.run();
    expect(streamState('c-p').streamingText).toBe('Cited [1] here.');
    clearStream('c-p');
  });

  it('a duplicate send stops without an error', async () => {
    const send = () => Promise.resolve(sse([{ duplicate: true }]));
    const r = await sendTurn(body, { send, schedule: frameQueue().schedule });
    expect(r.error).toBeFalsy();
    expect(streamState('new').isStreaming).toBe(false);
  });

  it('an error frame and a non-2xx response both land in the state', async () => {
    const send = () => Promise.resolve(sse([{ conversation: { id: 'c-e', title: 'T' } }, { error: 'the model could not be reached' }]));
    await sendTurn(body, { send, schedule: frameQueue().schedule });
    expect(streamState('c-e').error).toBe('the model could not be reached');
    clearStream('c-e');

    const refused = () => Promise.resolve(new Response(JSON.stringify({ error: 'unknown or disabled model' }), { status: 400 }));
    const r = await sendTurn(body, { send: refused, schedule: frameQueue().schedule });
    expect(r.error).toBe('unknown or disabled model');
  });

  it('a stream that goes silent is given up on rather than hanging the composer', async () => {
    const send = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: {"conversation":{"id":"c-s","title":"T"}}\n\n'));
              // and then nothing, ever
            },
          }),
          { status: 200 },
        ),
      );
    const r = await sendTurn(body, { send, schedule: frameQueue().schedule, timeoutMs: 20 });
    expect(r.aborted).toBe(true);
    expect(r.endReason).toBe('timeout');
    expect(streamState('c-s').isStreaming).toBe(false);
    expect(streamState('c-s').error).toMatch(/stopped arriving/);
    clearStream('c-s');
  });
});
