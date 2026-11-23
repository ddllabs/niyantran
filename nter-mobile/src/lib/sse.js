// Reads the research-chat event stream. With a streaming body (browser fetch, or a phone once
// the function's ALLOWED_ORIGINS lists the app) frames arrive as they are written; through
// Capacitor's native HTTP the body arrives whole and is parsed the same way.
export function parseSseBlock(block) {
  const payload = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
  if (!payload) return { skip: true };
  if (payload === '[DONE]') return { done: true };
  try { return { frame: JSON.parse(payload) }; } catch { return { skip: true }; }
}

export async function* readSseFrames(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = (await response.text()).replace(/\r\n/g, '\n');
    for (const block of text.split('\n\n')) {
      if (signal?.aborted) return;
      const r = parseSseBlock(block);
      if (r.done) return;
      if (r.frame) yield r.frame;
    }
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const stop = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal?.aborted) return;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let i = buffer.indexOf('\n\n');
      while (i !== -1) {
        const r = parseSseBlock(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
        if (r.done) return;
        if (r.frame) yield r.frame;
        i = buffer.indexOf('\n\n');
      }
      if (done) {
        const r = parseSseBlock(buffer);
        if (r.frame) yield r.frame;
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    reader.cancel().catch(() => {});
  }
}
