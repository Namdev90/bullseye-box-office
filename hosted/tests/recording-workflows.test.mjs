import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
  db.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('owner@example.test','owner','Owner');
  const DB={prepare(sql){return {bind(...values){const statement=db.prepare(sql);return {
    first:async()=>statement.get(...values)||null,
    all:async()=>({results:statement.all(...values)}),run:async()=>({meta:{changes:statement.run(...values).changes}}),
    exec:()=>statement.columns().length?{results:statement.all(...values)}:{meta:{changes:statement.run(...values).changes}}
  };}};},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s.exec());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  async function call(path,body,session=null,publicRequest=false,extraHeaders={}){
    const headers=session?{'X-SharePass-Session':session}:publicRequest?{}:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};
    Object.assign(headers,extraHeaders);
    if(body)Object.assign(headers,{'Content-Type':'application/json',Origin:'https://test.example'});
    const response=await worker.fetch(new Request('https://test.example'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),{DB,SHAREPASS_OWNER_EMAIL:'owner@example.test'});
    return {status:response.status,body:await response.json()};
  }
  async function pair(name,letter){const invite=await call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:name});const token=letter.repeat(43);assert.equal((await call('/api/device/connect',{code:invite.body.code,verifier:token},null,true)).status,200);return token;}
  return {db,call,pair,close:()=>db.close()};
}
const quantities={normal:1,vip:0,vvip:0};
const draft=()=>({name:'Synthetic depositor',phone:'+12025550101',quantities,intake_version:2,request_id:crypto.randomUUID(),recipients:[{name:'Synthetic collector',phone:'+12025550102',quantities}]});
const deposit={request_id:'fixture-deposit',location:'A-01',custody_confirmed:true,quantities};

test('versioned static assets cache safely while authenticated APIs remain no-store',async()=>{
  const html=await (await worker.fetch(new Request('https://test.example/'),{})).text();
  const path=/href="(\/brand.css\?v=[^"]+)"/.exec(html)[1];
  const asset=await worker.fetch(new Request('https://test.example'+path),{});
  assert.equal(asset.status,200);assert.match(asset.headers.get('Cache-Control'),/immutable/);
  const cached=await worker.fetch(new Request('https://test.example'+path,{headers:{'If-None-Match':asset.headers.get('ETag')}}),{});
  assert.equal(cached.status,304);assert.equal(await cached.text(),'');
  const unversioned=await worker.fetch(new Request('https://test.example/brand.css'),{});
  assert.equal(unversioned.headers.get('Cache-Control'),'no-cache');
  const denied=await worker.fetch(new Request('https://test.example/api/context?v=33'),{});
  assert.equal(denied.headers.get('Cache-Control'),'no-store');
});

test('submission never allocates a code; approval creates one and the private receipt updates automatically',async t=>{
  const f=fixture();t.after(f.close);
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,first=draft(),second=draft();
  for(const input of [first,first,second]){
    const submitted=await f.call(path,input,null,true);assert.equal(submitted.status,200);assert.equal(submitted.body.collection_code,undefined);
    assert.equal(submitted.body.name,input.name);
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sharepass_ledger_codes').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,0);
  assert.equal((await f.call(path+'?ticket='+first.request_id,undefined,null,true)).body.collection_code,undefined);
  const [one,two]=await Promise.all([first,second].map(input=>f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})));
  assert.equal(one.status,200);assert.equal(two.status,200);assert.match(one.body.collection_code,/^[0-9]{4}$/);
  assert.notEqual(one.body.collection_code,two.body.collection_code);assert.match(one.body.depositor_receipt.message,/Deposit confirmed by Owner/);
  const receipt=await f.call(path+'?ticket='+first.request_id,undefined,null,true);
  assert.equal(receipt.body.status,'confirmed');assert.equal(receipt.body.collection_code,one.body.collection_code);
  assert.equal(receipt.body.recipients[0].name,'Synthetic collector');
  assert.equal((await f.call('/api/queue/'+first.request_id+'/confirm',{custody_confirmed:true})).body.replayed,true);
  assert.equal((await f.call('/api/deposits/'+one.body.deposit.id+'/receipt')).body.collection_code,one.body.collection_code);
  const rotated=await f.call('/api/codes/refresh',{request_id:crypto.randomUUID(),collection_code:one.body.collection_code,packet_id:one.body.deposit.packet_id});
  assert.equal(rotated.status,200);
  assert.equal((await f.call('/api/deposits/'+one.body.deposit.id+'/receipt')).body.collection_code,rotated.body.collection_code);
  assert.equal((await f.call(path,first,null,true)).body.collection_code,rotated.body.collection_code);
});

