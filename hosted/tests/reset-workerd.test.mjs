import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

test('Workerd exports and restores complete long rows; reset preserves owner settings and foreign registers',{skip:!process.env.SHAREPASS_MINIFLARE_MODULE},async()=>{
 const {Miniflare}=createRequire(import.meta.url)(process.env.SHAREPASS_MINIFLARE_MODULE);
 const runtime=new Miniflare({cf:false,modules:true,script:readFileSync('dist/server/index.js','utf8'),compatibilityDate:'2026-01-01',d1Databases:['DB'],bindings:{SHAREPASS_OWNER_EMAIL:'owner@example.test'}});
 try{
  const db=await runtime.getD1Database('DB'),files=readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort();
  for(const file of files)for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  await db.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').bind('owner@example.test','owner','Owner').run();
  const call=async(path,body,token,origin='https://test.example')=>{
   const headers=token?{'X-SharePass-Session':token,'X-SharePass-Client':'0.9.21'}:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};
   if(body)Object.assign(headers,{Origin:origin,'Content-Type':'application/json'});
   const response=await runtime.dispatchFetch('https://test.example'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
   return {status:response.status,headers:response.headers,body:await response.json()};
  };
  const pair=async(name,character)=>{
   const invitation=await call('/api/admin/setup',{action:'invite',staff_name:name,device_label:name});assert.equal(invitation.status,200);
   const token=character.repeat(43),result=await call('/api/device/connect',{code:invitation.body.code,verifier:token},'');assert.equal(result.status,200);
   return {token,id:result.body.session_key};
  };
  const asha=await pair('Asha','A'),bea=await pair('Bea','B');
  assert.equal((await call('/api/admin/backup',undefined,asha.token)).status,404);
  const prompt=await call('/api/admin/staff-messages',{id:crypto.randomUUID(),message:'Synthetic targeted message',per_person:true,booth_id:'all',recipient_id:asha.id});assert.equal(prompt.status,200);
  assert.equal(prompt.body.messages[0].responses.length,1);assert.equal(prompt.body.messages[0].responses[0].name,'Asha');
  assert.equal((await call('/api/queue',undefined,bea.token)).body.messages?.length||0,0);
  assert.equal((await call('/api/queue',undefined,asha.token)).body.messages.length,1);
  const ticket=crypto.randomUUID(),intake={request_id:ticket,intake_version:2,name:'Taylor',phone:'+12025550101',quantities:{normal:2,vip:0,vvip:0},recipients:[]};
  assert.equal((await call('/api/public/deposit',intake)).status,200);
  const accepted=await call('/api/queue/'+ticket+'/confirm',{custody_confirmed:true},asha.token);assert.equal(accepted.status,200);
  const requestId='booth-'+ticket,row=await db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE owner=? AND id=?').bind('owner',requestId).first();
  const large=JSON.stringify({...JSON.parse(row.payload),backup_padding:'x'.repeat(7000)});
  await db.prepare('UPDATE sharepass_ledger_requests SET payload=? WHERE owner=? AND id=?').bind(large,'owner',requestId).run();
  await db.prepare('INSERT INTO sharepass_code_policy(owner,event,theme,overrides) VALUES(?,?,?,?)').bind('owner','training-event-001','Keep this setting','{}').run();
  await db.prepare('INSERT INTO sharepass_owner_passwords(owner_id,salt,hash) VALUES(?,?,?)').bind('owner','synthetic-salt','synthetic-hash').run();
  // Distinct ownership is an authorization boundary even within the same D1 database.
  await db.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').bind('foreign@example.test','foreign-owner','Foreign owner').run();
  await db.prepare('INSERT INTO sharepass_ledger_ready(owner) VALUES(?)').bind('foreign-owner').run();
  await db.prepare('INSERT INTO sharepass_mobile_sessions(digest,user_id,email,expires_at,revoked) VALUES(?,?,?,?,0)').bind('foreign-session','foreign-owner','foreign@example.test',Date.now()+60000).run();
  await db.prepare('INSERT INTO sharepass_configured_booths(workspace,id,name,location,poster_token) VALUES(?,?,?,?,?)').bind('foreign-owner','B1','Foreign legacy storage','Elsewhere',crypto.randomUUID()).run();
  await db.prepare('INSERT INTO sharepass_configured_staff(workspace,id,booth_id,name) VALUES(?,?,?,?)').bind('foreign-owner','foreign-staff','B1','Foreign staff').run();
  await db.prepare('INSERT INTO sharepass_configured_devices(workspace,id,staff_id,label,invite,setup_code,invite_expires) VALUES(?,?,?,?,?,?,?)').bind('foreign-owner','foreign-device','foreign-staff','Foreign phone',crypto.randomUUID(),'',Date.now()+60000).run();
  const foreignToken='F'.repeat(43),foreignDigest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(foreignToken))).toString('hex');
  await db.prepare('UPDATE sharepass_configured_devices SET digest=?,session_expires=0 WHERE id=?').bind(foreignDigest,'foreign-device').run();
  const ownDevice=(await db.prepare('SELECT id FROM sharepass_configured_devices WHERE workspace=? LIMIT 1').bind('owner').first()).id;
  for(const device of [ownDevice,'foreign-device'])await db.prepare('INSERT INTO sharepass_android_release_deliveries(version_code,device_id,delivered_at) VALUES(?,?,?)').bind(31,device,Date.now()).run();
  const backup=await call('/api/admin/backup');assert.equal(backup.status,200);
  assert.equal(backup.headers.get('Cache-Control'),'no-store');assert.match(backup.headers.get('Content-Disposition'),/attachment/);
  const table=backup.body.tables.find(value=>value.name==='sharepass_ledger_requests');assert.equal(table.rows[0].payload,large);assert(table.rows[0].payload.length>4096);
  const restored=new DatabaseSync(':memory:');
  try{
   for(const file of files)restored.exec(readFileSync('drizzle/'+file,'utf8'));
   const ordered=[...backup.body.tables].sort((a,b)=>(a.name==='sharepass_workspaces'?-1:b.name==='sharepass_workspaces'?1:0));
   for(const current of ordered){
    assert.equal(current.short,0);assert.match(current.name,/^sharepass_[a-z_]+$/);
    for(const column of current.columns)assert.match(column,/^[a-z_]+$/);
    restored.exec('DELETE FROM '+current.name);
    const insert=restored.prepare('INSERT INTO '+current.name+' ('+current.columns.join(',')+') VALUES ('+current.columns.map(()=>'?').join(',')+')');
    for(const value of current.rows)insert.run(...current.columns.map(key=>value[key]));
    const exact=values=>values.map(value=>JSON.stringify(current.columns.map(key=>value[key]))).sort();
    assert.deepEqual(exact(restored.prepare('SELECT * FROM '+current.name).all()),exact(current.rows));
   }
   assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{restored.close();}
  const reset={request_id:crypto.randomUUID(),confirmation:'RESET SHAREPASS',delete_staff:true};
  assert.equal((await call('/api/admin/reset',reset,asha.token)).status,404);
  assert.equal((await call('/api/admin/reset',reset,undefined,'https://foreign.example')).status,403);
  const resetResult=await call('/api/admin/reset',reset);assert.equal(resetResult.status,200);
  const disconnected=await call('/api/context',undefined,asha.token);assert.equal(disconnected.status,401);assert.equal(disconnected.body.register_reset_at,resetResult.body.reset_at);
  const foreignExpired=await call('/api/context',undefined,foreignToken);assert.equal(foreignExpired.status,401);assert.equal(foreignExpired.body.register_reset_at,0);
  const unknown=await call('/api/context',undefined,'Z'.repeat(43));assert.equal(unknown.status,401);assert.equal(unknown.body.register_reset_at,0);
  for(const [name,column] of [['sharepass_ledger_deposits','owner'],['sharepass_ledger_codes','owner'],['sharepass_ledger_requests','owner'],['sharepass_configured_staff','workspace'],['sharepass_configured_devices','workspace'],['sharepass_staff_prompts','workspace']])assert.equal((await db.prepare('SELECT count(*) AS n FROM '+name+' WHERE '+column+'=?').bind('owner').first()).n,0);
  assert.equal((await db.prepare('SELECT id FROM sharepass_configured_devices WHERE id=?').bind('foreign-device').first())?.id,'foreign-device');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sharepass_android_release_deliveries WHERE device_id=?').bind(ownDevice).first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sharepass_android_release_deliveries WHERE device_id=?').bind('foreign-device').first()).n,1);
  assert.equal((await db.prepare('SELECT hash FROM sharepass_owner_passwords WHERE owner_id=?').bind('owner').first()).hash,'synthetic-hash');
  assert.equal((await db.prepare('SELECT theme FROM sharepass_code_policy WHERE owner=? AND event=?').bind('owner','training-event-001').first()).theme,'Keep this setting');
  assert.equal((await db.prepare('SELECT user_id FROM sharepass_staff WHERE email=?').bind('foreign@example.test').first())?.user_id,'foreign-owner','Reset must not remove a different register owner');
  assert.equal((await db.prepare('SELECT digest FROM sharepass_mobile_sessions WHERE digest=?').bind('foreign-session').first())?.digest,'foreign-session');
  const revoked=JSON.parse((await db.prepare('SELECT overrides FROM sharepass_code_policy WHERE owner=? AND event=?').bind('owner','sharepass-register-reset').first()).overrides).memberships;
  assert(revoked.includes('foreign-owner'));assert(!revoked.includes('owner'));
  assert.equal((await call('/api/public/deposit',intake)).status,410);
  const fresh=await call('/api/deposits',{request_id:'after-reset-fresh',location:'N-01',custody_confirmed:true,quantities:{normal:1,vip:0,vvip:0}});assert.equal(fresh.status,200);assert.notEqual(fresh.body.collection_code,accepted.body.collection_code);
  assert.equal((await call('/api/admin/reset',reset)).body.replayed,true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sharepass_ledger_deposits').first()).n,1);
 }finally{await runtime.dispose();}
});
