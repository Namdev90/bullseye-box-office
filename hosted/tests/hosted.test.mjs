import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,verify} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

function fixture({env={},ctx,storageBytes=()=>null}={}){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  sqlite.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('account-one@example.test','account-one','Owner');
  const DB={prepare(sql){return {bind(...values){
    const stmt=sqlite.prepare(sql);
    const all=()=>({results:stmt.all(...values),meta:{size_after:storageBytes()}});
    const run=()=>({meta:{changes:stmt.run(...values).changes}});
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
  return {call,sqlite,close:()=>sqlite.close()};
}
const scope={event_id:'training-event-001',booth_id:'B1'};
const state='/api/state?event_id=training-event-001';
const deposit={...scope,request_id:'deposit-0001',location:'A-01',custody_confirmed:true,quantities:{normal:4,vip:2,vvip:0}};

test('numeric rollout rejects stored legacy letter codes without modifying custody',async t=>{
  const f=fixture();
  t.after(f.close);
  const created=await f.call('/api/deposits',{...deposit,custom_code:'4242'});
  assert.equal(created.status,200);
  const id=created.body.deposit.id;
  // Synthetic pre-rollout record only. This does not inspect a private catalogue or live records.
  f.sqlite.prepare('UPDATE sharepass_ledger_codes SET code=? WHERE deposit_id=?').run('K7M4',id);
  f.sqlite.prepare("UPDATE sharepass_ledger_deposits SET payload=json_set(payload,'$.active_collection_code',?,'$.code_expires_at',0) WHERE id=?").run('K7M4',id);
  const before=f.sqlite.prepare('SELECT payload,revision FROM sharepass_ledger_deposits WHERE id=?').get(id);
  const input={collection_code:'K7M4',packet_id:created.body.deposit.packet_id,location:deposit.location,
    request_id:crypto.randomUUID(),valid_minutes:1440};
  for(const path of ['/api/verify','/api/codes/refresh','/api/admin/reissue']){
    assert.equal((await f.call(path,input)).status,400,path);
  }
  assert.deepEqual(f.sqlite.prepare('SELECT payload,revision FROM sharepass_ledger_deposits WHERE id=?').get(id),before);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_collections WHERE deposit_id=?').get(id).n,0);
});

test('the allocator finds the last available four-digit code and reports exhaustion',async t=>{
  const f=fixture();
  t.after(f.close);
  const existing=await f.call('/api/deposits',{...deposit,custom_code:'0000'});
  assert.equal(existing.status,200);
  const code=f.sqlite.prepare('SELECT owner,event,deposit_id FROM sharepass_ledger_codes WHERE code=?').get('0000');
  f.sqlite.prepare(`WITH RECURSIVE digits(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM digits WHERE n<9999)
    INSERT INTO sharepass_ledger_codes(owner,event,code,deposit_id)
    SELECT ?,?,printf('%04d',n),? FROM digits WHERE n<>87`).run(code.owner,code.event,code.deposit_id);
  const last=await f.call('/api/codes/suggest');
  assert.equal(last.status,200);
  assert.equal(last.body.code,'0087');
  const full=await f.call('/api/codes/suggest?exclude=0087');
  assert.equal(full.status,409);
});

test('guest receipt alerts are consented, booth scoped, private, and sent once per committed change',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
  const pub=publicKey.export({format:'jwk'});
  const vapid=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
  const f=fixture({env:{SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),SHAREPASS_WEB_PUSH_PUBLIC_KEY:vapid}});
  const target='https://fcm.googleapis.com/fcm/send/guest-receipt-fixture';
  const originalFetch=globalThis.fetch,alerts=[];
  let relayStatus=201;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,target);
    alerts.push(options);
    return new Response(null,{status:relayStatus});
  };
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname;
    const path='/api/public'+poster;
    const ticket=crypto.randomUUID(),other=crypto.randomUUID(),missing=crypto.randomUUID();
    const draft={name:'Fixture guest',phone:'+12025550101',quantities:{normal:2,vip:0,vvip:0},intake_version:2,
      recipients:[{name:'Fixture collector',phone:'+12025550102',quantities:{normal:2,vip:0,vvip:0}}]};
    const enable={action:'enable',ticket,endpoint:target};
    assert.equal((await f.call(path,undefined,'')).body.alerts_key,vapid);
    assert.equal((await f.call(path+'/alerts',enable,'')).status,404);
    assert.equal((await f.call(path,{...draft,request_id:ticket},'')).status,200);
    assert.equal((await f.call(path,{...draft,request_id:other},'')).status,200);
    assert.equal(alerts.length,0);
    assert.equal((await f.call(path+'/alerts',enable,'','https://foreign.example')).status,403);
    assert.equal((await f.call(path+'/alerts',{...enable,endpoint:'https://foreign.example/webpush/invalid'},'')).status,400);
    const setup=(await f.call('/api/admin/setup',{action:'booth',name:'Other gate',location:'Other test area'})).body;
    const otherBooth=setup.booths.find(booth=>booth.name==='Other gate');
    const otherPoster=f.sqlite.prepare('SELECT poster_token FROM sharepass_configured_booths WHERE id=?').get(otherBooth.id).poster_token;
    assert.equal((await f.call('/api/public/booth/'+otherPoster+'/alerts',enable,'')).status,404);
    assert.equal((await f.call(path+'/alerts',{...enable,ticket:missing},'')).status,404);
    assert.equal((await f.call(path+'/alerts',enable,'')).body.enabled,true);
    assert.equal((await f.call(path+'/alerts',{...enable,ticket:other},'')).status,409);
    assert.equal((await f.call('/api/web-push',{endpoint:target})).status,409);
    const confirm='/api/queue/'+ticket+'/confirm',confirmBody={custody_confirmed:true,location:'GUEST-A'};
    const result=(await f.call(confirm,confirmBody)).body;
    assert.equal(alerts.length,1);
    assert.equal((await f.call(confirm,confirmBody)).body.replayed,true);
    await f.call('/api/queue/'+other+'/confirm',{...confirmBody,location:'GUEST-B'});
    assert.equal(alerts.length,1);
    assert.equal((await f.call(path+'?ticket='+ticket,undefined,'')).body.collection_code,result.collection_code);
    const lookup=(await f.call('/api/verify',{collection_code:result.collection_code})).body;
    const release='/api/deposits/'+lookup.deposit.id+'/release';
    const releaseBody={request_id:'guest-alert-pickup',claim_token:lookup.claim_token,packet_id:lookup.deposit.packet_id,
      version:lookup.deposit.version,quantities:{normal:1,vip:0,vvip:0}};
    assert.equal((await f.call(release,{...releaseBody,packet_id:'WRONG'})).status,400);
    assert.equal(alerts.length,1);
    const reserved=(await f.call(release,releaseBody)).body;
    assert.equal((await f.call(path+'?ticket='+ticket,undefined,'')).body.status,'checking');
    assert.equal(alerts.length,2);
    assert.equal((await f.call(release,releaseBody)).body.replayed,true);
    assert.equal(alerts.length,2);
    assert.equal((await f.call(path+'/alerts',{...enable,action:'stop',ticket:other},'')).body.enabled,false);
    relayStatus=410;
    const handover='/api/collections/'+reserved.collection.id+'/handover';
    const handoverBody={request_id:'guest-alert-handover',version:reserved.collection.version,handover_confirmed:true};
    assert.equal((await f.call(handover,handoverBody)).status,200);
    assert.equal(alerts.length,3);
    assert.equal((await f.call(handover,handoverBody)).body.replayed,true);
    assert.equal(alerts.length,3);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM sharepass_receipt_push').get().count,0);
    assert.equal((await f.call(path+'/alerts',enable,'')).body.enabled,true);
    assert.equal((await f.call(path+'/alerts',{...enable,action:'stop'},'')).body.enabled,false);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM sharepass_receipt_push').get().count,0);
    for(const message of alerts){
      assert.equal(message.body,undefined);
      assert.equal(message.redirect,'manual');
      assert.equal(message.headers.Topic,'sharepass-receipt');
      assert.match(message.headers.Authorization,/^vapid t=.+, k=/);
      assert(!JSON.stringify(message).includes(ticket));
    }
  }finally{globalThis.fetch=originalFetch;f.close();}
});

