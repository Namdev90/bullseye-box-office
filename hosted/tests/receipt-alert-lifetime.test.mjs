import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,verify} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

function fixture({env={},ctx,storageBytes=()=>null,beforeRun=()=>{}}={}){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  sqlite.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('account-one@example.test','account-one','Owner');
  const DB={prepare(sql){return {bind(...values){
    const stmt=sqlite.prepare(sql);
    const all=()=>({results:stmt.all(...values),meta:{size_after:storageBytes()}});
    const run=()=>{beforeRun(sql);return {meta:{changes:stmt.run(...values).changes}};};
    return {
      async first(){return stmt.get(...values)||null;},
      async all(){return all();},
      async run(){return run();},
      exec(){return stmt.columns().length?all():run();}
    };
  }};},async batch(statements){
    sqlite.exec('BEGIN');
    try{
      const results=statements.map(statement=>statement.exec());
      sqlite.exec('COMMIT');
      return results;
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  async function call(path,body,owner='account-one',origin='https://test.example',extraHeaders={}){
    const headers=owner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test',...extraHeaders}:{...extraHeaders};
    if(body)Object.assign(headers,{'Content-Type':'application/json',Origin:origin});
    const response=await worker.fetch(new Request('https://test.example'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),
      {DB,SHAREPASS_OWNER_EMAIL:'account-one@example.test',...env},ctx);
    return {status:response.status,body:await response.json()};
  }
  return {call,sqlite,DB,close:()=>sqlite.close()};
}
const scope={event_id:'training-event-001',booth_id:'B1'};
const state='/api/state?event_id=training-event-001';
const deposit={...scope,request_id:'deposit-0001',location:'A-01',custody_confirmed:true,quantities:{normal:4,vip:2,vvip:0}};

test('existing draft opt-in automatically survives a confirmed 48-hour receipt',async t=>{
  const hour=3600000,started=Date.now();
  t.mock.method(Date,'now',()=>started);
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url');
  const f=fixture({env:{SHAREPASS_WEB_PUSH_PUBLIC_KEY:publicKey,SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))}});
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:201}));
  try{
    const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname;
    const ticket=crypto.randomUUID(),quantities={normal:1,vip:0,vvip:0};
    assert.equal((await f.call(path,{request_id:ticket,intake_version:2,name:'Synthetic guest',phone:'+12025550101',quantities,
      recipients:[{name:'Synthetic collector',phone:'+12025550102',quantities}]},'')).status,200);
    assert.equal((await f.call(path+'/alerts',{action:'enable',ticket,endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-regression'},'')).body.expires_at,started+26*hour);
    assert.equal((await f.call('/api/queue/'+ticket+'/confirm',{location:'SYNTHETIC-ONLY',valid_minutes:2880,custody_confirmed:true})).status,200);
    assert.equal(f.sqlite.prepare('SELECT expires_at FROM sharepass_receipt_push WHERE ticket=?').get(ticket).expires_at,started+48*hour,
      'An existing opt-in must not expire while its confirmed receipt remains active');
  }finally{f.close();}
});

async function receiptFixture(t,options={}){
  const hour=3600000,started=Date.now();let now=started;
  t.mock.method(Date,'now',()=>now);
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url');
  const f=fixture({...options,env:{SHAREPASS_WEB_PUSH_PUBLIC_KEY:publicKey,SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))}});
  const sent=[];
  t.mock.method(globalThis,'fetch',async url=>{sent.push(url);return new Response(null,{status:201});});
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname;
  const ticket=crypto.randomUUID(),quantities={normal:1,vip:0,vvip:0};
  assert.equal((await f.call(path,{request_id:ticket,intake_version:2,name:'Synthetic guest',phone:'+12025550101',quantities,
    recipients:[{name:'Synthetic collector',phone:'+12025550102',quantities}]},'')).status,200);
  const endpoint='https://fcm.googleapis.com/fcm/send/synthetic-regression';
  const alerts=(action='enable',target=endpoint)=>f.call(path+'/alerts',{action,ticket,endpoint:target},'');
  const confirm=(extra={})=>f.call('/api/queue/'+ticket+'/confirm',{location:'SYNTHETIC-ONLY',valid_minutes:2880,custody_confirmed:true,...extra});
  const saved=()=>f.sqlite.prepare('SELECT * FROM sharepass_receipt_push WHERE ticket=?').get(ticket);
  const expiry=value=>f.sqlite.prepare('UPDATE sharepass_receipt_push SET expires_at=? WHERE ticket=?').run(value,ticket);
  return {...f,hour,started,path,ticket,quantities,endpoint,alerts,confirm,saved,expiry,sent,clock:value=>{now=value;}};
}

