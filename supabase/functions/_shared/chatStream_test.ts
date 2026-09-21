import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  CHAT_FRAME_KEYS,
  CHAT_STREAM_BUFFER_BYTES,
  CHAT_STREAM_QUEUE,
  type ChatFrame,
  createChatReplay,
  createChatSender,
  frameKey,
} from './chatStream.ts';

/** A stream plus its sender, and a reader that returns the whole body as text. */
function harness() {
  let sender!: ReturnType<typeof createChatSender>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sender = createChatSender(controller);
    },
  }, CHAT_STREAM_QUEUE);
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
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  }, CHAT_STREAM_QUEUE);
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

Deno.test('a one MiB valid final patch is delivered whole rather than truncated by a per-frame cap', async () => {
  const { sender, text } = harness();
  const answer = 'a'.repeat(1024 * 1024);
  sender.send({ patch: { from: 0, text: answer } });
  sender.done();
  const body = await text();
  assertEquals(JSON.parse(body.split('\n\n')[0].slice(6)).patch.text, answer);
  assert(body.endsWith('data: [DONE]\n\n'));
});
Deno.test('unread bytes beyond the queue budget error the reader and detach further writes', async () => {
  const { sender, text } = harness();
  for (let i = 0; i < 10; i++) sender.send({ chunk: 'x'.repeat(CHAT_STREAM_BUFFER_BYTES / 8) });
  assertEquals(sender.closed, true);
  const sent = sender.sent;
  sender.send({ chunk: 'later' });
  sender.done();
  assertEquals(sender.sent, sent);
  await assertRejects(text, Error, 'reader buffer limit');
});

Deno.test('pull-driven replay preserves Unicode across transport chunks and stops when cancelled', async () => {
  const content = 'a'.repeat(16_384 - 'data: {"patch":{"from":0,"text":"'.length - 1) + '🌐🙂'.repeat(20_000);
  const response = new Response(
    createChatReplay([{ patch: { from: 0, text: content } }, { done: { message_id: 'm1' } }]),
  );
  const body = await response.text();
  assertEquals(JSON.parse(body.split('\n\n')[0].slice(6)).patch.text, content);
  assert(body.endsWith('data: [DONE]\n\n'));
  let released = false;
  function* frames(): Generator<ChatFrame> {
    try {
      while (true) yield { patch: { from: 0, text: 'x'.repeat(1024 * 1024) } };
    } finally {
      released = true;
    }
  }
  const stream = createChatReplay(frames());
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  assertEquals(released, true);
});