test('receipt notification stays generic and opens only its locally saved receipt',async()=>{
  const handlers={},notices=[],messages=[],opened=[];
  const scope='https://test.example/receipt-alerts/'+'a'.repeat(64)+'/';
  const validPath='/booth/'+crypto.randomUUID()+'#receipt='+crypto.randomUUID();
  let saved={path:validPath,expiresAt:Date.now()+60000},closed=0;
  runInNewContext(readFileSync('web/receipt-alert-worker.js','utf8'),{
    self:{
      registration:{scope,showNotification:async(...notice)=>notices.push(notice),
        pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-worker'})}},
      navigator:{locks:{request:async(key,fn)=>fn()}},Notification:{permission:'granted'},
      addEventListener:(type,action)=>{handlers[type]=action;},
      clients:{matchAll:async()=>[{postMessage:message=>messages.push(message)}],openWindow:async path=>opened.push(path)}
    },
    caches:{open:async()=>({match:async key=>{assert.equal(key,scope);return saved?{json:async()=>saved}:null;},
      put:async(key,response)=>{saved=await response.json();},delete:async()=>{saved=null;}})},
    Response,AbortSignal,fetch:async()=>Response.json({enabled:saved?.expiresAt>Date.now(),expires_at:saved?.expiresAt})
  });
  async function run(type,event={}){
    let done;
    handlers[type]({...event,waitUntil:value=>{done=value;}});
    await done;
  }
  await run('push');
  assert.equal(notices[0][0],'SharePass receipt updated');
  assert.equal(messages[0].scope,scope);
  assert(!JSON.stringify([notices,messages]).includes(validPath));
  const clicked={notification:{close:()=>{closed++;}}};
  await run('notificationclick',clicked);
  assert.deepEqual(opened,[validPath]);
  saved={...saved,path:'https://other.example'+validPath};
  await run('notificationclick',clicked);
  saved={path:validPath,expiresAt:Date.now()-1};
  await run('notificationclick',clicked);
  assert.deepEqual(opened,[validPath]);
  assert.equal(closed,3);
});

test('invited staff sees the owner’s register only after sign-in and profile setup',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.call(state,undefined,'')).status,401);
    assert.equal((await f.call('/api/deposits',deposit,'account-one','https://foreign.example')).status,403);
    const created=await f.call('/api/deposits',deposit);
    assert.equal(created.status,200);
    assert.equal((await f.call('/api/context',undefined,'account-two')).status,403);
    assert.equal((await f.call('/api/admin',{email:'account-two@example.test',action:'grant'})).status,200);
    assert.equal((await f.call('/api/context',undefined,'account-two')).body.staff_label,null);
    assert.equal((await f.call(state,undefined,'account-two')).status,403);
    assert.equal((await f.call('/api/profile',{name:'Field staff'},'account-two')).status,200);
    assert.equal((await f.call('/api/context',undefined,'account-two')).body.staff_label,'Field staff');
    assert.equal((await f.call('/api/admin',undefined,'account-two')).status,404);
    const later=await f.call('/api/verify',{collection_code:created.body.collection_code},'account-two');
    assert.equal(later.body.deposit.id,created.body.deposit.id);
    assert(!JSON.stringify(later.body).includes(created.body.collection_code));
    assert.equal((await f.call('/api/admin',{email:'account-two@example.test',action:'revoke'})).status,200);
    assert.equal((await f.call(state,undefined,'account-two')).status,403);
  }finally{f.close();}
});
test('concurrent pickups cannot double reserve; exact retry and confirmation preserve partial balance',async()=>{
  const f=fixture();
  try{
    const created=(await f.call('/api/deposits',deposit)).body;
    const replay=(await f.call('/api/deposits',deposit)).body;
    assert.equal(replay.collection_code,created.collection_code);
    assert.equal((await f.call('/api/deposits',{...deposit,location:'Changed'})).status,409);
    const wrong=await f.call('/api/verify',{...scope,booth_id:'B2',collection_code:created.collection_code});
    assert.equal(wrong.body.deposit.booth_id,'B1');
    const claim=(await f.call('/api/verify',{...scope,collection_code:created.collection_code})).body;
    const path='/api/deposits/'+created.deposit.id+'/release';
    const release={...scope,request_id:'release-0001',claim_token:claim.claim_token,packet_id:created.deposit.packet_id,version:created.deposit.version,quantities:{normal:2,vip:1,vvip:0}};
    const both=await Promise.all([f.call(path,release),f.call(path,{...release,request_id:'release-0002'})]);
    assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
    const winner=both.find(r=>r.status===200).body;
    assert.deepEqual(winner.deposit.remaining,{normal:2,vip:1,vvip:0});
    assert.equal((await f.call('/api/verify',{...scope,collection_code:created.collection_code})).status,409);
    const confirm='/api/collections/'+winner.collection.id+'/handover';
    const handover={...scope,request_id:'handover-0001',version:winner.collection.version,handover_confirmed:true};
    assert.equal((await f.call(confirm,handover)).status,200);
    assert.equal((await f.call(confirm,handover)).body.replayed,true);
    const saved=(await f.call(state)).body;
    assert.equal(saved.deposits.length,0);
    const remaining=(await f.call('/api/verify',{collection_code:created.collection_code})).body;
    assert.deepEqual(remaining.deposit.remaining,{normal:2,vip:1,vvip:0});
  }finally{f.close();}
});
test('unsuccessful code checks survive across requests and rate-limit lookup',async()=>{
  const f=fixture();
  try{
    for(let i=0;i<5;i++)assert.equal((await f.call('/api/verify',{...scope,collection_code:'9998'})).status,404);
    assert.equal((await f.call('/api/verify',{...scope,collection_code:'9998'})).status,429);
  }finally{f.close();}
});
test('public opening stays clean and staff and admin routes are protected',async()=>{
  const publicPage=await worker.fetch(new Request('https://test.example/'),{});
  assert.equal(publicPage.headers.get('X-SharePass-Version'),'26');
  const html=await publicPage.text();
  assert(html.includes('Open register'));
  assert(!html.includes('Desk menu'));
  const staffPage=await worker.fetch(new Request('https://test.example/staff'),{});
  assert.equal(staffPage.status,302);
  assert.equal(staffPage.headers.get('Location'),'/connect');
  const signed=await worker.fetch(new Request('https://test.example/staff',{headers:{'oai-authenticated-user-id':'account-one'}}),{});
  assert((await signed.text()).includes('src="/counter.js"'));
  assert.equal((await worker.fetch(new Request('https://test.example/admin'),{})).status,404);
  assert.equal((await worker.fetch(new Request('https://test.example/admin.html'),{})).status,404);
});

