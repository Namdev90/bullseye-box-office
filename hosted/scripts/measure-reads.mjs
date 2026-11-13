import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../dist/server/index.js';
import {messageReadFixture} from '../tests/helpers/read-fixture.mjs';

const cases=[];
for(const personal of [0,1,10,50]){
  const fixture=await messageReadFixture(worker,personal);
  try{
    for(let i=0;i<5;i++)assert.equal((await fixture.call()).status,200);
    const samples=[];let response,metrics;
    for(let i=0;i<30;i++){
      fixture.reset();const started=performance.now();response=await fixture.call();
      samples.push(performance.now()-started);assert.equal(response.status,200);metrics=fixture.metrics();
    }
    assert(!response.text.includes('PRIVATE_OTHER_'));
    samples.sort((a,b)=>a-b);
    cases.push({personalMessages:personal,retainedHistory:1000,recipientsPerMessage:12,...metrics,
      payloadBytes:Buffer.byteLength(response.text),payloadSha256:createHash('sha256').update(response.text).digest('hex'),
      p50Ms:Number(samples[14].toFixed(3)),p95Ms:Number(samples[28].toFixed(3)),plans:fixture.plans()});
  }finally{fixture.close();}
}
console.log(JSON.stringify({environment:'Current Worker with in-memory SQLite, synthetic scoped records; local latency, not production D1 throughput',warmups:5,samples:30,cases},null,2));
