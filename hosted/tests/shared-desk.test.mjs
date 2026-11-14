import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
const source=readFileSync('tests/hosted.test.mjs','utf8');
const fixture=Function('DatabaseSync','readFileSync','readdirSync','worker','return ('+source.slice(source.indexOf('function fixture('),source.indexOf('\nconst scope='))+');')(DatabaseSync,readFileSync,readdirSync,worker);
async function staff(f,name,booth='B1',character='S'){
 const invitation=await f.call('/api/admin/setup',{action:'invite',staff_name:name,booth_id:booth,device_label:name});assert.equal(invitation.status,200);
 const token=character.repeat(43),headers={'X-SharePass-Session':token,'X-SharePass-Client':'0.9.21'};
 const paired=await f.call('/api/device/connect',{code:invitation.body.code,verifier:token},'');assert.equal(paired.status,200);
 return {headers,call:(path,body)=>f.call(path,body,'',undefined,headers)};
}
test('one built-in deposit URL is identical for every staff identity and browser',async t=>{
 const f=fixture();t.after(f.close);
 const old=await f.call('/api/admin/setup',{action:'booth',name:'Historical desk',location:'Old location'}),id=old.body.booths.find(b=>b.name==='Historical desk').id;
 const a=await staff(f,'Asha',id),b=await staff(f,'Bea','B1','T');
 for(const actor of [{call:f.call},a,b]){
  assert.equal((await actor.call('/api/booth')).body.url,'https://test.example/deposit');
  const context=(await actor.call('/api/context')).body;assert.equal(context.booth_url,'https://test.example/deposit');assert.equal(context.shared_desk,true);
 }
 assert.equal((await f.call('/api/public/deposit',undefined,'')).status,200);
});
test('any authenticated staff sees and accepts the shared queue, with no code before approval and named staff after it',async t=>{
 const f=fixture();t.after(f.close);const a=await staff(f,'Asha'),b=await staff(f,'Bea','B1','T');
 const ticket=crypto.randomUUID(),body={request_id:ticket,intake_version:2,name:'Taylor',phone:'+12025550101',quantities:{normal:3,vip:1,vvip:0,mip:0},recipients:[{name:'Riya',phone:'+12025550123'}]};
 const submitted=await f.call('/api/public/deposit',body,'');assert.equal(submitted.status,200);assert.equal(submitted.body.collection_code,undefined);
 assert.equal((await a.call('/api/queue')).body.drafts[0].name,'Taylor');assert.equal((await b.call('/api/queue')).body.drafts[0].name,'Taylor');
 const accepted=await b.call('/api/queue/'+ticket+'/confirm',{custody_confirmed:true});assert.equal(accepted.status,200);
 const receipt=(await f.call('/api/public/deposit?ticket='+ticket,undefined,'')).body;
 assert.equal(receipt.status,'confirmed');assert.equal(receipt.staff_name,'Bea');assert.equal(receipt.depositor_name,'Taylor');assert.equal(receipt.recipients[0].name,'Riya');
 assert.equal((await f.call('/api/queue',undefined,'unknown-account')).status,403);
});
test('historical ticket partitions do not prevent pickup; workspace scope, stock concurrency and original handover ownership remain',async t=>{
 const f=fixture();t.after(f.close);const a=await staff(f,'Asha'),b=await staff(f,'Bea','B1','T');
 const created=(await f.call('/api/deposits',{request_id:'shared-old-ticket',location:'S-01',depositor_label:'Taylor',custody_confirmed:true,quantities:{normal:2,vip:0,vvip:0},update_channel:'whatsapp',phone:'+12025550101',name:'Taylor'})).body;
 const d=JSON.parse(f.sqlite.prepare('SELECT payload FROM sharepass_ledger_deposits WHERE id=?').get(created.deposit.id).payload);d.booth_id='B-old-history';
 f.sqlite.prepare('UPDATE sharepass_ledger_deposits SET booth=?,payload=? WHERE id=?').run(d.booth_id,JSON.stringify(d),d.id);
 assert.equal((await a.call('/api/deposits/'+d.id+'/receipt')).status,200);
 const ca=(await a.call('/api/verify',{collection_code:created.collection_code})).body,cb=(await b.call('/api/verify',{collection_code:created.collection_code})).body;
 const release=(actor,claim,id)=>actor.call('/api/deposits/'+d.id+'/release',{request_id:id,packet_id:d.packet_id,claim_token:claim.claim_token,version:claim.deposit.version,collector_label:'Riya',quantities:{normal:1,vip:0,vvip:0}});
 const results=await Promise.all([release(a,ca,'shared-release-asha'),release(b,cb,'shared-release-bea')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results[0].status===200?a:b,other=winner===a?b:a,collection=results.find(r=>r.status===200).body.collection;
 const request={request_id:'shared-final-handover',version:collection.version,handover_confirmed:true};
 assert.equal((await other.call('/api/collections/'+collection.id+'/handover',request)).status,403);
 const done=await winner.call('/api/collections/'+collection.id+'/handover',request);assert.equal(done.status,200);assert.equal(done.body.collection.handed_over_by_name,winner===a?'Asha':'Bea');
 assert.equal((await winner.call('/api/collections/'+collection.id+'/handover',request)).body.replayed,true);
 assert.equal((await f.call('/api/deposits/'+d.id+'/receipt',undefined,'foreign-workspace')).status,403);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_collections').get().n,1);
});

test('full reset clears transactions and staff, retains owner settings, rejects stale retries and is idempotent',async t=>{
 const f=fixture();t.after(f.close);const person=await staff(f,'Asha');
 const ticket=crypto.randomUUID(),body={request_id:ticket,intake_version:2,name:'Taylor',phone:'+12025550101',quantities:{normal:3,vip:0,vvip:0},recipients:[]};
 assert.equal((await f.call('/api/public/deposit',body,'')).status,200);
 const deposit=(await person.call('/api/queue/'+ticket+'/confirm',{custody_confirmed:true})).body;
 const backup=await f.call('/api/admin/backup');assert.equal(backup.status,200);assert(backup.body.tables.length>=31);
 const requestRow=backup.body.tables.find(table=>table.name==='sharepass_ledger_requests');assert(requestRow.rows.length>0);assert.equal(requestRow.short,0);
 const reset={request_id:crypto.randomUUID(),confirmation:'RESET SHAREPASS',delete_staff:true};
 assert.equal((await person.call('/api/admin/reset',reset)).status,404);assert.equal((await f.call('/api/admin/reset',{...reset,confirmation:'RESET'})).status,400);
 const result=await f.call('/api/admin/reset',reset);assert.equal(result.status,200);assert.equal(result.body.reset,true);
 for(const table of ['sharepass_ledger_deposits','sharepass_ledger_codes','sharepass_ledger_collections','sharepass_ledger_audit','sharepass_ledger_requests','sharepass_booth_queue','sharepass_configured_devices','sharepass_configured_staff'])assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n,0,table);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_staff').get().n,1);
 assert.equal((await person.call('/api/queue')).status,401);
 assert.equal((await f.call('/api/public/deposit',body,'')).status,410);assert.equal((await f.call('/api/public/deposit?ticket='+ticket,undefined,'')).status,410);
 assert.equal((await f.call('/api/deposits',{request_id:'post-reset-old-code',location:'R-01',custody_confirmed:true,custom_code:deposit.collection_code,quantities:body.quantities})).status,409);
 const fresh=await f.call('/api/deposits',{request_id:'post-reset-new-code',location:'R-02',custody_confirmed:true,quantities:body.quantities});assert.equal(fresh.status,200);assert.notEqual(fresh.body.collection_code,deposit.collection_code);
 assert.equal((await f.call('/api/admin/reset',reset)).body.replayed,true);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').get().n,1);
});