test('a customer QR submits a private draft and only staff confirmation creates one deposit',async()=>{
  const f=fixture();
  try{
    const intake=(await f.call('/api/intakes',{})).body;
    const publicPath='/api/public/intake/'+intake.token;
    const staffPath='/api/intakes/'+intake.token;
    assert.equal(new URL(intake.url).pathname,'/intake/'+intake.token);
    const confirm={location:'QR-01',custody_confirmed:true};
    assert.equal((await f.call(staffPath+'/confirm',confirm)).status,409);
    const details={name:'A guest',quantities:{normal:4,vip:2,vvip:0}};
    assert.equal((await f.call(publicPath,details,'','https://foreign.example')).status,403);
    assert.equal((await f.call(publicPath,details,'')).body.status,'submitted');
    assert.equal((await f.call(publicPath,details,'')).status,200);
    assert.equal((await f.call(publicPath,{...details,name:'A different name'},'')).status,409);
    assert.deepEqual(Object.keys((await f.call(publicPath,undefined,'')).body).sort(),['expires_at','status']);
    assert.equal((await f.call(staffPath,undefined,'')).status,401);
    await f.call('/api/admin',{email:'account-two@example.test',action:'grant'});
    await f.call('/api/profile',{name:'Other staff'},'account-two');
    assert.equal((await f.call(staffPath,undefined,'account-two')).status,404);
    assert.equal((await f.call(staffPath+'/confirm',confirm,'account-two')).status,404);
    assert.deepEqual((await f.call(staffPath)).body.quantities,details.quantities);
    assert.equal((await f.call(staffPath+'/confirm',{...confirm,custody_confirmed:false})).status,400);
    const [first,retry]=await Promise.all([f.call(staffPath+'/confirm',confirm),f.call(staffPath+'/confirm',confirm)]);
    assert.equal(first.status,200);
    assert.equal(retry.status,200);
    assert.equal(first.body.collection_code,retry.body.collection_code);
    assert.equal(first.body.deposit.id,retry.body.deposit.id);
    assert.equal(first.body.deposit.depositor_label,details.name);
    assert.equal((await f.call(staffPath+'/confirm',{...confirm,location:'QR-02'})).status,409);
    assert.equal((await f.call(staffPath)).body.status,'confirmed');
    f.sqlite.prepare('UPDATE sharepass_intakes SET expires_at=0 WHERE token=?').run(intake.token);
    assert.equal((await f.call(publicPath,undefined,'')).status,404);
    assert.equal((await f.call(staffPath+'/confirm',confirm)).body.collection_code,first.body.collection_code);
    const expired=(await f.call('/api/intakes',{})).body;
    await f.call('/api/public/intake/'+expired.token,details,'');
    f.sqlite.prepare('UPDATE sharepass_intakes SET expires_at=0 WHERE token=?').run(expired.token);
    assert.equal((await f.call('/api/intakes/'+expired.token+'/confirm',{...confirm,location:'QR-03'})).status,404);
    const manual=(await f.call('/api/intakes',{})).body;
    const manualStaff='/api/intakes/'+manual.token+'/confirm';
    const manualPublic='/api/public/intake/'+manual.token;
    const edited={location:'QR-04',custody_confirmed:true,manual:true,quantities:{normal:1,vip:0,vvip:0}};
    const receipt=await f.call(manualStaff,edited);
    assert.equal(receipt.status,200);
    assert.equal((await f.call(manualPublic,details,'')).body.status,'confirmed');
    assert.equal((await f.call(manualStaff,edited)).body.collection_code,receipt.body.collection_code);
    assert.equal((await f.call(manualStaff,{...edited,location:'QR-05'})).status,409);
  }finally{f.close();}
});

test('native pairing requires browser approval and expires or revokes the device token',async()=>{
  const f=fixture();
  try{
    const verifier='A'.repeat(43);
    const challenge=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),b=>b.toString(16).padStart(2,'0')).join('');
    const mobile={'X-SharePass-Session':verifier};
    const poll=()=>f.call('/api/mobile/session',{verifier},'');
    assert.equal((await poll()).status,202);
    assert.equal((await f.call('/api/context',undefined,'',undefined,mobile)).status,401);
    assert.equal((await f.call('/api/mobile/authorize',{challenge},'')).status,401);
    assert.equal((await f.call('/api/mobile/authorize',{challenge})).status,200);
    assert.equal((await poll()).body.token,verifier);
    assert.equal((await f.call('/api/admin',undefined,'',undefined,mobile)).status,404);
    assert.equal((await f.call('/api/context',undefined,'',undefined,mobile)).body.staff_label,'Owner');
    assert.equal((await f.call('/api/deposits',deposit,'',undefined,mobile)).status,200);
    assert.equal((await f.call('/api/mobile/logout',{},'',undefined,mobile)).status,200);
    assert.equal((await f.call('/api/context',undefined,'',undefined,mobile)).status,401);
    assert.equal((await f.call('/api/mobile/authorize',{challenge})).status,409);
    f.sqlite.prepare('UPDATE sharepass_mobile_sessions SET revoked=0,expires_at=0').run();
    assert.equal((await f.call('/api/context',undefined,'',undefined,mobile)).status,401);
    assert.equal((await poll()).status,202);
  }finally{f.close();}
});

test('a stable poster accepts separate private drafts and two staff cannot confirm the same physical deposit',async()=>{
  const f=fixture();
  try{
    const {url}= (await f.call('/api/booth')).body;
    await f.call('/api/admin',{email:'account-two@example.test',action:'grant'});
    await f.call('/api/profile',{name:'Second counter'},'account-two');
    assert.equal((await f.call('/api/booth',undefined,'account-two')).body.url,url);
    const publicPath='/api/public'+new URL(url).pathname;
    const guest={request_id:crypto.randomUUID(),name:'Riya',phone:'+91 9876543210',email:'riya@example.test',
      recipients:[{name:'Guest',phone:'+91 9876543211',email:''}],quantities:{normal:2,vip:0,vvip:2,mip:1}};
    assert.equal((await f.call(publicPath,guest,'','https://other.test')).status,403);
    const submitted=await f.call(publicPath,guest,'');
    assert.equal(submitted.status,200);
    assert.deepEqual(Object.keys(submitted.body).sort(),['queue_ref','status']);
    assert.deepEqual((await f.call(publicPath,guest,'')).body,submitted.body);
    assert.equal((await f.call(publicPath,{...guest,name:'Edited'},'')).status,409);
    assert.equal((await f.call(publicPath,{...guest,request_id:crypto.randomUUID(),name:'Second guest'},'')).status,200);
    assert.equal((await f.call('/api/queue',undefined,'')).status,401);
    const list=(await f.call('/api/queue')).body.drafts;
    assert.equal(list.length,2);
    assert.equal(list.find(x=>x.token===guest.request_id).queue_ref,submitted.body.queue_ref);
    assert.equal(list.some(x=>x.phone||x.email||x.recipients),false);
    const path='/api/queue/'+guest.request_id;
    assert.deepEqual((await f.call(path,undefined,'account-two')).body.recipients,guest.recipients);
    const confirmation={location:'POSTER-01',custody_confirmed:true,custom_code:'1234',valid_minutes:60};
    assert.equal((await f.call(path+'/confirm',{...confirmation,custody_confirmed:false})).status,400);
    const race=await Promise.all([f.call(path+'/confirm',confirmation),f.call(path+'/confirm',confirmation,'account-two')]);
    assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
    assert.equal(race.find(x=>x.status===409).body.notExecuted,true);
    const result=race.find(x=>x.status===200).body;
    assert.equal(result.collection_code,'1234');
    assert.deepEqual(result.deposit.remaining,guest.quantities);
    assert.deepEqual(result.recipients,guest.recipients);
    assert.equal((await f.call('/api/queue')).body.drafts.length,1);
    const lookup=await f.call('/api/verify',{collection_code:'1234'});
    assert.deepEqual(lookup.body.deposit.remaining,guest.quantities);
    const release=await f.call('/api/deposits/'+result.deposit.id+'/release',{
      request_id:'poster-mip-release',claim_token:lookup.body.claim_token,packet_id:result.deposit.packet_id,
      version:result.deposit.version,quantities:{normal:1,vip:0,vvip:0}
    });
    assert.deepEqual(release.body.deposit.remaining,{normal:1,vip:0,vvip:2,mip:1});
  }finally{f.close();}
});

