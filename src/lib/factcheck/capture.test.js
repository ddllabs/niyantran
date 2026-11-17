// F344 T5: browser capture with injected fakes. Nothing here touches a real
// browser; what only a real Chrome can prove is listed in the task report.
import { describe, expect, it, vi } from 'vitest';
import { CaptureError, createResampler, isSupported, startCapture } from './capture.js';

class FakeTrack {
  constructor(kind) { this.kind = kind; this.stopped = false; this.listeners = {}; this.readyState = 'live'; }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  stop() { this.stopped = true; this.readyState = 'ended'; }
  fire(type) { for (const fn of [...(this.listeners[type] || [])]) fn({ type }); }
  get listenerCount() { return Object.values(this.listeners).reduce((n, s) => n + s.size, 0); }
}
function fakeStream({ audio = 1, video = 1 } = {}) {
  const tracks = [
    ...Array.from({ length: video }, () => new FakeTrack('video')),
    ...Array.from({ length: audio }, () => new FakeTrack('audio')),
  ];
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
  };
}

function setup({ stream = fakeStream(), sampleRate = 16000, worklet = true, scriptProcessor = true, getDisplayMedia, duringSetup } = {}) {
  const log = { contexts: [], nodes: [], processors: [], closed: 0, urls: [], revoked: [] };
  class FakeNode {
    constructor() { this.connected = []; this.disconnected = false; }
    connect(to) { this.connected.push(to); return to; }
    disconnect() { this.disconnected = true; }
  }
  class FakeAudioContext {
    constructor(options) {
      this.options = options; this.sampleRate = sampleRate; this.state = 'running';
      this.destination = new FakeNode(); this.closed = false;
      this.audioWorklet = { addModule: vi.fn(async () => { duringSetup?.(); if (!worklet) throw new Error('blocked by CSP'); }) };
      log.contexts.push(this);
    }
    createMediaStreamSource(s) { this.source = Object.assign(new FakeNode(), { stream: s }); return this.source; }
    createGain() { const n = new FakeNode(); n.gain = { value: 1 }; return n; }
    createScriptProcessor(size) {
      if (!scriptProcessor) throw new Error('no script processor');
      const n = new FakeNode(); n.size = size; log.processors.push(n); return n;
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; log.closed++; return Promise.resolve(); }
  }
  class FakeWorkletNode extends FakeNode {
    constructor(ctx, name, options) { super(); this.ctx = ctx; this.name = name; this.options = options; this.port = { onmessage: null }; log.nodes.push(this); }
  }
  const gdm = getDisplayMedia || vi.fn(async () => stream);
  const deps = {
    mediaDevices: { getDisplayMedia: gdm },
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
    URL: { createObjectURL: () => { log.urls.push('blob:x'); return 'blob:x'; }, revokeObjectURL: u => log.revoked.push(u) },
  };
  const events = { pieces: [], ended: [], errors: [] };
  const handlers = {
    onPiece: p => events.pieces.push(p),
    onEnded: reason => events.ended.push(reason),
    onError: e => events.errors.push(e),
  };
  return { stream, deps, log, events, handlers, gdm };
}
const frame = (n, v = 0.3) => Float32Array.from({ length: n }, (_, i) => v * Math.sin(i / 7));
function feed(port, seconds, make = frame, rate = 16000) {
  const total = seconds * rate;
  for (let i = 0; i < total; i += 2048) port.onmessage({ data: make(Math.min(2048, total - i)) });
}