test('a full code pool does not prevent intake or consume stock before staff verification',async t=>{
  const f=fixture();t.after(f.close);
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,input=draft();
  const insert=f.db.prepare('INSERT INTO sharepass_ledger_codes(owner,event,code,deposit_id) VALUES(?,?,?,?)');
  for(let number=0;number<10000;number++)insert.run('owner','training-event-001',String(number).padStart(4,'0'),'synthetic-held');
  assert.equal((await f.call(path,input,null,true)).status,200);
  assert.equal((await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})).status,409);
  assert.equal(f.db.prepare('SELECT confirmed FROM sharepass_booth_queue WHERE token=?').get(input.request_id).confirmed,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,0);
  f.db.prepare("DELETE FROM sharepass_ledger_codes WHERE code='0420'").run();
  const accepted=await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true});
  assert.equal(accepted.status,200);assert.equal(accepted.body.collection_code,'0420');
});

test('archiving closes new intake and setup while preserving current receipts and pickup',async t=>{
  const f=fixture();t.after(f.close);
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname;
  const active=await f.call('/api/deposits',deposit);assert.equal(active.status,200);
  const invite=await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'Late staff'});
  assert.equal((await f.call('/api/admin/setup',{action:'archive-booth',booth_id:'B1',confirmed:false})).status,400);
  assert.equal((await f.call('/api/admin/setup',{action:'archive-booth',booth_id:'B1',confirmed:true})).status,200);
  assert.equal((await f.call(path,undefined,null,true)).body.archived,true);
  assert.equal((await f.call(path,draft(),null,true)).status,409);
  assert.equal((await f.call('/api/admin/setup',{action:'invite',booth_id:'B1',staff_name:'New staff'})).status,400);
  assert.equal((await f.call('/api/device/connect',{code:invite.body.code,verifier:'A'.repeat(43)},null,true)).status,403);
  assert.equal((await f.call('/api/deposits',{...deposit,request_id:'archived-deposit',location:'A-02'})).status,409);
  assert.equal((await f.call('/api/verify',{collection_code:active.body.collection_code})).status,200);
  assert.equal((await f.call('/api/history')).body.deposits.length,1);
  assert.equal((await f.call('/api/admin/report')).body.booths[0].received,1);
});

test('a zero-balance pending handover never becomes a completed history receipt or final depositor draft',async t=>{
  const f=fixture();t.after(f.close);const peer=await f.pair('Synthetic peer','D');
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,input=draft();
  await f.call(path,input,null,true);
  const received=(await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})).body;
  const claim=(await f.call('/api/verify',{collection_code:received.collection_code})).body;
  const released=await f.call('/api/deposits/'+received.deposit.id+'/release',{request_id:crypto.randomUUID(),
    claim_token:claim.claim_token,packet_id:claim.deposit.packet_id,version:claim.deposit.version,quantities});
  assert.equal(released.status,200);
  const receiptPath='/api/deposits/'+received.deposit.id+'/receipt';
  const other=(await f.call(receiptPath,undefined,peer)).body;
  assert.equal(other.deposit.handover_pending,true);assert.equal(other.deposit.pending_collection,null);
  assert.equal(other.depositor_update,undefined);assert.equal(other.deposit.remaining.normal,0);
  const own=(await f.call(receiptPath)).body;
  assert.equal(own.deposit.pending_collection.id,released.body.collection.id);assert.equal(own.depositor_update,undefined);
  await f.call('/api/collections/'+released.body.collection.id+'/handover',{request_id:crypto.randomUUID(),version:released.body.collection.version,handover_confirmed:true});
  const completed=(await f.call(receiptPath)).body;
  assert.equal(completed.deposit.handover_pending,false);assert.match(completed.depositor_update.message,/All passes/);
});

