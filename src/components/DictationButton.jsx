import { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import { createDictation } from './dictation.js';
import './dictation.css';

export default function DictationButton({ onTranscript, disabled = false, contextKey, lang = 'en' }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const session = useRef(null);
  const receive = useRef(onTranscript);
  const scope = useRef({ contextKey, disabled });
  scope.current = { contextKey, disabled };
  receive.current = onTranscript;
  useEffect(() => {
    const current = createDictation({ onState: setState, onError: setError, onTranscript: text => {
      if (scope.current.contextKey === contextKey && !scope.current.disabled) receive.current(text);
    } });
    session.current = current; setState('idle'); setError('');
    return () => { current.cancel(); session.current = null; };
  }, [contextKey, disabled]);
  const recording = state === 'recording';
  const waiting = state === 'requesting' || state === 'transcribing';
  const label = recording ? (lang === 'hi' ? 'रिकॉर्डिंग रोकें' : 'Stop recording')
    : waiting ? (state === 'requesting' ? 'Allow microphone access' : 'Transcribing…')
    : (lang === 'hi' ? 'बोलकर लिखें' : 'Dictate text');
  return <div className="dictation-control">
    <button type="button" className={`dictation-button${recording ? ' recording' : ''}`}
      disabled={disabled || waiting} aria-label={label} title={label} aria-pressed={recording}
      onClick={() => {
        setError('');
        if (recording) session.current?.stop(); else session.current?.start();
      }}>
      {recording ? <Square size={13} fill="currentColor" /> : waiting ? <LoaderCircle size={16} className="dictation-spinner" /> : <Mic size={16} />}
    </button>
    {(recording || waiting || error) && <span className={`dictation-status${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
      {error || (recording ? 'Recording · click to stop' : label)}
    </span>}
  </div>;
}
