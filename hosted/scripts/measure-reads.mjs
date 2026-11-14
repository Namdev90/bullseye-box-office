import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import worker from '../dist/server/index.js';
import {messageReadFixture} from '../tests/helpers/read-fixture.mjs';

assert(process.argv[2],'Pass the built baseline Worker file for interleaved comparison');
const baseline=(await import(pathToFileURL(resolve(process.argv[2])))).default;
const cases=[];
for(const personal of [0,1,10,50]){
  const fixtures=[await messageReadFixture(baseline,personal),await messageReadFixture(worker,personal)];
  try{
    fixtures[0].db.exec('DROP INDEX IF EXISTS sharepass_staff_prompt_recent; ANALYZE;');
    for(const fixture of fixtures)for(let i=0;i<10;i++)assert.equal((await fixture.call()).status,200);
    const samples=[[],[]],responses=[];
    for(let i=0;i<60;i++)for(const variant of i%2?[1,0]:[0,1]){
      const fixture=fixtures[variant];fixture.reset();const started=performance.now();responses[variant]=await fixture.call();
      samples[variant].push(performance.now()-started);assert.equal(responses[variant].status,200);
    }
    assert.equal(responses[0].text,responses[1].text,'Optimization must preserve the exact scoped response');
    assert(!responses[1].text.includes('PRIVATE_OTHER_'));
    const variants=fixtures.map((fixture,i)=>{
      samples[i].sort((a,b)=>a-b);
      return {label:i?'after':'before',requestsPerSample:1,...fixture.metrics(),
        payloadBytes:Buffer.byteLength(responses[i].text),payloadSha256:createHash('sha256').update(responses[i].text).digest('hex'),
        p50Ms:Number(samples[i][29].toFixed(3)),p95Ms:Number(samples[i][56].toFixed(3)),plans:fixture.plans()};
    });
    cases.push({personalMessages:personal,retainedHistory:1000,recipientsPerMessage:12,identicalResponse:true,variants});
  }finally{fixtures.forEach(fixture=>fixture.close());}
}
console.log(JSON.stringify({environment:'Interleaved Workers in one process with in-memory SQLite and synthetic scoped records; local latency, not production D1 throughput',warmups:10,samples:60,cases},null,2));