test('archived booths block new private intake and manual completion of empty forms but keep submitted work recoverable',async t=>{
  const f=fixture();t.after(f.close);const session=await f.pair('Synthetic intake staff','E');
  const empty=(await f.call('/api/intakes',{},session)).body;
  const submitted=(await f.call('/api/intakes',{},session)).body;
  const publicPath='/api/public/intake/'+submitted.token;
  assert.equal((await f.call(publicPath,{name:'Existing synthetic guest',quantities},null,true)).status,200);
  await f.call('/api/admin/setup',{action:'archive-booth',booth_id:'B1',confirmed:true});
  assert.equal((await f.call('/api/intakes',{},session)).status,409);
  assert.equal((await f.call('/api/public/intake/'+empty.token,{name:'New synthetic guest',quantities},null,true)).status,409);
  assert.equal((await f.call('/api/intakes/'+empty.token+'/confirm',{manual:true,location:'A-empty',custody_confirmed:true,quantities},session)).status,409);
  const confirm={location:'A-existing',custody_confirmed:true};
  assert.equal((await f.call('/api/intakes/'+submitted.token+'/confirm',confirm,session)).status,200);
  assert.equal((await f.call('/api/intakes/'+submitted.token+'/confirm',confirm,session)).body.replayed,true);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,1);
  assert.equal((await f.call('/api/context')).body.booth_archived,true);
});

test('approval replay preserves the request fingerprint recorded before automatic update contacts existed',async t=>{
  const f=fixture();t.after(f.close);
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,input=draft();
  await f.call(path,input,null,true);
  const accepted=(await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})).body;
  const id='booth-'+input.request_id,row=f.db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE id=?').get(id);
  const stored=JSON.parse(row.payload),fingerprint=JSON.parse(stored.fingerprint);delete fingerprint[1].update_contact;stored.fingerprint=JSON.stringify(fingerprint);
  const oldPayload=JSON.stringify(stored);f.db.prepare('UPDATE sharepass_ledger_requests SET payload=? WHERE id=?').run(oldPayload,id);
  const raw=JSON.parse(f.db.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE id=?').get(accepted.deposit.id).payload);delete raw.update_contact;
  f.db.prepare('UPDATE sharepass_ledger_deposits SET payload=? WHERE id=?').run(JSON.stringify(raw),accepted.deposit.id);
  const replay=await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true});
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.collection_code,accepted.collection_code);
  assert.equal(f.db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE id=?').get(id).payload,oldPayload);
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE id=?').get(accepted.deposit.id).payload).update_contact,undefined);
});

for(const contact of [null,{channel:'none'},{channel:'whatsapp',address:'12025550109',name:'Recorded synthetic contact'}]){
  test('approval replay preserves the recorded update_contact value '+JSON.stringify(contact),async t=>{
    const f=fixture();t.after(f.close);
    const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,input=draft();
    await f.call(path,input,null,true);
    const accepted=(await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})).body;
    const id='booth-'+input.request_id,stored=JSON.parse(f.db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE id=?').get(id).payload);
    const fingerprint=JSON.parse(stored.fingerprint);fingerprint[1].update_contact=contact;stored.fingerprint=JSON.stringify(fingerprint);
    const original=JSON.stringify(stored);f.db.prepare('UPDATE sharepass_ledger_requests SET payload=? WHERE id=?').run(original,id);
    const raw=JSON.parse(f.db.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE id=?').get(accepted.deposit.id).payload);
    raw.update_contact=contact;f.db.prepare('UPDATE sharepass_ledger_deposits SET payload=? WHERE id=?').run(JSON.stringify(raw),accepted.deposit.id);
    const replay=await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true});
    assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.collection_code,accepted.collection_code);
    assert.equal(f.db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE id=?').get(id).payload,original);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE id=?').get(accepted.deposit.id).payload).update_contact,contact);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,1);
  });
}

