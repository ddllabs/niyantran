import { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle, X } from 'lucide-react';
import { createDictation } from './dictation.js';
import { observeRecording, paintRecording } from './dictationWaveform.js';
import './dictation.css';

export default function DictationButton({ onTranscript, onActiveChange, disabled = false, contextKey, lang = 'en' }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const session = useRef(null), canvas = useRef(null), latestSecond = useRef(-1);
  const idleButton = useRef(null), cancelButton = useRef(null);
  const receive = useRef(onTranscript), activeChange = useRef(onActiveChange);
  const scope = useRef({ contextKey, disabled });
  scope.current = { contextKey, disabled };
  receive.current = onTranscript; activeChange.current = onActiveChange;
  useEffect(() => {
    let live = true;
    const current = createDictation({ onState: next => {
      if (!live) return;
      setState(next); activeChange.current?.(['recording', 'requesting', 'transcribing'].includes(next));
    }, onError: setError, onAudio: stream => {
      const history = []; latestSecond.current = -1;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      return observeRecording(stream, ({ level, seconds: elapsed }) => {
        if (!live) return;
        if (latestSecond.current !== elapsed) { latestSecond.current = elapsed; setSeconds(elapsed); }
        paintRecording(canvas.current, history, level, reduced.matches);
      });
    }, onTranscript: text => {
      if (scope.current.contextKey === contextKey && !scope.current.disabled) receive.current(text);
    } });
    session.current = current; setState('idle'); setError('');
    return () => { live = false; current.cancel(); session.current = null; activeChange.current?.(false); };
  }, [contextKey, disabled]);
  const recording = state === 'recording';
  const waiting = state === 'requesting' || state === 'transcribing';
  const hi = lang === 'hi';
  useEffect(() => { if (state === 'requesting') cancelButton.current?.focus(); }, [state]);
  const label = state === 'requesting' ? (hi ? 'माइक्रोफ़ोन की अनुमति दें' : 'Allow microphone access')
    : (hi ? 'लिप्यंतरण जारी…' : 'Transcribing…');
  return <div className="dictation-control">
    {recording || waiting ? <div className="dictation-strip" role="group" aria-label={hi ? 'बोलकर लिखें' : 'Dictation controls'}>
      <button ref={cancelButton} type="button" className="dictation-button" aria-label={hi ? 'रिकॉर्डिंग रद्द करें' : 'Cancel dictation'} title={hi ? 'रद्द करें' : 'Cancel'}
        onClick={() => { session.current?.cancel(); setError(''); requestAnimationFrame(() => idleButton.current?.focus()); }}><X size={16} /></button>
      {recording ? <>
        <span className="dictation-dot" aria-hidden="true" />
        <span className="dictation-recording-label" role="status">{hi ? 'रिकॉर्डिंग' : 'Recording'}</span>
        <canvas ref={canvas} className="dictation-waveform" width={192} height={24} aria-hidden="true" />
        <span className="dictation-time" aria-label={hi ? 'बीता समय' : 'Elapsed recording time'}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        <button type="button" className="dictation-button dictation-stop" aria-label={hi ? 'रिकॉर्डिंग रोकें' : 'Stop recording'} title={hi ? 'रोकें और लिखें' : 'Stop and transcribe'}
          onClick={() => session.current?.stop()}><Square size={13} fill="currentColor" /></button>
      </> : <><LoaderCircle size={16} className="dictation-spinner" aria-hidden="true" /><span className="dictation-progress" role="status">{label}</span></>}
    </div> : <button ref={idleButton} type="button" className="dictation-button" disabled={disabled}
      aria-label={hi ? 'बोलकर लिखें' : 'Dictate text'} title={hi ? 'बोलकर लिखें' : 'Dictate text'}
      onClick={() => { setError(''); setSeconds(0); session.current?.start(); }}><Mic size={16} /></button>}
    {error && <span className="dictation-status error" role="alert">{error}</span>}
  </div>;
}