test('custom references accept leading zeroes and expire without removing stock or freeing the reference',async()=>{
  const f=fixture();
  try{
    const created=await f.call('/api/deposits',{...deposit,custom_code:'0000',valid_minutes:5});
    assert.equal(created.status,200);
    assert.equal(created.body.collection_code,'0000');
    const row=f.sqlite.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE owner=? AND id=?').get('account-one',created.body.deposit.id);
    const item=JSON.parse(row.payload);
    item.code_expires_at=Date.now()-1000;
    f.sqlite.prepare('UPDATE sharepass_ledger_deposits SET payload=? WHERE owner=? AND id=?').run(JSON.stringify(item),'account-one',item.id);
    assert.equal((await f.call('/api/verify',{collection_code:'0000'})).status,409);
    const retained={deposits:[JSON.parse(f.sqlite.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE owner=? AND id=?').get('account-one',item.id).payload)]};
    assert.deepEqual(retained.deposits[0].remaining,deposit.quantities);
    const replace={request_id:crypto.randomUUID(),collection_code:'0000',packet_id:created.body.deposit.packet_id,
      location:created.body.deposit.location,custom_code:'0133',valid_minutes:60};
    assert.equal((await f.call('/api/admin/reissue',{...replace,packet_id:'PKT-AAAAAAAA'})).status,404);
    const reissued=await f.call('/api/admin/reissue',replace);
    assert.equal(reissued.body.collection_code,'0133');
    assert.equal((await f.call('/api/admin/reissue',replace)).body.collection_code,'0133');
    assert.equal((await f.call('/api/verify',{collection_code:'0000'})).status,409);
    const updated=await f.call('/api/verify',{collection_code:'0133'});
    assert.deepEqual(updated.body.deposit.remaining,deposit.quantities);
    assert.equal(updated.body.deposit.active_collection_code,undefined);
  }finally{f.close();}
});

test('owner creates a separate booth and staff pairs once, sees only their booth, and can be revoked',async()=>{
  const f=fixture();
  try{
    const create=await f.call('/api/admin/setup',{action:'booth',name:'West Gate',location:'West concourse'});
    assert.equal(create.status,200);
    const booth=create.body.booths.find(x=>x.name==='West Gate');
    const issued=await f.call('/api/admin/setup',{action:'invite',booth_id:booth.id,staff_name:'Booth staff',device_label:'Tablet'});
    assert.equal(issued.status,200);
    const device=issued.body.devices.find(x=>x.label==='Tablet');
    assert.match(issued.body.code,/^\d{4}$/);
    assert.match(new URL(issued.body.qr_url).searchParams.get('invite'),/^[a-f0-9-]{36}$/);
    const secret='P'.repeat(43),headers={'X-SharePass-Session':secret,'X-SharePass-Client':'0.8.0'};
    const paired=await f.call('/api/device/connect',{code:issued.body.code,verifier:secret},'');
    assert.equal(paired.status,200);
    assert.equal(paired.body.booth_label,'West Gate');
    assert.equal(paired.body.staff_label,'Booth staff');
    assert.equal(paired.body.pickup_location,'West concourse');
    assert.equal(paired.body.admin,false);
    assert.equal((await f.call('/api/device/connect',{code:issued.body.code,verifier:'Q'.repeat(43)},'')).status,403);
    assert.equal((await f.call('/api/device/connect',{code:issued.body.code,verifier:secret},'')).status,200);
    assert.equal((await f.call('/api/admin/setup',undefined,'',undefined,headers)).status,404);
    const poster=(await f.call('/api/booth',undefined,'',undefined,headers)).body;
    assert.equal(poster.booth,'West Gate');
    assert.notEqual(poster.url,(await f.call('/api/booth')).body.url);
    const draft={request_id:crypto.randomUUID(),name:'Test Guest',phone:'',email:'',recipients:[],quantities:{normal:1,vip:0,vvip:0}};
    const post=await f.call('/api/public'+new URL(poster.url).pathname,draft,'');
    assert.equal(post.status,200);
    assert.deepEqual((await f.call('/api/queue')).body.drafts,[]);
    assert.equal((await f.call('/api/queue',undefined,'',undefined,headers)).body.drafts.length,1);
    const confirmed=await f.call('/api/queue/'+draft.request_id+'/confirm',{location:'A1',custody_confirmed:true,custom_code:'3705'},'',undefined,headers);
    assert.equal(confirmed.status,200);
    assert.equal(confirmed.body.deposit.booth_id,booth.id);
    assert.equal((await f.call('/api/verify',{collection_code:'3705'})).status,409);
    assert.equal((await f.call('/api/verify',{collection_code:'3705'},'',undefined,headers)).status,200);
    assert.equal((await f.call('/api/admin/setup',{action:'revoke',device_id:device.id})).status,200);
    assert.equal((await f.call('/api/context',undefined,'',undefined,headers)).status,401);
  }finally{f.close();}
});

test('device setup QR also creates a browser session, while expired and guessed codes are rejected',async()=>{
  const f=fixture();
  try{
    const issued=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'Browser staff',device_label:'Laptop'});
    const invite=new URL(issued.body.qr_url).searchParams.get('invite');
    const secret='S'.repeat(43);
    const paired=await f.call('/api/device/connect',{invite,verifier:secret},'');
    assert.equal(paired.status,200);
    assert.equal(paired.body.staff_label,'Browser staff');
    const cookie={Cookie:'__Host-sharepass-staff='+secret};
    assert.equal((await f.call('/api/context',undefined,'',undefined,cookie)).body.internal,true);
    assert.equal((await f.call('/api/admin/setup',undefined,'',undefined,cookie)).status,401);
    const old=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'Expired staff',device_label:'Old phone'});
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET invite_expires=0 WHERE label=?').run('Old phone');
    assert.equal((await f.call('/api/device/connect',{code:old.body.code,verifier:'T'.repeat(43)},'')).status,403);
    for(let i=0;i<4;i++)assert.equal((await f.call('/api/device/connect',{code:old.body.code,verifier:'T'.repeat(43)},'')).status,403);
    assert.equal((await f.call('/api/device/connect',{code:old.body.code,verifier:'T'.repeat(43)},'')).status,429);
  }finally{f.close();}
});

test('staff gets a depositor draft only after confirmed handover, with exact quantities and remaining balance',async()=>{
  const f=fixture();
  try{
    const created=(await f.call('/api/deposits',{...deposit,location:'DRAFT-QA',quantities:{normal:2,vip:0,vvip:0}})).body;
    const path='/api/deposits/'+created.deposit.id;
    const preference={request_id:crypto.randomUUID(),packet_id:created.deposit.packet_id,channel:'sms',name:'Test Depositor',phone:'+12025550123'};
    assert.equal((await f.call(path+'/updates',{...preference,packet_id:'PKT-FFFFFFFF'})).status,404);
    assert.equal((await f.call(path+'/updates',{...preference,phone:'bad number'})).status,400);
    const saved=await f.call(path+'/updates',preference);
    assert.equal(saved.body.update_channel,'sms');
    assert.equal(JSON.stringify(saved.body).includes('12025550123'),false);
    for(let i=0;i<2;i++){
      const lookup=(await f.call('/api/verify',{collection_code:created.collection_code})).body;
      assert.equal(JSON.stringify(lookup).includes('12025550123'),false);
      const release=await f.call(path+'/release',{
        request_id:crypto.randomUUID(),claim_token:lookup.claim_token,packet_id:lookup.deposit.packet_id,
        version:lookup.deposit.version,quantities:{normal:1,vip:0,vvip:0}
      });
      assert.equal(release.status,200);
      assert.equal(release.body.depositor_update,undefined);
      const handover='/api/collections/'+release.body.collection.id+'/handover';
      const command={request_id:crypto.randomUUID(),version:release.body.collection.version,handover_confirmed:true};
      const done=await f.call(handover,command);
      const update=done.body.depositor_update;
      assert.equal(update.channel,'sms');assert.equal(update.address,'12025550123');
      assert.match(update.message,/Hi Test Depositor!/);
      assert.match(update.message,/handed over 1 Normal/);
      assert.match(update.message,i===0?/Still available: 1 Normal/:/All passes/);
      assert.deepEqual((await f.call(handover,command)).body.depositor_update,update);
    }
  }finally{f.close();}
});

