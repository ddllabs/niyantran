// F344 T5: browser capture of the current tab's audio for the live fact-check.
//
// The user shares the tab through getDisplayMedia (the options proven in gates
// G1 and G2a). The video track is stopped at once; the audio is resampled to
// 16 kHz mono, cut into pieces (pieces.js) and each piece is handed to onPiece
// as a WAV Blob. Every browser API is injected through `deps`, so the logic is
// tested with fakes. What only a real Chrome can show is listed in the task
// report, not claimed here.
//
// Tap: an AudioWorklet loaded from a Blob URL is preferred (it runs off the main
// thread). A page whose content security policy blocks blob: worklets falls
// back to a ScriptProcessorNode, deprecated but available in Chromium; it is a
// documented fallback, not a second design.
// Resampling: the AudioContext is created at 16 kHz, which Chromium honours by
// resampling the stream itself. If a browser ignores the request, a linear
// resampler (createResampler) takes over; it has no low-pass filter, which is
// acceptable for speech recognition at 16 kHz.
import { RATE, createPieceCutter, encodeWav, isSilent } from './pieces.js';

export const DISPLAY_MEDIA_OPTIONS = Object.freeze({
  video: true,
  audio: Object.freeze({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }),
  preferCurrentTab: true,
  selfBrowserSurface: 'include',
  systemAudio: 'include',
});

/** reason: unsupported | denied | no_audio | failed */
export class CaptureError extends Error {
  constructor(reason, message) {
    super(message || `capture ${reason}`);
    this.name = 'CaptureError';
    this.reason = reason;
  }
}

/** Chromium on a desktop, with screen-capture audio and Web Audio. */
export function isSupported(env = globalThis) {
  const nav = env?.navigator;
  if (!nav || typeof nav.mediaDevices?.getDisplayMedia !== 'function') return false;
  if (typeof (env.AudioContext || env.webkitAudioContext) !== 'function') return false;
  const data = nav.userAgentData;
  if (data) {
    if (data.mobile) return false;
    return (data.brands || []).some(b => /chromium/i.test(b.brand));
  }
  const ua = String(nav.userAgent || '');
  if (/Android|Mobile|iPhone|iPad|iPod|CriOS|FxiOS/i.test(ua)) return false;
  return /\bChrome\/|\bChromium\//.test(ua) && !/Firefox\//.test(ua);
}

/** Linear-interpolation resampler that keeps its position across frames. */
export function createResampler(fromRate, toRate = RATE) {
  if (fromRate === toRate) return frame => frame;
  const step = fromRate / toRate;
  let pos = 0;      // input position of the next output, relative to the frame start
  let prev = 0;     // last sample of the previous frame (index -1)
  return frame => {
    const n = frame.length;
    const out = [];
    const at = i => (i < 0 ? prev : frame[i]);
    while (Math.floor(pos) + 1 <= n - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      out.push(at(i) * (1 - frac) + at(i + 1) * frac);
      pos += step;
    }
    if (n) { pos -= n; prev = frame[n - 1]; }
    return Float32Array.from(out);
  };
}

const WORKLET_SOURCE = `
class FcTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('fc-tap', FcTap);
`;

function resolveDeps(deps = {}) {
  const g = globalThis;
  return {
    mediaDevices: g.navigator?.mediaDevices,
    AudioContext: g.AudioContext || g.webkitAudioContext,
    AudioWorkletNode: g.AudioWorkletNode,
    URL: g.URL,
    Blob: g.Blob,
    ...deps,
  };
}

/**
 * Starts capture and resolves, once the user has chosen a tab and audio is
 * flowing into the cutter, with { stop }. Rejects with a CaptureError.
 * onPiece({ seq, startMs, endMs, overlapMs, endPauseMs, silent, wav: Blob })
 * onEnded('stopped' | 'ended') fires exactly once, after the last piece.
 * onError(error) reports a failure while running (for example in onPiece).
 */
