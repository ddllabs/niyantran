import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCapacityMetrics,capacityPressure,validMaintenanceAck} from './corpus-capacity.mjs';
const ref='vfgcppstyzjarlzyqdac';
function fixture(time=100,idle=90,user=10,available=50){const label=`supabase_project_ref="${ref}",service_type="db"`;return `node_time_seconds{${label}} ${time}\nnode_memory_MemTotal_bytes{${label}} 100\nnode_memory_MemAvailable_bytes{${label}} ${available}\nnode_cpu_seconds_total{${label},cpu="0",mode="idle"} ${idle}\nnode_cpu_seconds_total{${label},cpu="0",mode="user"} ${user}\nnode_disk_io_time_seconds_total{${label},device="data"} 0`;}
test('capacity rates reject missing, stale, wrong-project and reset samples',()=>{
 const a=parseCapacityMetrics(fixture(),ref,100000),b=parseCapacityMetrics(fixture(160,149,11),ref,160000);assert.equal(capacityPressure(a,b).bad,false);
 assert.throws(()=>parseCapacityMetrics('',ref,100000),/missing/);assert.throws(()=>parseCapacityMetrics(fixture(),ref,300000),/stale/);
 assert.throws(()=>parseCapacityMetrics(fixture(), 'other',100000),/missing/);assert.throws(()=>capacityPressure(b,a),/interval/);
 assert.throws(()=>capacityPressure(a,parseCapacityMetrics(fixture(160,1,1),ref,160000)),/reset/);
});
test('CPU, memory and disk pressure fail the pilot gate',()=>{
 const a=parseCapacityMetrics(fixture(),ref,100000);
 for(const raw of [fixture(160,100,60),fixture(160,149,11,14),fixture(160,149,11).replace('device="data"} 0','device="data"} 50')])assert.equal(capacityPressure(a,parseCapacityMetrics(raw,ref,160000)).bad,true);
});
test('maintenance acknowledgement binds exact progress, manifest and recent audit',()=>{
 const p={verified_documents:20,verified_chunks:1200},ack={...p,manifest_sha256:'sha',captured_at:100000,independent_audit_passed:true,analyze_counts_passed:true};
 assert.equal(validMaintenanceAck(ack,p,'sha',100001),true);
 for(const bad of [{verified_chunks:1199},{manifest_sha256:'other'},{independent_audit_passed:false},{analyze_counts_passed:false},{captured_at:100002}])assert.equal(validMaintenanceAck({...ack,...bad},p,'sha',100001),false);
 assert.equal(validMaintenanceAck(ack,p,'sha',2000000),false);
});