test('optional push registers live devices and sends one private, booth-scoped alert after a fresh submission',async t=>{
  const env={},jobs=[],assertions=[],sends=[];
  const f=fixture({env,ctx:{waitUntil:job=>jobs.push(job)}});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const account={
    project_id:'sharepass-fixture',
    client_email:'worker@sharepass-fixture.iam.gserviceaccount.com',
    private_key:privateKey.export({type:'pkcs8',format:'pem'})
  };
  let invalidToken;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if(url==='https://oauth2.googleapis.com/token'){
      assert.equal(options.redirect,'manual');
      assertions.push(options.body.get('assertion'));
      return Response.json({access_token:'fixture-access',expires_in:3600});
    }
    assert.equal(options.redirect,'manual');
    const {message}=JSON.parse(options.body);
    sends.push({url,authorization:options.headers.Authorization,message});
    return message.token===invalidToken
      ?Response.json({error:{details:[{errorCode:'UNREGISTERED'}]}},{status:404})
      :Response.json({name:'fixture-message'});
  });
  const flush=()=>Promise.all(jobs.splice(0));
  const push=(action,headers,token,origin)=>f.call('/api/push/'+action,{token},'',origin,headers);
  async function pair(booth,label,character){
    const issued=(await f.call('/api/admin/setup',{action:'invite',booth_id:booth,staff_name:label,device_label:label})).body;
    const invite=new URL(issued.qr_url).searchParams.get('invite'),verifier=character.repeat(43);
    assert.equal((await f.call('/api/device/connect',{invite,verifier},'')).status,200);
    return {id:issued.devices.find(device=>device.label===label).id,headers:{'X-SharePass-Session':verifier}};
  }
  try{
    const booth=(await f.call('/api/admin/setup',{action:'booth',name:'East',location:'East gate'})).body.booths.find(row=>row.name==='East');
    const a=await pair('B1','Phone A','A'),b=await pair('B1','Phone B','B'),c=await pair(booth.id,'Phone C','C');
    const tokenA='fcm-token-a-0000000000000000',tokenA2='fcm-token-a-2222222222222222';
    const tokenB='fcm-token-b-0000000000000000',tokenC='fcm-token-c-0000000000000000';
    assert.equal((await push('register',{},tokenA)).status,401);
    assert.deepEqual((await push('register',a.headers,tokenA)).body,{configured:false,registered:false});
    env.SHAREPASS_FCM_SERVICE_ACCOUNT=JSON.stringify(account);
    assert.equal((await push('register',a.headers,tokenA,'https://foreign.example')).status,403);
    assert.equal((await push('register',a.headers,'invalid token')).status,400);
    assert.deepEqual((await push('register',a.headers,tokenA)).body,{configured:true,registered:true});
    assert.equal((await push('register',b.headers,tokenA)).status,409);
    assert.equal((await push('register',b.headers,tokenB)).status,200);
    assert.equal((await push('register',c.headers,tokenC)).status,200);
    assert.equal((await push('register',a.headers,tokenA2)).status,200);
    await push('unregister',a.headers,tokenA);
    const poster=(await f.call('/api/booth')).body;
    const path='/api/public'+new URL(poster.url).pathname;
    const draft={request_id:crypto.randomUUID(),name:'Private Fixture Guest',phone:'',email:'fixture@example.test',
      recipients:[],quantities:{normal:1,vip:0,vvip:0}};
    assert.equal((await f.call(path,draft,'')).status,200);
    assert.equal(jobs.length,1);
    await flush();
    assert.deepEqual(sends.map(send=>send.message.token).sort(),[tokenA2,tokenB].sort());
    assert.equal(assertions.length,1);
    const [header,claims,signature]=assertions[0].split('.');
    assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'RS256');
    const claim=JSON.parse(Buffer.from(claims,'base64url'));
    assert.equal(claim.iss,account.client_email);
    assert.equal(claim.aud,'https://oauth2.googleapis.com/token');
    assert.equal(claim.scope,'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+claims),publicKey,Buffer.from(signature,'base64url')),true);
    for(const send of sends){
      assert.equal(send.url,'https://fcm.googleapis.com/v1/projects/sharepass-fixture/messages:send');
      assert.equal(send.authorization,'Bearer fixture-access');
      assert.deepEqual(send.message.data,{type:'sharepass_queue'});
      assert.deepEqual(send.message.notification,{title:'SharePass',body:'A pass deposit is ready for review.'});
      assert.equal(send.message.android.notification.channel_id,'booth_queue');
      assert.equal(JSON.stringify(send.message).includes(draft.name),false);
      assert.equal(JSON.stringify(send.message).includes(draft.email),false);
      assert.equal(JSON.stringify(send.message).includes(draft.request_id),false);
    }
    assert.equal((await f.call(path,draft,'')).status,200);
    assert.equal(jobs.length,0);
    assert.equal((await f.call(path,{...draft,request_id:crypto.randomUUID()},'')).status,200);
    await flush();
    assert.equal(sends.length,4);
    const east=(await f.call('/api/booth',undefined,'',undefined,c.headers)).body;
    assert.equal((await f.call('/api/public'+new URL(east.url).pathname,{...draft,request_id:crypto.randomUUID()},'')).status,200);
    await flush();
    assert.equal(sends.at(-1).message.token,tokenC);
    assert.equal(assertions.length,1);
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET session_expires=0 WHERE id=?').run(a.id);
    assert.equal((await push('register',b.headers,tokenA2)).status,200);
    assert.equal((await f.call('/api/admin/setup',{action:'revoke',device_id:c.id})).status,200);
    assert.deepEqual(f.sqlite.prepare('SELECT token FROM sharepass_push_tokens').all().map(row=>row.token),[tokenA2]);
    invalidToken=tokenA2;
    assert.equal((await f.call(path,{...draft,request_id:crypto.randomUUID()},'')).status,200);
    await flush();
    assert.equal(sends.length,6);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM sharepass_push_tokens').get().count,0);
  }finally{await flush();f.close();}
});

test('the owner report counts received, available, reserved and handed-over passes separately per booth',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.call('/api/admin/report',undefined,'')).status,401);
    assert.deepEqual((await f.call('/api/admin/report')).body.booths,[
      {id:'B1',name:'Box office',deposits:0,received:0,available:0,pending:0,handed_over:0}
    ]);
    const created=(await f.call('/api/deposits',deposit)).body;
    const releasePath='/api/deposits/'+created.deposit.id+'/release';
    async function reserve(id,quantities){
      const claim=(await f.call('/api/verify',{collection_code:created.collection_code})).body;
      const released=await f.call(releasePath,{request_id:id,claim_token:claim.claim_token,
        packet_id:claim.deposit.packet_id,version:claim.deposit.version,quantities});
      assert.equal(released.status,200);
      return released.body.collection;
    }
    const handed=await reserve('report-reserve-a',{normal:2,vip:0,vvip:0});
    assert.equal((await f.call('/api/collections/'+handed.id+'/handover',{
      request_id:'report-handover-a',version:handed.version,handover_confirmed:true
    })).status,200);
    await reserve('report-reserve-b',{normal:0,vip:1,vvip:0});
    const configured=await f.call('/api/admin/setup',{action:'booth',name:'East Gate',location:'Concourse'});
    const east=configured.body.booths.find(booth=>booth.name==='East Gate');
    const issued=(await f.call('/api/admin/setup',{action:'invite',booth_id:east.id,staff_name:'East desk',device_label:'East phone'})).body;
    const invite=new URL(issued.qr_url).searchParams.get('invite'),verifier='E'.repeat(43);
    assert.equal((await f.call('/api/device/connect',{invite,verifier},'')).status,200);
    const headers={'X-SharePass-Session':verifier,'X-SharePass-Client':'0.8.0'};
    assert.equal((await f.call('/api/deposits',{...deposit,request_id:'east-deposit',location:'E-01',
      quantities:{normal:0,vip:0,vvip:0,mip:3}},'',undefined,headers)).status,200);
    assert.equal((await f.call('/api/admin/report',undefined,'',undefined,headers)).status,404);
    const report=await f.call('/api/admin/report');
    assert.equal(report.status,200);
    assert.deepEqual(report.body.booths,[
      {id:'B1',name:'Box office',deposits:1,received:6,available:3,pending:1,handed_over:2},
      {id:east.id,name:'East Gate',deposits:1,received:3,available:3,pending:0,handed_over:0}
    ]);
  }finally{f.close();}
});

