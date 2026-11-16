import { describe, expect, it, vi } from 'vitest';
import { createTranscriber } from './transcriber.js';

describe('createTranscriber', () => {
  const wav = new Blob([new Uint8Array(4)], { type: 'audio/wav' });

  it('sends the piece to the client and returns { seq, text, secondsLeft }', async () => {
    const client = { transcribe: vi.fn(async () => ({ seq: 4, text: 'नमस्कार', seconds_left: 241 })) };
    const t = createTranscriber(client);
    const out = await t.transcribe({ seq: 4, wav, silent: false }, 'sess-1');
    expect(out).toEqual({ seq: 4, text: 'नमस्कार', secondsLeft: 241 });
    expect(client.transcribe).toHaveBeenCalledWith({ session_id: 'sess-1', seq: 4, file: wav, signal: undefined });
  });

  it('still sends a silent piece, so the server counts it as activity', async () => {
    const client = { transcribe: vi.fn(async () => ({ seq: 1, text: '', seconds_left: 100 })) };
    const out = await createTranscriber(client).transcribe({ seq: 1, wav, silent: true }, 's');
    expect(client.transcribe).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ seq: 1, text: '', secondsLeft: 100 });
  });

  it('turns a missing or non-string text into an empty string', async () => {
    const client = { transcribe: async () => ({ seq: 2, seconds_left: 5 }) };
    expect((await createTranscriber(client).transcribe({ seq: 2, wav }, 's')).text).toBe('');
  });

  it('passes errors and the abort signal through', async () => {
    const boom = new Error('x');
    const client = { transcribe: vi.fn(async () => { throw boom; }) };
    const ctl = new AbortController();
    await expect(createTranscriber(client).transcribe({ seq: 0, wav }, 's', { signal: ctl.signal })).rejects.toBe(boom);
    expect(client.transcribe.mock.calls[0][0].signal).toBe(ctl.signal);
  });
});
