// Explicitly invoked process supervision only. No OS service is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validMaintenanceAck} from './corpus-capacity.mjs';
export function atomicSave(file,value){
  const tmp=file+'.tmp-'+randomUUID();const fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
export function acquireLock(file,checkPid=pid=>process.kill(pid,0)){
  // Every acquirer uses the short recovery gate: no stale-reclaim race with a
  // new live owner. An abandoned gate is fail-closed and needs manual review.
  const gate=file+'.gate';let gateFd;
  try{gateFd=fs.openSync(gate,'wx',0o600);fs.writeFileSync(gateFd,String(process.pid));}catch{throw Error('lock recovery gate active or abandoned; inspect owner');}
  const owner={pid:process.pid,host:os.hostname(),token:randomUUID(),started_at:new Date().toISOString()};
  try{
    if(fs.existsSync(file)){
      const previous=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!Number.isSafeInteger(previous.pid)||previous.pid<=0||previous.host!==owner.host||!previous.token)throw Error('unknown lock owner; inspect before recovery');
      try{checkPid(previous.pid);throw Error('job lock active: '+previous.pid);}catch(error){if(error.code!=='ESRCH')throw error;}
      fs.unlinkSync(file);
    }
    const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }finally{fs.closeSync(gateFd);fs.unlinkSync(gate);}
  return ()=>{if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).token===owner.token)fs.unlinkSync(file);};
}
export async function supervise({run,readState,wait,now=Date.now,maxRestarts=5}){
  for(let restarts=0;;restarts++){
    const before=readState();if(['held','health_paused','maintenance_paused','complete'].includes(before?.status))return before.status;
    if(before?.status==='retry_wait')await wait(Math.max(0,before.wake_at-now()));
    const result=await run();const state=readState();
    if(['held','health_paused','maintenance_paused','complete'].includes(state?.status))return state.status;
    if(result.code===0)return 'complete';
    if(result.code===2)return 'held';
    if(restarts>=maxRestarts)return 'restart_limit';
    if(result.code!==75)await wait(Math.min(120000,5000*2**restarts));
  }
}
async function main(){
  const [mode,manifest,sha]=process.argv.slice(2);
  if(!['--dry-run','--execute'].includes(mode)||!manifest||!sha)throw Error('usage: corpus-job-supervisor.mjs --dry-run|--execute <manifest-file> <manifest-sha256>');
  const checkpoint=manifest+'.checkpoint.json';const release=acquireLock(path.join(path.dirname(manifest),'supervisor.lock'));
  let child;const stop=()=>{child?.kill('SIGTERM');process.exitCode=2;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await supervise({
      run:()=>new Promise((resolve,reject)=>{if(process.exitCode===2)return resolve({code:2});child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./corpus-stage-job.mjs',import.meta.url)),mode,manifest,sha],{stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}),
      readState:()=>{
        const state=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint)):null;
        const ackFile=manifest+'.maintenance-ack.json';
        if(state?.status==='maintenance_paused'&&fs.existsSync(ackFile)&&validMaintenanceAck(JSON.parse(fs.readFileSync(ackFile)),state.maintenance,sha))return {...state,status:'maintenance_acknowledged'};
        return state;
      },
      wait:async ms=>{const until=Date.now()+ms;while(Date.now()<until&&process.exitCode!==2)await new Promise(r=>setTimeout(r,Math.min(1000,until-Date.now())));},
    });
    console.log('Supervisor stopped: '+result);if(!['complete','dry_run_complete'].includes(result))process.exitCode=2;
  }finally{release();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=2;});
