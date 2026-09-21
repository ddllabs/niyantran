import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { type ChatFrame, CHAT_FRAME_KEYS, createChatSender, frameKey } from './chatStream.ts';

/** A stream plus its sender, and a reader that returns the whole body as text. */
function harness() {
  let sender!: ReturnType<typeof createChatSender>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sender = createChatSender(controller);
    },
  });
  return { sender, text: () => new Response(stream).text() };
}

Deno.test('frames are written as SSE data lines and [DONE] terminates', async () => {
  const { sender, text } = harness();
  sender.send({ conversation: { id: 'c1', title: 'Bills' } });
  sender.send({ chunk: 'Hello' });
  sender.send({ done: { message_id: 'm1' } });
  sender.done();
  const body = await text();
  assertEquals(body.split('\n\n').filter(Boolean), [
    'data: {"conversation":{"id":"c1","title":"Bills"}}',
    'data: {"chunk":"Hello"}',
    'data: {"done":{"message_id":"m1"}}',
    'data: [DONE]',
  ]);
  assertEquals(sender.sent, 4);
  assertEquals(sender.closed, true);
});

Deno.test('a closed reader never kills the turn: writes are swallowed and the sender reports closed', () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const sender = createChatSender(controller);
  sender.send({ chunk: 'before' });
  assertEquals(sender.sent, 1);
  stream.cancel();
  sender.send({ chunk: 'after the reader went away' });
  sender.send({ sources: [] });
  sender.done();
  assertEquals(sender.closed, true);
  assertEquals(sender.sent, 1, 'nothing more was written, and nothing threw');
});

Deno.test('done() is idempotent and an unknown frame name is refused before it reaches the wire', async () => {
  const { sender, text } = harness();
  sender.done();
  sender.done();
  assertThrows(() => sender.send({ nonsense: true } as unknown as ChatFrame), Error, 'unknown frame');
  assertEquals(await text(), 'data: [DONE]\n\n');
});

Deno.test('every declared frame key round-trips through frameKey', () => {
  const samples: ChatFrame[] = [
    { conversation: { id: 'c', title: 't' } },
    { reasoning: 'r' },
    { tool: { name: 'search_documents', phase: 'start', step: 1 } },
    { chunk: 'c' },
    { patch: { from: 0, text: 't' } },
    { model: { requested: 'a', served: 'b', reason: 'unavailable' } },
    { sources: [] },
    { followUpQuestions: [] },
    { truncated: { reason: 'length', continuations: 1 } },
    { notice: { kind: 'window', dropped: 3 } },
    { timing: { search_ms: 1, reasoning_ms: 2, writing_ms: 3, total_ms: 6 } },
    { duplicate: true },
    { saveFailed: { stage: 'persist', detail: 'x' } },
    { error: 'e' },
    { done: { message_id: 'm' } },
  ];
  assertEquals(samples.map(frameKey), [...CHAT_FRAME_KEYS]);
  assert(samples.length === CHAT_FRAME_KEYS.length);
});
