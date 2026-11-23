import { describe, expect, it } from 'vitest';
import { readSseFrames, parseSseBlock } from './sse.js';

const body = 'data: {"conversation":{"id":"c"}}\n\ndata: {"chunk":"Hi"}\r\n\r\n: keep-alive\n\ndata: {"done":{"message_id":"m"}}\n\ndata: {"credits":5}\n\ndata: [DONE]\n\n';

describe('the event stream', () => {
  it('reads frames from a streaming body', async () => {
    const res = new Response(new ReadableStream({ start(c) { for (const part of body.match(/[\s\S]{1,7}/g)) c.enqueue(new TextEncoder().encode(part)); c.close(); } }));
    const frames = [];
    for await (const f of readSseFrames(res)) frames.push(f);
    expect(frames).toEqual([{ conversation: { id: 'c' } }, { chunk: 'Hi' }, { done: { message_id: 'm' } }, { credits: 5 }]);
  });
  it('reads frames from a body that arrives whole (native HTTP)', async () => {
    const res = { body: null, text: async () => body };
    const frames = [];
    for await (const f of readSseFrames(res)) frames.push(f);
    expect(frames).toHaveLength(4);
  });
  it('skips comments and broken frames', () => {
    expect(parseSseBlock(': ping')).toEqual({ skip: true });
    expect(parseSseBlock('data: {oops')).toEqual({ skip: true });
  });
});
