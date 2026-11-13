import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

const refreshPath='/api/codes/refresh',recoverPath=refreshPath+'/recover';
const source=readFileSync(new URL('../web/counter.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/counter.html',import.meta.url),'utf8');
const initial={request_id:'refresh-fixture-deposit',location:'A-01',custody_confirmed:true,quantities:{normal:4,vip:2,vvip:0}};
function fixture(env={}){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+name,'utf8'));
  sqlite.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('owner@example.test','owner','Owner');
  const DB={prepare(sql){return {bind(...values){const statement=sqlite.prepare(sql);
    const all=()=>({results:statement.all(...values)}),run=()=>({meta:{changes:statement.run(...values).changes}});
    return {first:async()=>statement.get(...values)||null,all:async()=>all(),run:async()=>run(),exec:()=>statement.columns().length?all():run()};
  }};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.exec());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  async function send(path,body,{owner='owner',headers={},origin='https://fixture.example'}={}){
    return worker.fetch(new Request('https://fixture.example'+path,{headers:{...(owner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test'}:{}),...headers,
      ...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),{DB,SHAREPASS_OWNER_EMAIL:'owner@example.test',...env});
  }
  const call=async(...args)=>{const response=await send(...args);return {status:response.status,body:await response.json()};};
  async function pair(name,character,booth='B1'){
    const invite=await call('/api/admin/setup',{action:'invite',booth_id:booth,staff_name:name,device_label:name});
    assert.equal(invite.status,200);
    const secret=character.repeat(43),connected=await call('/api/device/connect',{code:invite.body.code,verifier:secret},{owner:''});
    assert.equal(connected.status,200);
    return {context:connected.body,options:{owner:'',headers:{'X-SharePass-Session':secret,'X-SharePass-Client':'0.9.6'}},id:invite.body.devices.find(d=>d.label===name).id};
  }
  const snapshot=()=>JSON.stringify(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'sharepass_ledger_%' OR name='sharepass_receipt_push') ORDER BY name").all().map(({name})=>[name,sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
  return {sqlite,send,call,pair,snapshot,close:()=>sqlite.close()};
}

// Execute the complete counter script and its actual event handlers. This is a
// DOM/transport model, not browser rendering or device acceptance.
async function page(f,{storage=new Map(),options={},intercept,context}={}){
  const nodes=new Map(),calls=[];
  class Node{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.children=[];this.textContent='';this.required=false;this.readOnly=false;this.selectedOptions=[{textContent:'1 day'}];this.classList={add(){},toggle(){}};this.fields=new Map();this.elements=new Proxy({},{get:(_,key)=>{if(!this.fields.has(key))this.fields.set(key,new Node(id+'-'+key));return this.fields.get(key);}});}
    addEventListener(){} focus(){} append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;} querySelector(){return new Node('child');} querySelectorAll(){return [];} reset(){for(const n of this.fields.values())n.value='';}
  }
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const node=id=>{assert(ids.has(id),'Actual counter markup must contain #'+id);if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
  const sectionIds=[...html.matchAll(/<section id="([^"]+)"/g)].map(m=>m[1]);
  const document={getElementById:node,querySelector:()=>null,querySelectorAll:selector=>selector==='main>section'?sectionIds.map(node):[],createElement:tag=>new Node(tag),addEventListener(){}};
  const stored={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const sandbox={document,window:{SharePassDrafts:{clear(){},composeLink:()=>new Node('link'),renderDeposit(){}},addEventListener(){}},navigator:{},crypto,AbortSignal,URL,
    sessionStorage:stored,location:{origin:'https://fixture.example',assign(){}},getComputedStyle:()=>({getPropertyValue:()=>''}),setTimeout:()=>0,clearTimeout(){},
    DemoStore:class{passTypes=[{id:'normal',label:'Normal'},{id:'vip',label:'VIP'},{id:'vvip',label:'VVIP'}];},
    sharePassSteps:()=>({show(){}}),sharePassAutoAdvance(){},fetch:async(path,init={})=>{
      const body=init.body?JSON.parse(init.body):undefined;
      calls.push({path,body});
      if(path==='/api/context'&&context)return Response.json(context);
      const normal=()=>f.send(path,body,options);
      return intercept?intercept(path,body,normal):normal();
    }};
  runInNewContext(source+'\nglobalThis.testCounter={showReceipt,show,openRefresh,recover,request,runRefresh,ready,state:()=>({receipt,recovery,view,busy}),setStorage:value=>{sessionStorage=value;}};',sandbox,{filename:'counter.js'});
  const api=sandbox.testCounter;
  async function settle(){for(let i=0;i<100;i++){await Promise.resolve();if(!api.state().busy&&api.state().view!=='loading'){await Promise.resolve();return;}}throw Error('Counter did not settle');}
  await settle();
  const click=async id=>{const result=node(id).onclick();await result;await settle();};
  const submit=async()=>{await node('refresh-code-form').onsubmit({preventDefault(){}});await settle();};
  return {api,node,calls,storage,stored,click,submit,settle};
}
const journal=p=>JSON.parse([...p.storage.values()][0]||'null');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function receipt(f,options){const made=await f.call('/api/deposits',initial,options);assert.equal(made.status,200);return made.body;}
// Recovery tests deliberately enter the retained interrupted-request form. The
// normal receipt icon now rotates immediately and is exercised separately below.
async function start(p,data){p.api.showReceipt(data);p.api.openRefresh();p.node('refresh-code-form').elements.packet.value=data.deposit.packet_id;}

test('receipt refresh icon rotates once without asking for a packet label',async()=>{
  const f=fixture();try{
    const data=await receipt(f),p=await page(f);p.api.showReceipt(data);
    await p.click('refresh-saved-code');
    assert.equal(p.api.state().view,'saved');
    assert.notEqual(p.api.state().receipt.collection_code,data.collection_code);
    assert.equal(p.storage.size,0);
    const writes=p.calls.filter(call=>call.path===refreshPath);
    assert.equal(writes.length,1);
    assert.equal(writes[0].body.packet_id,data.deposit.packet_id);
    assert.equal(writes[0].body.collection_code,data.collection_code);
    assert.match(html,/<input name="packet" type="hidden">/);
    const old=await f.call('/api/verify',{collection_code:data.collection_code});
    assert.notEqual(old.status,200,'The superseded code must not authorize another pickup');
  }finally{f.close();}
});

for(const reopen of [false,true])test('lost committed refresh recovers identically '+(reopen?'after Cancel/reopen':'on immediate retry'),async()=>{
  const f=fixture();let lose=true,committed;
  try{
    const data=await receipt(f),p=await page(f,{intercept:async(path,body,normal)=>{const result=await normal();if(path===refreshPath&&lose){lose=false;committed=await result.json();throw Error('Response lost');}return result;}});
    await start(p,data);await p.submit();
    const saved=journal(p);assert(saved);assert.deepEqual(Object.keys(saved.body).sort(),['packet_id','request_id']);assert(!JSON.stringify(saved).includes(data.collection_code));
    if(reopen){await p.click('cancel-refresh');assert.equal(p.node('saved-code').textContent,'Refresh pending');await p.click('refresh-saved-code');}
    else await p.submit();
    assert.equal(p.api.state().receipt.collection_code,committed.collection_code);assert.equal(p.api.state().view,'saved');assert.equal(p.storage.size,0);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sharepass_ledger_requests WHERE owner=?').get('owner').n,2);
    const posts=p.calls.filter(c=>c.path===refreshPath);assert(posts.every(c=>c.body.request_id===saved.body.request_id));
  }finally{f.close();}
});

test('reload restores a code-free journal and returns the original replacement from the desk',async()=>{
  const f=fixture();try{
    const data=await receipt(f),storage=new Map(),p=await page(f,{storage,intercept:async(path,body,normal)=>{const r=await normal();if(path===refreshPath)throw Error('Lost');return r;}});
    await start(p,data);await p.submit();const saved=journal(p),before=f.snapshot();
    const reloaded=await page(f,{storage});assert.equal(reloaded.api.state().receipt,undefined);
    assert.equal(reloaded.node('recovery').children[0].textContent,'Recover last action');
    await reloaded.node('recovery').children[0].onclick();await reloaded.settle();
    assert.equal(reloaded.api.state().view,'saved');assert.equal(storage.size,0);assert.notEqual(reloaded.api.state().receipt.collection_code,data.collection_code);
    assert.equal(f.snapshot(),before);assert.deepEqual(reloaded.calls.find(c=>c.path===recoverPath).body,saved.body);
  }finally{f.close();}
});

test('a lost request before commit can be retried after reload using the original code and same ID',async()=>{
  const f=fixture();try{
    const data=await receipt(f),storage=new Map(),p=await page(f,{storage,intercept:(path,body,normal)=>path===refreshPath?Promise.reject(Error('Not delivered')):normal()});
    await start(p,data);await p.submit();const saved=journal(p);
    const next=await page(f,{storage});await next.api.recover();
    assert.equal(next.api.state().view,'refresh-code');assert.equal(next.node('refresh-original-code').hidden,false);assert.equal(next.node('refresh-code-form').elements.code.required,true);
    assert.equal(next.node('refresh-code-form').elements.packet.readOnly,true);assert.equal(storage.size,1);
    next.node('refresh-code-form').elements.code.value=data.collection_code;await next.submit();
    assert.equal(next.api.state().view,'saved');assert.equal(storage.size,0);assert.equal(next.calls.find(c=>c.path===refreshPath).body.request_id,saved.body.request_id);
  }finally{f.close();}
});

test('a different packet cannot replace the pending refresh or bypass the mutation journal',async()=>{
  const f=fixture();try{
    const data=await receipt(f),p=await page(f,{intercept:(path,body,normal)=>path===refreshPath?Promise.reject(Error('Offline')):normal()});
    await start(p,data);p.node('refresh-code-form').elements.packet.value='PKT-AAAAAAAA';await p.submit();assert.equal(p.storage.size,0);assert.equal(p.calls.filter(c=>c.path===refreshPath).length,0);
    p.node('refresh-code-form').elements.packet.value=data.deposit.packet_id;await p.submit();const saved=journal(p);
    p.node('refresh-code-form').elements.packet.value='PKT-BBBBBBBB';await p.submit();assert.deepEqual(journal(p),saved);assert.equal(p.calls.filter(c=>c.path===refreshPath).length,1);
    assert.throws(()=>p.api.request('/api/deposits',initial),/Recover the last action/);
    await p.click('cancel-refresh');await p.click('share-action');assert.equal(p.api.state().view,'refresh-code');assert.deepEqual(journal(p),saved);
  }finally{f.close();}
});

test('definitive initial failure clears only its journal and a later refresh gets a new ID',async()=>{
  const f=fixture();let reject=true;try{
    const data=await receipt(f),p=await page(f,{intercept:(path,body,normal)=>path===refreshPath&&reject?Response.json({error:'Check packet',notExecuted:true},{status:400}):normal()});
    await start(p,data);await p.submit();assert.equal(p.storage.size,0);assert.equal(p.node('error').textContent,'Check packet');reject=false;
    await p.submit();const posts=p.calls.filter(c=>c.path===refreshPath);assert.notEqual(posts[0].body.request_id,posts[1].body.request_id);assert.equal(p.storage.size,0);
    p.api.openRefresh();p.node('refresh-code-form').elements.packet.value=data.deposit.packet_id;await p.submit();assert.equal(new Set(p.calls.filter(c=>c.path===refreshPath).map(c=>c.body.request_id)).size,3);
  }finally{f.close();}
});

test('journal write failure prevents submission; cleanup failure preserves recoverability',async()=>{
  const f=fixture();try{
    const data=await receipt(f),p=await page(f);await start(p,data);
    p.api.setStorage({...p.stored,setItem(){throw Error('Storage full');}});await p.submit();assert.equal(p.calls.filter(c=>c.path===refreshPath).length,0);
    p.api.setStorage({...p.stored,removeItem(){throw Error('Cannot clear');}});await p.submit();assert(journal(p));
    p.api.setStorage(p.stored);await p.api.recover();assert.equal(p.storage.size,0);assert.equal(p.api.state().view,'saved');
  }finally{f.close();}
});

test('navigation while refresh is in flight cannot be undone by a stale success',async()=>{
  const f=fixture(),gate=deferred(),started=deferred();try{
    const data=await receipt(f),p=await page(f,{intercept:async(path,body,normal)=>{const r=await normal();if(path===refreshPath){started.resolve();await gate.promise;}return r;}});
    await start(p,data);const submitting=p.submit();await started.promise;p.api.show('desk');gate.resolve();await submitting;
    assert.equal(p.api.state().view,'desk');assert(journal(p));await p.api.recover();assert.equal(p.api.state().view,'saved');assert.equal(p.storage.size,0);
  }finally{f.close();}
});

test('a stale failure cannot overwrite a newer view and a changed session cannot clear the old journal',async()=>{
  const f=fixture(),gate=deferred(),started=deferred();try{
    const data=await receipt(f),p=await page(f,{intercept:async(path,body,normal)=>{if(path===refreshPath){started.resolve();await gate.promise;throw Error('Offline');}return normal();}});
    await start(p,data);const submitting=p.submit();await started.promise;
    p.api.ready({session_key:'other-staff',staff_label:'Other',booth_id:'B1'});p.node('error').textContent='New session message';gate.resolve();await submitting;
    assert.equal(p.api.state().view,'desk');assert.equal(p.node('error').textContent,'New session message');assert(p.storage.has('sharepass-pending:owner'));assert.equal(p.api.state().recovery,null);
  }finally{f.close();}
});

test('out-of-order recovery responses cannot replace the newer result or clear a newer action',async()=>{
  const f=fixture(),older=deferred();try{
    const data=await receipt(f),p=await page(f,{intercept:(path,body,normal)=>path===refreshPath?Promise.reject(Error('Offline')):normal()});
    await start(p,data);await p.submit();const action=p.api.state().recovery;
    const a=p.api.runRefresh(action,()=>older.promise,true);
    const latest={...data,collection_code:'NEW1'};await p.api.runRefresh(action,()=>Promise.resolve(latest),true);
    older.resolve({...data,collection_code:'OLD1'});await a;assert.equal(p.api.state().receipt.collection_code,'NEW1');assert.equal(p.storage.size,0);
  }finally{f.close();}
});

test('expired session rejection retains an uncertain journal, and another staff session cannot load it',async()=>{
  const f=fixture();let denied=false;try{
    const data=await receipt(f),storage=new Map(),p=await page(f,{storage,intercept:(path,body,normal)=>path===refreshPath?Promise.reject(Error('Offline')):path===recoverPath&&denied?Response.json({error:'Sign in again',notExecuted:true},{status:401}):normal()});
    await start(p,data);await p.submit();denied=true;await p.click('refresh-saved-code');assert(journal(p));
    const other=await page(f,{storage,context:{session_key:'someone-else',staff_label:'Other',booth_id:'B1'}});assert.equal(other.api.state().recovery,null);assert.equal(storage.size,1);
  }finally{f.close();}
});

test('recovery endpoint is exact-operation and staff/booth/workspace scoped, read-only, and rejects stale replacements',async()=>{
  const f=fixture();try{
    const original=await f.pair('Original','A'),peer=await f.pair('Peer','B');
    const data=await receipt(f,original.options),body={request_id:crypto.randomUUID(),packet_id:data.deposit.packet_id,collection_code:data.collection_code};
    const refreshed=await f.call(refreshPath,body,original.options);assert.equal(refreshed.status,200);
    const saved={request_id:body.request_id,packet_id:body.packet_id},before=f.snapshot();
    const replay=await f.call(recoverPath,saved,original.options);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.collection_code,refreshed.body.collection_code);assert.equal(f.snapshot(),before);
    for(const options of [peer.options,{owner:'owner'}])assert.equal((await f.call(recoverPath,saved,options)).status,404);
    assert.equal((await f.call(recoverPath,{...saved,packet_id:'PKT-AAAAAAAA'},original.options)).status,404);
    assert.deepEqual((await f.call(recoverPath,{...saved,request_id:crypto.randomUUID()},original.options)).body,{refresh_pending:true});
    assert.equal((await f.call(recoverPath,{...saved,request_id:initial.request_id},original.options)).status,400);
    // A UUID used for a different operation must not reveal its receipt.
    const otherId=crypto.randomUUID();await f.call('/api/deposits',{...initial,location:'A-02',request_id:otherId},original.options);
    assert.equal((await f.call(recoverPath,{...saved,request_id:otherId},original.options)).status,404);
    const staffId=original.context.session_key;
    const booth=(await f.call('/api/admin/setup',{action:'booth',name:'Other booth',location:'Elsewhere'})).body.booths.find(b=>b.name==='Other booth');
    f.sqlite.prepare('UPDATE sharepass_configured_staff SET booth_id=? WHERE id=?').run(booth.id,staffId);
    assert.equal((await f.call(recoverPath,saved,original.options)).status,404);
    f.sqlite.prepare('UPDATE sharepass_configured_staff SET booth_id=? WHERE id=?').run('B1',staffId);
    f.sqlite.prepare('INSERT INTO sharepass_configured_booths VALUES(?,?,?,?,?)').run('other-workspace','B1','Other workspace','Elsewhere',crypto.randomUUID());
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET workspace=? WHERE id=?').run('other-workspace',original.id);
    const otherWorkspace=await f.call(recoverPath,saved,original.options);
    assert.deepEqual(otherWorkspace.body,{refresh_pending:true});
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET workspace=? WHERE id=?').run('owner',original.id);
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET session_expires=0 WHERE id=?').run(original.id);
    assert.equal((await f.call(recoverPath,saved,original.options)).status,401);
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET session_expires=?,active=0 WHERE id=?').run(Date.now()+60000,original.id);
    assert.equal((await f.call(recoverPath,saved,original.options)).status,401);
    f.sqlite.prepare('UPDATE sharepass_configured_devices SET active=1 WHERE id=?').run(original.id);
    const next=await f.call(refreshPath,{...body,request_id:crypto.randomUUID(),collection_code:refreshed.body.collection_code},original.options);assert.equal(next.status,200);
    const stale=await f.call(recoverPath,saved,original.options);assert.equal(stale.status,409);assert.equal(stale.body.refreshResolved,true);assert.equal(stale.body.collection_code,undefined);
    assert.equal((await f.call(recoverPath,saved,{owner:'',origin:'https://foreign.example',headers:{Cookie:'__Host-sharepass-staff='+'A'.repeat(43)}})).status,403);
  }finally{f.close();}
});

test('supervisor replacement clears the matching stale receipt and never re-shares either obsolete or supervisor code',async()=>{
  const f=fixture();let replacement;try{
    const data=await receipt(f),p=await page(f,{intercept:async(path,body,normal)=>{const r=await normal();if(path===refreshPath){replacement=await r.json();throw Error('Lost');}return r;}});
    await start(p,data);await p.submit();const saved=journal(p);
    const supervisor=await f.call(refreshPath,{request_id:crypto.randomUUID(),packet_id:data.deposit.packet_id,collection_code:replacement.collection_code});assert.equal(supervisor.status,200);
    await p.click('cancel-refresh');await p.click('share-action');
    assert.equal(p.storage.size,0);assert.equal(p.api.state().receipt,undefined);assert.equal(p.api.state().view,'desk');assert.equal(p.node('saved-code').textContent,'');
    assert.match(p.node('error').textContent,/replaced by a supervisor/);
    await p.click('share-action');assert.equal(p.api.state().view,'desk');assert.equal(p.node('saved-code').textContent,'');
    assert.equal(p.calls.filter(c=>c.path===refreshPath).length,1);assert(p.calls.some(c=>c.path===recoverPath&&c.body.request_id===saved.body.request_id));
  }finally{f.close();}
});

test('a delayed terminal replay does not erase a newer packet receipt',async()=>{
  const f=fixture(),gate=deferred();try{
    const data=await receipt(f),p=await page(f,{intercept:(path,body,normal)=>path===refreshPath?Promise.reject(Error('Offline')):normal()});
    await start(p,data);await p.submit();const saved=p.api.state().recovery;
    const waiting=p.api.runRefresh(saved,()=>gate.promise,true);
    const newer=(await f.call('/api/deposits',{...initial,request_id:'second-fixture-deposit',location:'B-01'})).body;
    p.api.showReceipt(newer);
    gate.resolve(Promise.reject(Object.assign(Error('Superseded'),{notExecuted:true,refreshResolved:true})));await waiting;
    assert.equal(p.api.state().receipt.collection_code,newer.collection_code);assert.equal(p.api.state().view,'saved');assert.equal(p.storage.size,0);
  }finally{f.close();}
});

test('missing original request stays pending without rotating the ID or exposing another code',async()=>{
  const f=fixture();try{
    const data=await receipt(f),storage=new Map(),p=await page(f,{storage,intercept:async(path,body,normal)=>{const r=await normal();if(path===refreshPath)throw Error('Lost');return r;}});
    await start(p,data);await p.submit();const saved=journal(p);
    f.sqlite.prepare('DELETE FROM sharepass_ledger_requests WHERE owner=? AND id=?').run('owner',saved.body.request_id);
    const next=await page(f,{storage});await next.api.recover();await next.api.recover();
    assert.deepEqual(journal(next),saved);assert.equal(next.api.state().view,'refresh-code');assert.equal(next.calls.filter(c=>c.path===refreshPath).length,0);
    await next.click('cancel-refresh');assert.equal(next.api.state().view,'desk');assert.equal(storage.size,1);
  }finally{f.close();}
});

test('read-only replay never notifies, renews, or resurrects guest receipt alert consent',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk=publicKey.export({format:'jwk'});
  const vapid=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
  const f=fixture({SHAREPASS_WEB_PUSH_PUBLIC_KEY:vapid,SHAREPASS_WEB_PUSH_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'}))});
  const originalFetch=globalThis.fetch,notifications=[],endpoint='https://fcm.googleapis.com/fcm/send/synthetic-refresh-fixture';
  globalThis.fetch=async(url,options)=>{assert.equal(url,endpoint);notifications.push(options);return new Response(null,{status:201});};
  try{
    const poster=new URL((await f.call('/api/booth')).body.url).pathname,path='/api/public'+poster,ticket=crypto.randomUUID();
    assert.equal((await f.call(path,{request_id:ticket,name:'Synthetic guest',phone:'+12025550101',email:'',intake_version:2,recipients:[{name:'Synthetic collector',phone:'+12025550102',quantities:initial.quantities}],quantities:initial.quantities},{owner:''})).status,200);
    assert.equal((await f.call(path+'/alerts',{action:'enable',ticket,endpoint},{owner:''})).status,200);
    const data=(await f.call('/api/queue/'+ticket+'/confirm',{location:'A-01',custody_confirmed:true})).body;
    const body={request_id:crypto.randomUUID(),packet_id:data.deposit.packet_id,collection_code:data.collection_code};
    assert.equal((await f.call(refreshPath,body)).status,200);assert.equal(notifications.length,2);
    const saved={request_id:body.request_id,packet_id:body.packet_id};
    for(const consent of ['live','expired','stopped']){
      if(consent==='expired')f.sqlite.prepare('UPDATE sharepass_receipt_push SET expires_at=0 WHERE ticket=?').run(ticket);
      if(consent==='stopped')f.sqlite.prepare('DELETE FROM sharepass_receipt_push WHERE ticket=?').run(ticket);
      const before=f.snapshot();
      assert.equal((await f.call(recoverPath,saved)).body.replayed,true);
      assert.equal(f.snapshot(),before);assert.equal(notifications.length,2,consent+' consent must not be notified');
    }
  }finally{globalThis.fetch=originalFetch;f.close();}
});

test('numeric refresh rejects letters locally without creating a mutation journal',async()=>{
  const f=fixture();try{
    const data=await receipt(f),p=await page(f);
    await start(p,{...data,collection_code:'K7M4'});await p.submit();
    assert.equal(p.storage.size,0);
    assert.equal(p.calls.filter(c=>c.path===refreshPath).length,0);
    assert.equal(p.node('error').textContent,'Enter the original four-digit collection code.');
  }finally{f.close();}
});