test('browser push is signed, payload-free and sent only for new drafts',async t=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const pub=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url');
  const config={SHAREPASS_WEB_PUSH_PUBLIC_KEY:pub,SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))};
  const jobs=[],sends=[];
  const f=fixture({env:config,ctx:{waitUntil:p=>jobs.push(p)}});
  const target='https://fcm.googleapis.com/fcm/send/sharepass-fixture';
  let responseStatus=201;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    sends.push({url,options});
    return new Response(null,{status:responseStatus});
  });
  const flush=()=>Promise.all(jobs.splice(0));
  try{
    assert.equal((await f.call('/api/web-push',undefined,'')).status,401);
    assert.equal((await f.call('/api/web-push')).body.public_key,pub);
    assert.equal((await f.call('/api/web-push',{endpoint:'http://127.0.0.1/private/endpoint'})).status,400);
    assert.equal((await f.call('/api/web-push',{endpoint:target},'account-one','https://foreign.example')).status,403);
    assert.equal((await f.call('/api/web-push',{endpoint:target})).body.registered,true);
    const poster=(await f.call('/api/booth')).body;
    const path='/api/public'+new URL(poster.url).pathname;
    const first={request_id:crypto.randomUUID(),name:'Sensitive fixture',phone:'',recipients:[],quantities:{normal:1,vip:0,vvip:0}};
    for(const draft of [first,first,{...first,request_id:crypto.randomUUID()}]){
      assert.equal((await f.call(path,draft,'')).status,200);
    }
    await flush();
    assert.equal(sends.length,2);
    for(const {url,options} of sends){
      assert.equal(url,target);
      assert.equal(options.redirect,'manual');
      assert.equal(options.body,undefined);
      assert.equal(options.headers.Topic,'sharepass-queue');
      const [,token,key]=options.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
      assert.equal(key,pub);
      const [h,p,s]=token.split('.');
      assert.equal(JSON.parse(Buffer.from(p,'base64url')).aud,'https://fcm.googleapis.com');
      assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(s,'base64url'),Buffer.from(h+'.'+p)),true);
    }
    responseStatus=410;
    assert.equal((await f.call(path,{...first,request_id:crypto.randomUUID()},'')).status,200);
    await flush();
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_web_push').get().n,0);
  }finally{await flush();f.close();}
});

test('competing confirmation requests cannot both confirm the same physical handover',async()=>{
  const f=fixture();
  try{
    const {body:created}=await f.call('/api/deposits',deposit);
    const {body:claim}=await f.call('/api/verify',{collection_code:created.collection_code});
    const {body:reserved}=await f.call('/api/deposits/'+created.deposit.id+'/release',{
      request_id:'reserve-race-01',claim_token:claim.claim_token,packet_id:created.deposit.packet_id,
      version:claim.deposit.version,quantities:{normal:4,vip:2,vvip:0}
    });
    const path='/api/collections/'+reserved.collection.id+'/handover';
    const confirmation={version:reserved.collection.version,handover_confirmed:true};
    const results=await Promise.all(['confirm-race-01','confirm-race-02'].map(request_id=>f.call(path,{...confirmation,request_id})));
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM sharepass_ledger_audit WHERE payload->>'action'='HANDOVER_CONFIRMED'").get().n,1);
    assert.deepEqual((await f.call('/api/admin/report')).body.booths[0],{id:'B1',name:'Box office',deposits:1,received:6,available:0,pending:0,handed_over:6});
  }finally{f.close();}
});

test('a native device reconciles the same completed handover without writing or offering another physical pickup',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
  const pub=publicKey.export({format:'jwk'});
  const vapid=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
  const scheduled=[];
  const f=fixture({env:{SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),
    SHAREPASS_WEB_PUSH_PUBLIC_KEY:vapid},ctx:{waitUntil:work=>scheduled.push(work)}});
  async function pair(label,verifier){
    const invite=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:label,device_label:label});
    assert.equal(invite.status,200);
    const paired=await f.call('/api/device/connect',{code:invite.body.code,verifier},'');
    assert.equal(paired.status,200);
    return {operator:paired.body.session_key,headers:{'X-SharePass-Session':verifier,'X-SharePass-Client':'0.9.6'}};
  }
  const native=(device,path,body)=>f.call(path,body,'','https://test.example',device.headers);
  try{
    const original=await pair('Fixture original operator','A'.repeat(43));
    const peer=await pair('Fixture peer','B'.repeat(43));
    const {body:created}=await f.call('/api/deposits',deposit);
    const {body:claim}=await native(original,'/api/verify',{collection_code:created.collection_code});
    const releasePath='/api/deposits/'+created.deposit.id+'/release';
    const release={request_id:'old-native-release',claim_token:claim.claim_token,packet_id:created.deposit.packet_id,
      version:claim.deposit.version,quantities:{normal:2,vip:1,vvip:0}};
    const reserved=await native(original,releasePath,release);
    assert.equal(reserved.status,200);
    const collection=reserved.body.collection;
    assert.equal((await native(original,releasePath,release)).body.replayed,true);
    const confirmPath='/api/collections/'+collection.id+'/handover';
    const confirm={request_id:'supervisor-handover',version:collection.version,handover_confirmed:true};
    const committed=await f.call(confirmPath,confirm);
    assert.equal(committed.status,200);
    assert.equal(committed.body.collection.status,'HANDED_OVER');
    await Promise.all(scheduled);
    const priorAlerts=scheduled.length;
    const snapshot=()=>f.sqlite.prepare(`SELECT d.revision,
      (SELECT count(*) FROM sharepass_ledger_requests) AS requests,
      (SELECT count(*) FROM sharepass_ledger_audit) AS audit
      FROM sharepass_ledger_deposits d WHERE d.id=?`).get(created.deposit.id);
    const originalState=snapshot();
    const staleRelease=await native(original,releasePath,release);
    assert.equal(staleRelease.status,409);
    assert.equal(staleRelease.body.notExecuted,true);
    assert.match(staleRelease.body.error,/Do not hand over the passes again/);
    assert.equal((await native(original,confirmPath,{...confirm,request_id:release.request_id})).status,409);
    const retry={...confirm,request_id:'native-saved-confirm'};
    const recovered=await native(original,confirmPath,retry);
    assert.equal(recovered.status,200);
    assert.equal(recovered.body.replayed,true);
    assert.equal(recovered.body.collection.id,collection.id);
    assert.equal(recovered.body.collection.status,'HANDED_OVER');
    assert.equal(recovered.body.collection.version,collection.version+1);
    assert.deepEqual(recovered.body.deposit.remaining,{normal:2,vip:1,vvip:0});
    assert.equal(recovered.body.deposit.pending_collection,null);
    assert.equal(recovered.body.depositor_update,undefined);
    assert.equal((await native(peer,confirmPath,{...retry,request_id:'peer-confirm'})).status,403);
    assert.equal((await native(original,confirmPath,{...retry,version:collection.version+1})).status,409);
    assert.equal((await native(original,'/api/collections/'+crypto.randomUUID()+'/handover',retry)).status,404);

    const verifier='C'.repeat(43);
    const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('hex');
    assert.equal((await f.call('/api/mobile/authorize',{challenge})).status,200);
    const supervisor=await native({headers:{'X-SharePass-Session':verifier}},confirmPath,{...retry,request_id:'native-admin-confirm'});
    assert.equal(supervisor.status,200);
    assert.equal(supervisor.body.replayed,true);

    const setup=await f.call('/api/admin/setup',{action:'booth',name:'Other fixture booth',location:'Side door'});
    const other=setup.body.booths.find(row=>row.name==='Other fixture booth');
    f.sqlite.prepare('UPDATE sharepass_configured_staff SET booth_id=? WHERE id=?').run(other.id,original.operator);
    assert.equal((await native(original,confirmPath,{...retry,request_id:'wrong-booth-confirm'})).status,409);
    assert.deepEqual(snapshot(),originalState);
    assert.equal(scheduled.length,priorAlerts);
  }finally{await Promise.all(scheduled);f.close();}
});

test('failed legacy import rolls back every ledger row and does not fence the old snapshot',async()=>{
  const f=fixture();
  try{
    const old={deposits:[{
      id:'old-one',event_id:scope.event_id,booth_id:'B1',location:'S1',packet_id:'PKT-12345678'
    },{
      id:'old-two',event_id:scope.event_id,booth_id:'B1',location:'S2',packet_id:'PKT-12345678'
    }],codes:[],collections:[],claims:[],requests:[],failures:[],audit:[]};
    f.sqlite.prepare('INSERT INTO sharepass_workspaces VALUES(?,?,?)').run('account-one',3,JSON.stringify(old));
    assert.equal((await f.call('/api/admin/report')).status,503);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,0);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_ready').get().n,0);
    assert.equal(f.sqlite.prepare('UPDATE sharepass_workspaces SET revision=4 WHERE owner_id=?').run('account-one').changes,1);
  }finally{f.close();}
});