export async function startCapture({ onPiece = () => {}, onEnded = () => {}, onError = () => {}, deps } = {}) {
  const d = resolveDeps(deps);
  if (typeof d.mediaDevices?.getDisplayMedia !== 'function' || typeof d.AudioContext !== 'function') {
    throw new CaptureError('unsupported');
  }
  let stream;
  try {
    stream = await d.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
  } catch (error) {
    throw new CaptureError(error?.name === 'NotAllowedError' ? 'denied' : 'failed');
  }
  // Only the sound is wanted: stop the picture at once.
  stream.getVideoTracks().forEach(track => track.stop());
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach(track => track.stop());
    throw new CaptureError('no_audio', 'The shared tab has no audio. Share a tab and tick "Also share tab audio".');
  }

  const cutter = createPieceCutter();
  let ctx = null;
  let source = null;
  let tap = null;
  let sink = null;
  let resample = frame => frame;
  let finishing = null;
  let released = false;

  const emit = piece => {
    try {
      onPiece({
        seq: piece.seq, startMs: piece.startMs, endMs: piece.endMs, overlapMs: piece.overlapMs,
        endPauseMs: piece.endPauseMs, silent: isSilent(piece.samples),
        wav: new d.Blob([encodeWav(piece.samples, RATE)], { type: 'audio/wav' }),
      });
    } catch (error) { onError(error); }
  };
  const onFrame = frame => {
    if (finishing) return;
    for (const piece of cutter.push(resample(frame))) emit(piece);
  };
  const onTrackEnded = () => { void finish('ended', { flush: true }); };

  async function release() {
    if (released) return;
    released = true;
    for (const track of audioTracks) track.removeEventListener?.('ended', onTrackEnded);
    if (tap) { if (tap.port) tap.port.onmessage = null; tap.onaudioprocess = null; }
    for (const node of [source, tap, sink]) { try { node?.disconnect(); } catch { /* already disconnected */ } }
    stream.getTracks().forEach(track => track.stop());
    try { await ctx?.close(); } catch { /* already closed */ }
  }

  function finish(reason, { flush = true } = {}) {
    if (!finishing) {
      finishing = (async () => {
        if (flush) for (const piece of cutter.flush()) emit(piece);
        await release();
        onEnded(reason);
      })();
    }
    return finishing;
  }

  // Listen before any further await, so a share that stops during setup is seen.
  for (const track of audioTracks) track.addEventListener('ended', onTrackEnded);
  const handle = { stop: options => finish('stopped', options) };

  try {
    ctx = new d.AudioContext({ sampleRate: RATE });
    if (ctx.sampleRate && ctx.sampleRate !== RATE) resample = createResampler(ctx.sampleRate, RATE);
    try { await ctx.resume?.(); } catch { /* the first frames will start it */ }
    if (finishing) return handle; // the share ended while the context started
    source = ctx.createMediaStreamSource(stream);
    sink = ctx.createGain();
    sink.gain.value = 0; // keeps the graph pulled without playing the tab twice

    if (typeof d.AudioWorkletNode === 'function' && ctx.audioWorklet && d.URL?.createObjectURL) {
      const url = d.URL.createObjectURL(new d.Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        if (finishing) return handle;
        tap = new d.AudioWorkletNode(ctx, 'fc-tap', {
          numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
        });
        tap.port.onmessage = event => onFrame(event.data);
      } catch {
        tap = null; // blocked by the page's content security policy, or unsupported
      } finally {
        d.URL.revokeObjectURL?.(url);
      }
    }
    if (!tap) {
      tap = ctx.createScriptProcessor(4096, 1, 1);
      tap.onaudioprocess = event => {
        const input = event.inputBuffer;
        const mono = new Float32Array(input.length);
        for (let c = 0; c < input.numberOfChannels; c++) {
          const data = input.getChannelData(c);
          for (let i = 0; i < mono.length; i++) mono[i] += data[i] / input.numberOfChannels;
        }
        onFrame(mono);
      };
    }
    if (finishing) return handle;
    source.connect(tap);
    tap.connect(sink);
    sink.connect(ctx.destination);
    // A share that stopped without an event reaching us.
    if (audioTracks.some(track => track.readyState === 'ended')) void finish('ended');
  } catch (error) {
    if (finishing) return handle;
    finishing = Promise.resolve(); // a failed start never fires onEnded
    await release();
    throw new CaptureError('failed', error?.message);
  }

  return handle;
}