describe('startCapture setup', () => {
  it('asks for the current tab with audio and processing off, the options proven in G1/G2a', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    expect(t.gdm).toHaveBeenCalledWith({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include',
    });
  });

  it('stops the video track immediately and keeps the audio track', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    const [video, audio] = t.stream.tracks;
    expect(video.stopped).toBe(true);
    expect(audio.stopped).toBe(false);
  });

  it('creates a 16 kHz audio context and prefers an AudioWorklet', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    expect(t.log.contexts[0].options).toEqual({ sampleRate: 16000 });
    expect(t.log.contexts[0].audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(t.log.nodes).toHaveLength(1);
    expect(t.log.processors).toHaveLength(0);
    expect(t.log.revoked).toEqual(['blob:x']);
    // the node feeds a muted sink, so the tab audio is not played a second time
    expect(t.log.contexts[0].source.connected).toContain(t.log.nodes[0]);
  });

  it('falls back to a ScriptProcessor when the worklet cannot load', async () => {
    const t = setup({ worklet: false });
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    expect(t.log.nodes).toHaveLength(0);
    expect(t.log.processors).toHaveLength(1);
    // two channels (0.2 and 0.4) are mixed to mono (0.3)
    const input = { numberOfChannels: 2, length: 16000, getChannelData: c => new Float32Array(16000).fill(c ? 0.4 : 0.2) };
    t.log.processors[0].onaudioprocess({ inputBuffer: input });
    await cap.stop();
    expect(t.events.pieces).toHaveLength(1);
    const view = new DataView(await t.events.pieces[0].wav.arrayBuffer());
    expect(view.getInt16(44, true)).toBeCloseTo(0.3 * 32767, -1);
  });

  it('fails clearly when the user shared something without audio, and releases it', async () => {
    const t = setup({ stream: fakeStream({ audio: 0 }) });
    const err = await startCapture({ ...t.handlers, deps: t.deps }).catch(e => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect(err.reason).toBe('no_audio');
    expect(t.stream.tracks.every(tr => tr.stopped)).toBe(true);
    expect(t.log.contexts).toHaveLength(0);
    expect(t.events.ended).toEqual([]);
  });

  it('maps a refused prompt to reason "denied"', async () => {
    const t = setup({ getDisplayMedia: async () => { throw new DOMException('no', 'NotAllowedError'); } });
    const err = await startCapture({ ...t.handlers, deps: t.deps }).catch(e => e);
    expect(err).toMatchObject({ name: 'CaptureError', reason: 'denied' });
  });

  it('maps any other getDisplayMedia failure to reason "failed"', async () => {
    const t = setup({ getDisplayMedia: async () => { throw new Error('boom'); } });
    expect(await startCapture({ ...t.handlers, deps: t.deps }).catch(e => e)).toMatchObject({ reason: 'failed' });
  });

  it('releases the tracks and the context when neither worklet nor script processor works', async () => {
    const t = setup({ worklet: false, scriptProcessor: false });
    const err = await startCapture({ ...t.handlers, deps: t.deps }).catch(e => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect(err.reason).toBe('failed');
    expect(t.stream.tracks.every(tr => tr.stopped)).toBe(true);
    expect(t.log.closed).toBe(1);
  });

  it('is unsupported without the injected browser pieces', async () => {
    const err = await startCapture({ onPiece() {}, onEnded() {}, onError() {}, deps: {} }).catch(e => e);
    expect(err).toMatchObject({ name: 'CaptureError', reason: 'unsupported' });
  });
});

describe('a share that stops during setup is not missed', () => {
  it('the track ending while the worklet loads fires onEnded("ended") once and releases everything', async () => {
    const stream = fakeStream();
    const t = setup({ stream, duringSetup: () => stream.getAudioTracks()[0].fire('ended') });
    await startCapture({ ...t.handlers, deps: t.deps });
    await vi.waitFor(() => expect(t.events.ended).toEqual(['ended']));
    expect(stream.tracks.every(tr => tr.stopped)).toBe(true);
    expect(t.log.closed).toBe(1);
  });

  it('a track already ended when setup finishes (no event seen) is treated as ended', async () => {
    const stream = fakeStream();
    const t = setup({ stream, duringSetup: () => { stream.getAudioTracks()[0].readyState = 'ended'; } });
    await startCapture({ ...t.handlers, deps: t.deps });
    await vi.waitFor(() => expect(t.events.ended).toEqual(['ended']));
    expect(t.log.closed).toBe(1);
  });
});

describe('startCapture running', () => {
  it('emits pieces as { seq, startMs, endMs, overlapMs, silent, wav }', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 26);
    expect(t.events.pieces.map(p => [p.seq, p.startMs, p.endMs, p.overlapMs])).toEqual([
      [0, 0, 12000, 0], [1, 11000, 24000, 1000],
    ]);
    const p = t.events.pieces[0];
    expect(p.silent).toBe(false);
    expect(p.wav).toBeInstanceOf(Blob);
    expect(p.wav.type).toBe('audio/wav');
    expect(p.wav.size).toBe(44 + 12 * 16000 * 2);
    expect(p).not.toHaveProperty('samples');
  });

  it('passes heldMs (audio held after the cut) with each piece', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 26);
    for (const p of t.events.pieces) {
      expect(p.heldMs).toBeGreaterThanOrEqual(0);
      expect(p.heldMs).toBeLessThan(130);
    }
  });

  it('marks a piece of silence as silent but still emits it', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 13, n => new Float32Array(n));
    expect(t.events.pieces).toHaveLength(1);
    expect(t.events.pieces[0].silent).toBe(true);
  });

  it('resamples when the context ignores the 16 kHz request', async () => {
    const t = setup({ sampleRate: 48000 });
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 3, frame, 48000);
    await cap.stop();
    expect(t.events.pieces).toHaveLength(1);
    expect(Math.abs(t.events.pieces[0].endMs - 3000)).toBeLessThanOrEqual(5);
  });

  it('reports an error thrown by onPiece through onError and keeps capturing', async () => {
    const t = setup();
    const onPiece = vi.fn(() => { throw new Error('handler broke'); });
    await startCapture({ ...t.handlers, onPiece, deps: t.deps });
    expect(() => feed(t.log.nodes[0].port, 26)).not.toThrow();
    expect(onPiece).toHaveBeenCalledTimes(2);
    expect(t.events.errors).toHaveLength(2);
  });
});