test('at the storage ceiling new deposits pause while saved replays and pickup finish',async()=>{
  let bytes=8999999999;
  const f=fixture({storageBytes:()=>bytes});
  try{
    const created=await f.call('/api/deposits',deposit);
    assert.equal(created.status,200);
    bytes=9000000000;
    assert.deepEqual((await f.call('/api/admin/report')).body.storage,{used_bytes:bytes,limit_bytes:bytes,at_limit:true});
    const paused=await f.call('/api/deposits',{...deposit,request_id:'deposit-paused-0001',location:'A-02'});
    assert.equal(paused.status,507);
    assert.equal(paused.body.notExecuted,true);
    assert.equal((await f.call('/api/deposits',deposit)).body.replayed,true);
    const claim=(await f.call('/api/verify',{collection_code:created.body.collection_code})).body;
    const release=await f.call('/api/deposits/'+created.body.deposit.id+'/release',{
      request_id:'capacity-release-01',claim_token:claim.claim_token,packet_id:created.body.deposit.packet_id,
      version:claim.deposit.version,quantities:deposit.quantities
    });
    assert.equal(release.status,200);
    const finish=await f.call('/api/collections/'+release.body.collection.id+'/handover',{
      request_id:'capacity-handover-01',version:release.body.collection.version,handover_confirmed:true
    });
    assert.equal(finish.status,200);
    assert.deepEqual(finish.body.deposit.remaining,{normal:0,vip:0,vvip:0});
  }finally{f.close();}
});

test('a recycled code requires the new receipt and never redirects an old message or claim to new stock',async()=>{
  const env={};
  const f=fixture({env});
  try{
    const {url}= (await f.call('/api/booth')).body;
    const publicPath='/api/public'+new URL(url).pathname;
    const ticket=crypto.randomUUID(),code='1337',quantities={normal:2,vip:0,vvip:0};
    const guest={request_id:ticket,intake_version:2,name:'Fixture guest',phone:'+12025550120',quantities,
      recipients:[{name:'Fixture collector',phone:'+12025550121',quantities}]};
    assert.equal((await f.call(publicPath,guest,'')).status,200);
    const original=await f.call('/api/queue/'+ticket+'/confirm',{custody_confirmed:true,custom_code:code});
    assert.equal(original.status,200);
    const old=original.body.deposit;
    const receiptPath=publicPath+'?ticket='+ticket;
    assert.equal((await f.call(receiptPath,undefined,'')).body.collection_reference,old.packet_id);
    const reserve=async(deposit,claim,amount,packet=deposit.packet_id)=>f.call('/api/deposits/'+deposit.id+'/release',{
      request_id:crypto.randomUUID(),claim_token:claim.claim_token,version:claim.deposit.version,packet_id:packet,
      quantities:{normal:amount,vip:0,vvip:0}
    });
    const finish=(collection,request_id)=>f.call('/api/collections/'+collection.id+'/handover',{
      request_id,handover_confirmed:true,version:collection.version
    });
    const create=(location,request_id)=>f.call('/api/deposits',{...deposit,request_id,location,custom_code:code});
    const ordinary=await f.call('/api/verify',{collection_code:code});
    assert.equal(ordinary.status,200);
    const first=await reserve(old,ordinary.body,1);
    assert.equal(first.status,200);
    assert.equal((await finish(first.body.collection,'first-handover')).status,200);
    env.SHAREPASS_ALLOW_CODE_REUSE='1';
    assert.equal((await create('reuse-partial','reuse-partial')).status,409);
    const lastClaim=(await f.call('/api/verify',{collection_code:code})).body;
    const last=await reserve(old,lastClaim,1);
    assert.equal(last.status,200);
    assert.equal((await f.call(receiptPath,undefined,'')).body.status,'checking');
    assert.equal((await create('reuse-pending','reuse-pending')).status,409);
    assert.equal((await finish(last.body.collection,'last-handover')).status,200);
    env.SHAREPASS_ALLOW_CODE_REUSE='0';
    assert.equal((await f.call('/api/context')).body.pickup_code_reuse_enabled,false);
    assert.equal((await create('reuse-disabled','reuse-disabled')).status,409);
    delete env.SHAREPASS_ALLOW_CODE_REUSE;
    assert.equal((await f.call('/api/context')).body.pickup_code_reuse_enabled,true);
    const attempts=await Promise.all([create('reuse-candidate-A','reuse-candidate-A'),create('reuse-candidate-B','reuse-candidate-B')]);
    assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
    const current=attempts.find(r=>r.status===200).body.deposit;
    assert.notEqual(current.id,old.id);
    assert.notEqual(current.packet_id,old.packet_id);
    assert.deepEqual((await f.call(receiptPath,undefined,'')).body,{status:'closed',queue_ref:ticket.slice(-6).toUpperCase()});
    assert.equal((await finish(last.body.collection,'last-handover')).body.replayed,true);
    const invite=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'Fixture staff',device_label:'Legacy'});
    const token='D'.repeat(43);
    assert.equal((await f.call('/api/device/connect',{code:invite.body.code,verifier:token},'')).status,200);
    for(const [owner,headers] of [['account-one',{}],['',{'X-SharePass-Session':token}]]){
      const blocked=await f.call('/api/verify',{collection_code:code},owner,undefined,headers);
      assert.equal(blocked.status,409);
      assert.deepEqual(Object.keys(blocked.body).sort(),['error','notExecuted','pickup_reference_required']);
      assert.equal(blocked.body.pickup_reference_required,true);
    }
    const stale=await f.call('/api/verify',{collection_code:code,collection_reference:old.packet_id});
    assert.equal(stale.status,404);
    assert.deepEqual(Object.keys(stale.body).sort(),['error','notExecuted']);
    delete env.SHAREPASS_ALLOW_CODE_REUSE;
    assert.equal((await f.call('/api/verify',{collection_code:code})).status,409);
    const lookup=await f.call('/api/verify',{collection_code:code,collection_reference:current.packet_id});
    assert.equal(lookup.status,200);
    assert.equal(lookup.body.deposit.id,current.id);
    assert.equal((await reserve(current,lastClaim,1)).status,409);
    assert.equal((await reserve(current,lookup.body,1,old.packet_id)).status,400);
    assert.equal((await reserve(current,lookup.body,1)).status,200);
  }finally{f.close();}
});