test('receipt updates use the saved contact and respect opt-out, including deposits without a queue row',async t=>{
  const f=fixture();t.after(f.close);
  const path='/api/public'+new URL((await f.call('/api/booth')).body.url).pathname,input=draft();await f.call(path,input,null,true);
  const accepted=(await f.call('/api/queue/'+input.request_id+'/confirm',{custody_confirmed:true})).body;
  const updates='/api/deposits/'+accepted.deposit.id+'/updates',receipt='/api/deposits/'+accepted.deposit.id+'/receipt';
  assert.equal((await f.call(updates,{request_id:crypto.randomUUID(),packet_id:accepted.deposit.packet_id,channel:'whatsapp',phone:'+12025550103',name:'Corrected synthetic contact'})).status,200);
  const corrected=(await f.call(receipt)).body.depositor_update;
  assert.equal(corrected.address,'12025550103');assert.match(corrected.message,/Corrected synthetic contact/);
  await f.call(updates,{request_id:crypto.randomUUID(),packet_id:accepted.deposit.packet_id,channel:'none'});
  assert.equal((await f.call(receipt)).body.depositor_update,undefined);
  const manual=(await f.call('/api/deposits',{...deposit,request_id:'manual-contact-test',location:'M-01'})).body;
  await f.call('/api/deposits/'+manual.deposit.id+'/updates',{request_id:crypto.randomUUID(),packet_id:manual.deposit.packet_id,channel:'whatsapp',phone:'+12025550104',name:'Manual synthetic contact'});
  assert.equal((await f.call('/api/deposits/'+manual.deposit.id+'/receipt')).body.depositor_update.address,'12025550104');
});

test('All messages acknowledge each person once across devices, including the administrator',async t=>{
  const f=fixture();t.after(f.close);
  const first=await f.pair('Synthetic one','A'),same=await f.pair('Synthetic one','B'),other=await f.pair('Synthetic two','C');
  const message={id:crypto.randomUUID(),booth_id:'all',message:'Synthetic update',per_person:true};
  assert.equal((await f.call('/api/admin/staff-messages',message,first)).status,404);
  assert.equal((await f.call('/api/admin/staff-messages',message)).status,200);
  assert.equal((await f.call('/api/admin/staff-messages',message)).body.messages[0].responses.length,3);
  assert.equal((await f.call('/api/staff-messages/reply',{id:message.id,reply:'working'},first)).status,200);
  assert.equal((await f.call('/api/staff-messages/reply',{id:message.id,reply:'working'},same)).status,200);
  assert.equal((await f.call('/api/queue',undefined,same)).body.messages,undefined);
  assert.equal((await f.call('/api/queue',undefined,other)).body.messages[0].id,message.id);
  assert.equal((await f.call('/api/queue')).body.messages[0].id,message.id);
  assert.equal((await f.call('/api/staff-messages/reply',{id:message.id,reply:'done'},other)).status,200);
  assert.equal((await f.call('/api/admin/staff-messages/reply',{id:message.id,reply:'help'},first)).status,404);
  assert.equal((await f.call('/api/admin/staff-messages/reply',{id:message.id,reply:'help'},null,false,{Cookie:'__Host-sharepass-staff='+first})).status,200);
  assert.deepEqual((await f.call('/api/admin/staff-messages')).body.messages[0].responses.map(person=>person.reply).sort(),['done','help','working']);
});
