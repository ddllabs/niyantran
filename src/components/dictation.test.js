import { expect, it, vi } from 'vitest';
import { createDictation } from './dictation.js';
function setup(transcribe = async () => 'Recognized speech') {
 const track={stop:vi.fn()}; const states=[]; const receive=vi.fn();
 class Recorder {
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}
 }
 const media={getUserMedia:vi.fn(async()=>({getTracks:()=>[track]}))};
 const session=createDictation({media,Recorder,transcribe,onState:s=>states.push(s),onTranscript:receive});
 return {session,track,states,receive,media};
}
it('records only after activation, releases microphone and inserts transcript after stop',async()=>{
 const s=setup();expect(s.media.getUserMedia).not.toHaveBeenCalled();await s.session.start();
 expect(s.states).toContain('recording');s.session.stop();await new Promise(r=>setTimeout(r,0));
 expect(s.track.stop).toHaveBeenCalled();expect(s.receive).toHaveBeenCalledWith('Recognized speech');expect(s.states.at(-1)).toBe('idle');
});
it('cancels a pending transcript and never inserts it in a new context',async()=>{
 let resolve;const s=setup(()=>new Promise(r=>{resolve=r;}));await s.session.start();s.session.stop();s.session.cancel();resolve('Late speech');
 await new Promise(r=>setTimeout(r,0));expect(s.receive).not.toHaveBeenCalled();expect(s.track.stop).toHaveBeenCalled();
});
it('releases a microphone permission result that arrives after cancellation',async()=>{
 let resolve;const stop=vi.fn();const media={getUserMedia:()=>new Promise(r=>{resolve=r;})};
 const s=createDictation({media,Recorder:class{},onState:()=>{},onTranscript:()=>{},transcribe:async()=>''});
 const pending=s.start();s.cancel();resolve({getTracks:()=>[{stop}]});await pending;expect(stop).toHaveBeenCalled();
});
it('reports denied permission and keeps the microphone released on failure',async()=>{
 const onError=vi.fn(); const onState=vi.fn();
 const s=createDictation({media:{getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}},Recorder:class{},onState,onError,onTranscript:vi.fn()});
 await s.start();expect(onError).toHaveBeenCalledWith(expect.stringContaining('Allow access'));expect(onState).toHaveBeenLastCalledWith('error');
});