test('aged booth receipts retain live or pending custody and expire unused or finished receipts',async t=>{
  const hour=60*60*1000,started=Date.now();
  let now=started;
  t.mock.method(Date,'now',()=>now);
  const f=fixture();
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname,path='/api/public'+poster;
    const quantities={normal:1,vip:0,vvip:0};
    const draft={name:'Fixture guest',phone:'+12025550101',quantities,intake_version:2,
      recipients:[{name:'Fixture collector',phone:'+12025550102',quantities}]};
    const submit=async()=>{
      const ticket=crypto.randomUUID();
      assert.equal((await f.call(path,{...draft,request_id:ticket},'')).status,200);
      return ticket;
    };
    const confirm=async(location,valid_minutes)=>{
      const ticket=await submit();
      const response=await f.call('/api/queue/'+ticket+'/confirm',{location,valid_minutes,custody_confirmed:true});
      assert.equal(response.status,200);
      return {ticket,...response.body};
    };
    const read=async ticket=>f.call(path+'?ticket='+ticket,undefined,'');
    const reserve=async(data,id)=>{
      const found=(await f.call('/api/verify',{collection_code:data.collection_code})).body;
      const result=await f.call('/api/deposits/'+data.deposit.id+'/release',{
        request_id:id,version:found.deposit.version,claim_token:found.claim_token,packet_id:data.deposit.packet_id,quantities
      });
      assert.equal(result.status,200);
      return result.body.collection;
    };
    const handover=async(collection,id)=>f.call('/api/collections/'+collection.id+'/handover',{
      request_id:id,version:collection.version,handover_confirmed:true
    });
    const unconfirmed=await submit();
    const long=await confirm('Receipt-long',2880);
    const refresh=await confirm('Receipt-refresh',1440);
    const expired=await confirm('Receipt-expired',1440);
    const finished=await confirm('Receipt-finished',2880);
    const pending=await confirm('Receipt-pending',60);
    const pendingCollection=await reserve(pending,'receipt-pending-reserve');
    assert.equal((await handover(await reserve(finished,'receipt-finished-reserve'),'receipt-finished-handover')).status,200);
    now=started+23*hour;
    const renewed=await f.call('/api/codes/refresh',{
      request_id:crypto.randomUUID(),collection_code:refresh.collection_code,packet_id:refresh.deposit.packet_id
    });
    assert.equal(renewed.status,200);
    assert.notEqual(renewed.body.collection_code,refresh.collection_code);
    now=started+27*hour;
    await submit(); // Sweep on a different guest's new submission.
    assert.equal((await read(long.ticket)).body.collection_code,long.collection_code);
    assert.equal((await read(refresh.ticket)).body.collection_code,renewed.body.collection_code);
    assert.deepEqual((await read(pending.ticket)).body,{status:'checking',queue_ref:pending.ticket.slice(-6).toUpperCase()});
    for(const ticket of [unconfirmed,expired.ticket,finished.ticket])assert.equal((await read(ticket)).status,404);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,5);
    assert.equal((await handover(pendingCollection,'receipt-pending-handover')).status,200);
    now=started+48*hour;
    await submit();
    for(const ticket of [long.ticket,refresh.ticket,pending.ticket])assert.equal((await read(ticket)).status,404);
  }finally{f.close();}
});

test('explicit receipt opt-in follows the current confirmed code lifetime',async t=>{
  const hour=60*60*1000,started=Date.now();
  let now=started;
  t.mock.method(Date,'now',()=>now);
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const key=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url');
  const f=fixture({env:{SHAREPASS_WEB_PUSH_PUBLIC_KEY:key,SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))}});
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:201}));
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname,path='/api/public'+poster;
    const ticket=crypto.randomUUID(),quantities={normal:1,vip:0,vvip:0};
    const draft={name:'Fixture guest',phone:'+12025550101',quantities,intake_version:2,request_id:ticket,
      recipients:[{name:'Fixture collector',phone:'+12025550102',quantities}]};
    assert.equal((await f.call(path,draft,'')).status,200);
    const enable=async()=>f.call(path+'/alerts',{action:'enable',ticket,endpoint:'https://fcm.googleapis.com/fcm/send/aged-receipt-fixture'},'');
    assert.equal((await enable()).body.expires_at,started+26*hour);
    assert.equal((await f.call('/api/queue/'+ticket+'/confirm',{location:'Receipt-alert',valid_minutes:2880,custody_confirmed:true})).status,200);
    now=started+hour;
    assert.equal((await enable()).body.expires_at,started+48*hour);
    assert.equal(f.sqlite.prepare('SELECT expires_at FROM sharepass_receipt_push WHERE ticket=?').get(ticket).expires_at,started+48*hour);
    now=started+28*hour;
    assert.equal((await f.call(path,{...draft,request_id:crypto.randomUUID()},'')).status,200);
    assert.equal((await enable()).body.expires_at,started+48*hour);
    now=started+48*hour;
    assert.equal((await enable()).status,404);
  }finally{f.close();}
});

test('aged confirmed queue rows wait for their workspace ledger import before pruning',async()=>{
  const f=fixture();
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname,path='/api/public'+poster;
    const confirmed=crypto.randomUUID(),unconfirmed=crypto.randomUUID();
    const insert=f.sqlite.prepare('INSERT INTO sharepass_booth_queue(token,workspace,booth_id,submitted_at,expires_at,payload,confirmed) VALUES(?,?,?,?,?,?,?)');
    insert.run(confirmed,'account-one','B1',0,0,'{}',1);
    insert.run(unconfirmed,'account-one','B1',0,0,'{}',0);
    const quantities={normal:1,vip:0,vvip:0};
    const submit=()=>f.call(path,{name:'Fixture guest',phone:'+12025550101',quantities,intake_version:2,request_id:crypto.randomUUID(),
      recipients:[{name:'Fixture collector',phone:'+12025550102',quantities}]},'');
    const row=f.sqlite.prepare('SELECT confirmed FROM sharepass_booth_queue WHERE token=?');
    assert.equal((await submit()).status,200);
    assert.equal(row.get(confirmed).confirmed,1);
    assert.equal(row.get(unconfirmed),undefined);
    assert.equal((await f.call(state)).status,200);
    assert.equal((await submit()).status,200);
    assert.equal(row.get(confirmed),undefined);
  }finally{f.close();}
});

test('staff request identifiers cannot forge a guest receipt',async()=>{
  const f=fixture();
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname;
    const path='/api/public'+poster,ticket=crypto.randomUUID();
    const quantities={normal:1,vip:0,vvip:0};
    const draft={name:'Fixture guest',phone:'+12025550101',quantities,intake_version:2,request_id:ticket,
      recipients:[{name:'Fixture collector',phone:'+12025550102',quantities}]};
    assert.equal((await f.call(path,draft,'')).status,200);
    const reservedId='booth-'+ticket;
    assert.equal((await f.call('/api/deposits',{...deposit,request_id:reservedId})).status,400);
    assert.equal((await f.call('/api/deposits',deposit)).status,200);
    const legacy=f.sqlite.prepare('UPDATE sharepass_ledger_requests SET id=? WHERE owner=? AND id=?')
      .run(reservedId,'account-one',deposit.request_id);
    assert.equal(legacy.changes,1);
    const receipt=await f.call(path+'?ticket='+ticket,undefined,'');
    assert.equal(receipt.status,200);
    assert.deepEqual(receipt.body,{status:'submitted',queue_ref:ticket.slice(-6).toUpperCase()});
  }finally{f.close();}
});

test('staff desk has an install manifest and a scoped Android setup link with web fallback',async()=>{
  const origin='https://test.example';
  const fetchPage=path=>worker.fetch(new Request(origin+path,{headers:{'oai-authenticated-user-id':'account-one'}}),{});
  const staff=await fetchPage('/staff');
  assert.equal(staff.status,200);
  assert.match(await staff.text(),/<link rel="manifest" href="\/staff.webmanifest">/);
  const metadata=await fetchPage('/staff.webmanifest');
  assert.equal(metadata.status,200);
  assert.match(metadata.headers.get('Content-Type'),/^application\/manifest\+json/);
  const manifest=await metadata.json();
  assert.equal(manifest.start_url,'/staff');
  assert.equal(manifest.display,'standalone');
  for(const size of [192,512]){
    const icon=manifest.icons.find(item=>item.sizes===size+'x'+size);
    assert(icon);
    const bytes=Buffer.from(await (await fetchPage(icon.src)).arrayBuffer());
    assert.equal(bytes.readUInt32BE(16),size);
    assert.equal(bytes.readUInt32BE(20),size);
  }
  const links=await worker.fetch(new Request(origin+'/.well-known/assetlinks.json'),{});
  assert.equal(links.status,200);
  assert.match(links.headers.get('Content-Type'),/^application\/json/);
  const [link]=await links.json();
  assert.deepEqual(link.relation,['delegate_permission/common.handle_all_urls']);
  assert.equal(link.target.package_name,'in.sharepass.foundation');
  assert.equal(link.target.sha256_cert_fingerprints[0].replaceAll(':','').toLowerCase(),
    '0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12');
  const fallback=await fetchPage('/app-setup?invite=7b5fde7e-1a21-4e59-a568-1e3760963d3d');
  const old=await fetchPage('/connect');
  assert.equal(fallback.status,200);
  assert.equal(await fallback.text(),await old.text());
  const f=fixture();
  try{
    const response=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'Test desk',device_label:'Test browser'});
    assert.equal(response.status,200);
    assert.equal(new URL(response.body.qr_url).pathname,'/app-setup');
  }finally{f.close();}
});
