'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
async function notice({admin=false,status=200,offline=false}={}){
  const handlers={},notices=[],calls=[];
  const self={registration:{scope:admin?'https://test.example/admin-alerts/':'https://test.example/',showNotification:async(title,options)=>notices.push({title,...options})},
    addEventListener:(name,action)=>handlers[name]=action,clients:{matchAll:async()=>[]}};
  runInNewContext(readFileSync('web/queue-alert-worker.js','utf8'),{self,AbortSignal,fetch:async(path,options)=>{calls.push({path,...options});if(offline)throw Error('Offline');return {status,ok:status===200,json:async()=>({drafts:admin?[]:[{name:'Taylor Example',quantities:{normal:4,vip:2},phone:'+12025550123'}],inbox:[{message:'Meet at booth two'}]})};}});
  let pending;handlers.push({waitUntil:work=>pending=work});await pending;return {notices,calls};
}
test('staff push obtains scoped names and counts with no shared cache or private phone data',async()=>{
  const p=await notice();assert.equal(p.calls[0].path,'/api/queue');assert.equal(p.calls[0].cache,'no-store');assert.equal(p.calls[0].credentials,'include');
  assert.match(p.notices[0].body,/Taylor Example · 4 Normal \+ 2 VIP/);assert(!JSON.stringify(p.notices).includes('+12025550123'));
});
test('administrator uses the owner endpoint; revoked sessions show no details or stale notice',async()=>{
  const p=await notice({admin:true});assert.equal(p.calls[0].path,'/api/admin/staff-messages');assert.match(p.notices[0].body,/Admin: Meet at booth two/);
  for(const status of [401,403])assert.equal((await notice({status})).notices.length,0);
  const offline=await notice({offline:true});assert.equal(offline.notices[0].body,'Open the staff desk to review it.');
});
