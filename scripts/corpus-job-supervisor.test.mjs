import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import * as supervisor from './corpus-job-supervisor.mjs';
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corpus-job-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('a live job lock prevents a second worker',t=>{const lock=path.join(temp(t),'job.lock');const release=supervisor.acquireLock(lock);assert.throws(()=>supervisor.acquireLock(lock),/active/);release();assert.equal(fs.existsSync(lock),false);});
test('an exact dead local owner lock can be recovered',t=>{const lock=path.join(temp(t),'job.lock');fs.writeFileSync(lock,JSON.stringify({pid:123,host:os.hostname(),token:'old'}));const release=supervisor.acquireLock(lock,pid=>{if(pid===123)throw Object.assign(Error('dead'),{code:'ESRCH'});});assert.equal(JSON.parse(fs.readFileSync(lock)).pid,process.pid);release();});
test('a lock from another host or with unknown owner cannot be removed',t=>{const lock=path.join(temp(t),'job.lock');fs.writeFileSync(lock,JSON.stringify({pid:123,host:'other-host',token:'old'}));assert.throws(()=>supervisor.acquireLock(lock),/owner/);assert.equal(JSON.parse(fs.readFileSync(lock)).host,'other-host');});
test('release cannot delete a replacement lock',t=>{const lock=path.join(temp(t),'job.lock');const release=supervisor.acquireLock(lock);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,host:os.hostname(),token:'replacement'}));release();assert.equal(JSON.parse(fs.readFileSync(lock)).token,'replacement');});
test('supervisor restarts a killed worker and stops on completion',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>++runs===1?{code:null,signal:'SIGKILL'}:{code:0},readState:()=>({status:'running'}),wait:async()=>{},maxRestarts:2});assert.equal(runs,2);assert.equal(result,'complete');});
test('held state is terminal even after process death',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>{runs++;return {code:null,signal:'SIGKILL'};},readState:()=>({status:runs?'held':'running'}),wait:async()=>{},maxRestarts:2});assert.equal(result,'held');assert.equal(runs,1);});
test('maintenance pause stops the supervisor before restart',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>{runs++;return {code:0};},readState:()=>({status:'maintenance_paused'}),wait:async()=>{}});assert.equal(result,'maintenance_paused');assert.equal(runs,0);});
test('a worker maintenance pause is not reported as complete',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>{runs++;return {code:0};},readState:()=>({status:runs?'maintenance_paused':'running'}),wait:async()=>{}});assert.equal(result,'maintenance_paused');assert.equal(runs,1);});
test('retry time is respected without clearing a health pause',async()=>{let runs=0,wake=0;const result=await supervisor.supervise({run:async()=>++runs===1?{code:75}:{code:2},readState:()=>runs===0?{status:'running'}:runs===1?{status:'retry_wait',wake_at:1000}:{status:'health_paused'},now:()=>100,wait:async ms=>{wake+=ms;},maxRestarts:2});assert.equal(wake,900);assert.equal(result,'health_paused');});
test('unknown repeated crashes are bounded',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>{runs++;return {code:1};},readState:()=>({status:'running'}),wait:async()=>{},maxRestarts:2});assert.equal(result,'restart_limit');assert.equal(runs,3);});
test('terminal worker failure cannot be reported as a previous successful dry run',async()=>{let runs=0;const result=await supervisor.supervise({run:async()=>{runs++;return {code:2};},readState:()=>({status:'dry_run_complete'}),wait:async()=>{},maxRestarts:2});assert.equal(result,'held');assert.equal(runs,1);});
test('real killed child leaves a recoverable owner lock without affecting another process',async t=>{
 const lock=path.join(temp(t),'worker.lock');const module=new URL('./corpus-job-supervisor.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {acquireLock} from ${JSON.stringify(module)};acquireLock(process.argv[1]);console.log('ready');setInterval(()=>{},1000);`,lock],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==null)reject(Error('child exited before ready'));});});
 assert.throws(()=>supervisor.acquireLock(lock),/active/);
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 const release=supervisor.acquireLock(lock);assert.equal(JSON.parse(fs.readFileSync(lock)).pid,process.pid);release();
});
