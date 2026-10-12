// Only infrastructure counters are retained. No credentials or query text.
export function parseCapacityMetrics(text,project,now=Date.now()){
  const values=new Map();
  for(const line of text.split('\n')){
    const match=/^(node_[a-zA-Z_]+)\{([^}]+)\}\s+([0-9.eE+-]+)$/.exec(line);
    if(!match)continue;
    const labels=Object.fromEntries([...match[2].matchAll(/([a-z_]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    if(labels.supabase_project_ref!==project||labels.service_type!=='db')continue;
    const value=Number(match[3]);if(!Number.isFinite(value)||value<0)throw Error('invalid capacity metric');
    values.set(match[1]+'|'+(labels.cpu??'')+'|'+(labels.mode??'')+'|'+(labels.device??''),value);
  }
  const required=name=>{const value=values.get(name+'|||');if(value===undefined)throw Error('missing capacity metric: '+name);return value;};
  const sample={time:required('node_time_seconds'),memory_total:required('node_memory_MemTotal_bytes'),memory_available:required('node_memory_MemAvailable_bytes'),cpu:Object.fromEntries([...values].filter(([k])=>k.startsWith('node_cpu_seconds_total|'))),disk:Object.fromEntries([...values].filter(([k])=>k.startsWith('node_disk_io_time_seconds_total|')))};
  if(!sample.memory_total||sample.memory_available>sample.memory_total||!Object.keys(sample.cpu).length||!Object.keys(sample.disk).length)throw Error('missing or invalid capacity counters');
  if(Math.abs(now-sample.time*1000)>120000)throw Error('stale capacity metrics');
  return sample;
}
export function capacityPressure(previous,current){
  const seconds=current.time-previous.time;if(seconds<30||seconds>180)throw Error('invalid capacity sample interval');
  const delta=(old,latest)=>{const keys=Object.keys(old);if(keys.length!==Object.keys(latest).length||keys.some(k=>latest[k]===undefined||latest[k]<old[k]))throw Error('capacity counter reset or series changed');return keys.map(k=>[k,latest[k]-old[k]]);};
  const cpu=delta(previous.cpu,current.cpu),total=cpu.reduce((n,[,v])=>n+v,0),idle=cpu.filter(([k])=>k.split('|')[2]==='idle').reduce((n,[,v])=>n+v,0);
  if(!total||!cpu.some(([k])=>k.split('|')[2]==='idle'))throw Error('missing CPU interval');
  const cpu_percent=100*(1-idle/total),memory_available_percent=100*current.memory_available/current.memory_total,disk_percent=Math.max(...delta(previous.disk,current.disk).map(([,v])=>100*v/seconds));
  return {cpu_percent,memory_available_percent,disk_percent,bad:cpu_percent>=70||memory_available_percent<15||disk_percent>=80};
}
export function validMaintenanceAck(ack,pending,sha,now=Date.now()){
  return Boolean(ack&&pending&&ack.manifest_sha256===sha&&ack.verified_documents===pending.verified_documents&&ack.verified_chunks===pending.verified_chunks&&ack.independent_audit_passed===true&&ack.analyze_counts_passed===true&&Number.isFinite(ack.captured_at)&&ack.captured_at<=now&&now-ack.captured_at<1800000);
}
