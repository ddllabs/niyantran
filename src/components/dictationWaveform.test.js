import { expect, it, vi } from 'vitest';
import { observeRecording } from './dictationWaveform.js';
it('samples genuine input energy and elapsed time, then releases every analyser resource', () => {
 let next, time=0, amplitude=0;
 const analyser={fftSize:0,getFloatTimeDomainData:values=>values.fill(amplitude),disconnect:vi.fn()};
 const source={connect:vi.fn(),disconnect:vi.fn()}; const close=vi.fn(async()=>{});
 class Context {createMediaStreamSource(){return source;} createAnalyser(){return analyser;} resume(){return Promise.resolve();} close(){return close();}}
 const receive=vi.fn(), cancelFrame=vi.fn();
 const stop=observeRecording({},receive,{Context,frame:fn=>{next=fn;return 7;},cancelFrame,now:()=>time});
 next();expect(receive).toHaveBeenLastCalledWith({level:0,seconds:0});
 amplitude=.25;time=2200;next();expect(receive).toHaveBeenLastCalledWith({level:.25,seconds:2});
 stop();stop();expect(cancelFrame).toHaveBeenCalledWith(7);expect(close).toHaveBeenCalledTimes(1);expect(source.disconnect).toHaveBeenCalledTimes(1);
 const count=receive.mock.calls.length;next();expect(receive).toHaveBeenCalledTimes(count);
});
it('keeps elapsed time without fabricating audio activity if Web Audio is unavailable',()=>{
 let next;const receive=vi.fn();const stop=observeRecording({},receive,{Context:null,frame:fn=>{next=fn;return 1;},cancelFrame:()=>{},now:()=>100});
 next();expect(receive).toHaveBeenCalledWith({level:null,seconds:0});stop();
});