test('explicit stop and never-enabled receipts never acquire consent on confirmation',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();assert.equal((await f.alerts('stop')).body.enabled,false);
    assert.equal((await f.confirm()).status,200);
    assert.equal(f.saved(),undefined);assert.equal(f.sent.length,0);
    // Retrying the successful confirmation must not recreate a subscription.
    assert.equal((await f.confirm()).body.replayed,true);assert.equal(f.saved(),undefined);
  }finally{f.close();}
});

test('expired opt-in including exact expiry boundary is not renewed by confirmation',async t=>{
  for(const offset of [0,-1])await t.test('expiry offset '+offset,async t=>{
    const f=await receiptFixture(t);
    try{
      await f.alerts();f.expiry(f.started+offset);
      assert.equal((await f.confirm()).status,200);
      assert.equal(f.saved().expires_at,f.started+offset);assert.equal(f.sent.length,0);
    }finally{f.close();}
  });
});

test('failed confirmation changes no opt-in and successful retry renews once without replay renewal',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();
    assert.equal((await f.confirm({custody_confirmed:false})).status,400);
    assert.equal(f.saved().expires_at,f.started+26*f.hour);assert.equal(f.sent.length,0);
    assert.equal((await f.confirm()).status,200);
    assert.equal(f.saved().expires_at,f.started+48*f.hour);assert.equal(f.sent.length,1);
    const saved=f.saved();
    assert.equal((await f.confirm()).body.replayed,true);
    assert.deepEqual(f.saved(),saved);
    assert.equal(f.sent.length,1);
  }finally{f.close();}
});

test('old endpoint stop cannot remove or notify a replacement subscription',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();const replacement=f.endpoint+'-replacement';
    assert.equal((await f.alerts('enable',replacement)).status,200);
    await f.alerts('stop');
    assert.equal((await f.confirm()).status,200);
    assert.equal(f.saved().endpoint,replacement);
    assert.equal(f.saved().expires_at,f.started+48*f.hour);
    assert.deepEqual(f.sent,[replacement]);
  }finally{f.close();}
});

test('same ticket with different subscription workspace or booth is never renewed or notified',async t=>{
  for(const field of ['workspace','booth_id'])await t.test(field,async t=>{
    const f=await receiptFixture(t);
    try{
      await f.alerts();f.sqlite.prepare('UPDATE sharepass_receipt_push SET '+field+'=? WHERE ticket=?').run('other-fixture',f.ticket);
      assert.equal((await f.confirm()).status,200);
      assert.equal(f.saved().expires_at,f.started+26*f.hour);assert.equal(f.sent.length,0);
    }finally{f.close();}
  });
});

test('code refresh extends live consent, but cannot revive already expired consent',async t=>{
  for(const expired of [false,true])await t.test('expired '+expired,async t=>{
    const f=await receiptFixture(t);
    try{
      await f.alerts();const receipt=(await f.confirm({valid_minutes:1440})).body;
      f.clock(f.started+23*f.hour);
      if(expired)f.expiry(f.started+23*f.hour);
      const result=await f.call('/api/codes/refresh',{request_id:crypto.randomUUID(),collection_code:receipt.collection_code,packet_id:receipt.deposit.packet_id});
      assert.equal(result.status,200);
      assert.equal(f.saved().expires_at,f.started+(expired?23:47)*f.hour);
      assert.equal(f.sent.length,expired?1:2);
    }finally{f.close();}
  });
});

test('pending full handover retains live consent through code lifetime without granting more time after expiry',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();const receipt=(await f.confirm()).body;
    // Model an older still-live subscription persisted before this fix.
    f.expiry(f.started+26*f.hour);
    const lookup=(await f.call('/api/verify',{collection_code:receipt.collection_code})).body;
    const pending=await f.call('/api/deposits/'+receipt.deposit.id+'/release',{
      request_id:'synthetic-pending-release',claim_token:lookup.claim_token,packet_id:lookup.deposit.packet_id,
      version:lookup.deposit.version,quantities:f.quantities});
    assert.equal(pending.status,200);
    assert.equal(f.saved().expires_at,f.started+48*f.hour);
    assert.equal((await f.call(f.path+'?ticket='+f.ticket,undefined,'')).body.status,'checking');
    f.clock(f.started+48*f.hour);
    const before=f.sent.length;
    assert.equal((await f.call('/api/collections/'+pending.body.collection.id+'/handover',{
      request_id:'synthetic-pending-handover',version:pending.body.collection.version,handover_confirmed:true})).status,200);
    assert.equal(f.saved().expires_at,f.started+48*f.hour);assert.equal(f.sent.length,before);
  }finally{f.close();}
});