describe('startCapture exit paths', () => {
  function expectReleased(t) {
    expect(t.stream.tracks.every(tr => tr.stopped)).toBe(true);
    expect(t.stream.tracks.every(tr => tr.listenerCount === 0)).toBe(true);
    expect(t.log.closed).toBe(1);
    expect(t.log.nodes[0].disconnected).toBe(true);
    expect(t.log.nodes[0].port.onmessage).toBe(null);
  }

  it('stop() sends the final partial piece, fires onEnded("stopped") once and releases everything', async () => {
    const t = setup();
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 5);
    await cap.stop();
    expect(t.events.pieces.map(p => [p.startMs, p.endMs])).toEqual([[0, 5000]]);
    expect(t.events.ended).toEqual(['stopped']);
    expectReleased(t);
  });

  it('stop() twice releases once and fires onEnded once', async () => {
    const t = setup();
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    await Promise.all([cap.stop(), cap.stop()]);
    await cap.stop();
    expect(t.events.ended).toEqual(['stopped']);
    expect(t.log.closed).toBe(1);
  });

  it('stop({ flush: false }) discards the unsent tail', async () => {
    const t = setup();
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 5);
    await cap.stop({ flush: false });
    expect(t.events.pieces).toEqual([]);
    expect(t.events.ended).toEqual(['stopped']);
  });

  it('the browser ending the share fires onEnded("ended"), flushes, and releases everything', async () => {
    const t = setup();
    await startCapture({ ...t.handlers, deps: t.deps });
    feed(t.log.nodes[0].port, 4);
    t.stream.getAudioTracks()[0].fire('ended');
    await vi.waitFor(() => expect(t.events.ended).toEqual(['ended']));
    expect(t.events.ended).toEqual(['ended']);
    expect(t.events.pieces.map(p => p.endMs)).toEqual([4000]);
    expectReleased(t);
  });

  it('ignores audio frames that arrive after the end', async () => {
    const t = setup();
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    const { port } = t.log.nodes[0];
    await cap.stop();
    expect(port.onmessage).toBe(null);
    expect(t.events.pieces).toEqual([]);
  });

  it('ended after stop does not fire onEnded a second time', async () => {
    const t = setup();
    const cap = await startCapture({ ...t.handlers, deps: t.deps });
    const audio = t.stream.getAudioTracks()[0];
    await cap.stop();
    audio.fire('ended');
    await Promise.resolve();
    expect(t.events.ended).toEqual(['stopped']);
  });
});

describe('createResampler', () => {
  it('passes samples through at the same rate', () => {
    const f = Float32Array.of(1, 2, 3);
    expect(createResampler(16000)(f)).toBe(f);
  });
  it('downsamples 48 kHz to 16 kHz across frame boundaries without a gap', () => {
    const r = createResampler(48000);
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i);
    const out = [];
    for (let i = 0; i < ramp.length; i += 1000) out.push(...r(ramp.subarray(i, i + 1000)));
    expect(Math.abs(out.length - 1600)).toBeLessThanOrEqual(1);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(i * 3, 3);
  });
});

describe('isSupported', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
  const env = (nav = {}, extra = {}) => ({
    navigator: { mediaDevices: { getDisplayMedia() {} }, userAgent: chrome, ...nav },
    AudioContext: class {}, ...extra,
  });
  it('is true on desktop Chromium, by user-agent data', () => {
    expect(isSupported(env({ userAgentData: { mobile: false, brands: [{ brand: 'Chromium', version: '157' }] } }))).toBe(true);
  });
  it('is true on desktop Chrome by user-agent string when userAgentData is missing', () => {
    expect(isSupported(env())).toBe(true);
  });
  it('is false on a Chromium phone (userAgentData.mobile)', () => {
    expect(isSupported(env({ userAgentData: { mobile: true, brands: [{ brand: 'Chromium' }] } }))).toBe(false);
  });
  it('is false on Android Chrome by user-agent string', () => {
    expect(isSupported(env({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/157.0.0.0 Mobile Safari/537.36' }))).toBe(false);
  });
  it('is false on Firefox, Safari and iOS Chrome', () => {
    expect(isSupported(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:140.0) Gecko/20100101 Firefox/140.0' }))).toBe(false);
    expect(isSupported(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' }))).toBe(false);
    expect(isSupported(env({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/157.0.0.0 Mobile/15E148 Safari/604.1' }))).toBe(false);
  });
  it('is false when getDisplayMedia or AudioContext is missing, or there is no navigator', () => {
    expect(isSupported(env({ mediaDevices: {} }))).toBe(false);
    expect(isSupported(env({ mediaDevices: undefined }))).toBe(false);
    expect(isSupported(env({}, { AudioContext: undefined }))).toBe(false);
    expect(isSupported({})).toBe(false);
  });
});