test('delayed result uses current ledger expiry rather than stale response expiry',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();const receipt=(await f.confirm()).body;
    f.expiry(f.started+26*f.hour);
    const context={Date,Response};
    runInNewContext(readFileSync('worker/web-push.js','utf8')+`
      webPushSettings=()=>({});
      sendWebPush=async()=>{};
      globalThis.finish=guestReceiptResult;
    `,context);
    const delayed=Response.json({...receipt,deposit:{...receipt.deposit,code_expires_at:f.started+100*f.hour}});
    await context.finish(delayed,{DB:f.DB},null,{workspace:'account-one'});
    assert.equal(f.saved().expires_at,f.started+48*f.hour);
  }finally{f.close();}
});

test('confirmation without any prior opt-in creates no subscription',async t=>{
  const f=await receiptFixture(t);
  try{
    assert.equal((await f.confirm()).status,200);
    assert.equal(f.saved(),undefined);assert.equal(f.sent.length,0);
  }finally{f.close();}
});

test('replay repairs transient lifetime-update failure without repeating alerts or custody changes',async t=>{
  let fail=true;
  const f=await receiptFixture(t,{beforeRun:sql=>{
    if(fail&&sql.startsWith('UPDATE sharepass_receipt_push AS p')){fail=false;throw new Error('synthetic transient renewal failure');}
  }});
  try{
    await f.alerts();assert.equal((await f.confirm()).status,200);
    assert.equal(f.saved().expires_at,f.started+26*f.hour);
    const sent=f.sent.length;
    const ledger=()=>JSON.stringify(f.sqlite.prepare('SELECT * FROM sharepass_ledger_deposits').all());
    const before=ledger();
    assert.equal((await f.confirm()).body.replayed,true);
    assert.equal(f.saved().expires_at,f.started+48*f.hour);
    assert.equal(f.sent.length,sent);assert.equal(ledger(),before);
  }finally{f.close();}
});

test('repair replay cannot resurrect consent stopped or expired after transient failure',async t=>{
  for(const state of ['stopped','expired'])await t.test(state,async t=>{
    let fail=true;
    const f=await receiptFixture(t,{beforeRun:sql=>{
      if(fail&&sql.startsWith('UPDATE sharepass_receipt_push AS p')){fail=false;throw new Error('synthetic transient renewal failure');}
    }});
    try{
      await f.alerts();assert.equal((await f.confirm()).status,200);
      if(state==='stopped')await f.alerts('stop');else f.clock(f.started+26*f.hour);
      const before=f.saved(),sent=f.sent.length;
      assert.equal((await f.confirm()).body.replayed,true);
      assert.deepEqual(f.saved(),before);assert.equal(f.sent.length,sent);
    }finally{f.close();}
  });
});

test('status is exact-endpoint scoped and read-only across confirmation, extension and stop',async t=>{
  const f=await receiptFixture(t);
  try{
    assert.deepEqual((await f.alerts('status')).body,{enabled:false});
    await f.alerts();const receipt=(await f.confirm()).body;
    const changes=()=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
    const before=changes();
    assert.equal((await f.alerts('status')).body.expires_at,f.started+48*f.hour);
    assert.deepEqual((await f.alerts('status',f.endpoint+'-wrong')).body,{enabled:false});
    assert.equal(changes(),before);
    await f.alerts('stop');
    assert.deepEqual((await f.alerts('status')).body,{enabled:false});
    assert.equal(f.saved(),undefined);
    assert.equal((await f.call(f.path+'/alerts',{action:'status',ticket:f.ticket,endpoint:f.endpoint},'','https://foreign.example')).status,403);
  }finally{f.close();}
});

test('status allows unexpired existing pending consent after code expiry, but never after consent expiry',async t=>{
  const f=await receiptFixture(t);
  try{
    await f.alerts();const receipt=(await f.confirm({valid_minutes:60})).body;
    const lookup=(await f.call('/api/verify',{collection_code:receipt.collection_code})).body;
    assert.equal((await f.call('/api/deposits/'+receipt.deposit.id+'/release',{
      request_id:'status-pending-release',claim_token:lookup.claim_token,packet_id:lookup.deposit.packet_id,
      version:lookup.deposit.version,quantities:f.quantities})).status,200);
    f.clock(f.started+2*f.hour);
    assert.equal((await f.alerts('status')).body.expires_at,f.started+26*f.hour);
    f.clock(f.started+26*f.hour);
    assert.deepEqual((await f.alerts('status')).body,{enabled:false});
  }finally{f.close();}
});
